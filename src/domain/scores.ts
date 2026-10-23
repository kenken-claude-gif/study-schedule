/** 成績グラフ用に、定期テストと模試の結果を「回ごとの値」に並べ直す */
import type { Exam, ISODate, MockExam } from './types.ts';

/** 定期テストの平均点の系列名 */
export const AVERAGE = '平均';

export interface ScorePoint {
  id: string;
  /** 回の名前（例: 2学期 期末テスト） */
  label: string;
  date: ISODate;
  /** 系列名（教科名など）→ 値 */
  values: Record<string, number>;
}

/** 模試のグラフで見る値。偏差値と得点率は単位が違うので、同じグラフに混ぜない */
export type MockMetric = 'deviation' | 'rate';

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** テストの日付（教科ごとのテスト日のうち最後の日。教科がなければ勉強開始日） */
function examDateOf(exam: Exam): ISODate {
  return exam.subjects.reduce((mx, s) => (s.examDate > mx ? s.examDate : mx), exam.studyStart);
}

/**
 * 定期テストの点数を、テストの回ごとに並べる。点数が1つも入っていない回は除く。
 * 教科は名前でそろえる（回ごとに教科のIDが違うため）。平均点も系列として加える
 */
export function regularPoints(exams: Exam[]): ScorePoint[] {
  const points: ScorePoint[] = [];
  for (const exam of exams) {
    const values: Record<string, number> = {};
    for (const s of exam.subjects) {
      const v = exam.results?.[s.id];
      if (v !== undefined) values[s.name] = v;
    }
    const nums = Object.values(values);
    if (nums.length === 0) continue;
    values[AVERAGE] = round1(nums.reduce((a, b) => a + b, 0) / nums.length);
    points.push({ id: exam.id, label: exam.name, date: examDateOf(exam), values });
  }
  return points.sort((a, b) => a.date.localeCompare(b.date));
}

/** 模試の結果を回ごとに並べる。得点率は 点数÷満点×100（満点が未入力なら100点満点とみなす） */
export function mockPoints(mocks: MockExam[], metric: MockMetric): ScorePoint[] {
  const points: ScorePoint[] = [];
  for (const mock of mocks) {
    const values: Record<string, number> = {};
    for (const sc of mock.scores) {
      const name = sc.subject.trim();
      if (!name) continue;
      if (metric === 'deviation' && sc.deviation !== undefined) values[name] = sc.deviation;
      if (metric === 'rate' && sc.score !== undefined) {
        const max = sc.max && sc.max > 0 ? sc.max : 100;
        values[name] = round1((sc.score / max) * 100);
      }
    }
    if (Object.keys(values).length === 0) continue;
    points.push({ id: mock.id, label: mock.name, date: mock.date, values });
  }
  return points.sort((a, b) => a.date.localeCompare(b.date));
}

/** 系列名の一覧（平均を先頭に、あとは最初に出てきた順） */
export function seriesNames(points: ScorePoint[]): string[] {
  const names: string[] = [];
  for (const p of points) for (const n of Object.keys(p.values)) if (!names.includes(n)) names.push(n);
  return names.includes(AVERAGE) ? [AVERAGE, ...names.filter((n) => n !== AVERAGE)] : names;
}

/** 直近の回と、その前の回との差（両方に値がある系列だけ） */
export function latestDiff(points: ScorePoint[], name: string): { latest: number; diff?: number } | undefined {
  const withValue = points.filter((p) => p.values[name] !== undefined);
  const last = withValue.at(-1);
  if (!last) return undefined;
  const prev = withValue.at(-2);
  return {
    latest: last.values[name],
    diff: prev ? round1(last.values[name] - prev.values[name]) : undefined,
  };
}
