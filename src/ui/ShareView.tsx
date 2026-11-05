import { useEffect, useState } from 'react';
import { SHARE_PREFIX, decodeSnapshot, type ShareRef, type ShareSnapshot, type ShareTask } from '../app/share.ts';
import { diffDays, formatMinutes, formatShort, todayISO } from '../domain/date.ts';
import { PASS_NAME, counter, taskTitle } from '../domain/labels.ts';
import type { ExamSubject, ISODate, Pass, PlannedTask } from '../domain/types.ts';
import { Dot, PASS_COLOR, PassChip, colorAt } from './common.tsx';

/** 共有データから、タスクの文言を作るのに必要な形へ戻す */
function toSubjects(snap: ShareSnapshot): ExamSubject[] {
  return snap.subjects.map((s, i) => ({
    id: String(i),
    name: s.n,
    kind: s.k,
    examDate: s.e,
    weakness: 3,
    materials: s.m.map((m, j) => ({
      id: `${i}-${j}`,
      name: m.n,
      kind: m.k,
      unit: m.u,
      rangeStart: 0,
      rangeEnd: 0,
      minutesPerUnit: 1,
      isSubmission: m.s === 1,
      passes: 3,
    })),
  }));
}

function toTask(t: ShareTask, date: ISODate): PlannedTask {
  return {
    id: `${date}|${t[0]}|${t[1]}|${t[2]}`,
    date,
    subjectId: String(t[0]),
    materialId: `${t[0]}-${t[1]}`,
    pass: t[2],
    units: t[3],
    minutes: t[4],
    ranges: t[5] === 0 ? undefined : t[5],
  };
}

/**
 * 共有リンクを開いたときの、見るだけの画面。
 * 入力欄はなく、端末にも保存しない（開いた人自身のデータには触らない）
 */
export function ShareView() {
  const [snap, setSnap] = useState<ShareSnapshot | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    decodeSnapshot(location.hash.slice(SHARE_PREFIX.length))
      .then((s) => {
        if (active) setSnap(s);
      })
      .catch((e: unknown) => {
        console.error('共有リンクを読み込めませんでした:', e);
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, []);

  if (failed) {
    return (
      <main className="app share">
        <div className="card">
          <h2>共有リンクを開けませんでした</h2>
          <p className="small muted">リンクが途中で切れているかもしれません。もう一度送ってもらってください。</p>
        </div>
      </main>
    );
  }
  if (!snap) return <main className="app share"><p className="small muted">読み込み中…</p></main>;
  return <ShareBody snap={snap} />;
}

function ShareBody({ snap }: { snap: ShareSnapshot }) {
  const subjects = toSubjects(snap);
  const age = diffDays(snap.at.slice(0, 10), todayISO());
  const todayRow = snap.days.find((d) => d.d === snap.today);
  const rest = snap.days.filter((d) => d.d !== snap.today);

  const titleOf = (t: ShareTask, date: ISODate) => {
    const s = subjects[t[0]];
    return `${s.name}：${taskTitle(toTask(t, date), s.materials[t[1]], s)}`;
  };
  const refName = (r: ShareRef) => {
    const s = subjects[r[0]];
    const m = s.materials[r[1]];
    return `${s.name} ${m.name}（${PASS_NAME[r[2]]} ${r[3]}${counter(m)}・約${r[4]}分）`;
  };

  return (
    <main className="app share">
      <header className="app-header">
        <h1>テスト勉強の様子</h1>
        <span className="sub">{snap.name}</span>
      </header>

      <div className={`banner small ${age > 0 ? 'warn' : 'info'}`}>
        見るだけの画面です。{snap.at} 時点の内容です。
        {age > 0 && ` ${age}日前の内容なので、最新を見るには送り直してもらってください。`}
      </div>

      {snap.overflow.length > 0 && (
        <div className="card">
          <h2 style={{ color: 'var(--bad)' }}>⚠️ 間に合わない提出物</h2>
          <ul className="small">{snap.overflow.map((r) => <li key={`${r[0]}-${r[1]}-${r[2]}`}>{refName(r)}</li>)}</ul>
        </div>
      )}
      {snap.late > 0 && (
        <div className="banner warn small">
          前の日までに終わらなかった分（約{formatMinutes(snap.late)}）は、今日以降の計画に組み直されています。
        </div>
      )}

      {todayRow && (
        <div className="card">
          <div className="spread">
            <h2>{formatShort(todayRow.d)} にやること</h2>
            <span className="small muted">勉強できる時間 {formatMinutes(todayRow.c)}</span>
          </div>
          {todayRow.ev.length > 0 && (
            <div className="row wrap" style={{ marginBottom: 8 }}>
              {todayRow.ev.map((e) => <span key={e} className="chip event">{e}</span>)}
            </div>
          )}
          {todayRow.t.length === 0 && <p className="small muted">この日の勉強の予定はありません。</p>}
          {todayRow.t.map((t) => {
            const finished = t[6] >= t[3];
            const m = subjects[t[0]].materials[t[1]];
            return (
              <div key={`${t[0]}-${t[1]}-${t[2]}`} className={`task ${finished ? 'done' : ''}`}>
                <div className="row">
                  <span className={`check ${finished ? 'on' : ''}`}>{finished ? '✓' : ''}</span>
                  <div style={{ flex: 1 }}>
                    <div className="row wrap small">
                      <Dot color={colorAt(t[0])} />
                      <PassChip pass={t[2]} />
                    </div>
                    <div className="title">{titleOf(t, todayRow.d)}</div>
                    <div className="meta">
                      目安 {t[4]}分
                      {t[6] > 0 && !finished && `・${t[6]}/${t[3]}${counter(m)} できた`}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="card">
        <h2>教科ごとの進み具合</h2>
        <div className="row wrap small muted" style={{ marginBottom: 8 }}>
          {([1, 2, 3] as Pass[]).map((p) => (
            <span key={p} className="row"><span className="dot" style={{ background: PASS_COLOR[p] }} />{PASS_NAME[p]}</span>
          ))}
        </div>
        {snap.subjects.map((s, i) => (
          <div key={i} style={{ marginBottom: 12 }}>
            <div className="row">
              <Dot color={colorAt(i)} />
              <b>{s.n}</b>
              <span className="small muted">{formatShort(s.e)}</span>
            </div>
            {s.m.map((m, j) => (
              <div key={j} style={{ margin: '4px 0 0 18px' }}>
                <div className="small">{m.n}{m.s === 1 && ' 📮'}</div>
                <div className="passbar">
                  {([0, 1, 2] as const).map((k) => (
                    <div key={k} className="seg">
                      <div
                        style={{
                          width: `${m.t[k] === 0 ? 0 : Math.min(100, (m.d[k] / m.t[k]) * 100)}%`,
                          background: PASS_COLOR[(k + 1) as Pass],
                        }}
                      />
                    </div>
                  ))}
                </div>
                <div className="small muted">
                  {([0, 1, 2] as const)
                    .filter((k) => m.t[k] > 0)
                    .map((k) => `${PASS_NAME[(k + 1) as Pass]} ${m.d[k]}/${m.t[k]}`)
                    .join('　')}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      {snap.trimmed.length > 0 && (
        <details className="card">
          <summary>時間が足りず省いているもの（{snap.trimmed.length}件）</summary>
          <ul className="small">{snap.trimmed.map((r) => <li key={`${r[0]}-${r[1]}-${r[2]}`}>{refName(r)}</li>)}</ul>
        </details>
      )}

      {rest.length > 0 && (
        <div className="card">
          <h2>これからの予定</h2>
          {rest.map((d) => {
            const exams = snap.subjects.filter((s) => s.e === d.d);
            const mins = d.t.reduce((a, t) => a + t[4], 0);
            return (
              <div key={d.d} className={`day ${exams.length ? 'exam' : ''}`}>
                <div className="spread">
                  <span className="date">{formatShort(d.d)}</span>
                  <span className="small muted">{formatMinutes(mins)} / 使える{formatMinutes(d.c)}</span>
                </div>
                <div className="row wrap">
                  {exams.map((s) => <span key={s.n} className="chip exam">📝 {s.n}のテスト</span>)}
                  {d.ev.map((e) => <span key={e} className="chip event">{e}</span>)}
                </div>
                {d.t.length === 0 && exams.length === 0 && <div className="small muted">予備日（お休み）</div>}
                {d.t.map((t) => (
                  <div key={`${t[0]}-${t[1]}-${t[2]}`} className="daytask">
                    <Dot color={colorAt(t[0])} />
                    <PassChip pass={t[2]} />
                    <span>{titleOf(t, d.d)}<span className="muted">（{t[4]}分）</span></span>
                  </div>
                ))}
              </div>
            );
          })}
          {snap.cut > 0 && (
            <p className="small muted" style={{ marginBottom: 0 }}>
              リンクが長くなるので、これより先の{snap.cut}日分は省いています。
            </p>
          )}
        </div>
      )}

      {snap.past.length > 0 && (
        <div className="card">
          <h2>これまでの記録</h2>
          {snap.past.map(([d, ok, total]) => (
            <div key={d} className="spread small">
              <span>{formatShort(d)}</span>
              <span>{total === 0 ? 'お休み' : `${ok}/${total} 完了 ${ok === total ? '🎉' : ''}`}</span>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
