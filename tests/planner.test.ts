import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AHEAD_PREFIX, currentPlan, ensureTodayFrozen } from '../src/app/planner.ts';
import type { AppState, ProgressLog } from '../src/domain/types.ts';

const TODAY = '2026-11-02';

function state(): AppState {
  const evening = [{ start: '19:00', end: '21:00' }];
  return {
    version: 1,
    exams: [
      {
        id: 'e1',
        name: '期末',
        studyStart: TODAY,
        subjects: [
          {
            id: 'math', name: '数学I', kind: 'understand', examDate: '2026-11-16', weakness: 4,
            materials: [{
              id: 'wb', name: 'ワーク', kind: 'workbook', unit: 'page', rangeStart: 1, rangeEnd: 30,
              minutesPerUnit: 8, isSubmission: true, dueDate: '2026-11-16', passes: 3,
            }],
          },
        ],
      },
    ],
    activeExamId: 'e1',
    weekly: { 0: evening, 1: evening, 2: evening, 3: evening, 4: evening, 5: evening, 6: evening },
    events: [],
    logs: [],
    dayPlans: {},
    settings: { loadFactor: 0.8, maxSubjectsPerDay: 3 },
  };
}

function pass1Units(tasks: { pass: number; units: number }[]): number {
  return tasks.filter((t) => t.pass === 1).reduce((s, t) => s + t.units, 0);
}

/** 先取りの記録（from〜to をやった） */
function aheadLog(from: number, to: number): ProgressLog {
  return {
    id: 'a1', date: TODAY, examId: 'e1', subjectId: 'math', materialId: 'wb',
    pass: 1, amount: to - from + 1, taskId: `${AHEAD_PREFIX}${TODAY}|x`, ranges: [[from, to]],
  };
}

test('先取りで記録した分は、明日以降の計画から減る', () => {
  const s0 = ensureTodayFrozen(state(), TODAY);
  const exam = s0.exams[0];
  const before = currentPlan(s0, exam, TODAY);
  const next = before.future.tasks.find((t) => t.pass === 1)!;
  assert.ok(next.date > TODAY);

  const s1: AppState = { ...s0, logs: [aheadLog(next.from!, next.from! + 2)] };
  const after = currentPlan(s1, exam, TODAY);
  // 今日の計画はそのまま
  assert.deepEqual(after.today, before.today);
  // 明日以降の1周目は3ページ減り、続きの範囲から始まる
  assert.equal(pass1Units(after.future.tasks), pass1Units(before.future.tasks) - 3);
  const firstAfter = after.future.tasks.filter((t) => t.pass === 1)[0];
  assert.equal(firstAfter.from, next.from! + 3);
});

test('今日の計画を作り直しても、先取りした分は今日のタスクに入らず、ページ番号もずれない', () => {
  const s0 = ensureTodayFrozen(state(), TODAY);
  const todayTasks = s0.dayPlans.e1[TODAY];
  const todayUnits = pass1Units(todayTasks);
  const todayFrom = todayTasks.find((t) => t.pass === 1)!.from!;
  // 今日の分（例: p.1〜5）を残したまま、その先（p.6〜30）を全部先取りしてから作り直す
  const s1: AppState = { ...s0, logs: [aheadLog(todayFrom + todayUnits, 30)] };
  const rebuilt = ensureTodayFrozen(s1, TODAY, true);
  const rebuiltP1 = rebuilt.dayPlans.e1[TODAY].filter((t) => t.pass === 1);
  // 今日のタスクは、まだやっていない頭のページから（先取りしたページは出てこない）
  assert.equal(rebuiltP1[0].from, todayFrom);
  assert.ok(rebuiltP1.every((t) => t.to! < todayFrom + todayUnits));
  // 先取り＋今日＋明日以降で、範囲（30ページ）をちょうど1回ずつ
  const plan = currentPlan(rebuilt, rebuilt.exams[0], TODAY);
  assert.equal(30 - todayUnits + pass1Units(rebuiltP1) + pass1Units(plan.future.tasks), 30);
});
