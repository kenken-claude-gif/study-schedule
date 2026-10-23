import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AVERAGE, latestDiff, mockPoints, regularPoints, seriesNames } from '../src/domain/scores.ts';
import type { Exam, MockExam } from '../src/domain/types.ts';

function exam(id: string, name: string, date: string, scores: Record<string, number | undefined>): Exam {
  const subjects = Object.keys(scores).map((n) => ({
    id: `${id}-${n}`, name: n, kind: 'mixed' as const, examDate: date, weakness: 3 as const, materials: [],
  }));
  const results: Record<string, number> = {};
  for (const s of subjects) {
    const v = scores[s.name];
    if (v !== undefined) results[s.id] = v;
  }
  return { id, name, studyStart: date, subjects, results };
}

test('定期テストは日付順に並び、教科は名前でそろい、平均点が入る', () => {
  const pts = regularPoints([
    exam('b', '2学期中間', '2026-10-10', { 数学I: 60, 英語: 70 }),
    exam('a', '1学期期末', '2026-07-05', { 数学I: 45, 英語: 66, 化学基礎: 52 }),
    exam('c', '2学期期末', '2026-11-18', { 数学I: undefined, 英語: undefined }),
  ]);
  // 点数が1つもない回は除く
  assert.deepEqual(pts.map((p) => p.label), ['1学期期末', '2学期中間']);
  assert.equal(pts[0].values['数学I'], 45);
  assert.equal(pts[1].values['数学I'], 60);
  assert.equal(pts[0].values[AVERAGE], 54.3);
  assert.equal(pts[1].values['化学基礎'], undefined);
  assert.deepEqual(seriesNames(pts), [AVERAGE, '数学I', '英語', '化学基礎']);
});

test('模試は偏差値と得点率を別々に取り出し、満点がなければ100点満点とみなす', () => {
  const mocks: MockExam[] = [
    {
      id: 'm1', name: '7月 進研模試', date: '2026-07-12', scores: [
        { subject: '数学', score: 90, max: 200, deviation: 48.5 },
        { subject: '英語', score: 70, deviation: 55 },
        { subject: '国語' },
      ],
    },
  ];
  const dev = mockPoints(mocks, 'deviation');
  assert.deepEqual(dev[0].values, { 数学: 48.5, 英語: 55 });
  const rate = mockPoints(mocks, 'rate');
  assert.deepEqual(rate[0].values, { 数学: 45, 英語: 70 });
});

test('直近の回と前の回の差を出す（値がない回は飛ばす）', () => {
  const pts = regularPoints([
    exam('a', '1', '2026-05-01', { 数学I: 45 }),
    exam('b', '2', '2026-07-01', { 英語: 60 }),
    exam('c', '3', '2026-10-01', { 数学I: 58 }),
  ]);
  assert.deepEqual(latestDiff(pts, '数学I'), { latest: 58, diff: 13 });
  assert.deepEqual(latestDiff(pts, '英語'), { latest: 60, diff: undefined });
  assert.equal(latestDiff(pts, '物理'), undefined);
});
