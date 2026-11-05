/**
 * 見るだけの共有リンク。
 * 計画の様子を圧縮してリンクの # 以降に入れる。# 以降はサーバーに送られないので、データはどこにも保存されない。
 * リンクの長さを抑えるため、キーは短くして、タスクの文言は入れずに開く側で組み立てる。
 * 開く側から見ると外から来たデータなので、読み込むときに中身を全部確かめる
 */
import { eventsOn } from '../domain/availability.ts';
import { dateRange } from '../domain/date.ts';
import { materialProgress, type PlanItemRef } from '../domain/scheduler.ts';
import type {
  Exam,
  AppState,
  ISODate,
  MaterialKind,
  Pass,
  Ranges,
  SubjectKind,
  Unit,
} from '../domain/types.ts';
import { behind, capacityFn, currentPlan, doneForTask, lastExamDate } from './planner.ts';

export const SHARE_PREFIX = '#share=';
/** リンクの長さの目標。メッセージアプリで分割されないよう、これを超えたら表示する日数を減らす */
export const MAX_LINK_CHARS = 4000;
/** 表示する日数を減らしていくときの段階 */
const DAY_STEPS = [14, 7, 3, 1];
/** 読み込むデータの上限。細工されたリンクで端末に負担をかけないため */
const MAX_ENCODED_CHARS = 200_000;
const MAX_DECODED_BYTES = 2_000_000;

export interface ShareMaterial {
  /** 教材名 */
  n: string;
  k: MaterialKind;
  u: Unit;
  /** 提出物なら1 */
  s: 0 | 1;
  /** 周ごとの目標量 */
  t: [number, number, number];
  /** 周ごとのやった量 */
  d: [number, number, number];
}

export interface ShareSubject {
  n: string;
  k: SubjectKind;
  /** テストの日 */
  e: ISODate;
  m: ShareMaterial[];
}

/** [教科の番号, 教材の番号, 周, 量, 分, 範囲（なければ0）, やった量] */
export type ShareTask = [number, number, Pass, number, number, Ranges | 0, number];
/** [教科の番号, 教材の番号, 周, 量, 分] */
export type ShareRef = [number, number, Pass, number, number];

export interface ShareDay {
  d: ISODate;
  /** 勉強できる時間（分） */
  c: number;
  /** 予定の名前 */
  ev: string[];
  t: ShareTask[];
}

export interface ShareSnapshot {
  v: 1;
  /** 作った日時（表示用の 'YYYY-MM-DD HH:MM'） */
  at: string;
  today: ISODate;
  /** テストの名前 */
  name: string;
  subjects: ShareSubject[];
  days: ShareDay[];
  /** これまでの記録 [日付, 完了数, タスク数] */
  past: [ISODate, number, number][];
  /** 前の日までに終わらなかった分（分） */
  late: number;
  trimmed: ShareRef[];
  overflow: ShareRef[];
  /** リンクが長くなりすぎて省いた日数 */
  cut: number;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** 今の状態から共有用のデータを作る（成績は入れない） */
export function buildSnapshot(state: AppState, exam: Exam, today: ISODate, now: Date = new Date()): ShareSnapshot {
  const plan = currentPlan(state, exam, today);
  const cap = capacityFn(state);
  const logs = state.logs.filter((l) => l.examId === exam.id);

  const subjectIndex = new Map(exam.subjects.map((s, i) => [s.id, i]));
  const materialIndex = new Map(exam.subjects.flatMap((s) => s.materials.map((m, i) => [m.id, i] as const)));
  const ref = (r: PlanItemRef): ShareRef => [
    subjectIndex.get(r.subjectId) ?? 0,
    materialIndex.get(r.materialId) ?? 0,
    r.pass,
    r.units,
    r.minutes,
  ];

  const last = lastExamDate(exam);
  const from = today < exam.studyStart ? exam.studyStart : today;
  const dates = last && from <= last ? dateRange(from, last) : [];
  const tasks = [...plan.today, ...plan.future.tasks];
  const days: ShareDay[] = dates.map((d) => ({
    d,
    c: cap(d),
    ev: eventsOn(state.events, d).map((e) => e.title),
    t: tasks
      .filter((t) => t.date === d)
      .filter((t) => subjectIndex.has(t.subjectId) && materialIndex.has(t.materialId))
      .map((t): ShareTask => [
        subjectIndex.get(t.subjectId)!,
        materialIndex.get(t.materialId)!,
        t.pass,
        t.units,
        t.minutes,
        t.ranges ?? (t.from !== undefined && t.to !== undefined ? [[t.from, t.to]] : 0),
        d === today ? Math.min(t.units, doneForTask(state, t.id)) : 0,
      ]),
  }));

  const past = Object.entries(state.dayPlans[exam.id] ?? {})
    .filter(([d]) => d < today)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([d, ts]): [ISODate, number, number] => [
      d,
      ts.filter((t) => doneForTask(state, t.id) >= t.units).length,
      ts.length,
    ]);

  return {
    v: 1,
    at: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`,
    today,
    name: exam.name,
    subjects: exam.subjects.map((s) => ({
      n: s.name,
      k: s.kind,
      e: s.examDate,
      m: s.materials.map((m) => {
        const p = materialProgress(m, s, logs);
        return {
          n: m.name,
          k: m.kind,
          u: m.unit,
          s: m.isSubmission ? 1 : 0,
          t: [p.target[1], p.target[2], p.target[3]],
          d: [p.done[1], p.done[2], p.done[3]],
        };
      }),
    })),
    days,
    past,
    late: behind(state, exam, today).minutes,
    trimmed: plan.future.trimmed.map(ref),
    overflow: plan.future.overflow.map(ref),
    cut: 0,
  };
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export async function encodeSnapshot(snapshot: ShareSnapshot): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(snapshot));
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return toBase64Url(new Uint8Array(await new Response(stream).arrayBuffer()));
}

/** 展開する。上限を超えたら途中でやめる（小さなリンクが巨大に膨らむ細工への対策） */
async function inflateLimited(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_DECODED_BYTES) {
      await reader.cancel();
      throw new Error('共有データが大きすぎます');
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.length;
  }
  return new TextDecoder().decode(all);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MATERIAL_KINDS: readonly unknown[] = ['workbook', 'print', 'textbook', 'notes', 'vocab', 'other'];
const UNITS: readonly unknown[] = ['page', 'problem', 'item', 'sheet'];
const SUBJECT_KINDS: readonly unknown[] = ['understand', 'memorize', 'mixed'];

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}
function isDate(v: unknown): v is string {
  return typeof v === 'string' && DATE_RE.test(v);
}
function isNumTriple(v: unknown): boolean {
  return Array.isArray(v) && v.length === 3 && v.every(isNum);
}
function isRanges(v: unknown): boolean {
  return (
    Array.isArray(v) &&
    v.every((r) => Array.isArray(r) && r.length === 2 && r.every(isNum) && r[0] <= r[1])
  );
}

/** 教科・教材の番号が実在するか（なければ画面が落ちるので確かめる） */
function validIndex(subjects: unknown[], si: unknown, mi: unknown): boolean {
  if (!isNum(si) || !isNum(mi)) return false;
  const s = subjects[si];
  return isObj(s) && Array.isArray(s.m) && s.m[mi] !== undefined;
}
function validPass(p: unknown): boolean {
  return p === 1 || p === 2 || p === 3;
}
function isRef(v: unknown, subjects: unknown[]): boolean {
  return (
    Array.isArray(v) &&
    v.length === 5 &&
    validIndex(subjects, v[0], v[1]) &&
    validPass(v[2]) &&
    isNum(v[3]) &&
    isNum(v[4])
  );
}

/** 共有データの形を中まで確かめる */
export function isSnapshot(v: unknown): v is ShareSnapshot {
  if (!isObj(v) || v.v !== 1) return false;
  if (typeof v.at !== 'string' || !isDate(v.today) || typeof v.name !== 'string') return false;
  if (!isNum(v.late) || !isNum(v.cut)) return false;
  const subjects = v.subjects;
  if (!Array.isArray(subjects)) return false;
  const subjectsOk = subjects.every(
    (s) =>
      isObj(s) &&
      typeof s.n === 'string' &&
      SUBJECT_KINDS.includes(s.k) &&
      isDate(s.e) &&
      Array.isArray(s.m) &&
      s.m.every(
        (m) =>
          isObj(m) &&
          typeof m.n === 'string' &&
          MATERIAL_KINDS.includes(m.k) &&
          UNITS.includes(m.u) &&
          (m.s === 0 || m.s === 1) &&
          isNumTriple(m.t) &&
          isNumTriple(m.d),
      ),
  );
  if (!subjectsOk) return false;
  const daysOk =
    Array.isArray(v.days) &&
    v.days.every(
      (d) =>
        isObj(d) &&
        isDate(d.d) &&
        isNum(d.c) &&
        Array.isArray(d.ev) &&
        d.ev.every((e) => typeof e === 'string') &&
        Array.isArray(d.t) &&
        d.t.every(
          (t) =>
            Array.isArray(t) &&
            t.length === 7 &&
            validIndex(subjects, t[0], t[1]) &&
            validPass(t[2]) &&
            isNum(t[3]) &&
            isNum(t[4]) &&
            (t[5] === 0 || isRanges(t[5])) &&
            isNum(t[6]),
        ),
    );
  if (!daysOk) return false;
  const pastOk =
    Array.isArray(v.past) &&
    v.past.every((p) => Array.isArray(p) && p.length === 3 && isDate(p[0]) && isNum(p[1]) && isNum(p[2]));
  if (!pastOk) return false;
  return (
    Array.isArray(v.trimmed) &&
    v.trimmed.every((r) => isRef(r, subjects)) &&
    Array.isArray(v.overflow) &&
    v.overflow.every((r) => isRef(r, subjects))
  );
}

/** リンクの中身を読み込む。読めないときは例外を投げる */
export async function decodeSnapshot(encoded: string): Promise<ShareSnapshot> {
  if (encoded.length === 0 || encoded.length > MAX_ENCODED_CHARS) {
    throw new Error('共有リンクの長さが正しくありません');
  }
  const parsed: unknown = JSON.parse(await inflateLimited(fromBase64Url(encoded)));
  if (!isSnapshot(parsed)) throw new Error('共有リンクの中身が正しくありません');
  return parsed;
}

/** 共有リンクを作る。長すぎるときは先の日を省いて収める（省いた日数は cut に残す） */
export async function buildShareLink(
  state: AppState,
  exam: Exam,
  today: ISODate,
  baseUrl: string,
): Promise<{ url: string; cut: number }> {
  const full = buildSnapshot(state, exam, today);
  const link = async (s: ShareSnapshot) => `${baseUrl}${SHARE_PREFIX}${await encodeSnapshot(s)}`;
  let url = await link(full);
  let cut = 0;
  for (const keep of DAY_STEPS) {
    if (url.length <= MAX_LINK_CHARS) break;
    if (full.days.length <= keep) continue;
    cut = full.days.length - keep;
    url = await link({ ...full, days: full.days.slice(0, keep), cut });
  }
  return { url, cut };
}
