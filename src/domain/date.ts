import type { HHMM, ISODate } from './types.ts';

const MS_PER_DAY = 86_400_000;
const DOW_JA = ['日', '月', '火', '水', '木', '金', '土'];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Date をローカル日付の 'YYYY-MM-DD' にする */
export function toISO(d: Date): ISODate {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 'YYYY-MM-DD' を UTC の 0時として扱う（日数計算でタイムゾーンの影響を受けないため） */
function toUTC(iso: ISODate): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function todayISO(): ISODate {
  return toISO(new Date());
}

export function addDays(iso: ISODate, days: number): ISODate {
  const t = new Date(toUTC(iso) + days * MS_PER_DAY);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** b - a の日数 */
export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((toUTC(b) - toUTC(a)) / MS_PER_DAY);
}

export function dayOfWeek(iso: ISODate): number {
  return new Date(toUTC(iso)).getUTCDay();
}

/** a〜b（両端含む）の日付リスト */
export function dateRange(a: ISODate, b: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let d = a; d <= b; d = addDays(d, 1)) out.push(d);
  return out;
}

/** '10/21(火)' */
export function formatShort(iso: ISODate): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${m}/${d}(${DOW_JA[dayOfWeek(iso)]})`;
}

export function dowLabel(dow: number): string {
  return DOW_JA[dow];
}

export function hhmmToMin(t: HHMM): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

export function formatMinutes(min: number): string {
  if (min < 60) return `${min}分`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}時間` : `${h}時間${m}分`;
}
