import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import {
  MAX_LINK_CHARS,
  SHARE_PREFIX,
  buildShareLink,
  buildSnapshot,
  decodeSnapshot,
  encodeSnapshot,
  isSnapshot,
} from '../src/app/share.ts';
import { ensureTodayFrozen } from '../src/app/planner.ts';
import { addDays } from '../src/domain/date.ts';
import type { AppState, ExamSubject } from '../src/domain/types.ts';

const TODAY = '2026-11-02';
const BASE = 'https://kenken-claude-gif.github.io/study-schedule/';
const SUBJECT_NAMES = [
  '現代の国語', '言語文化', '数学I', '数学A', '英語コミュニケーションI',
  '論理・表現I', '歴史総合', '公共', '化学基礎', '生物基礎',
];

/** 本番で多めの量：10教科・各3教材・3週間 */
function bigState(): AppState {
  const windows = [{ start: '19:00', end: '22:00' }];
  const subjects: ExamSubject[] = SUBJECT_NAMES.map((name, i) => ({
    id: `s${i}`,
    name,
    kind: i % 2 === 0 ? 'understand' : 'memorize',
    examDate: addDays(TODAY, 21 + (i % 4)),
    weakness: ((i % 5) + 1) as 1 | 2 | 3 | 4 | 5,
    lastScore: 40 + i,
    targetScore: 70 + i,
    materials: [
      { id: `s${i}a`, name: 'ワーク', kind: 'workbook', unit: 'page', rangeStart: 1, rangeEnd: 25, minutesPerUnit: 6, isSubmission: true, dueDate: addDays(TODAY, 21), passes: 3 },
      { id: `s${i}b`, name: '教科書', kind: 'textbook', unit: 'page', rangeStart: 10, rangeEnd: 40, minutesPerUnit: 3, isSubmission: false, passes: 3 },
      { id: `s${i}c`, name: '単語', kind: 'vocab', unit: 'item', rangeStart: 1, rangeEnd: 100, minutesPerUnit: 0.5, isSubmission: false, passes: 3 },
    ],
  }));
  const state: AppState = {
    version: 1,
    exams: [{ id: 'e1', name: '2学期 期末テスト', studyStart: TODAY, subjects, results: { s0: 88 } }],
    activeExamId: 'e1',
    weekly: { 0: windows, 1: windows, 2: windows, 3: windows, 4: windows, 5: windows, 6: windows },
    events: [{ id: 'b', title: 'バスケ部', category: '部活', date: TODAY, allDay: false, start: '19:00', end: '20:00', repeatWeekly: true }],
    logs: [],
    dayPlans: {},
    settings: { loadFactor: 0.8, maxSubjectsPerDay: 3 },
    mockExams: [{ id: 'k', name: '模試', date: TODAY, scores: [{ subject: '数学', score: 77, deviation: 51.5 }] }],
  };
  return ensureTodayFrozen(state, TODAY);
}

test('共有リンクから同じ内容を読み戻せる', async () => {
  const state = bigState();
  const snap = buildSnapshot(state, state.exams[0], TODAY);
  assert.equal(isSnapshot(snap), true);
  assert.deepEqual(await decodeSnapshot(await encodeSnapshot(snap)), JSON.parse(JSON.stringify(snap)));
});

test('今日のタスクのやった量が共有データに入る', () => {
  const state = bigState();
  const t = state.dayPlans.e1[TODAY][0];
  const logged: AppState = {
    ...state,
    logs: [{ id: 'l', date: TODAY, examId: 'e1', subjectId: t.subjectId, materialId: t.materialId, pass: t.pass, amount: 1, taskId: t.id }],
  };
  const snap = buildSnapshot(logged, logged.exams[0], TODAY);
  assert.equal(snap.days[0].d, TODAY);
  assert.equal(snap.days[0].t.reduce((s, x) => s + x[6], 0), 1);
});

test('共有データに成績は入らない', () => {
  const state = bigState();
  const json = JSON.stringify(buildSnapshot(state, state.exams[0], TODAY));
  for (const key of ['lastScore', 'targetScore', 'results', 'mockExams', 'deviation', 'score']) {
    assert.ok(!json.includes(key), key);
  }
});

test('多めの量でもリンクは目標の長さに収まる', async () => {
  const state = bigState();
  const { url, cut } = await buildShareLink(state, state.exams[0], TODAY, BASE);
  console.log(`link length=${url.length} cut=${cut}`);
  assert.ok(url.length <= MAX_LINK_CHARS, `長さ ${url.length}`);
  assert.ok(url.startsWith(`${BASE}${SHARE_PREFIX}`));
  const snap = await decodeSnapshot(url.split(SHARE_PREFIX)[1]);
  assert.equal(snap.cut, cut);
});

test('壊れた・細工されたリンクは読み込まない', async () => {
  const state = bigState();
  const good = buildSnapshot(state, state.exams[0], TODAY);
  const encode = (v: unknown) =>
    deflateRawSync(Buffer.from(JSON.stringify(v))).toString('base64url');

  await assert.rejects(decodeSnapshot(''));
  await assert.rejects(decodeSnapshot('not-valid-data'));
  await assert.rejects(decodeSnapshot(encode({ v: 2 })));
  // 実在しない教科の番号を指している
  const badIndex = { ...good, days: [{ d: TODAY, c: 60, ev: [], t: [[99, 0, 1, 1, 1, 0, 0]] }] };
  await assert.rejects(decodeSnapshot(encode(badIndex)));
  // 知らない単位（表示で落ちる）
  const badUnit = structuredClone(good) as unknown as { subjects: { m: { u: string }[] }[] };
  badUnit.subjects[0].m[0].u = 'xxx';
  await assert.rejects(decodeSnapshot(encode(badUnit)));
  // 展開すると巨大になるデータ
  const bomb = deflateRawSync(Buffer.alloc(5_000_000, 0x20)).toString('base64url');
  await assert.rejects(decodeSnapshot(bomb), /大きすぎ/);
});
