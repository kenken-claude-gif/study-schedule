/** 画面から使う計画まわりの処理（その日の計画の確定・遅れの判定など） */
import { availableMinutes } from '../domain/availability.ts';
import { addDays } from '../domain/date.ts';
import { buildPlan, pagesOf, taskRanges, toRanges, type PlanResult } from '../domain/scheduler.ts';
import type { AppState, Exam, ISODate, PlannedTask, ProgressLog } from '../domain/types.ts';

/** 先取り（明日以降の分を今日やった）記録の taskId の先頭 */
export const AHEAD_PREFIX = 'ahead:';

export function isAheadLog(l: ProgressLog): boolean {
  return l.taskId?.startsWith(AHEAD_PREFIX) ?? false;
}

export function activeExam(state: AppState): Exam | undefined {
  return state.exams.find((e) => e.id === state.activeExamId);
}

export function lastExamDate(exam: Exam): ISODate | undefined {
  return exam.subjects.reduce<ISODate | undefined>(
    (mx, s) => (mx === undefined || s.examDate > mx ? s.examDate : mx),
    undefined,
  );
}

export function capacityFn(state: AppState): (d: ISODate) => number {
  return (d) => availableMinutes(state.weekly, state.events, d);
}

export function examLogs(state: AppState, examId: string): ProgressLog[] {
  return state.logs.filter((l) => l.examId === examId);
}

export function doneForTask(state: AppState, taskId: string): number {
  return state.logs.filter((l) => l.taskId === taskId).reduce((s, l) => s + l.amount, 0);
}

/** 計画期間中か（勉強開始日〜最後のテストの前日） */
export function inStudyPeriod(exam: Exam, today: ISODate): boolean {
  const last = lastExamDate(exam);
  return last !== undefined && today >= exam.studyStart && today < last;
}

/**
 * 今日の計画がまだ確定していなければ確定させる。
 * 朝に一度確定した計画は、その日のうちは動かさない（やっている途中で中身が変わると混乱するため）。
 */
export function ensureTodayFrozen(state: AppState, today: ISODate, force = false): AppState {
  const exam = activeExam(state);
  if (!exam || exam.finished || !inStudyPeriod(exam, today)) return state;
  if (!force && state.dayPlans[exam.id]?.[today]) return state;
  const plan = buildPlan({
    exam,
    startDate: today,
    capacity: capacityFn(state),
    // 今日のタスクの記録は除いて作る。作り直しても今日のタスクIDが変わらず、記録とつながったままになる。
    // 先取りした分は除かない（もうやった分なので、今日の計画にも入れない）
    logs: examLogs(state, exam.id).filter((l) => !(l.date === today && !isAheadLog(l))),
    settings: state.settings,
  });
  const todays = plan.tasks.filter((t) => t.date === today);
  return {
    ...state,
    dayPlans: {
      ...state.dayPlans,
      [exam.id]: { ...(state.dayPlans[exam.id] ?? {}), [today]: todays },
    },
  };
}

export interface CurrentPlan {
  today: PlannedTask[];
  /** 明日以降（勉強開始前なら開始日から）の計画 */
  future: PlanResult;
}

/** 今日の確定済みタスク＋明日以降の計画（今日の残りはやる前提で組む） */
export function currentPlan(state: AppState, exam: Exam, today: ISODate): CurrentPlan {
  const todays = state.dayPlans[exam.id]?.[today] ?? [];
  // 今日の残り（まだやっていない分）は、やる前提で明日以降の計画から除く
  const pendingToday = todays
    .map((t) => {
      const done = doneForTask(state, t.id);
      const ranges = taskRanges(t);
      return {
        ...t,
        units: Math.max(0, t.units - done),
        ranges: ranges ? toRanges(pagesOf(ranges).slice(done)) : undefined,
      };
    })
    .filter((t) => t.units > 0);
  const start = today < exam.studyStart ? exam.studyStart : todays.length > 0 ? addDays(today, 1) : today;
  const future = buildPlan({
    exam,
    startDate: start,
    capacity: capacityFn(state),
    logs: examLogs(state, exam.id),
    assumedDone: pendingToday,
    settings: state.settings,
  });
  return { today: todays, future };
}

export interface BehindInfo {
  /** 前の日までに終わらなかったタスク */
  tasks: { task: PlannedTask; done: number }[];
  minutes: number;
}

/** 前の日までの確定計画のうち、終わっていない分 */
export function behind(state: AppState, exam: Exam, today: ISODate): BehindInfo {
  const plans = state.dayPlans[exam.id] ?? {};
  const tasks: BehindInfo['tasks'] = [];
  let minutes = 0;
  for (const [date, ts] of Object.entries(plans)) {
    if (date >= today) continue;
    for (const t of ts) {
      const done = doneForTask(state, t.id);
      if (done < t.units) {
        tasks.push({ task: t, done });
        minutes += Math.ceil((t.minutes * (t.units - done)) / Math.max(1, t.units));
      }
    }
  }
  return { tasks, minutes };
}
