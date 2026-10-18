/**
 * テスト勉強の自動スケジューラ。
 *
 * 考え方（「残り日数で割るだけ」にしないための工夫）:
 * - 3周制: 1周目=理解・提出物 / 2周目=×と△だけ解き直し / 3周目=仕上げ（暗記は全体の最終チェック）
 * - 1周目は勉強期間の前半までに終わらせる（後半を解き直しに使うため）。提出物は締切の前日まで
 * - 2周目は1周目が終わった「次の日以降」に置く（間を空けた方が定着する＝分散学習）
 * - 3周目はテスト3日前〜前日に置く（暗記ものはテスト直前に最後に触れる）
 * - 苦手度・目標点との差が大きい教科ほど重みを上げ、空いた時間には重い教科を前倒しで入れる
 * - 1日に扱う教科数と、1教材・1教科あたりの時間に上限を設けて、ダラダラ1教科だけにならないようにする
 * - 使える時間の loadFactor 分だけ埋め、残りは遅れを吸収する予備にする
 * - 時間が足りないときは、得意教科の3周目→2周目の順に削り、何を削ったかを返す（提出物と1周目は削らない）
 */
import { addDays, dateRange, diffDays } from './date.ts';
import type {
  Exam,
  ExamSubject,
  ISODate,
  Material,
  Pass,
  PlannedTask,
  ProgressLog,
  Settings,
} from './types.ts';

/** 1回の勉強の最小単位（分）。これより細切れにしても身につかない */
const MIN_CHUNK_MIN = 15;
/** 1教材を1日に続けてやる上限（分）。暗記ものは短く区切って何日かに分ける */
const ITEM_CAP_MIN = { memory: 40, problem: 80 } as const;
/** 1教科を1日にやる上限（分） */
const SUBJECT_CAP_MIN = 120;
/** 1周目の締切：勉強期間のこの割合の地点まで */
const PASS1_DEADLINE_RATIO = 0.5;
/** 3周目を始める日（テストの何日前から） */
const PASS3_START_DAYS_BEFORE = 3;
/** 入らなかったときの損の重み（1周目は提出物・最低限の理解なので最優先） */
const PASS_VALUE = { 1: 100, 2: 3, 3: 1 } as const;
/** 1日の目安量を均等ペースよりどれだけ多めにするか（前倒し気味にして終盤に余裕を残す） */
const FRONT_LOAD = 1.25;
/** 1周目→2周目でまだできない割合（2周目の記録がまだないときの見積もり） */
const DEFAULT_PASS2_WRONG_RATE = 0.4;
/** 各周の1単位あたり時間の倍率 */
const PASS_TIME_FACTOR = {
  problem: { 1: 1, 2: 1.3, 3: 1.2 },
  memory: { 1: 1, 2: 0.6, 3: 0.3 },
} as const;

export interface PlanInput {
  exam: Exam;
  /** 計画を作り始める日 */
  startDate: ISODate;
  /** その日に勉強できる分（loadFactor をかける前） */
  capacity: (date: ISODate) => number;
  /** この試験の進捗記録 */
  logs: ProgressLog[];
  /** すでに割り当て済みとみなすタスク（今日の未完了タスクなど） */
  assumedDone?: PlannedTask[];
  settings: Settings;
}

export interface PlanItemRef {
  subjectId: string;
  materialId: string;
  pass: Pass;
  units: number;
  minutes: number;
}

export interface PlanResult {
  tasks: PlannedTask[];
  /** 時間が足りず削った項目 */
  trimmed: PlanItemRef[];
  /** 削っても入りきらなかった項目（予定の見直しが必要） */
  overflow: PlanItemRef[];
  demandMinutes: number;
  capacityMinutes: number;
}

/** 苦手度から、1周目で×・△になる割合を見積もる（1→22%, 5→50%） */
export function defaultWrongRate(weakness: number): number {
  return 0.15 + 0.07 * weakness;
}

/** 暗記型の教材か（単語、暗記教科の教科書・ノート・プリント） */
export function isMemoryMaterial(m: Material, s: ExamSubject): boolean {
  return m.kind === 'vocab' || (s.kind === 'memorize' && m.kind !== 'workbook');
}

export function totalUnits(m: Material): number {
  return Math.max(0, m.rangeEnd - m.rangeStart + 1);
}

/** 教科の重み。苦手なほど・目標点との差が大きいほど重い */
export function subjectWeight(s: ExamSubject): number {
  const gap =
    s.targetScore !== undefined && s.lastScore !== undefined
      ? Math.max(0, s.targetScore - s.lastScore)
      : 0;
  return (0.6 + 0.2 * s.weakness) * (1 + gap / 50);
}

export interface MaterialProgress {
  /** 周ごとの目標量（2・3周目は×の数から見積もる） */
  target: Record<Pass, number>;
  /** 周ごとのやった量 */
  done: Record<Pass, number>;
}

function sumLogs(logs: ProgressLog[], pass: Pass) {
  let amount = 0;
  let ratedAmount = 0;
  let ratedWrong = 0;
  for (const l of logs) {
    if (l.pass !== pass) continue;
    amount += l.amount;
    if (l.wrong !== undefined) {
      ratedAmount += l.amount;
      ratedWrong += l.wrong;
    }
  }
  return { amount, ratedAmount, ratedWrong };
}

/** 記録した×の数から次の周の量を見積もる。記録が少ないうちは既定の割合を使う */
function estimateNext(
  base: number,
  rec: { ratedAmount: number; ratedWrong: number },
  fallbackRate: number,
): number {
  const rate = rec.ratedAmount >= 3 ? rec.ratedWrong / rec.ratedAmount : fallbackRate;
  const rest = Math.max(0, base - rec.ratedAmount);
  return Math.min(base, Math.ceil(rec.ratedWrong + rest * rate));
}

/** 教材ごとの進み具合（周ごとの目標量とやった量） */
export function materialProgress(
  m: Material,
  s: ExamSubject,
  logs: ProgressLog[],
): MaterialProgress {
  const mine = logs.filter((l) => l.materialId === m.id);
  const total = totalUnits(m);
  const p1 = sumLogs(mine, 1);
  const p2 = sumLogs(mine, 2);
  const p3 = sumLogs(mine, 3);
  const t2 = m.passes >= 2 ? estimateNext(total, p1, defaultWrongRate(s.weakness)) : 0;
  let t3 = 0;
  if (m.passes >= 3) {
    t3 = isMemoryMaterial(m, s) ? total : estimateNext(t2, p2, DEFAULT_PASS2_WRONG_RATE);
  }
  return {
    target: { 1: total, 2: t2, 3: t3 },
    done: { 1: Math.min(total, p1.amount), 2: Math.min(t2, p2.amount), 3: Math.min(t3, p3.amount) },
  };
}

/** その周の1単位あたりの時間（分） */
export function minutesPerUnit(m: Material, s: ExamSubject, pass: Pass): number {
  const style = isMemoryMaterial(m, s) ? 'memory' : 'problem';
  return Math.max(0.5, m.minutesPerUnit * PASS_TIME_FACTOR[style][pass]);
}

interface WorkItem {
  key: string;
  subject: ExamSubject;
  material: Material;
  pass: Pass;
  remaining: number;
  /** 計画を作り始めた時点の残り量（理想のペースの計算に使う） */
  initial: number;
  nextFrom?: number;
  mpu: number;
  release: ISODate;
  deadline: ISODate;
  /** 絶対に守る締切（提出物の締切前日、またはテスト前日）。目安の締切を過ぎたらこちらを使う */
  hardDeadline: ISODate;
  /** この日より前にやる（テスト当日以降はやらない） */
  examDate: ISODate;
  weight: number;
  memory: boolean;
  /** 削ってはいけない（1周目） */
  protected: boolean;
}

function minDate(a: ISODate, b: ISODate): ISODate {
  return a < b ? a : b;
}
function maxDate(a: ISODate, b: ISODate): ISODate {
  return a > b ? a : b;
}

function buildItems(input: PlanInput): WorkItem[] {
  const { exam, startDate } = input;
  const logs = [...input.logs, ...(input.assumedDone ?? []).map(assumedToLog)];
  const items: WorkItem[] = [];
  for (const s of exam.subjects) {
    const E = s.examDate;
    const lastDay = addDays(E, -1);
    const span = Math.max(1, diffDays(exam.studyStart, E));
    const weight = subjectWeight(s);
    for (const m of s.materials) {
      const prog = materialProgress(m, s, logs);
      const memory = isMemoryMaterial(m, s);
      // 苦手な教科ほど1周目を早く終わらせて、解き直しの時間を多く取る（苦手5→45%、得意1→55%）
      const ratio = PASS1_DEADLINE_RATIO - 0.025 * (s.weakness - 3);
      let d1 = addDays(exam.studyStart, Math.floor(span * ratio));
      if (m.isSubmission && m.dueDate) d1 = minDate(d1, addDays(m.dueDate, -1));
      const deadlines: Record<Pass, ISODate> = {
        1: minDate(d1, lastDay),
        2: maxDate(minDate(addDays(E, -2), lastDay), exam.studyStart),
        3: lastDay,
      };
      const pass3Start = addDays(E, -PASS3_START_DAYS_BEFORE);
      for (const pass of [1, 2, 3] as Pass[]) {
        if (pass > m.passes) continue;
        const remaining = prog.target[pass] - prog.done[pass];
        // 前の周が残っているなら、その周が終わるまで始めない（allocate 内で解放する）
        const prevLeft = pass > 1 && prog.target[(pass - 1) as Pass] - prog.done[(pass - 1) as Pass] > 0;
        const baseRelease = pass === 3 ? maxDate(startDate, pass3Start) : startDate;
        items.push({
          key: `${s.id}|${m.id}|${pass}`,
          subject: s,
          material: m,
          pass,
          remaining: Math.max(0, remaining),
          initial: Math.max(0, remaining),
          nextFrom: pass === 1 ? m.rangeStart + prog.done[1] : undefined,
          mpu: minutesPerUnit(m, s, pass),
          release: prevLeft ? '9999-12-31' : baseRelease,
          deadline: deadlines[pass],
          hardDeadline:
            pass === 1 && m.isSubmission && m.dueDate
              ? minDate(addDays(m.dueDate, -1), lastDay)
              : lastDay,
          examDate: E,
          weight,
          memory,
          protected: pass === 1,
        });
      }
    }
  }
  return items;
}

function assumedToLog(t: PlannedTask): ProgressLog {
  return {
    id: `assumed-${t.id}`,
    date: t.date,
    examId: '',
    subjectId: t.subjectId,
    materialId: t.materialId,
    pass: t.pass,
    amount: t.units,
  };
}

interface AllocResult {
  tasks: PlannedTask[];
  leftover: WorkItem[];
}

/**
 * 日ごとに作業を割り当てる。
 * reserved を渡すと、そのタスクで埋まった残りの時間にだけ割り当てる（外した項目の詰め直し用）。
 */
function allocate(items: WorkItem[], input: PlanInput, reserved: PlannedTask[] = []): AllocResult {
  const { settings } = input;
  const lastExam = items.reduce((mx, i) => maxDate(mx, i.examDate), input.startDate);
  const days = dateRange(input.startDate, addDays(lastExam, -1));
  const byKey = new Map(items.map((i) => [i.key, i]));
  const tasks: PlannedTask[] = [];
  const caps = days.map((d) => Math.floor(input.capacity(d) * settings.loadFactor));
  // capsFrom[i] = i日目以降の使える時間の合計
  const capsFrom = caps.reduceRight<number[]>((acc, c) => [c + (acc[0] ?? 0), ...acc], []);

  for (const [di, day] of days.entries()) {
    const dayCap = caps[di];
    const already = reserved.filter((t) => t.date === day);
    let capLeft = dayCap - already.reduce((s, t) => s + t.minutes, 0);
    if (capLeft <= 0) continue;
    // 残りの量÷残りの時間 から今日の目安量を出す。少しだけ前倒し気味にして、最後に余裕を残す
    const demandLeft = items
      .filter((i) => i.remaining > 0 && day < i.examDate)
      .reduce((s, i) => s + i.remaining * i.mpu, 0);
    const pace = Math.min(1, (demandLeft / Math.max(1, capsFrom[di])) * FRONT_LOAD + 0.05);
    // 詰め直しのときは空き時間を全部使う
    const budget = reserved.length > 0 ? dayCap : Math.max(MIN_CHUNK_MIN, Math.ceil(dayCap * pace));
    const subjectsToday = new Set<string>(already.map((t) => t.subjectId));
    const subjectMin = new Map<string, number>();
    for (const t of already) subjectMin.set(t.subjectId, (subjectMin.get(t.subjectId) ?? 0) + t.minutes);
    const itemMin = new Map<string, number>();
    const todayTask = new Map<string, PlannedTask>();

    const eligible = () =>
      items.filter((i) => i.remaining > 0 && i.release <= day && day < i.examDate);

    // 目安の締切を過ぎたものは、テスト前日を本当の締切として他と競わせる
    // （遅れた1周目が、テストが近い教科の解き直しを押しのけないように）
    const deadlineOf = (i: WorkItem) => (day > i.deadline ? i.hardDeadline : i.deadline);
    const daysLeft = (i: WorkItem) => Math.max(1, diffDays(day, deadlineOf(i)) + 1);

    // 今日扱う教科の枠は、「理想のペース（目安の締切までに均等に進める）からの遅れ」が
    // 大きい教科から順に決める。昨日やった教科は遅れが小さくなるので、自然にローテーションになる
    const lag = new Map<string, number>();
    for (const i of eligible()) {
      const from = maxDate(i.release, input.startDate);
      const span = Math.max(1, diffDays(from, i.deadline) + 1);
      const frac = Math.min(1, (diffDays(from, day) + 1) / span);
      const behindUnits = i.initial * frac - (i.initial - i.remaining);
      lag.set(i.subject.id, (lag.get(i.subject.id) ?? 0) + behindUnits * i.mpu * i.weight);
    }
    const allowed = new Set(subjectsToday);
    for (const [sid] of [...lag].sort((x, y) => y[1] - x[1])) {
      if (allowed.size >= settings.maxSubjectsPerDay) break;
      allowed.add(sid);
    }

    const give = (it: WorkItem, wantUnits: number): void => {
      if (!allowed.has(it.subject.id) && daysLeft(it) > 1) return;
      const itemCap = Math.max(ITEM_CAP_MIN[it.memory ? 'memory' : 'problem'], it.mpu);
      const maxMin = Math.min(
        capLeft,
        itemCap - (itemMin.get(it.key) ?? 0),
        Math.max(SUBJECT_CAP_MIN, it.mpu) - (subjectMin.get(it.subject.id) ?? 0),
      );
      const units = Math.min(wantUnits, it.remaining, Math.floor(maxMin / it.mpu));
      if (units <= 0) return;
      const minutes = Math.ceil(units * it.mpu);

      let t = todayTask.get(it.key);
      if (!t) {
        t = {
          id: `${day}|${it.key}`,
          date: day,
          subjectId: it.subject.id,
          materialId: it.material.id,
          pass: it.pass,
          from: it.nextFrom,
          to: it.nextFrom !== undefined ? it.nextFrom - 1 : undefined,
          units: 0,
          minutes: 0,
        };
        todayTask.set(it.key, t);
        tasks.push(t);
      }
      t.units += units;
      t.minutes += minutes;
      if (t.to !== undefined) t.to += units;
      if (it.nextFrom !== undefined) it.nextFrom += units;

      it.remaining -= units;
      capLeft -= minutes;
      subjectsToday.add(it.subject.id);
      subjectMin.set(it.subject.id, (subjectMin.get(it.subject.id) ?? 0) + minutes);
      itemMin.set(it.key, (itemMin.get(it.key) ?? 0) + minutes);

      if (it.remaining === 0 && it.pass < 3) {
        // 次の周は「次の日以降」に解放（間を空けて解き直す）
        const next = byKey.get(`${it.subject.id}|${it.material.id}|${it.pass + 1}`);
        if (next) {
          const earliest =
            next.pass === 3
              ? addDays(next.examDate, -PASS3_START_DAYS_BEFORE)
              : input.startDate;
          next.release = maxDate(addDays(day, 1), earliest);
        }
      }
    };

    // A: 締切に間に合わせるための「今日の必要量」。締切が近い順
    const a = eligible().sort(
      (x, y) => deadlineOf(x).localeCompare(deadlineOf(y)) || y.weight - x.weight,
    );
    const needOf = (it: WorkItem) => {
      const need = Math.ceil(it.remaining / daysLeft(it));
      const minUnits = Math.max(1, Math.ceil(MIN_CHUNK_MIN / it.mpu));
      return Math.max(need, Math.min(minUnits, it.remaining));
    };
    // A0: 絶対の締切（提出日・テスト前日）に間に合うための最低量を先に確保する
    const byHard = [...a].sort((x, y) => x.hardDeadline.localeCompare(y.hardDeadline));
    for (const it of byHard) {
      if (capLeft <= 0) break;
      const hardDays = Math.max(1, diffDays(day, it.hardDeadline) + 1);
      give(it, Math.ceil(it.remaining / hardDays));
    }
    // A1: 遅れているときに1教科が1日を独占しないよう、まず教科ごとに公平な分だけ配る
    const activeSubjects = new Set(a.filter((i) => allowed.has(i.subject.id)).map((i) => i.subject.id));
    const fairMin = Math.max(MIN_CHUNK_MIN, Math.floor(capLeft / Math.max(1, activeSubjects.size)));
    const givenToSubject = new Map<string, number>();
    for (const it of a) {
      if (capLeft <= 0) break;
      const room = fairMin - (givenToSubject.get(it.subject.id) ?? 0);
      if (room <= 0) continue;
      const want = needOf(it) - (todayTask.get(it.key)?.units ?? 0);
      if (want <= 0) continue;
      const before = capLeft;
      give(it, Math.min(want, Math.max(1, Math.floor(room / it.mpu))));
      givenToSubject.set(it.subject.id, (givenToSubject.get(it.subject.id) ?? 0) + (before - capLeft));
    }
    // A2: それでも今日の必要量に足りない分を、締切が近い順に足す
    for (const it of a) {
      if (capLeft <= 0) break;
      const already = todayTask.get(it.key)?.units ?? 0;
      const want = needOf(it) - already;
      if (want > 0) give(it, want);
    }
    // B: 目安量に届くまで、苦手・伸びしろの大きい教科を前倒し
    const b = eligible().sort(
      (x, y) => y.weight - x.weight || x.deadline.localeCompare(y.deadline),
    );
    for (const it of b) {
      const room = budget - (dayCap - capLeft);
      if (room <= 0) break;
      give(it, Math.max(1, Math.floor(room / it.mpu)));
    }
  }

  return { tasks, leftover: items.filter((i) => i.remaining > 0) };
}

/** 入らなかったときの「損」の大きさ。1周目 ≫ 2周目 > 3周目、苦手な教科ほど大きい */
function lossValue(i: WorkItem): number {
  return PASS_VALUE[i.pass] * i.weight;
}

function totalLoss(leftover: WorkItem[], dropped: WorkItem[]): number {
  return [...leftover, ...dropped].reduce((s, i) => s + i.remaining * i.mpu * lossValue(i), 0);
}

function toRef(i: WorkItem, units = i.remaining): PlanItemRef {
  return {
    subjectId: i.subject.id,
    materialId: i.material.id,
    pass: i.pass,
    units,
    minutes: Math.ceil(units * i.mpu),
  };
}

/** 詰め直す項目の開始日を、本計画で前の周が終わった次の日にする */
function releaseAfterMainPlan(
  it: WorkItem,
  main: AllocResult,
  dropped: Set<string>,
  startDate: ISODate,
): void {
  if (it.pass === 1) return;
  const prevKey = `${it.subject.id}|${it.material.id}|${it.pass - 1}`;
  // 前の周も外されているなら、詰め直しの中で前の周が終わったときに解放される
  if (dropped.has(prevKey)) return;
  if (main.leftover.some((i) => i.key === prevKey)) return;
  const prevTasks = main.tasks.filter(
    (t) => t.materialId === it.material.id && t.pass === it.pass - 1,
  );
  if (prevTasks.length === 0) return; // 前の周は計画前に終わっている（buildItems の値のまま）
  const lastPrev = prevTasks.reduce((mx, t) => maxDate(mx, t.date), startDate);
  const earliest =
    it.pass === 3 ? addDays(it.examDate, -PASS3_START_DAYS_BEFORE) : startDate;
  it.release = maxDate(addDays(lastPrev, 1), earliest);
}

/** 計画を作る。入りきらないときは削れるものから削って作り直す */
export function buildPlan(input: PlanInput): PlanResult {
  const base = buildItems(input);
  const demandMinutes = Math.ceil(base.reduce((s, i) => s + i.remaining * i.mpu, 0));
  const lastExam = base.reduce((mx, i) => maxDate(mx, i.examDate), input.startDate);
  const capacityMinutes = dateRange(input.startDate, addDays(lastExam, -1)).reduce(
    (s, d) => s + Math.floor(input.capacity(d) * input.settings.loadFactor),
    0,
  );

  const dropped = new Set<string>();
  const run = () => allocate(buildItems(input).filter((i) => !dropped.has(i.key)), input);
  const loss = (r: AllocResult) => totalLoss(r.leftover, base.filter((i) => dropped.has(i.key)));
  let result = run();

  // 入りきらないときは、2・3周目を丸ごと外して、もっと大事なもの（1周目・苦手教科の解き直し）に
  // 時間を回せるか試す。全体の「損」が減るときだけ外す
  if (result.leftover.length > 0) {
    // 試す順: 3周目→2周目、同じ周なら重みの軽い（得意な）教科から
    const candidates = base
      .filter((i) => !i.protected && i.remaining > 0)
      .sort((x, y) => y.pass - x.pass || x.weight - y.weight);
    for (const c of candidates) {
      if (result.leftover.length === 0) break;
      dropped.add(c.key);
      const trial = run();
      if (loss(trial) < loss(result) - 1e-9) {
        result = trial;
      } else {
        dropped.delete(c.key);
      }
    }
  }

  // 外した項目は、確定した計画の空き時間に入るだけ入れる
  let filled: AllocResult = { tasks: [], leftover: [] };
  if (dropped.size > 0) {
    const fillItems = buildItems(input).filter((i) => dropped.has(i.key));
    for (const it of fillItems) releaseAfterMainPlan(it, result, dropped, input.startDate);
    filled = allocate(fillItems, input, result.tasks);
  }

  // 2・3周目で入らなかった分は「削った」として見せる
  const trimmed = [...result.leftover, ...filled.leftover]
    .filter((i) => !i.protected)
    .map((i) => toRef(i));
  return {
    tasks: [...result.tasks, ...filled.tasks].sort(
      (x, y) => x.date.localeCompare(y.date) || y.minutes - x.minutes,
    ),
    trimmed,
    overflow: result.leftover.filter((i) => i.protected).map((i) => toRef(i)),
    demandMinutes,
    capacityMinutes,
  };
}
