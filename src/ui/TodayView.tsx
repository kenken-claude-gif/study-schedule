import { useEffect, useMemo, useState } from 'react';
import { useStore, newId } from '../app/store.tsx';
import {
  activeExam,
  behind,
  capacityFn,
  currentPlan,
  doneForTask,
  ensureTodayFrozen,
  lastExamDate,
} from '../app/planner.ts';
import { eventsOn } from '../domain/availability.ts';
import { diffDays, formatMinutes, formatShort } from '../domain/date.ts';
import { counter, taskHowTo, taskTitle, wrongLabel } from '../domain/labels.ts';
import type { Exam, PlannedTask } from '../domain/types.ts';
import { appToday, Dot, NumberField, PassChip, subjectColor } from './common.tsx';
import type { TabKey } from './App.tsx';

export function TodayView({ goTo }: { goTo: (t: TabKey) => void }) {
  const { state, update } = useStore();
  const today = appToday();
  const exam = activeExam(state);

  useEffect(() => {
    update((s) => ensureTodayFrozen(s, today));
  }, [update, today, exam?.id]);

  if (!exam) {
    return (
      <>
        <Header title="今日の勉強" />
        <div className="card stack">
          <h2>はじめよう</h2>
          <p className="small">
            ① テスト範囲を入れる → ② 部活や塾などの予定を入れる → ③ 毎日「今日」の画面を見て勉強して、やった量を記録する。
          </p>
          <button className="btn primary block" onClick={() => goTo('exam')}>
            テスト範囲を入れる
          </button>
        </div>
      </>
    );
  }
  return <TodayBody exam={exam} today={today} goTo={goTo} />;
}

function Header({ title, sub }: { title: string; sub?: string }) {
  return (
    <header className="app-header">
      <h1>{title}</h1>
      {sub && <span className="sub">{sub}</span>}
    </header>
  );
}

function TodayBody({ exam, today, goTo }: { exam: Exam; today: string; goTo: (t: TabKey) => void }) {
  const { state, update } = useStore();
  const plan = useMemo(() => currentPlan(state, exam, today), [state, exam, today]);
  const late = useMemo(() => behind(state, exam, today), [state, exam, today]);
  const last = lastExamDate(exam);
  const nextExam = [...exam.subjects]
    .filter((s) => s.examDate >= today)
    .sort((a, b) => a.examDate.localeCompare(b.examDate))[0];
  const events = eventsOn(state.events, today);
  const available = capacityFn(state)(today);

  if (exam.subjects.length === 0) {
    return (
      <>
        <Header title={exam.name} />
        <div className="card">
          <p>まだ教科が入っていないよ。</p>
          <button className="btn primary" onClick={() => goTo('exam')}>テスト範囲を入れる</button>
        </div>
      </>
    );
  }

  if (last && today >= last && !nextExam) {
    return (
      <>
        <Header title={exam.name} />
        <div className="card stack">
          <h2>テストおつかれさま！</h2>
          <p className="small">結果が返ってきたら「テスト範囲」の画面で点数を入れて振り返ろう。次のテストの計画に生かせるよ。</p>
          <button className="btn primary" onClick={() => goTo('exam')}>点数を入れる</button>
        </div>
      </>
    );
  }

  const beforeStart = today < exam.studyStart;
  const todays = beforeStart ? [] : plan.today;
  const totalMin = todays.reduce((s, t) => s + t.minutes, 0);
  const doneMin = todays.reduce(
    (s, t) => s + Math.min(t.minutes, (t.minutes * doneForTask(state, t.id)) / Math.max(1, t.units)),
    0,
  );
  const allDone = todays.length > 0 && todays.every((t) => doneForTask(state, t.id) >= t.units);
  const testToday = exam.subjects.filter((s) => s.examDate === today);

  return (
    <>
      <Header title="今日の勉強" sub={`${formatShort(today)}・${exam.name}`} />

      {nextExam && (
        <div className="card spread">
          <div>
            <div className="small muted">次のテスト</div>
            <div className="row"><Dot color={subjectColor(exam, nextExam.id)} /><b>{nextExam.name}</b></div>
            <div className="small muted">{formatShort(nextExam.examDate)}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="small muted">あと</div>
            <div className="big">{diffDays(today, nextExam.examDate)}<span className="small">日</span></div>
          </div>
        </div>
      )}

      {testToday.length > 0 && (
        <div className="banner bad">📝 今日は {testToday.map((s) => s.name).join('・')} のテスト。がんばれ！</div>
      )}

      {plan.future.overflow.length > 0 && (
        <div className="banner bad">
          ⚠️ このままだと提出物が間に合わない。「予定」の画面で勉強できる時間を増やせないか、家族と相談しよう。
        </div>
      )}
      {late.tasks.length > 0 && (
        <div className="banner warn">
          前の日までに終わらなかった分（約{formatMinutes(late.minutes)}）は、今日以降の計画に組み直したよ。
        </div>
      )}
      {plan.future.trimmed.length > 0 && (
        <div className="banner warn">
          時間が足りないので、点数につながりにくいもの（{plan.future.trimmed.length}件）を省いているよ。
          <button className="link" onClick={() => goTo('plan')}>くわしく</button>
        </div>
      )}

      {beforeStart ? (
        <div className="card">
          <h2>勉強開始は {formatShort(exam.studyStart)} から</h2>
          <p className="small muted">開始日の計画はこんな感じ。範囲や予定はそれまでに入れておこう。</p>
          {plan.future.tasks
            .filter((t) => t.date === exam.studyStart)
            .map((t) => (
              <PreviewTask key={t.id} exam={exam} task={t} />
            ))}
        </div>
      ) : (
        <div className="card">
          <div className="spread">
            <h2>今日やること</h2>
            <span className="small muted">
              勉強できる時間 {formatMinutes(available)}
            </span>
          </div>
          <div className="small" style={{ marginBottom: 8 }}>
            <button
              className="link"
              onClick={() => {
                if (confirm('範囲や予定を変えた内容で、今日の計画を作り直す？')) {
                  update((s) => ensureTodayFrozen(s, today, true));
                }
              }}
            >
              範囲や予定を変えたら：今日の計画を作り直す
            </button>
          </div>
          {events.length > 0 && (
            <div className="row wrap" style={{ marginBottom: 8 }}>
              {events.map((e) => (
                <span key={e.id} className="chip event">
                  {e.category}：{e.title}
                  {!e.allDay && e.start && ` ${e.start}〜${e.end ?? ''}`}
                </span>
              ))}
            </div>
          )}
          {todays.length === 0 ? (
            <p className="small muted">今日は予定された勉強はないよ。ゆっくり休もう（予備日）。</p>
          ) : (
            <>
              <div className="bar" style={{ marginBottom: 6 }}>
                <div style={{ width: `${Math.min(100, (doneMin / Math.max(1, totalMin)) * 100)}%`, background: 'var(--ok)' }} />
              </div>
              <div className="small muted" style={{ marginBottom: 10 }}>
                目安 {formatMinutes(totalMin)}（{Math.round(doneMin)}分ぶん完了）
              </div>
              {allDone && <div className="banner ok">🎉 今日の分は全部おわり！よくがんばった！</div>}
              {todays.map((t) => (
                <TaskCard key={t.id} exam={exam} task={t} today={today} />
              ))}
            </>
          )}
        </div>
      )}
    </>
  );
}

function PreviewTask({ exam, task }: { exam: Exam; task: PlannedTask }) {
  const s = exam.subjects.find((x) => x.id === task.subjectId);
  const m = s?.materials.find((x) => x.id === task.materialId);
  if (!s || !m) return null;
  return (
    <div className="daytask">
      <Dot color={subjectColor(exam, s.id)} />
      <span>{s.name}：{taskTitle(task, m, s)}</span>
      <span className="muted">({task.minutes}分)</span>
    </div>
  );
}

function TaskCard({ exam, task, today }: { exam: Exam; task: PlannedTask; today: string }) {
  const { state, update } = useStore();
  const [open, setOpen] = useState(false);
  const s = exam.subjects.find((x) => x.id === task.subjectId);
  const m = s?.materials.find((x) => x.id === task.materialId);
  const done = doneForTask(state, task.id);
  const left = Math.max(0, task.units - done);
  const [amount, setAmount] = useState<number | undefined>(left);
  const [wrong, setWrong] = useState<number | undefined>(undefined);
  if (!s || !m) return null;
  const finished = left === 0;
  const c = counter(m);
  const askWrong = task.pass < 3;

  const record = (amt: number) => {
    if (amt <= 0) return;
    update((st) => ({
      ...st,
      logs: [
        ...st.logs,
        {
          id: newId(),
          date: today,
          examId: exam.id,
          subjectId: s.id,
          materialId: m.id,
          pass: task.pass,
          amount: amt,
          wrong: askWrong && wrong !== undefined ? Math.min(wrong, amt) : undefined,
          taskId: task.id,
        },
      ],
    }));
    setOpen(false);
    setWrong(undefined);
  };

  const undo = () => {
    update((st) => ({ ...st, logs: st.logs.filter((l) => l.taskId !== task.id) }));
    setAmount(task.units);
  };

  return (
    <div className={`task ${finished ? 'done' : ''}`}>
      <div className="row" onClick={() => setOpen(!open)} style={{ cursor: 'pointer' }}>
        <span className={`check ${finished ? 'on' : ''}`}>{finished ? '✓' : ''}</span>
        <div style={{ flex: 1 }}>
          <div className="row wrap small">
            <Dot color={subjectColor(exam, s.id)} />
            <b>{s.name}</b>
            <PassChip pass={task.pass} />
          </div>
          <div className="title">{taskTitle(task, m, s)}</div>
          <div className="meta">
            目安 {task.minutes}分
            {done > 0 && !finished && `・${done}/${task.units}${c} できた`}
          </div>
        </div>
      </div>
      {open && (
        <div style={{ marginTop: 8 }}>
          <div className="small"><b>やり方</b></div>
          <ol className="howto">
            {taskHowTo(task, m, s).map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ol>
          <hr />
          {finished ? (
            <div className="spread">
              <span className="small">記録ずみ（{done}{c}）</span>
              <button className="btn small danger" onClick={undo}>記録を取り消す</button>
            </div>
          ) : (
            <div className="stack">
              <div className={askWrong ? 'grid2' : ''}>
                <NumberField
                  label={`やった量（${c}）`}
                  value={amount}
                  min={0}
                  max={left}
                  onChange={setAmount}
                />
                {askWrong && (
                  <NumberField
                    label={wrongLabel(m, s)}
                    value={wrong}
                    min={0}
                    placeholder="例: 3"
                    onChange={setWrong}
                  />
                )}
              </div>
              <div className="row">
                <button
                  className="btn ok"
                  style={{ flex: 1 }}
                  onClick={() => record(left)}
                >
                  全部できた
                </button>
                <button
                  className="btn"
                  style={{ flex: 1 }}
                  disabled={!amount || amount <= 0}
                  onClick={() => record(Math.min(left, amount ?? 0))}
                >
                  この量で記録
                </button>
              </div>
              {askWrong && (
                <p className="small muted" style={{ margin: 0 }}>
                  できなかった量を入れると、その分だけが次の周（やり直し）になるよ。入れないと苦手度から見積もる。
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
