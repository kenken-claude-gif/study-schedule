import { useMemo } from 'react';
import { useStore } from '../app/store.tsx';
import { activeExam, capacityFn, currentPlan, doneForTask, examLogs, lastExamDate } from '../app/planner.ts';
import { eventsOn } from '../domain/availability.ts';
import { addDays, dateRange, formatMinutes, formatShort } from '../domain/date.ts';
import { PASS_DESC, PASS_NAME, counter, taskTitle } from '../domain/labels.ts';
import { materialProgress, type PlanItemRef } from '../domain/scheduler.ts';
import type { Exam, Pass, PlannedTask } from '../domain/types.ts';
import { appToday, Dot, PassChip, subjectColor } from './common.tsx';
import type { TabKey } from './App.tsx';

const PASS_COLOR: Record<Pass, string> = { 1: '#5b9bea', 2: '#f08a24', 3: '#9b5de5' };

export function PlanView({ goTo }: { goTo: (t: TabKey) => void }) {
  const { state } = useStore();
  const exam = activeExam(state);
  const today = appToday();
  if (!exam || exam.subjects.length === 0) {
    return (
      <>
        <header className="app-header"><h1>計画</h1></header>
        <div className="card">
          <p>テスト範囲を入れると、ここに計画が出るよ。</p>
          <button className="btn primary" onClick={() => goTo('exam')}>テスト範囲を入れる</button>
        </div>
      </>
    );
  }
  return <PlanBody exam={exam} today={today} goTo={goTo} />;
}

function refName(exam: Exam, r: PlanItemRef): string {
  const s = exam.subjects.find((x) => x.id === r.subjectId);
  const m = s?.materials.find((x) => x.id === r.materialId);
  return `${s?.name ?? '?'} ${m?.name ?? '?'}（${PASS_NAME[r.pass]} ${r.units}${m ? counter(m) : ''}・約${r.minutes}分）`;
}

function PlanBody({ exam, today, goTo }: { exam: Exam; today: string; goTo: (t: TabKey) => void }) {
  const { state } = useStore();
  const plan = useMemo(() => currentPlan(state, exam, today), [state, exam, today]);
  const logs = examLogs(state, exam.id);
  const last = lastExamDate(exam)!;
  const cap = capacityFn(state);

  const byDay = new Map<string, PlannedTask[]>();
  for (const t of [...plan.today, ...plan.future.tasks]) {
    byDay.set(t.date, [...(byDay.get(t.date) ?? []), t]);
  }
  const from = today < exam.studyStart ? exam.studyStart : today;
  const days = from <= last ? dateRange(from, last) : [];
  const pastDays = Object.keys(state.dayPlans[exam.id] ?? {})
    .filter((d) => d < today)
    .sort();

  const { demandMinutes, capacityMinutes } = plan.future;
  const ratio = demandMinutes / Math.max(1, capacityMinutes);

  return (
    <>
      <header className="app-header">
        <h1>計画</h1>
        <span className="sub">{exam.name}</span>
      </header>

      <div className="card">
        <h2>全体の見通し</h2>
        <div className="small">
          残りの勉強の量 <b>{formatMinutes(demandMinutes)}</b> ／ 使える時間 <b>{formatMinutes(capacityMinutes)}</b>
        </div>
        <div className="bar" style={{ margin: '6px 0' }}>
          <div
            style={{
              width: `${Math.min(100, ratio * 100)}%`,
              background: ratio > 1 ? 'var(--bad)' : ratio > 0.85 ? 'var(--warn)' : 'var(--ok)',
            }}
          />
        </div>
        <div className="small muted">
          {ratio > 1
            ? '時間が足りない。下の「省いたもの」を見て、予定を見直すか家族と相談しよう。'
            : ratio > 0.85
              ? 'ギリギリ。毎日の分をためないようにしよう。'
              : '余裕あり。このペースでいけば大丈夫！'}
          （使える時間は、勉強できる時間の{Math.round(state.settings.loadFactor * 100)}%で計算。残りは遅れたとき用の予備）
        </div>
      </div>

      {(plan.future.overflow.length > 0 || plan.future.trimmed.length > 0) && (
        <div className="card">
          {plan.future.overflow.length > 0 && (
            <>
              <h2 style={{ color: 'var(--bad)' }}>⚠️ 間に合わないもの</h2>
              <ul className="small">
                {plan.future.overflow.map((r) => <li key={`${r.materialId}${r.pass}`}>{refName(exam, r)}</li>)}
              </ul>
            </>
          )}
          {plan.future.trimmed.length > 0 && (
            <>
              <h2>省いたもの</h2>
              <p className="small muted">時間が足りないので、点数につながりにくいもの（得意な教科の仕上げや読み直し）から省いて、苦手な教科の解き直しを残したよ。予定が空いたら自動で戻る。</p>
              <ul className="small">
                {plan.future.trimmed.map((r) => <li key={`${r.materialId}${r.pass}`}>{refName(exam, r)}</li>)}
              </ul>
            </>
          )}
          <button className="btn small" onClick={() => goTo('schedule')}>予定を見直す</button>
        </div>
      )}

      <div className="card">
        <h2>教科ごとの進み具合</h2>
        <div className="row wrap small muted" style={{ marginBottom: 8 }}>
          {([1, 2, 3] as Pass[]).map((p) => (
            <span key={p} className="row"><span className="dot" style={{ background: PASS_COLOR[p] }} />{PASS_NAME[p]}：{PASS_DESC[p]}</span>
          ))}
        </div>
        {exam.subjects.map((s) => (
          <div key={s.id} style={{ marginBottom: 12 }}>
            <div className="row">
              <Dot color={subjectColor(exam, s.id)} />
              <b>{s.name}</b>
              <span className="small muted">{formatShort(s.examDate)}</span>
            </div>
            {s.materials.map((m) => {
              const p = materialProgress(m, s, logs);
              return (
                <div key={m.id} style={{ margin: '4px 0 0 18px' }}>
                  <div className="small">{m.name}{m.isSubmission && ' 📮'}</div>
                  <div className="passbar">
                    {([1, 2, 3] as Pass[]).map((pass) => {
                      const t = p.target[pass];
                      const pct = pass > m.passes ? 0 : t === 0 ? 100 : (p.done[pass] / t) * 100;
                      return (
                        <div key={pass} className="seg" title={`${PASS_NAME[pass]} ${p.done[pass]}/${t}`}>
                          <div style={{ width: `${pct}%`, background: PASS_COLOR[pass], opacity: pass > m.passes ? 0 : 1 }} />
                        </div>
                      );
                    })}
                  </div>
                  <div className="small muted">
                    {([1, 2, 3] as Pass[])
                      .filter((pass) => pass <= m.passes)
                      .map((pass) => `${PASS_NAME[pass]} ${p.done[pass]}/${p.target[pass]}`)
                      .join('　')}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div className="card">
        <h2>日ごとの予定</h2>
        {days.map((d) => {
          const ts = byDay.get(d) ?? [];
          const exams = exam.subjects.filter((s) => s.examDate === d);
          const evs = eventsOn(state.events, d);
          const mins = ts.reduce((s, t) => s + t.minutes, 0);
          return (
            <div key={d} className={`day ${d === today ? 'today' : ''} ${exams.length ? 'exam' : ''}`}>
              <div className="spread">
                <span className="date">{formatShort(d)}{d === today && '（今日）'}</span>
                <span className="small muted">{formatMinutes(mins)} / 使える{formatMinutes(cap(d))}</span>
              </div>
              <div className="row wrap">
                {exams.map((s) => <span key={s.id} className="chip exam">📝 {s.name}のテスト</span>)}
                {evs.map((e) => <span key={e.id} className="chip event">{e.title}</span>)}
              </div>
              {ts.length === 0 && exams.length === 0 && <div className="small muted">予備日（お休み）</div>}
              {ts.map((t) => {
                const s = exam.subjects.find((x) => x.id === t.subjectId);
                const m = s?.materials.find((x) => x.id === t.materialId);
                if (!s || !m) return null;
                const done = d === today && doneForTask(state, t.id) >= t.units;
                return (
                  <div key={t.id} className="daytask" style={{ opacity: done ? 0.5 : 1 }}>
                    <Dot color={subjectColor(exam, s.id)} />
                    <PassChip pass={t.pass} />
                    <span>{done && '✓ '}{s.name}：{taskTitle(t, m, s)}<span className="muted">（{t.minutes}分）</span></span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {pastDays.length > 0 && (
        <div className="card">
          <h2>これまでの記録</h2>
          {pastDays.map((d) => {
            const ts = state.dayPlans[exam.id][d];
            const ok = ts.filter((t) => doneForTask(state, t.id) >= t.units).length;
            return (
              <div key={d} className="spread small">
                <span>{formatShort(d)}</span>
                <span>{ts.length === 0 ? 'お休み' : `${ok}/${ts.length} 完了 ${ok === ts.length ? '🎉' : ''}`}</span>
              </div>
            );
          })}
          <div className="small muted" style={{ marginTop: 6 }}>
            直近7日でやった量：
            {formatMinutes(
              Math.round(
                logs
                  .filter((l) => l.date >= addDays(today, -7))
                  .reduce((s, l) => {
                    const subj = exam.subjects.find((x) => x.id === l.subjectId);
                    const m = subj?.materials.find((x) => x.id === l.materialId);
                    return s + (m ? l.amount * m.minutesPerUnit : 0);
                  }, 0),
              ),
            )}
            （目安）
          </div>
        </div>
      )}
    </>
  );
}
