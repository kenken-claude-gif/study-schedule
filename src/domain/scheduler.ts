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
 * - 暗記ものの3周目（直前の総チェック）は、2周目の途中でも1周目が終わっていれば入れる（2周目待ちで消えないように）
 * - 時間が足りないときは、点につながりやすいもの（提出物の1周目 → 苦手教科の解き直し → 1周目 → 仕上げ）
 *   から決まった順に入れ、同じ優先度のものは同じ割合だけ範囲の頭から残す（教材を丸ごと消すより、
 *   残した範囲を最後の総チェックまでやる）。何を削ったかを返す。提出物の1周目だけは削らない
 * - 項目を1つずつ外して試すやり方と違い、時間が少し変わっただけで残る教材がガラッと入れ替わることがない
 * - 「さらっと眺める」教材（参考書など）は重みを下げ、先に削る
 * - どれだけ時間が足りなくても、どの教科にも少しは残す（勉強0分の教科を作らない）
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
  Ranges,
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
/**
 * 入らなかったときの損の重み（1分あたり）。時間が足りないときに、教科の中で何から残すかを決める。
 * 提出物の1周目は出さないといけないので別格。それ以外は「×を直す2周目」が一番点につながり、
 * 提出物でない1周目（教科書の読み直しなど）はその次。
 * 暗記ものの3周目はテスト直前の総チェックで、短い時間で全体に触れられるので2周目と同じ扱い。
 * 問題ものの3周目（2周目でも×だったものだけ）が最後。
 * ただし前の周が残っていれば先には入れない（buildPlan で前の周の値を上限にする）
 */
const LOSS_PER_MIN = { submission1: 100, pass1: 2.5, pass2: 3, pass3Memory: 3, pass3: 1 } as const;
/**
 * 時間が足りないときに試す、残す量の合計の割合（使える時間の何割分を残すか）。
 * 1.0 から BUDGET_SCALE_MIN まで BUDGET_SCALE_STEPS 段階で試す
 */
const BUDGET_SCALE_MIN = 0.5;
const BUDGET_SCALE_STEPS = 10;
/** 控えめな案に切り替えるのは、入らなかった分の損がこの割合以上小さくなるときだけ */
const BUDGET_SCALE_GAIN = 0.05;
/** 時間が足りなくても、どの教科にもこれだけは残す（分） */
const MIN_SUBJECT_MIN = 30;
/** 「さらっと眺める」教材の重みの倍率。時間が足りないときに先に削り、前倒しも後回しにする */
const SKIM_WEIGHT_FACTOR = 0.3;
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

/** 番号のリストを、連続した範囲にまとめる（[1,2,3,7] → [[1,3],[7,7]]） */
export function toRanges(nums: number[]): Ranges {
  const sorted = [...nums].sort((a, b) => a - b);
  const out: Ranges = [];
  for (const n of sorted) {
    const last = out[out.length - 1];
    if (last && n <= last[1] + 1) last[1] = Math.max(last[1], n);
    else out.push([n, n]);
  }
  return out;
}

/**
 * 範囲に番号を足す。toRanges([...pagesOf(ranges), ...nums]) と同じ結果。
 * 1周目のページは前から順に割り当てるので、足す番号はふつう全部いまの範囲より後ろにある。
 * そのときは広げ直さずに後ろへつなぐだけにする（そうでなければ広げ直す）
 */
function appendRanges(ranges: Ranges, nums: number[]): Ranges {
  const lastEnd = ranges.length > 0 ? ranges[ranges.length - 1][1] : -Infinity;
  let ascending = true;
  for (let k = 0; k < nums.length; k++) {
    if (nums[k] <= (k === 0 ? lastEnd : nums[k - 1])) {
      ascending = false;
      break;
    }
  }
  if (!ascending) return toRanges([...pagesOf(ranges), ...nums]);
  const out: Ranges = ranges.map(([x, y]) => [x, y]);
  for (const n of nums) {
    const last = out[out.length - 1];
    if (last && n <= last[1] + 1) last[1] = Math.max(last[1], n);
    else out.push([n, n]);
  }
  return out;
}

/** 範囲を番号のリストに広げる */
export function pagesOf(ranges: Ranges): number[] {
  const out: number[] = [];
  for (const [a, b] of ranges) for (let n = a; n <= b; n++) out.push(n);
  return out;
}

/**
 * 1周目でまだやっていない番号（ページ・問題など）を、前から順に返す。
 * 範囲つきの記録はその範囲を、範囲のない古い記録は「前から順にやった」とみなして埋める
 */
export function pass1Remaining(m: Material, logs: ProgressLog[]): number[] {
  const done = new Set<number>();
  let unranged = 0;
  for (const l of logs) {
    if (l.materialId !== m.id || l.pass !== 1) continue;
    if (l.ranges) for (const n of pagesOf(l.ranges)) done.add(n);
    else unranged += l.amount;
  }
  const rest: number[] = [];
  for (let n = m.rangeStart; n <= m.rangeEnd; n++) {
    if (done.has(n)) continue;
    if (unranged > 0) {
      unranged--;
      continue;
    }
    rest.push(n);
  }
  return rest;
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
    done: { 1: total - pass1Remaining(m, mine).length, 2: Math.min(t2, p2.amount), 3: Math.min(t3, p3.amount) },
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
  /** 1周目のみ：まだやっていない番号（前から順に割り当てる） */
  pages?: number[];
  mpu: number;
  release: ISODate;
  deadline: ISODate;
  /**
   * 目安の締切を過ぎたあとの締切。1周目のあとに解き直しがあるなら、その時間を残せる日（テスト3日前）まで。
   * 遅れた1周目がずるずる直前まで続いて、解き直しの時間がなくなるのを防ぐ
   */
  relaxedDeadline: ISODate;
  /** 絶対に守る締切（提出物の締切前日、またはテスト前日） */
  hardDeadline: ISODate;
  /** この日より前にやる（テスト当日以降はやらない） */
  examDate: ISODate;
  weight: number;
  memory: boolean;
  /** 削ってはいけない（提出物の1周目） */
  protected: boolean;
  /** allocate の作業用：その日の締切と残り日数（毎朝、今日やれる項目について入れ直す） */
  todayDeadline: ISODate;
  todayDaysLeft: number;
}

function minDate(a: ISODate, b: ISODate): ISODate {
  return a < b ? a : b;
}
function maxDate(a: ISODate, b: ISODate): ISODate {
  return a > b ? a : b;
}
/**
 * 日付の並べ替え用の比較。'YYYY-MM-DD' は文字の大小がそのまま日付の前後になる。
 * localeCompare と同じ順になるが、並べ替えの中で何万回も呼ぶので軽い比較にしている
 */
function cmpDate(a: ISODate, b: ISODate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * その周を始める前に終わっていないといけない周。
 * 暗記ものの3周目（直前の総チェック）は範囲全体をもう一度見るだけなので、1周目が終わっていれば始められる
 */
function prevPassOf(pass: Pass, memory: boolean): Pass | undefined {
  if (pass === 1) return undefined;
  if (pass === 3 && memory) return 1;
  return (pass - 1) as Pass;
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
        const prev = prevPassOf(pass, memory);
        const prevLeft = prev !== undefined && prog.target[prev] - prog.done[prev] > 0;
        const baseRelease = pass === 3 ? maxDate(startDate, pass3Start) : startDate;
        const hardDeadline =
          pass === 1 && m.isSubmission && m.dueDate
            ? minDate(addDays(m.dueDate, -1), lastDay)
            : lastDay;
        const relaxedDeadline =
          pass === 1 && m.passes >= 2
            ? maxDate(deadlines[1], minDate(hardDeadline, pass3Start))
            : hardDeadline;
        items.push({
          key: `${s.id}|${m.id}|${pass}`,
          subject: s,
          material: m,
          pass,
          remaining: Math.max(0, remaining),
          initial: Math.max(0, remaining),
          pages: pass === 1 ? pass1Remaining(m, logs) : undefined,
          mpu: minutesPerUnit(m, s, pass),
          release: prevLeft ? '9999-12-31' : baseRelease,
          deadline: deadlines[pass],
          relaxedDeadline,
          hardDeadline,
          examDate: E,
          weight: m.skim ? weight * SKIM_WEIGHT_FACTOR : weight,
          memory,
          protected: pass === 1 && m.isSubmission,
          todayDeadline: lastDay,
          todayDaysLeft: 1,
        });
      }
    }
  }
  return items;
}

/** タスクの範囲（古い計画は from/to しか持っていないので、そこから作る） */
export function taskRanges(t: PlannedTask): Ranges | undefined {
  if (t.ranges) return t.ranges;
  return t.from !== undefined && t.to !== undefined ? [[t.from, t.to]] : undefined;
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
    ranges: t.pass === 1 ? taskRanges(t) : undefined,
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
  const capsFrom = new Array<number>(caps.length);
  for (let k = caps.length - 1, sum = 0; k >= 0; k--) capsFrom[k] = sum += caps[k];

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

    // 今日やれる項目。1日の途中で増えることはない（次の周の開始日は早くても翌日になる）ので、
    // 朝に1回だけ選んで、あとは「残りがあるか」だけ見る
    const eligibleAtStart = items.filter((i) => i.remaining > 0 && i.release <= day && day < i.examDate);

    // 目安の締切を過ぎたものは、締切を段階的にゆるめて他と競わせる（目安→解き直しの時間を残せる日→絶対の締切）。
    // 遅れた1周目が、テストが近い教科の解き直しを押しのけないように。
    // 項目と日付だけで決まるので、並べ替えや give の中で何度も計算しないよう、朝に1回出しておく
    for (const i of eligibleAtStart) {
      i.todayDeadline =
        day <= i.deadline ? i.deadline : day <= i.relaxedDeadline ? i.relaxedDeadline : i.hardDeadline;
      i.todayDaysLeft = Math.max(1, diffDays(day, i.todayDeadline) + 1);
    }
    const deadlineOf = (i: WorkItem) => i.todayDeadline;
    const daysLeft = (i: WorkItem) => i.todayDaysLeft;

    // 今日扱う教科の枠は、「理想のペース（目安の締切までに均等に進める）からの遅れ」が
    // 大きい教科から順に決める。昨日やった教科は遅れが小さくなるので、自然にローテーションになる
    const lag = new Map<string, number>();
    const size = new Map<string, number>();
    for (const i of eligibleAtStart) {
      const from = maxDate(i.release, input.startDate);
      const span = Math.max(1, diffDays(from, i.deadline) + 1);
      const frac = Math.min(1, (diffDays(from, day) + 1) / span);
      const behindUnits = i.initial * frac - (i.initial - i.remaining);
      lag.set(i.subject.id, (lag.get(i.subject.id) ?? 0) + behindUnits * i.mpu * i.weight);
      size.set(i.subject.id, (size.get(i.subject.id) ?? 0) + i.initial * i.mpu);
    }
    // 遅れは「その教科の量のうち何割遅れているか」で比べる。分のままだと、量の多い教科がいつも上に来て、
    // 量の少ない教科（単語帳だけ、など）は何日も順番が回ってこない
    for (const [sid, v] of lag) lag.set(sid, v / Math.max(MIN_CHUNK_MIN, size.get(sid)!));
    // 遅れを分で比べると、量の多い教科がいつも上に来て、量の少ない教科（単語帳だけ、など）に
    // 順番が回らないまま試験日になることがある。この計画でまだ一度も入っていない教科を先にして、
    // どの教科にも一度は手をつけさせる
    const startedSet = new Set(tasks.map((t) => t.subjectId));
    const started = (sid: string) => Number(startedSet.has(sid));
    const allowed = new Set(subjectsToday);
    for (const [sid] of [...lag].sort((x, y) => started(x[0]) - started(y[0]) || y[1] - x[1])) {
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

          units: 0,
          minutes: 0,
        };
        todayTask.set(it.key, t);
        tasks.push(t);
      }
      t.units += units;
      t.minutes += minutes;
      if (it.pages) {
        t.ranges = appendRanges(t.ranges ?? [], it.pages.splice(0, units));
        t.from = t.ranges[0][0];
        t.to = t.ranges[t.ranges.length - 1][1];
      }

      it.remaining -= units;
      capLeft -= minutes;
      subjectsToday.add(it.subject.id);
      subjectMin.set(it.subject.id, (subjectMin.get(it.subject.id) ?? 0) + minutes);
      itemMin.set(it.key, (itemMin.get(it.key) ?? 0) + minutes);

      if (it.remaining === 0) {
        // この周を待っていた周は「次の日以降」に解放（間を空けて解き直す）
        for (const pass of [2, 3] as Pass[]) {
          if (prevPassOf(pass, it.memory) !== it.pass) continue;
          const next = byKey.get(`${it.subject.id}|${it.material.id}|${pass}`);
          if (!next) continue;
          const earliest =
            next.pass === 3
              ? addDays(next.examDate, -PASS3_START_DAYS_BEFORE)
              : input.startDate;
          next.release = maxDate(addDays(day, 1), earliest);
        }
      }
    };

    // A: 締切に間に合わせるための「今日の必要量」。締切が近い順
    const a = [...eligibleAtStart].sort(
      (x, y) => cmpDate(deadlineOf(x), deadlineOf(y)) || y.weight - x.weight,
    );
    const needOf = (it: WorkItem) => {
      const need = Math.ceil(it.remaining / daysLeft(it));
      const minUnits = Math.max(1, Math.ceil(MIN_CHUNK_MIN / it.mpu));
      return Math.max(need, Math.min(minUnits, it.remaining));
    };
    // A0: 絶対の締切（提出日・テスト前日）に間に合うための最低量を先に確保する
    const byHard = [...a].sort((x, y) => cmpDate(x.hardDeadline, y.hardDeadline));
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
    const b = eligibleAtStart.filter((i) => i.remaining > 0).sort(
      (x, y) => y.weight - x.weight || cmpDate(x.deadline, y.deadline),
    );
    for (const it of b) {
      const room = budget - (dayCap - capLeft);
      if (room <= 0) break;
      give(it, Math.max(1, Math.floor(room / it.mpu)));
    }
  }

  return { tasks, leftover: items.filter((i) => i.remaining > 0) };
}

/** 入らなかったときの「損」の大きさ（1分あたり）。苦手な教科ほど・眺める教材でないほど大きい */
function lossValue(i: WorkItem): number {
  const base = i.protected
    ? LOSS_PER_MIN.submission1
    : i.pass === 1
      ? LOSS_PER_MIN.pass1
      : i.pass === 2
        ? LOSS_PER_MIN.pass2
        : i.memory
          ? LOSS_PER_MIN.pass3Memory
          : LOSS_PER_MIN.pass3;
  return base * i.weight;
}

function itemMinutes(i: WorkItem, units = i.remaining): number {
  return units * i.mpu;
}

/**
 * 時間が足りないときに、どの項目を何単位残すかを決める（budgetMinutes に収まるように）。
 * - 提出物の1周目は必ず全部残す
 * - 残りは「入らなかったときの損」の大きい順に入れる。前の周が残っているのに次の周を残しても
 *   始められないので、各項目の優先度は前の周の優先度を上限にする
 * - 同じ優先度の項目が並んだところで時間が尽きたら、その全部を同じ割合だけ（1周目なら範囲の頭から）残す。
 *   1周目・2周目・暗記の総チェックが同じ割合になるので、残した範囲は最後の総チェックまでできる
 * - どの教科にも最低 MIN_SUBJECT_MIN 分は残す（勉強0分の教科を作らない）
 * 決まった順に上から入れるだけなので、使える時間が増えたら、残る量はどの項目も減らない
 */
function selectByPriority(items: WorkItem[], budgetMinutes: number): Map<string, number> {
  const priority = new Map<string, number>();
  for (const i of items) {
    // buildItems は教材ごとに1→2→3周目の順に並べるので、前の周の優先度はもう出ている
    const prev = prevPassOf(i.pass, i.memory);
    const own = lossValue(i);
    const cap = prev === undefined ? Infinity : (priority.get(`${i.subject.id}|${i.material.id}|${prev}`) ?? own);
    priority.set(i.key, Math.min(own, cap));
  }
  const keep = new Map<string, number>();
  let left = budgetMinutes;
  const tiers = new Map<number, WorkItem[]>();
  for (const i of items) {
    if (i.remaining <= 0) continue;
    if (i.protected) {
      keep.set(i.key, i.remaining);
      left -= itemMinutes(i);
      continue;
    }
    // 浮動小数の誤差で同じ優先度が別の段に分かれないよう、丸めてまとめる
    const p = Math.round(priority.get(i.key)! * 1e6) / 1e6;
    tiers.set(p, [...(tiers.get(p) ?? []), i]);
  }
  for (const [, tier] of [...tiers].sort((x, y) => y[0] - x[0])) {
    if (left <= 0) break;
    const cost = tier.reduce((s, i) => s + itemMinutes(i), 0);
    const ratio = Math.min(1, left / cost);
    for (const i of tier) {
      const units = Math.floor(i.remaining * ratio + 1e-9);
      if (units > 0) keep.set(i.key, units);
    }
    left -= cost * ratio;
  }
  // 1つも残らなかった教科は、優先度が一番高い項目を最低 MIN_SUBJECT_MIN 分だけ残す
  const keptSubjects = new Set(items.filter((i) => (keep.get(i.key) ?? 0) > 0).map((i) => i.subject.id));
  for (const i of [...items].sort((x, y) => priority.get(y.key)! - priority.get(x.key)! || x.pass - y.pass)) {
    if (i.remaining <= 0 || keptSubjects.has(i.subject.id)) continue;
    keep.set(i.key, Math.min(i.remaining, Math.max(1, Math.ceil(MIN_SUBJECT_MIN / i.mpu))));
    keptSubjects.add(i.subject.id);
  }
  return keep;
}

/** 項目を、残す分（範囲の頭から units）だけに切り詰める */
function headOf(i: WorkItem, units: number): WorkItem {
  return { ...i, remaining: units, initial: units, pages: i.pages?.slice(0, units) };
}

/** 項目を、削った分（範囲の後ろ、残す分を除いた残り）だけにする */
function tailOf(i: WorkItem, keptUnits: number): WorkItem {
  const rest = i.remaining - keptUnits;
  return { ...i, remaining: rest, initial: rest, pages: i.pages?.slice(keptUnits) };
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
  const prev = prevPassOf(it.pass, it.memory);
  if (prev === undefined) {
    // 1周目の続き（範囲の後ろ）は、本計画で頭の方をやる日より前に入れない（ページの順番が逆にならないように）
    const head = main.tasks.filter((t) => t.materialId === it.material.id && t.pass === 1);
    if (head.length > 0) it.release = maxDate(it.release, head.reduce((mx, t) => maxDate(mx, t.date), startDate));
    return;
  }
  const prevKey = `${it.subject.id}|${it.material.id}|${prev}`;
  // 前の周も外されているなら、詰め直しの中で前の周が終わったときに解放される
  if (dropped.has(prevKey)) return;
  if (main.leftover.some((i) => i.key === prevKey)) return;
  const prevTasks = main.tasks.filter((t) => t.materialId === it.material.id && t.pass === prev);
  if (prevTasks.length === 0) return; // 前の周は計画前に終わっている（buildItems の値のまま）
  const lastPrev = prevTasks.reduce((mx, t) => maxDate(mx, t.date), startDate);
  const earliest =
    it.pass === 3 ? addDays(it.examDate, -PASS3_START_DAYS_BEFORE) : startDate;
  it.release = maxDate(addDays(lastPrev, 1), earliest);
}

/**
 * 本計画のタスクに、詰め直しのタスクを足す。途中まで残した項目は、同じ日に頭の方（本計画）と
 * 続き（詰め直し）が両方入ることがある。タスクの id は日付と項目で決まるので、別々にすると id がぶつかる。
 * 1つのタスクにまとめる（続きは頭の方より後ろの番号なので、範囲は後ろにつなぐ）
 */
function mergeSameTasks(main: PlannedTask[], fill: PlannedTask[]): PlannedTask[] {
  const byId = new Map(main.map((t) => [t.id, { ...t }]));
  for (const f of fill) {
    const t = byId.get(f.id);
    if (!t) {
      byId.set(f.id, f);
      continue;
    }
    t.units += f.units;
    t.minutes += f.minutes;
    if (f.ranges) {
      t.ranges = appendRanges(t.ranges ?? [], pagesOf(f.ranges));
      t.from = t.ranges[0][0];
      t.to = t.ranges[t.ranges.length - 1][1];
    }
  }
  return [...byId.values()];
}

/** 計画を作る。入りきらないときは削れるものから削って作り直す */
export function buildPlan(rawInput: PlanInput): PlanResult {
  // 使える時間は、外す候補を試すたびに全日分を聞き直すことになるので、日付ごとに覚えておく
  // （画面の capacity は予定の一覧をなめるので、1回ごとが軽くない）
  const capByDate = new Map<ISODate, number>();
  const input: PlanInput = {
    ...rawInput,
    capacity: (d) => {
      let c = capByDate.get(d);
      if (c === undefined) {
        c = rawInput.capacity(d);
        capByDate.set(d, c);
      }
      return c;
    },
  };
  const base = buildItems(input);
  // allocate は項目を書き換える（残り量・ページ・開始日）ので、試すたびに base の写しを渡す。
  // buildItems をやり直すのと同じ中身になる
  const freshItems = (): WorkItem[] => base.map((i) => ({ ...i, pages: i.pages?.slice() }));
  const demandMinutes = Math.ceil(base.reduce((s, i) => s + i.remaining * i.mpu, 0));
  const lastExam = base.reduce((mx, i) => maxDate(mx, i.examDate), input.startDate);
  const capacityMinutes = dateRange(input.startDate, addDays(lastExam, -1)).reduce(
    (s, d) => s + Math.floor(input.capacity(d) * input.settings.loadFactor),
    0,
  );

  /** 残す単位数を決めて計画を作り、外した分を空き時間に詰め直す */
  const planWith = (keep?: Map<string, number>): { result: AllocResult; filled: AllocResult } => {
    if (!keep) return { result: allocate(freshItems(), input), filled: { tasks: [], leftover: [] } };
    const dropped = new Set(base.filter((i) => i.remaining > (keep.get(i.key) ?? 0)).map((i) => i.key));
    const kept = (i: WorkItem) => keep.get(i.key) ?? 0;
    const result = allocate(
      freshItems()
        .filter((i) => i.remaining === 0 || kept(i) > 0)
        .map((i) => (i.remaining === 0 ? i : headOf(i, kept(i)))),
      input,
    );
    // 外した分は、確定した計画の空き時間に入るだけ入れる（途中までにした項目は、その続きから）
    const fillItems = freshItems()
      .filter((i) => dropped.has(i.key))
      .map((i) => tailOf(i, kept(i)));
    for (const it of fillItems) releaseAfterMainPlan(it, result, dropped, input.startDate);
    return { result, filled: allocate(fillItems, input, result.tasks) };
  };
  const lossOf = (p: { result: AllocResult; filled: AllocResult }) =>
    [...p.result.leftover, ...p.filled.leftover].reduce((s, i) => s + itemMinutes(i) * lossValue(i), 0);

  let best = planWith();
  // 入りきらないときは、大事なものから残し、残りを外して作り直す（selectByPriority）。
  // 残す量を使える時間いっぱいにすると、テストの早い教科は使える日が少ないので詰め込みすぎになり、
  // 締切に押し出される項目が出る。残す量を少しずつ控えめにした案も作り、入らなかった分の損が
  // はっきり（BUDGET_SCALE_GAIN 以上）小さくなるときだけ控えめな案に切り替える。
  // わずかな差で切り替えると、使える時間が少し変わっただけで計画がガラッと変わってしまう
  if (best.result.leftover.length > 0) {
    best = planWith(selectByPriority(base, capacityMinutes));
    let bestLoss = lossOf(best);
    for (let k = 1; k <= BUDGET_SCALE_STEPS; k++) {
      const scale = 1 - (k * (1 - BUDGET_SCALE_MIN)) / BUDGET_SCALE_STEPS;
      const trial = planWith(selectByPriority(base, capacityMinutes * scale));
      const l = lossOf(trial);
      if (l < bestLoss * (1 - BUDGET_SCALE_GAIN)) {
        best = trial;
        bestLoss = l;
      }
    }
  }
  const { result, filled } = best;

  // 2・3周目で入らなかった分は「削った」として見せる
  // 途中まで残した項目は「頭の方で入りきらなかった分」と「後ろの削った分」の2つに分かれるので、1つにまとめる
  const trimmedByKey = new Map<string, PlanItemRef>();
  for (const i of [...result.leftover, ...filled.leftover]) {
    if (i.protected) continue;
    const prev = trimmedByKey.get(i.key);
    trimmedByKey.set(i.key, toRef(i, i.remaining + (prev?.units ?? 0)));
  }
  const trimmed = [...trimmedByKey.values()];
  return {
    tasks: mergeSameTasks(result.tasks, filled.tasks).sort(
      (x, y) => cmpDate(x.date, y.date) || y.minutes - x.minutes,
    ),
    trimmed,
    overflow: result.leftover.filter((i) => i.protected).map((i) => toRef(i)),
    demandMinutes,
    capacityMinutes,
  };
}
