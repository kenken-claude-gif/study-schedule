import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan, materialProgress } from '../src/domain/scheduler.ts';
import { availableMinutes } from '../src/domain/availability.ts';
import { addDays } from '../src/domain/date.ts';
import type { Exam, ExamSubject, LifeEvent, Material, PlannedTask, Settings, Weakness } from '../src/domain/types.ts';

const settings: Settings = { loadFactor: 0.8, maxSubjectsPerDay: 3 };

function makeExam(): Exam {
  return {
    id: 'e1',
    name: '2学期期末',
    studyStart: '2026-11-02',
    subjects: [
      {
        id: 'math',
        name: '数学I',
        kind: 'understand',
        examDate: '2026-11-16',
        weakness: 5,
        lastScore: 45,
        targetScore: 65,
        materials: [
          {
            id: 'math-wb', name: '数学ワーク', kind: 'workbook', unit: 'page',
            rangeStart: 52, rangeEnd: 70, minutesPerUnit: 8, isSubmission: true,
            dueDate: '2026-11-16', passes: 3,
          },
        ],
      },
      {
        id: 'eng',
        name: '英語コミュニケーションI',
        kind: 'mixed',
        examDate: '2026-11-17',
        weakness: 3,
        materials: [
          {
            id: 'eng-vocab', name: '単語帳', kind: 'vocab', unit: 'item',
            rangeStart: 1, rangeEnd: 150, minutesPerUnit: 0.6, isSubmission: false, passes: 3,
          },
          {
            id: 'eng-wb', name: '英語ワーク', kind: 'workbook', unit: 'page',
            rangeStart: 28, rangeEnd: 45, minutesPerUnit: 6, isSubmission: true,
            dueDate: '2026-11-13', passes: 3,
          },
        ],
      },
      {
        id: 'hist',
        name: '歴史総合',
        kind: 'memorize',
        examDate: '2026-11-18',
        weakness: 2,
        materials: [
          {
            id: 'hist-tb', name: '教科書', kind: 'textbook', unit: 'page',
            rangeStart: 60, rangeEnd: 90, minutesPerUnit: 4, isSubmission: false, passes: 3,
          },
        ],
      },
    ],
  };
}

const ample = () => 150;

function tasksOf(tasks: PlannedTask[], materialId: string, pass?: number) {
  return tasks.filter((t) => t.materialId === materialId && (pass === undefined || t.pass === pass));
}

test('余裕があるときは、何も削らずに全部入る', () => {
  const r = buildPlan({ exam: makeExam(), startDate: '2026-11-02', capacity: ample, logs: [], settings });
  assert.deepEqual(r.overflow, []);
  assert.deepEqual(r.trimmed, []);
});

test('1日の量は「使える時間×loadFactor」以内で、教科は3つまで', () => {
  const r = buildPlan({ exam: makeExam(), startDate: '2026-11-02', capacity: ample, logs: [], settings });
  const byDay = new Map<string, PlannedTask[]>();
  for (const t of r.tasks) byDay.set(t.date, [...(byDay.get(t.date) ?? []), t]);
  for (const [, ts] of byDay) {
    assert.ok(ts.reduce((s, t) => s + t.minutes, 0) <= 150 * 0.8 + 1);
    assert.ok(new Set(ts.map((t) => t.subjectId)).size <= 3);
  }
});

test('1周目は範囲の頭から順に、すき間なく割り当てる', () => {
  const r = buildPlan({ exam: makeExam(), startDate: '2026-11-02', capacity: ample, logs: [], settings });
  const p1 = tasksOf(r.tasks, 'math-wb', 1);
  assert.equal(p1[0].from, 52);
  for (let i = 1; i < p1.length; i++) assert.equal(p1[i].from, p1[i - 1].to! + 1);
  assert.equal(p1[p1.length - 1].to, 70);
});

test('2周目は1周目が終わった次の日以降、3周目はテスト3日前〜前日', () => {
  const exam = makeExam();
  const r = buildPlan({ exam, startDate: '2026-11-02', capacity: ample, logs: [], settings });
  for (const s of exam.subjects) {
    for (const m of s.materials) {
      const p1Last = tasksOf(r.tasks, m.id, 1).at(-1)!.date;
      const p2 = tasksOf(r.tasks, m.id, 2);
      assert.ok(p2.length > 0, `${m.id} の2周目がない`);
      assert.ok(p2[0].date > p1Last, `${m.id}: 2周目 ${p2[0].date} が1周目最終日 ${p1Last} 以前`);
      for (const t of tasksOf(r.tasks, m.id, 3)) {
        assert.ok(t.date >= addDays(s.examDate, -3) && t.date < s.examDate, `${m.id} 3周目 ${t.date}`);
      }
      for (const t of tasksOf(r.tasks, m.id)) assert.ok(t.date < s.examDate);
    }
  }
});

test('1周目は勉強期間の前半までに終わり、提出物は締切前日までに終わる', () => {
  const r = buildPlan({ exam: makeExam(), startDate: '2026-11-02', capacity: ample, logs: [], settings });
  // 数学: 11/2〜11/16 の14日 → 半分の 11/9 まで
  assert.ok(tasksOf(r.tasks, 'math-wb', 1).at(-1)!.date <= '2026-11-09');
  assert.ok(tasksOf(r.tasks, 'eng-wb', 1).at(-1)!.date <= '2026-11-12');
});

test('苦手な数学は得意な歴史より先に1周目が終わる（前倒し）', () => {
  const r = buildPlan({ exam: makeExam(), startDate: '2026-11-02', capacity: ample, logs: [], settings });
  const mathEnd = tasksOf(r.tasks, 'math-wb', 1).at(-1)!.date;
  const histEnd = tasksOf(r.tasks, 'hist-tb', 1).at(-1)!.date;
  assert.ok(mathEnd <= histEnd, `math ${mathEnd} hist ${histEnd}`);
});

test('時間が足りないときは削るものが出るが、提出物の1周目は削らない', () => {
  const r = buildPlan({ exam: makeExam(), startDate: '2026-11-02', capacity: () => 45, logs: [], settings });
  assert.ok(r.trimmed.length > 0);
  const materials = makeExam().subjects.flatMap((s) => s.materials);
  const isSubmission = (id: string) => materials.find((m) => m.id === id)!.isSubmission;
  assert.ok(r.trimmed.every((t) => !(t.pass === 1 && isSubmission(t.materialId))));
  for (const m of materials.filter((x) => x.isSubmission)) {
    const units = tasksOf(r.tasks, m.id, 1).reduce((s, t) => s + t.units, 0);
    assert.equal(units, m.rangeEnd - m.rangeStart + 1, m.id);
  }
});

test('残り1週間・7教科で時間が足りないとき、得意教科の読み直しより苦手教科の解き直しを優先する', () => {
  const M = (id: string, kind: Material['kind'], unit: Material['unit'], a: number, b: number, mpu: number, due?: string): Material => ({
    id, name: id, kind, unit, rangeStart: a, rangeEnd: b, minutesPerUnit: mpu,
    isSubmission: due !== undefined, dueDate: due, passes: 3,
  });
  const S = (id: string, kind: ExamSubject['kind'], examDate: string, weakness: Weakness, materials: Material[], lastScore?: number, targetScore?: number): ExamSubject =>
    ({ id, name: id, kind, examDate, weakness, materials, lastScore, targetScore });
  const exam: Exam = {
    id: 'week',
    name: '期末',
    studyStart: '2026-11-09',
    subjects: [
      S('数学I', 'understand', '2026-11-16', 5, [M('m1', 'workbook', 'page', 1, 20, 8, '2026-11-16')], 45, 65),
      S('数学A', 'understand', '2026-11-17', 4, [M('ma', 'workbook', 'page', 1, 15, 8, '2026-11-17')], 50, 65),
      S('英コミ', 'mixed', '2026-11-16', 3, [M('ev', 'vocab', 'item', 1, 150, 0.6), M('ew', 'workbook', 'page', 1, 15, 6, '2026-11-16')], 60, 70),
      S('現国', 'mixed', '2026-11-17', 2, [M('gp', 'print', 'sheet', 1, 5, 15), M('gk', 'vocab', 'item', 1, 50, 0.6)], 70, 75),
      S('歴総', 'memorize', '2026-11-18', 2, [M('ht', 'textbook', 'page', 1, 30, 4), M('hp', 'print', 'sheet', 1, 4, 12)], 72, 80),
      S('化基', 'understand', '2026-11-18', 4, [M('cw', 'workbook', 'problem', 1, 40, 4, '2026-11-18')], 52, 70),
      S('生基', 'memorize', '2026-11-17', 3, [M('bt', 'textbook', 'page', 1, 25, 4), M('bw', 'workbook', 'page', 1, 10, 6, '2026-11-17')], 65, 75),
    ],
  };
  // 平日3時間・土日6時間（1周目は全部入るが、全部の周は入らない量）
  const capacity = (d: string) => ([0, 6].includes(new Date(`${d}T00:00Z`).getUTCDay()) ? 360 : 180);
  const r = buildPlan({ exam, startDate: '2026-11-09', capacity, logs: [], settings });
  assert.ok(r.trimmed.length > 0, '時間が足りるケースになっている');
  assert.deepEqual(r.overflow, []);
  const minutes = (id: string, pass: number) => tasksOf(r.tasks, id, pass).reduce((s, t) => s + t.minutes, 0);
  // 一番苦手な数学Iの解き直しは削られない
  const m1Pass2 = materialProgress(exam.subjects[0].materials[0], exam.subjects[0], []).target[2];
  assert.equal(tasksOf(r.tasks, 'm1', 2).reduce((s, t) => s + t.units, 0), m1Pass2);
  // 提出物はすべて提出日の前日までに終わる
  for (const s of exam.subjects) {
    for (const m of s.materials.filter((x) => x.isSubmission)) {
      const p1 = tasksOf(r.tasks, m.id, 1);
      assert.equal(p1.reduce((a, t) => a + t.units, 0), m.rangeEnd - m.rangeStart + 1, m.id);
      assert.ok(p1.at(-1)!.date < m.dueDate!, `${m.id} の提出が間に合わない`);
    }
  }
  // 削られるのは得意な教科（苦手度2）の分が中心
  assert.ok(minutes('m1', 2) > minutes('gp', 2));
});

test('時間が足りなくても、提出物の1周目は提出日の前日までに入る', () => {
  const r = buildPlan({ exam: makeExam(), startDate: '2026-11-02', capacity: () => 45, logs: [], settings });
  assert.ok(tasksOf(r.tasks, 'eng-wb', 1).at(-1)!.date <= '2026-11-12');
  assert.ok(tasksOf(r.tasks, 'math-wb', 1).at(-1)!.date <= '2026-11-15');
});

test('10教科あっても1日3教科のローテーションで、どの教科も早めに始まり1周目が期限内に終わる', () => {
  const names = ['現国', '言文', '数I', '数A', '英コミ', '論表', '歴総', '公共', '化基', '生基'];
  const exam: Exam = {
    id: 'big',
    name: '期末',
    studyStart: '2026-11-02',
    subjects: names.map((n, i) => ({
      id: n,
      name: n,
      kind: i % 3 === 0 ? 'understand' : i % 3 === 1 ? 'memorize' : 'mixed',
      examDate: addDays('2026-11-23', Math.floor(i / 4)),
      weakness: ((i % 5) + 1) as 1 | 2 | 3 | 4 | 5,
      materials: [
        {
          id: `${n}-wb`, name: 'ワーク', kind: 'workbook', unit: 'page',
          rangeStart: 1, rangeEnd: 12, minutesPerUnit: 6, isSubmission: true,
          dueDate: addDays('2026-11-23', Math.floor(i / 4)), passes: 3,
        },
      ],
    })),
  };
  const r = buildPlan({ exam, startDate: '2026-11-02', capacity: () => 180, logs: [], settings });
  assert.deepEqual(r.overflow, []);
  for (const s of exam.subjects) {
    const p1 = tasksOf(r.tasks, `${s.id}-wb`, 1);
    assert.ok(p1[0].date <= '2026-11-07', `${s.id} の開始が遅い: ${p1[0].date}`);
    assert.ok(p1.at(-1)!.date < addDays(s.examDate, -1), `${s.id} の1周目が遅い: ${p1.at(-1)!.date}`);
  }
});

test('×の数を記録すると、2周目の量はその数になる', () => {
  const exam = makeExam();
  const s = exam.subjects[0];
  const m = s.materials[0];
  const logs = [
    { id: 'l1', date: '2026-11-03', examId: 'e1', subjectId: 'math', materialId: 'math-wb', pass: 1 as const, amount: 19, wrong: 4 },
  ];
  const prog = materialProgress(m, s, logs);
  assert.equal(prog.done[1], 19);
  assert.equal(prog.target[2], 4);

  const r = buildPlan({ exam, startDate: '2026-11-04', capacity: ample, logs, settings });
  assert.equal(tasksOf(r.tasks, 'math-wb', 1).length, 0);
  assert.equal(tasksOf(r.tasks, 'math-wb', 2).reduce((x, t) => x + t.units, 0), 4);
});

test('遅れて途中から作り直しても、残りの範囲から続きを入れる', () => {
  const logs = [
    { id: 'l1', date: '2026-11-02', examId: 'e1', subjectId: 'math', materialId: 'math-wb', pass: 1 as const, amount: 5 },
  ];
  const r = buildPlan({ exam: makeExam(), startDate: '2026-11-08', capacity: ample, logs, settings });
  const p1 = tasksOf(r.tasks, 'math-wb', 1);
  assert.equal(p1[0].from, 57);
  assert.equal(p1.reduce((s, t) => s + t.units, 0), 14);
  assert.ok(r.tasks.every((t) => t.date >= '2026-11-08'));
});

test('予定がある日は勉強できる時間が減り、毎週の予定もくり返される', () => {
  const weekly = { 1: [{ start: '19:00', end: '22:00' }] }; // 月曜
  const events: LifeEvent[] = [
    { id: 'a', title: '塾', category: '塾', date: '2026-11-02', allDay: false, start: '19:00', end: '20:30', repeatWeekly: true },
  ];
  assert.equal(availableMinutes(weekly, [], '2026-11-02'), 180);
  assert.equal(availableMinutes(weekly, events, '2026-11-02'), 90);
  assert.equal(availableMinutes(weekly, events, '2026-11-09'), 90);
  assert.equal(availableMinutes(weekly, events, '2026-11-03'), 0); // 火曜は時間帯なし
  const allDay: LifeEvent[] = [{ id: 'b', title: '法事', category: '家族', date: '2026-11-09', allDay: true }];
  assert.equal(availableMinutes(weekly, allDay, '2026-11-09'), 0);
});
