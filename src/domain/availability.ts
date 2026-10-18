import { dayOfWeek, diffDays, hhmmToMin } from './date.ts';
import type { ISODate, LifeEvent, TimeWindow, WeeklyPattern } from './types.ts';

/** その日に発生する予定（毎週くり返しを展開して判定） */
export function eventsOn(events: LifeEvent[], date: ISODate): LifeEvent[] {
  return events.filter((e) => {
    if (e.date === date) return true;
    if (!e.repeatWeekly || date < e.date) return false;
    if (e.repeatUntil && date > e.repeatUntil) return false;
    return diffDays(e.date, date) % 7 === 0;
  });
}

function overlap(a: TimeWindow, bStart: number, bEnd: number): number {
  const s = Math.max(hhmmToMin(a.start), bStart);
  const e = Math.min(hhmmToMin(a.end), bEnd);
  return Math.max(0, e - s);
}

export function windowMinutes(windows: TimeWindow[]): number {
  return windows.reduce((sum, w) => sum + Math.max(0, hhmmToMin(w.end) - hhmmToMin(w.start)), 0);
}

/**
 * その日に勉強できる時間（分）。
 * 曜日ごとの勉強時間帯から、予定と重なる時間を引く。終日の予定がある日は0。
 */
export function availableMinutes(weekly: WeeklyPattern, events: LifeEvent[], date: ISODate): number {
  const windows = weekly[dayOfWeek(date)] ?? [];
  const todays = eventsOn(events, date);
  if (todays.some((e) => e.allDay)) return 0;
  let total = 0;
  for (const w of windows) {
    let mins = Math.max(0, hhmmToMin(w.end) - hhmmToMin(w.start));
    for (const e of todays) {
      if (!e.start || !e.end) continue;
      mins -= overlap(w, hhmmToMin(e.start), hhmmToMin(e.end));
    }
    total += Math.max(0, mins);
  }
  return total;
}
