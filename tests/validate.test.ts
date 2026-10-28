import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAppState } from '../src/app/validate.ts';

const ok = {
  version: 1,
  exams: [{ id: 'e', name: 'x', studyStart: '2026-11-02', subjects: [{ id: 's', examDate: '2026-11-16', materials: [{ id: 'm' }] }] }],
  events: [],
  logs: [{ id: 'l', materialId: 'm', amount: 3 }],
  weekly: {},
  dayPlans: {},
  settings: { loadFactor: 0.8, maxSubjectsPerDay: 3 },
};

test('正しい形のデータは読み込める（模試の項目がない古いデータも）', () => {
  assert.equal(isAppState(ok), true);
  assert.equal(isAppState({ ...ok, mockExams: [{ id: 'k', scores: [] }] }), true);
});

test('壊れたバックアップは読み込まない', () => {
  assert.equal(isAppState(null), false);
  assert.equal(isAppState([]), false);
  assert.equal(isAppState({ ...ok, version: 2 }), false);
  assert.equal(isAppState({ ...ok, exams: [{ id: 'e', studyStart: '2026-11-02', subjects: [{ examDate: '2026-11-16' }] }] }), false);
  assert.equal(isAppState({ ...ok, logs: [{ materialId: 'm', amount: '3' }] }), false);
  assert.equal(isAppState({ ...ok, mockExams: [{ id: 'k' }] }), false);
  assert.equal(isAppState({ ...ok, weekly: [] }), false);
});
