import { useMemo, useState } from 'react';
import { newId, useStore } from '../app/store.tsx';
import { activeExam, currentPlan, lastExamDate } from '../app/planner.ts';
import { availableMinutes, eventsOn, windowMinutes } from '../domain/availability.ts';
import { addDays, dateRange, dayOfWeek, dowLabel, formatMinutes, formatShort } from '../domain/date.ts';
import type { AppState, EventCategory, LifeEvent, TimeWindow } from '../domain/types.ts';
import { appToday, TextField } from './common.tsx';

const CATEGORIES: EventCategory[] = ['部活', '塾', '習い事', '家族', '遊び', 'その他'];

export function ScheduleView() {
  return (
    <>
      <header className="app-header">
        <h1>予定</h1>
        <span className="sub">勉強以外の予定と、勉強できる時間</span>
      </header>
      <div className="banner info small">
        部活・塾・家族の予定を、家族と相談しながら入れよう。入れる前に「この予定を入れると勉強の計画がどうなるか」が見られるよ。
      </div>
      <ConsultCalendar />
      <EventForm />
      <EventList />
      <WeeklyEditor />
    </>
  );
}

/** これから2週間の「勉強できる時間」と「計画の量」を並べて見る（相談用） */
function ConsultCalendar() {
  const { state } = useStore();
  const today = appToday();
  const exam = activeExam(state);
  const last = exam ? lastExamDate(exam) : undefined;
  const end = last && last > today ? last : addDays(today, 13);
  const days = dateRange(today, end).slice(0, 28);
  const planned = useMemo(() => {
    const m = new Map<string, number>();
    if (!exam || exam.subjects.length === 0) return m;
    const p = currentPlan(state, exam, today);
    for (const t of [...p.today, ...p.future.tasks]) m.set(t.date, (m.get(t.date) ?? 0) + t.minutes);
    return m;
  }, [state, exam, today]);
  const max = Math.max(60, ...days.map((d) => availableMinutes(state.weekly, state.events, d)));

  return (
    <div className="card">
      <h2>相談カレンダー</h2>
      <div className="row small muted" style={{ marginBottom: 6 }}>
        <span className="row"><span className="dot" style={{ background: 'var(--accent-weak)', border: '1px solid var(--accent)' }} />勉強できる時間</span>
        <span className="row"><span className="dot" style={{ background: 'var(--accent)' }} />計画の量</span>
      </div>
      {days.map((d) => {
        const cap = availableMinutes(state.weekly, state.events, d);
        const plan = planned.get(d) ?? 0;
        const evs = eventsOn(state.events, d);
        const examDay = exam?.subjects.some((s) => s.examDate === d);
        return (
          <div key={d}>
            <div className="cap">
              <span style={{ fontWeight: d === today ? 700 : 400, color: examDay ? 'var(--bad)' : undefined }}>
                {formatShort(d)}
              </span>
              <div className="bar" style={{ background: 'transparent' }}>
                <div style={{ width: `${(cap / max) * 100}%`, background: 'var(--accent-weak)', position: 'relative' }}>
                  <div style={{ width: `${cap ? Math.min(100, (plan / cap) * 100) : 0}%`, height: '100%', background: 'var(--accent)' }} />
                </div>
              </div>
              <span className="muted">{formatMinutes(cap)}</span>
            </div>
            {evs.length > 0 && (
              <div className="small muted" style={{ marginLeft: 84, marginTop: -2 }}>
                {evs.map((e) => e.title).join('・')}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function emptyEvent(today: string): LifeEvent {
  return { id: '', title: '', category: '部活', date: today, allDay: false, start: '16:00', end: '19:00' };
}

function EventForm() {
  const { state, update } = useStore();
  const today = appToday();
  const [ev, setEv] = useState<LifeEvent>(emptyEvent(today));
  const set = (p: Partial<LifeEvent>) => setEv((e) => ({ ...e, ...p }));
  const exam = activeExam(state);

  // この予定を入れたら計画がどう変わるか（入れる前に見せる）
  const impact = useMemo(() => {
    if (!exam || exam.subjects.length === 0 || !ev.title) return null;
    const before = currentPlan(state, exam, today).future;
    const withEv: AppState = { ...state, events: [...state.events, { ...ev, id: 'preview' }] };
    const after = currentPlan(withEv, exam, today).future;
    return {
      lost: before.capacityMinutes - after.capacityMinutes,
      trimmedBefore: before.trimmed.length,
      trimmedAfter: after.trimmed.length,
      overflowAfter: after.overflow.length,
    };
  }, [state, exam, ev, today]);

  const valid = ev.title.trim() !== '' && (ev.allDay || (ev.start && ev.end && ev.start < ev.end));

  const save = () => {
    if (!valid) return;
    update((s) => ({ ...s, events: [...s.events, { ...ev, id: newId(), title: ev.title.trim() }] }));
    setEv(emptyEvent(today));
  };

  return (
    <div className="card stack">
      <h2>予定を追加</h2>
      <div className="row wrap">
        {CATEGORIES.map((c) => (
          <button key={c} className={`chip selectable ${ev.category === c ? 'on' : ''}`} onClick={() => set({ category: c })}>
            {c}
          </button>
        ))}
      </div>
      <TextField label="予定の名前" value={ev.title} placeholder="例: 部活の練習、塾、おばあちゃんの家" onChange={(v) => set({ title: v })} />
      <div className="grid2">
        <TextField label="日にち" type="date" value={ev.date} onChange={(v) => v && set({ date: v })} />
        <label className="row small" style={{ alignSelf: 'end', paddingBottom: 8 }}>
          <input type="checkbox" checked={ev.allDay} onChange={(e) => set({ allDay: e.target.checked })} />
          1日中（勉強できない）
        </label>
      </div>
      {!ev.allDay && (
        <div className="grid2">
          <TextField label="開始" type="time" value={ev.start ?? ''} onChange={(v) => set({ start: v })} />
          <TextField label="終了" type="time" value={ev.end ?? ''} onChange={(v) => set({ end: v })} />
        </div>
      )}
      <div className="row wrap">
        <label className="row small">
          <input type="checkbox" checked={!!ev.repeatWeekly} onChange={(e) => set({ repeatWeekly: e.target.checked })} />
          毎週くり返す（{dowLabel(dayOfWeek(ev.date))}曜日）
        </label>
        {ev.repeatWeekly && (
          <>
            <input
              type="date"
              style={{ width: 'auto' }}
              value={ev.repeatUntil ?? ''}
              onChange={(e) => set({ repeatUntil: e.target.value || undefined })}
            />
            <span className="small muted">まで</span>
          </>
        )}
      </div>
      {impact && (
        <div className={`banner ${impact.overflowAfter > 0 ? 'bad' : impact.trimmedAfter > impact.trimmedBefore ? 'warn' : 'ok'}`}>
          {impact.lost === 0
            ? 'この予定は勉強時間と重ならないので、計画に影響なし。'
            : `この予定で、テストまでに使える勉強時間が ${formatMinutes(impact.lost)} 減るよ。`}
          {impact.overflowAfter > 0
            ? ' 1周目が間に合わなくなる！ほかの日に勉強時間を増やせないか相談しよう。'
            : impact.trimmedAfter > impact.trimmedBefore
              ? ` 解き直し・仕上げが ${impact.trimmedAfter - impact.trimmedBefore} 件省かれる。`
              : impact.lost > 0
                ? ' でも計画は今のままこなせるよ。'
                : ''}
        </div>
      )}
      <button className="btn primary" disabled={!valid} onClick={save}>この予定を入れる</button>
    </div>
  );
}

function EventList() {
  const { state, update } = useStore();
  const today = appToday();
  const list = state.events
    .filter((e) => e.date >= addDays(today, -1) || (e.repeatWeekly && (!e.repeatUntil || e.repeatUntil >= today)))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (list.length === 0) return null;
  return (
    <div className="card">
      <h2>入っている予定</h2>
      {list.map((e) => (
        <div key={e.id} className="spread small" style={{ padding: '4px 0', borderBottom: '1px solid var(--line)' }}>
          <span>
            <span className="chip event">{e.category}</span> {e.title}
            <span className="muted">
              {' '}
              {e.repeatWeekly ? `毎週${dowLabel(dayOfWeek(e.date))}曜` : formatShort(e.date)}
              {e.allDay ? ' 終日' : ` ${e.start}〜${e.end}`}
              {e.repeatWeekly && e.repeatUntil && `（${formatShort(e.repeatUntil)}まで）`}
            </span>
          </span>
          <button
            className="link"
            style={{ color: 'var(--bad)' }}
            onClick={() => update((s) => ({ ...s, events: s.events.filter((x) => x.id !== e.id) }))}
          >
            削除
          </button>
        </div>
      ))}
    </div>
  );
}

/** 曜日ごとの「勉強できる時間帯」 */
function WeeklyEditor() {
  const { state, update } = useStore();
  const setDay = (dow: number, ws: TimeWindow[]) =>
    update((s) => ({ ...s, weekly: { ...s.weekly, [dow]: ws } }));

  return (
    <details className="card">
      <summary>勉強できる時間帯（曜日ごと）</summary>
      <p className="small muted">
        ふだん勉強に使える時間帯。ここから予定と重なる時間を引いて計画を作るよ。ご飯・お風呂・寝る時間は入れないでね。
      </p>
      {[1, 2, 3, 4, 5, 6, 0].map((dow) => {
        const ws = state.weekly[dow] ?? [];
        return (
          <div key={dow} style={{ marginBottom: 10 }}>
            <div className="spread small">
              <b>{dowLabel(dow)}曜日</b>
              <span className="muted">合計 {formatMinutes(windowMinutes(ws))}</span>
            </div>
            {ws.map((w, i) => (
              <div key={i} className="row" style={{ marginTop: 4 }}>
                <input type="time" value={w.start} onChange={(e) => setDay(dow, ws.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} />
                <span>〜</span>
                <input type="time" value={w.end} onChange={(e) => setDay(dow, ws.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} />
                <button className="link" style={{ color: 'var(--bad)' }} onClick={() => setDay(dow, ws.filter((_, j) => j !== i))}>×</button>
              </div>
            ))}
            <button className="link" onClick={() => setDay(dow, [...ws, { start: '20:00', end: '21:00' }])}>＋時間帯を追加</button>
          </div>
        );
      })}
    </details>
  );
}
