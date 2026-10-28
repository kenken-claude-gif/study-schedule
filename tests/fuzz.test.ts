/**
 * ランダムな入力でスケジューラを大量に動かして、どんな入力でも守るべきルールを確かめる。
 * 乱数はシード固定なので、失敗したときも同じ入力で再現できる
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan, pagesOf, taskRanges, totalUnits } from '../src/domain/scheduler.ts';
import { addDays } from '../src/domain/date.ts';
import type { Exam, ExamSubject, Material, MaterialKind, ProgressLog, Settings, Unit } from '../src/domain/types.ts';

/** 再現できる乱数（mulberry32） */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const KINDS: MaterialKind[] = ['workbook', 'print', 'textbook', 'notes', 'vocab', 'other'];
const UNITS: Unit[] = ['page', 'problem', 'item', 'sheet'];

function randomCase(seed: number) {
  const r = rng(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
  const pick = <T,>(xs: T[]) => xs[int(0, xs.length - 1)];
  const studyStart = '2026-11-02';
  const firstExam = addDays(studyStart, int(1, 25));
  const subjects: ExamSubject[] = [];
  for (let i = 0; i < int(1, 10); i++) {
    const examDate = addDays(firstExam, int(0, 4));
    const materials: Material[] = [];
    for (let j = 0; j < int(0, 3); j++) {
      const start = int(0, 80);
      const sub = r() < 0.5;
      materials.push({
        id: `s${i}m${j}`,
        name: `m${j}`,
        kind: pick(KINDS),
        unit: pick(UNITS),
        rangeStart: start,
        // まれに終わりが始まりより前の、入力ミスのような範囲も混ぜる
        rangeEnd: r() < 0.05 ? start - 1 : start + int(0, 60),
        minutesPerUnit: pick([0.3, 0.6, 1, 4, 8, 15, 40]),
        isSubmission: sub,
        dueDate: sub ? addDays(examDate, -int(0, 6)) : undefined,
        passes: pick([1, 2, 3] as const),
      });
    }
    subjects.push({
      id: `s${i}`,
      name: `subject${i}`,
      kind: pick(['understand', 'memorize', 'mixed'] as const),
      examDate,
      weakness: pick([1, 2, 3, 4, 5] as const),
      lastScore: r() < 0.5 ? int(20, 90) : undefined,
      targetScore: r() < 0.5 ? int(40, 100) : undefined,
      materials,
    });
  }
  const exam: Exam = { id: 'e', name: 'fuzz', studyStart, subjects };
  const capByDay = new Map<string, number>();
  const capacity = (d: string) => {
    if (!capByDay.has(d)) capByDay.set(d, pick([0, 30, 60, 90, 120, 180, 240, 360]));
    return capByDay.get(d)!;
  };
  // 途中まで進んだ記録（範囲つき・範囲なし・×の数つき）を混ぜる
  const logs: ProgressLog[] = [];
  for (const s of subjects) {
    for (const m of s.materials) {
      if (r() < 0.4 && totalUnits(m) > 0) {
        const n = int(1, totalUnits(m));
        const ranged = r() < 0.5;
        const from = m.rangeStart + int(0, totalUnits(m) - n);
        logs.push({
          id: `l${m.id}`, date: studyStart, examId: 'e', subjectId: s.id, materialId: m.id, pass: 1,
          amount: n, wrong: r() < 0.5 ? int(0, n) : undefined,
          ranges: ranged ? [[from, from + n - 1]] : undefined,
        });
      }
    }
  }
  const settings: Settings = { loadFactor: pick([0.6, 0.8, 1]), maxSubjectsPerDay: pick([2, 3, 4, 5]) };
  const startDate = addDays(studyStart, int(0, 5));
  return { exam, capacity, logs, settings, startDate };
}

test('ランダムな入力300通りでも、計画のルールが守られる', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const { exam, capacity, logs, settings, startDate } = randomCase(seed);
    const where = `seed=${seed}`;
    const r = buildPlan({ exam, startDate, capacity, logs, settings });
    const subjectOf = new Map(exam.subjects.map((s) => [s.id, s]));
    const materialOf = new Map(exam.subjects.flatMap((s) => s.materials.map((m) => [m.id, m] as const)));

    const perDay = new Map<string, number>();
    const pass1Pages = new Map<string, number[]>();
    for (const t of r.tasks) {
      const s = subjectOf.get(t.subjectId)!;
      const m = materialOf.get(t.materialId)!;
      assert.ok(t.units > 0, `${where} 量が0以下のタスク`);
      assert.ok(t.date >= startDate, `${where} 開始日より前のタスク ${t.date}`);
      assert.ok(t.date < s.examDate, `${where} テスト当日以降のタスク ${t.date} >= ${s.examDate}`);
      perDay.set(t.date, (perDay.get(t.date) ?? 0) + t.minutes);
      if (t.pass === 1) {
        const pages = pagesOf(taskRanges(t) ?? []);
        assert.equal(pages.length, t.units, `${where} 範囲と量が合わない`);
        pass1Pages.set(m.id, [...(pass1Pages.get(m.id) ?? []), ...pages]);
      }
    }
    // 1日の量は 使える時間×loadFactor 以内
    for (const [d, min] of perDay) {
      assert.ok(min <= Math.floor(capacity(d) * settings.loadFactor), `${where} ${d} が詰め込みすぎ ${min}分`);
    }
    // 1周目のページは範囲内・重複なし・すでにやったページは出てこない
    for (const [mid, pages] of pass1Pages) {
      const m = materialOf.get(mid)!;
      assert.equal(new Set(pages).size, pages.length, `${where} ${mid} のページが重複`);
      for (const p of pages) assert.ok(p >= m.rangeStart && p <= m.rangeEnd, `${where} ${mid} 範囲外 ${p}`);
      const done = new Set(logs.filter((l) => l.materialId === mid && l.ranges).flatMap((l) => pagesOf(l.ranges!)));
      for (const p of pages) assert.ok(!done.has(p), `${where} ${mid} すでにやった ${p} が計画に出た`);
    }
    // 提出物の1周目は、計画に入るか「間に合わない」として必ず報告される
    for (const s of exam.subjects) {
      for (const m of s.materials.filter((x) => x.isSubmission)) {
        const remaining = totalUnits(m) - logs.filter((l) => l.materialId === m.id).reduce((a, l) => a + l.amount, 0);
        if (remaining <= 0) continue;
        const planned = (pass1Pages.get(m.id) ?? []).length;
        const reported = r.overflow.some((o) => o.materialId === m.id && o.pass === 1);
        assert.ok(planned >= remaining || reported, `${where} ${m.id} 提出物が黙って消えた`);
      }
    }
  }
});
