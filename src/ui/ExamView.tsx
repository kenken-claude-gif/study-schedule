import { useState } from 'react';
import { newId, useStore } from '../app/store.tsx';
import { activeExam } from '../app/planner.ts';
import { addDays, formatShort } from '../domain/date.ts';
import {
  GRADE1_SUBJECTS,
  MATERIAL_PRESETS,
  SUBJECT_KIND_LABEL,
  UNIT_LABEL,
  newMaterial,
} from '../domain/presets.ts';
import { totalUnits } from '../domain/scheduler.ts';
import type {
  Exam,
  ExamSubject,
  Material,
  MaterialKind,
  Pass,
  SubjectKind,
  Unit,
  Weakness,
} from '../domain/types.ts';
import { appToday, Dot, NumberField, subjectColor, TextField } from './common.tsx';

const WEAK_FACES: Record<Weakness, string> = { 1: '😎', 2: '🙂', 3: '😐', 4: '😟', 5: '😱' };
const WEAK_LABEL: Record<Weakness, string> = { 1: '得意', 2: 'まあまあ', 3: 'ふつう', 4: '苦手', 5: 'すごく苦手' };

export function ExamView() {
  const { state, update } = useStore();
  const exam = activeExam(state);
  const [creating, setCreating] = useState(state.exams.length === 0);

  return (
    <>
      <header className="app-header">
        <h1>テスト範囲</h1>
        {state.exams.length > 0 && (
          <select
            style={{ width: 'auto' }}
            value={state.activeExamId ?? ''}
            onChange={(e) => update((s) => ({ ...s, activeExamId: e.target.value }))}
          >
            {state.exams.map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
        )}
      </header>

      {creating ? (
        <NewExamForm onDone={() => setCreating(false)} />
      ) : (
        <button className="btn block" style={{ marginBottom: 12 }} onClick={() => setCreating(true)}>
          ＋ 新しいテストを作る
        </button>
      )}

      {exam && !creating && <ExamEditor exam={exam} />}
    </>
  );
}

function NewExamForm({ onDone }: { onDone: () => void }) {
  const { state, update } = useStore();
  const today = appToday();
  const [name, setName] = useState('');
  const [studyStart, setStudyStart] = useState(today);
  const [firstDay, setFirstDay] = useState(addDays(today, 14));
  const [copyFrom, setCopyFrom] = useState<string>('');
  const [picked, setPicked] = useState<string[]>([]);

  const toggle = (n: string) =>
    setPicked((p) => (p.includes(n) ? p.filter((x) => x !== n) : [...p, n]));

  const create = () => {
    const src = state.exams.find((e) => e.id === copyFrom);
    const subjects: ExamSubject[] = src
      ? src.subjects.map((s) => ({
          ...s,
          id: newId(),
          examDate: firstDay,
          // 前回の結果を「前回の点数」に引き継ぐ
          lastScore: src.results?.[s.id] ?? s.lastScore,
          materials: s.materials.map((m) => ({ ...m, id: newId(), dueDate: undefined })),
        }))
      : picked.map((n) => {
          const p = GRADE1_SUBJECTS.find((x) => x.name === n)!;
          return { id: newId(), name: p.name, kind: p.kind, examDate: firstDay, weakness: 3, materials: [] };
        });
    const exam: Exam = { id: newId(), name: name || '定期テスト', studyStart, subjects };
    update((s) => ({ ...s, exams: [...s.exams, exam], activeExamId: exam.id }));
    onDone();
  };

  return (
    <div className="card stack">
      <h2>新しいテスト</h2>
      <TextField label="テストの名前" value={name} placeholder="例: 2学期 期末テスト" onChange={setName} />
      <div className="grid2">
        <TextField label="勉強を始める日" type="date" value={studyStart} onChange={setStudyStart} />
        <TextField label="テスト初日" type="date" value={firstDay} onChange={setFirstDay} />
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        高校の定期テストは教科が多いので、2〜3週間前から始めるのがおすすめ。教科ごとのテスト日は後で変えられるよ。
      </p>
      {state.exams.length > 0 && (
        <label className="field">
          <span>前のテストから教科と教材をコピー（前回の点数も引き継ぐ）</span>
          <select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
            <option value="">コピーしない</option>
            {state.exams.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </label>
      )}
      {!copyFrom && (
        <>
          <div className="small muted">テストがある教科を選んでね（高1の共通科目）</div>
          <div className="row wrap">
            {GRADE1_SUBJECTS.map((s) => (
              <button
                key={s.name}
                className={`chip selectable ${picked.includes(s.name) ? 'on' : ''}`}
                onClick={() => toggle(s.name)}
              >
                {s.name}
              </button>
            ))}
          </div>
        </>
      )}
      <div className="row">
        {state.exams.length > 0 && <button className="btn" onClick={onDone}>やめる</button>}
        <button className="btn primary" style={{ flex: 1 }} onClick={create} disabled={!copyFrom && picked.length === 0}>
          作成する
        </button>
      </div>
    </div>
  );
}

function ExamEditor({ exam }: { exam: Exam }) {
  const { update } = useStore();
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState('');

  const patchExam = (p: Partial<Exam>) =>
    update((s) => ({ ...s, exams: s.exams.map((e) => (e.id === exam.id ? { ...e, ...p } : e)) }));
  const patchSubject = (id: string, p: Partial<ExamSubject>) =>
    patchExam({ subjects: exam.subjects.map((s) => (s.id === id ? { ...s, ...p } : s)) });

  const addSubject = () => {
    const n = adding.trim();
    if (!n) return;
    const preset = GRADE1_SUBJECTS.find((x) => x.name === n);
    const first = exam.subjects[0]?.examDate ?? addDays(exam.studyStart, 14);
    patchExam({
      subjects: [
        ...exam.subjects,
        { id: newId(), name: n, kind: preset?.kind ?? 'mixed', examDate: first, weakness: 3, materials: [] },
      ],
    });
    setAdding('');
  };

  const removeExam = () => {
    if (!confirm(`「${exam.name}」を削除する？記録も全部消えるよ。`)) return;
    update((s) => {
      const exams = s.exams.filter((e) => e.id !== exam.id);
      const { [exam.id]: _removed, ...dayPlans } = s.dayPlans;
      return {
        ...s,
        exams,
        activeExamId: exams[0]?.id,
        logs: s.logs.filter((l) => l.examId !== exam.id),
        dayPlans,
      };
    });
  };

  const sorted = [...exam.subjects].sort((a, b) => a.examDate.localeCompare(b.examDate));

  return (
    <>
      <div className="card stack">
        <TextField label="テストの名前" value={exam.name} onChange={(v) => patchExam({ name: v })} />
        <TextField label="勉強を始める日" type="date" value={exam.studyStart} onChange={(v) => v && patchExam({ studyStart: v })} />
      </div>

      <div className="banner info small">
        教科をタップして、①テストの日 ②苦手度 ③範囲（ワーク・プリント・単語など）を入れてね。範囲表を見ながら入れるのがおすすめ。
      </div>

      {sorted.map((s) => (
        <div className="card" key={s.id}>
          <div className="spread" style={{ cursor: 'pointer' }} onClick={() => setOpenId(openId === s.id ? null : s.id)}>
            <div className="row">
              <Dot color={subjectColor(exam, s.id)} />
              <b>{s.name}</b>
            </div>
            <span className="small muted">
              {formatShort(s.examDate)} {WEAK_FACES[s.weakness]} {s.materials.length === 0 ? '⚠️範囲なし' : `教材${s.materials.length}`}
            </span>
          </div>
          {openId === s.id && (
            <SubjectEditor
              subject={s}
              onChange={(p) => patchSubject(s.id, p)}
              onRemove={() => {
                if (confirm(`${s.name}を外す？`)) patchExam({ subjects: exam.subjects.filter((x) => x.id !== s.id) });
              }}
            />
          )}
        </div>
      ))}

      <div className="card row">
        <input list="subject-presets" placeholder="教科を追加（例: 情報I）" value={adding} onChange={(e) => setAdding(e.target.value)} />
        <datalist id="subject-presets">
          {GRADE1_SUBJECTS.map((s) => <option key={s.name} value={s.name} />)}
        </datalist>
        <button className="btn" onClick={addSubject}>追加</button>
      </div>

      <ResultsCard exam={exam} />

      <button className="btn danger block" onClick={removeExam}>このテストを削除</button>
    </>
  );
}

function SubjectEditor(props: {
  subject: ExamSubject;
  onChange: (p: Partial<ExamSubject>) => void;
  onRemove: () => void;
}) {
  const { subject: s, onChange } = props;
  const patchMaterial = (id: string, p: Partial<Material>) =>
    onChange({ materials: s.materials.map((m) => (m.id === id ? { ...m, ...p } : m)) });

  return (
    <div className="stack" style={{ marginTop: 10 }}>
      <div className="grid2">
        <TextField label="テストの日" type="date" value={s.examDate} onChange={(v) => v && onChange({ examDate: v })} />
        <label className="field">
          <span>教科のタイプ</span>
          <select value={s.kind} onChange={(e) => onChange({ kind: e.target.value as SubjectKind })}>
            {(Object.keys(SUBJECT_KIND_LABEL) as SubjectKind[]).map((k) => (
              <option key={k} value={k}>{SUBJECT_KIND_LABEL[k]}</option>
            ))}
          </select>
        </label>
      </div>
      <div>
        <div className="small muted">苦手度：{WEAK_LABEL[s.weakness]}（苦手なほど早めに・多めに時間を取る）</div>
        <div className="weak">
          {([1, 2, 3, 4, 5] as Weakness[]).map((w) => (
            <button key={w} className={s.weakness === w ? 'on' : ''} onClick={() => onChange({ weakness: w })}>
              {WEAK_FACES[w]}
            </button>
          ))}
        </div>
      </div>
      <div className="grid2">
        <NumberField label="前回の点数" value={s.lastScore} min={0} max={100} onChange={(v) => onChange({ lastScore: v })} />
        <NumberField label="目標の点数" value={s.targetScore} min={0} max={100} onChange={(v) => onChange({ targetScore: v })} />
      </div>
      <p className="small muted" style={{ margin: 0 }}>前回と目標の差が大きい教科ほど、時間を多めに割り当てるよ。</p>

      <h3>範囲・教材</h3>
      {s.materials.length === 0 && <p className="small muted">まだないよ。下のボタンから追加してね。</p>}
      {s.materials.map((m) => (
        <MaterialEditor
          key={m.id}
          m={m}
          onChange={(p) => patchMaterial(m.id, p)}
          onRemove={() => onChange({ materials: s.materials.filter((x) => x.id !== m.id) })}
        />
      ))}
      <div className="row wrap">
        {MATERIAL_PRESETS.map((p) => (
          <button
            key={p.kind}
            className="chip selectable"
            onClick={() => onChange({ materials: [...s.materials, newMaterial(newId(), p.kind)] })}
          >
            ＋{p.label}
          </button>
        ))}
      </div>
      <hr />
      <button className="btn small danger" onClick={props.onRemove}>この教科を外す</button>
    </div>
  );
}

function MaterialEditor(props: { m: Material; onChange: (p: Partial<Material>) => void; onRemove: () => void }) {
  const { m, onChange } = props;
  const units = totalUnits(m);
  return (
    <div className="task stack">
      <div className="grid2">
        <TextField label="教材名" value={m.name} onChange={(v) => onChange({ name: v })} />
        <label className="field">
          <span>種類</span>
          <select
            value={m.kind}
            onChange={(e) => {
              const kind = e.target.value as MaterialKind;
              const p = MATERIAL_PRESETS.find((x) => x.kind === kind)!;
              onChange({ kind, unit: p.unit, minutesPerUnit: p.minutesPerUnit });
            }}
          >
            {MATERIAL_PRESETS.map((p) => <option key={p.kind} value={p.kind}>{p.label}</option>)}
          </select>
        </label>
      </div>
      <div className="grid3">
        <label className="field">
          <span>単位</span>
          <select value={m.unit} onChange={(e) => onChange({ unit: e.target.value as Unit })}>
            {(Object.keys(UNIT_LABEL) as Unit[]).map((u) => <option key={u} value={u}>{UNIT_LABEL[u].name}</option>)}
          </select>
        </label>
        <NumberField label="どこから" value={m.rangeStart} min={0} onChange={(v) => onChange({ rangeStart: v ?? 1 })} />
        <NumberField label="どこまで" value={m.rangeEnd} min={0} onChange={(v) => onChange({ rangeEnd: v ?? 1 })} />
      </div>
      <div className="grid2">
        <NumberField
          label={`1${UNIT_LABEL[m.unit].counter}あたり何分？`}
          value={m.minutesPerUnit}
          min={0.1}
          step={0.1}
          onChange={(v) => onChange({ minutesPerUnit: v && v > 0 ? v : 1 })}
        />
        <label className="field">
          <span>何周やる？</span>
          <select value={m.passes} onChange={(e) => onChange({ passes: Number(e.target.value) as Pass })}>
            <option value={1}>1周（やるだけ）</option>
            <option value={2}>2周（×をやり直す）</option>
            <option value={3}>3周（仕上げまで）</option>
          </select>
        </label>
      </div>
      <div className="row wrap">
        <label className="row small">
          <input type="checkbox" checked={m.isSubmission} onChange={(e) => onChange({ isSubmission: e.target.checked })} />
          提出物
        </label>
        {m.isSubmission && (
          <input
            type="date"
            style={{ width: 'auto' }}
            value={m.dueDate ?? ''}
            onChange={(e) => onChange({ dueDate: e.target.value || undefined })}
          />
        )}
        {m.isSubmission && <span className="small muted">提出日</span>}
      </div>
      <div className="spread small muted">
        <span>
          全部で {units}{UNIT_LABEL[m.unit].counter}・1周目の目安 {Math.round(units * m.minutesPerUnit)}分
        </span>
        <button className="link" style={{ color: 'var(--bad)' }} onClick={props.onRemove}>削除</button>
      </div>
    </div>
  );
}

export function ResultsCard({ exam, title }: { exam: Exam; title?: string }) {
  const { update } = useStore();
  const setResult = (sid: string, v: number | undefined) =>
    update((s) => ({
      ...s,
      exams: s.exams.map((e) => {
        if (e.id !== exam.id) return e;
        const results = { ...(e.results ?? {}) };
        if (v === undefined) delete results[sid];
        else results[sid] = v;
        return { ...e, results };
      }),
    }));
  return (
    <details className="card">
      <summary>{title ?? 'テストの結果を入れる（振り返り）'}</summary>
      <p className="small muted">
        返ってきた点数を入れておくと、次のテストを「前のテストからコピー」で作ったときに、前回の点数として使われるよ。目標との差が大きい教科ほど次は時間を多めに取る。
      </p>
      {exam.subjects.map((s) => {
        const r = exam.results?.[s.id];
        const diff = r !== undefined && s.targetScore !== undefined ? r - s.targetScore : undefined;
        return (
          <div key={s.id} className="grid2" style={{ alignItems: 'end', marginBottom: 6 }}>
            <div className="small">
              {s.name}
              {s.targetScore !== undefined && <span className="muted">（目標 {s.targetScore}）</span>}
              {diff !== undefined && (
                <span style={{ color: diff >= 0 ? 'var(--ok)' : 'var(--bad)' }}>
                  {diff >= 0 ? ` 目標達成！+${diff}` : ` あと${-diff}点`}
                </span>
              )}
            </div>
            <NumberField label="点数" value={r} min={0} max={100} onChange={(v) => setResult(s.id, v)} />
          </div>
        );
      })}
    </details>
  );
}
