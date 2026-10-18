import type { Exam, ISODate, Pass } from '../domain/types.ts';
import { todayISO } from '../domain/date.ts';
import { PASS_NAME } from '../domain/labels.ts';

const SUBJECT_COLORS = [
  '#5b7cfa', '#f08a24', '#22a06b', '#d64545', '#9b5de5',
  '#00a3b4', '#c9a400', '#e0559b', '#6d8a3a', '#7a6ff0',
  '#b5651d', '#3b8ea5', '#d1495b', '#5f6caf',
];

export function subjectColor(exam: Exam, subjectId: string): string {
  const i = exam.subjects.findIndex((s) => s.id === subjectId);
  return SUBJECT_COLORS[(i < 0 ? 0 : i) % SUBJECT_COLORS.length];
}

/**
 * 今日の日付。動作確認用に URL の ?today=YYYY-MM-DD で上書きできる
 * （テスト前の数週間を、日付を進めながら試すため）
 */
export function appToday(): ISODate {
  const q = new URLSearchParams(location.search).get('today');
  return q && /^\d{4}-\d{2}-\d{2}$/.test(q) ? q : todayISO();
}

export function PassChip({ pass }: { pass: Pass }) {
  return <span className={`chip pass${pass}`}>{PASS_NAME[pass]}</span>;
}

export function Dot({ color }: { color: string }) {
  return <span className="dot" style={{ background: color }} />;
}

export function NumberField(props: {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
}) {
  return (
    <label className="field">
      <span>{props.label}</span>
      <input
        type="number"
        inputMode="decimal"
        value={props.value ?? ''}
        min={props.min}
        max={props.max}
        step={props.step}
        placeholder={props.placeholder}
        onChange={(e) => {
          const v = e.target.value;
          props.onChange(v === '' ? undefined : Number(v));
        }}
      />
    </label>
  );
}

export function TextField(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: 'text' | 'date' | 'time';
  placeholder?: string;
}) {
  return (
    <label className="field">
      <span>{props.label}</span>
      <input
        type={props.type ?? 'text'}
        value={props.value}
        placeholder={props.placeholder}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </label>
  );
}
