import { useMemo, useState } from 'react';
import { newId, useStore } from '../app/store.tsx';
import { formatShort } from '../domain/date.ts';
import {
  AVERAGE,
  latestDiff,
  mockPoints,
  regularPoints,
  seriesNames,
  type MockMetric,
  type ScorePoint,
} from '../domain/scores.ts';
import type { MockExam, MockScore } from '../domain/types.ts';
import { appToday, NumberField, TextField } from './common.tsx';
import { ResultsCard } from './ExamView.tsx';
import { LineChart, type ChartSeries } from './LineChart.tsx';

/** 同時に表示する線の数の上限（これ以上は色で見分けられなくなる） */
const MAX_SERIES = 4;
const MOCK_SUBJECTS = ['国語', '数学', '英語', '理科', '社会', '総合'];

type Kind = 'regular' | 'mock';

export function ScoresView() {
  const { state } = useStore();
  const [kind, setKind] = useState<Kind>('regular');
  const [metric, setMetric] = useState<MockMetric>('deviation');
  const mocks = state.mockExams ?? [];

  const points = useMemo(
    () => (kind === 'regular' ? regularPoints(state.exams) : mockPoints(mocks, metric)),
    [kind, metric, state.exams, mocks],
  );

  return (
    <>
      <header className="app-header">
        <h1>成績</h1>
        <span className="sub">結果を入れ続けると、伸びが見える</span>
      </header>

      <div className="seg-toggle" style={{ marginBottom: 12 }}>
        <button className={kind === 'regular' ? 'on' : ''} onClick={() => setKind('regular')}>定期テスト</button>
        <button className={kind === 'mock' ? 'on' : ''} onClick={() => setKind('mock')}>模試</button>
      </div>

      {kind === 'mock' && (
        <div className="seg-toggle" style={{ marginBottom: 12 }}>
          <button className={metric === 'deviation' ? 'on' : ''} onClick={() => setMetric('deviation')}>偏差値</button>
          <button className={metric === 'rate' ? 'on' : ''} onClick={() => setMetric('rate')}>得点率（%）</button>
        </div>
      )}

      {/* 種類や指標が変わると系列が変わるので、選択状態ごと作り直す */}
      <ChartCard key={`${kind}-${metric}`} points={points} kind={kind} metric={metric} />

      {kind === 'regular' ? <RegularInput /> : <MockInput />}
    </>
  );
}

/** 縦軸の範囲。上下に少し余白をとって10刻みに丸め、幅は最低30にする */
function yRange(vals: number[], deviation: boolean): { yMin: number; yMax: number } {
  if (vals.length === 0) return deviation ? { yMin: 40, yMax: 60 } : { yMin: 0, yMax: 100 };
  const lo = deviation ? 20 : 0;
  const hi = deviation ? 80 : 100;
  let yMin = Math.max(lo, Math.floor((Math.min(...vals) - 5) / 10) * 10);
  let yMax = Math.min(hi, Math.ceil((Math.max(...vals) + 5) / 10) * 10);
  while (yMax - yMin < 30) {
    if (yMin > lo) yMin -= 10;
    else if (yMax < hi) yMax += 10;
    else break;
  }
  return { yMin, yMax };
}

/** はじめに表示する系列：平均と、直近の点数が低い教科（伸ばしたい教科）から */
function defaultSelection(points: ScorePoint[], names: string[]): string[] {
  const last = points.at(-1);
  const rest = names
    .filter((n) => n !== AVERAGE)
    .sort((a, b) => (last?.values[a] ?? 999) - (last?.values[b] ?? 999));
  return (names.includes(AVERAGE) ? [AVERAGE, ...rest] : rest).slice(0, MAX_SERIES);
}

function ChartCard({ points, kind, metric }: { points: ScorePoint[]; kind: Kind; metric: MockMetric }) {
  const names = seriesNames(points);
  const [selected, setSelected] = useState<ChartSeries[]>(() =>
    defaultSelection(points, names).map((name, i) => ({ name, slot: i + 1 })),
  );
  const unit = kind === 'mock' && metric === 'deviation' ? '' : kind === 'mock' ? '%' : '点';

  if (points.length === 0) {
    return (
      <div className="card">
        <h2>まだ結果がないよ</h2>
        <p className="small muted">
          {kind === 'regular'
            ? '下の「定期テストの点数を入れる」から、返ってきた点数を入れてね。2回分入ると線になるよ。'
            : '下の「模試の結果を追加」から入れてね。偏差値と点数は、わかるほうだけでOK。'}
        </p>
      </div>
    );
  }

  const toggle = (name: string) => {
    setSelected((cur) => {
      if (cur.some((s) => s.name === name)) return cur.filter((s) => s.name !== name);
      if (cur.length >= MAX_SERIES) return cur;
      // 空いている色の枠を使う（残っている教科の色は変えない）
      const used = new Set(cur.map((s) => s.slot));
      const slot = [1, 2, 3, 4].find((n) => !used.has(n))!;
      return [...cur, { name, slot }];
    });
  };

  // 縦軸は表示している教科の値に合わせて10刻みで決める（0〜100だと線が固まって伸びが見えないため）
  const vals = points.flatMap((p) => selected.map((s) => p.values[s.name]).filter((v) => v !== undefined));
  const { yMin, yMax } = yRange(vals, kind === 'mock' && metric === 'deviation');

  return (
    <div className="card">
      <div className="small muted" style={{ marginBottom: 6 }}>
        表示する教科（{MAX_SERIES}つまで）
      </div>
      <div className="row wrap" style={{ marginBottom: 10 }}>
        {names.map((n) => {
          const s = selected.find((x) => x.name === n);
          return (
            <button
              key={n}
              className={`chip selectable ${s ? 'on' : ''}`}
              onClick={() => toggle(n)}
              disabled={!s && selected.length >= MAX_SERIES}
              aria-pressed={!!s}
            >
              {s && <span className="dot" style={{ background: `var(--series-${s.slot})`, border: '1.5px solid #fff' }} />}
              {n}
            </button>
          );
        })}
      </div>
      {selected.length === 0 ? (
        <p className="small muted">教科を選ぶとグラフが出るよ。</p>
      ) : (
        <LineChart points={points} series={selected} yMin={yMin} yMax={yMax} unit={unit} />
      )}
      <p className="small muted" style={{ margin: '6px 0 0' }}>
        点をタップすると、その回の{kind === 'mock' && metric === 'deviation' ? '偏差値' : '点数'}が出るよ。
      </p>

      <h3>前回からの変化</h3>
      {names.map((n) => {
        const d = latestDiff(points, n);
        if (!d) return null;
        return (
          <div key={n} className="spread small" style={{ padding: '2px 0' }}>
            <span>{n}</span>
            <span>
              <b>{d.latest}{unit}</b>{' '}
              {d.diff === undefined ? (
                <span className="muted">（初回）</span>
              ) : (
                <span style={{ color: d.diff > 0 ? 'var(--ok)' : d.diff < 0 ? 'var(--bad)' : 'var(--muted)' }}>
                  {d.diff > 0 ? `▲ +${d.diff}` : d.diff < 0 ? `▼ ${d.diff}` : '± 0'}
                </span>
              )}
            </span>
          </div>
        );
      })}

      <details style={{ marginTop: 8 }}>
        <summary>表で見る</summary>
        <div className="scroll-x">
          <table className="scores">
            <thead>
              <tr>
                <th>教科</th>
                {points.map((p) => (
                  <th key={p.id} title={p.label}>{formatShort(p.date)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {names.map((n) => (
                <tr key={n}>
                  <td>{n}</td>
                  {points.map((p) => (
                    <td key={p.id}>{p.values[n] ?? '–'}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

function RegularInput() {
  const { state } = useStore();
  const exams = [...state.exams].reverse();
  return (
    <div className="card">
      <h2>定期テストの点数を入れる</h2>
      {exams.length === 0 ? (
        <p className="small muted">「範囲」の画面でテストを作ると、ここで点数を入れられるよ。</p>
      ) : (
        exams.map((e) => <ResultsCard key={e.id} exam={e} title={e.name} />)
      )}
    </div>
  );
}

function emptyMock(today: string): MockExam {
  return {
    id: '',
    name: '',
    date: today,
    scores: MOCK_SUBJECTS.slice(0, 3).map((subject) => ({ subject })),
  };
}

function MockInput() {
  const { state, update } = useStore();
  const today = appToday();
  const mocks = [...(state.mockExams ?? [])].sort((a, b) => b.date.localeCompare(a.date));
  const [draft, setDraft] = useState<MockExam>(emptyMock(today));
  const editing = draft.id !== '';

  const setScore = (i: number, p: Partial<MockScore>) =>
    setDraft((d) => ({ ...d, scores: d.scores.map((s, j) => (j === i ? { ...s, ...p } : s)) }));

  const save = () => {
    const cleaned = {
      ...draft,
      name: draft.name.trim() || '模試',
      scores: draft.scores.filter((s) => s.subject.trim() !== ''),
    };
    update((s) => {
      const list = s.mockExams ?? [];
      return {
        ...s,
        mockExams: editing
          ? list.map((m) => (m.id === cleaned.id ? cleaned : m))
          : [...list, { ...cleaned, id: newId() }],
      };
    });
    setDraft(emptyMock(today));
  };

  const remove = (m: MockExam) => {
    if (!confirm(`「${m.name}」の結果を削除する？`)) return;
    update((s) => ({ ...s, mockExams: (s.mockExams ?? []).filter((x) => x.id !== m.id) }));
    if (draft.id === m.id) setDraft(emptyMock(today));
  };

  const unused = MOCK_SUBJECTS.filter((n) => !draft.scores.some((s) => s.subject === n));

  return (
    <>
      <div className="card stack">
        <h2>{editing ? '模試の結果を直す' : '模試の結果を追加'}</h2>
        <div className="grid2">
          <TextField label="模試の名前" value={draft.name} placeholder="例: 7月 進研模試" onChange={(v) => setDraft({ ...draft, name: v })} />
          <TextField label="受けた日" type="date" value={draft.date} onChange={(v) => v && setDraft({ ...draft, date: v })} />
        </div>
        <p className="small muted" style={{ margin: 0 }}>点数・満点・偏差値は、わかるものだけでOK。満点を空けると100点満点として計算するよ。</p>
        {draft.scores.map((sc, i) => (
          <div key={i} className="task" style={{ marginBottom: 0 }}>
            <div className="spread">
              <input
                style={{ width: '60%' }}
                value={sc.subject}
                placeholder="教科"
                onChange={(e) => setScore(i, { subject: e.target.value })}
              />
              <button
                className="link"
                style={{ color: 'var(--bad)' }}
                onClick={() => setDraft((d) => ({ ...d, scores: d.scores.filter((_, j) => j !== i) }))}
              >
                外す
              </button>
            </div>
            <div className="grid3" style={{ marginTop: 6 }}>
              <NumberField label="点数" value={sc.score} min={0} onChange={(v) => setScore(i, { score: v })} />
              <NumberField label="満点" value={sc.max} min={1} placeholder="100" onChange={(v) => setScore(i, { max: v })} />
              <NumberField label="偏差値" value={sc.deviation} min={0} max={100} step={0.1} onChange={(v) => setScore(i, { deviation: v })} />
            </div>
          </div>
        ))}
        <div className="row wrap">
          {unused.map((n) => (
            <button
              key={n}
              className="chip selectable"
              onClick={() => setDraft((d) => ({ ...d, scores: [...d.scores, { subject: n }] }))}
            >
              ＋{n}
            </button>
          ))}
          <button
            className="chip selectable"
            onClick={() => setDraft((d) => ({ ...d, scores: [...d.scores, { subject: '' }] }))}
          >
            ＋ほかの教科
          </button>
        </div>
        <div className="row">
          {editing && <button className="btn" onClick={() => setDraft(emptyMock(today))}>やめる</button>}
          <button className="btn primary" style={{ flex: 1 }} onClick={save}>
            {editing ? '直した内容で保存' : '追加する'}
          </button>
        </div>
      </div>

      {mocks.length > 0 && (
        <div className="card">
          <h2>入れた模試</h2>
          {mocks.map((m) => (
            <div key={m.id} className="spread small" style={{ padding: '4px 0', borderBottom: '1px solid var(--line)' }}>
              <span>
                {formatShort(m.date)} {m.name}
                <span className="muted">（{m.scores.length}教科）</span>
              </span>
              <span className="row">
                <button className="link" onClick={() => { setDraft(m); window.scrollTo(0, 0); }}>直す</button>
                <button className="link" style={{ color: 'var(--bad)' }} onClick={() => remove(m)}>削除</button>
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
