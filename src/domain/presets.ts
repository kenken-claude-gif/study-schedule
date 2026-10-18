import type { Material, MaterialKind, SubjectKind, Unit, WeeklyPattern } from './types.ts';

export interface SubjectPreset {
  name: string;
  kind: SubjectKind;
}

/** 高1（共通科目）の教科の初期リスト。学校によって違うので追加・削除できる */
export const GRADE1_SUBJECTS: SubjectPreset[] = [
  { name: '現代の国語', kind: 'mixed' },
  { name: '言語文化', kind: 'memorize' },
  { name: '数学I', kind: 'understand' },
  { name: '数学A', kind: 'understand' },
  { name: '英語コミュニケーションI', kind: 'mixed' },
  { name: '論理・表現I', kind: 'mixed' },
  { name: '歴史総合', kind: 'memorize' },
  { name: '地理総合', kind: 'memorize' },
  { name: '公共', kind: 'memorize' },
  { name: '化学基礎', kind: 'understand' },
  { name: '生物基礎', kind: 'memorize' },
  { name: '物理基礎', kind: 'understand' },
  { name: '情報I', kind: 'mixed' },
  { name: '保健', kind: 'memorize' },
];

export const SUBJECT_KIND_LABEL: Record<SubjectKind, string> = {
  understand: '理解系（解いて身につける）',
  memorize: '暗記系（覚えて身につける）',
  mixed: 'ミックス',
};

export interface MaterialPreset {
  kind: MaterialKind;
  label: string;
  unit: Unit;
  minutesPerUnit: number;
  isSubmission: boolean;
}

/** 教材の種類ごとの初期値。1単位あたりの時間は目安で、記録を見て調整する */
export const MATERIAL_PRESETS: MaterialPreset[] = [
  { kind: 'workbook', label: 'ワーク・問題集', unit: 'page', minutesPerUnit: 8, isSubmission: true },
  { kind: 'print', label: 'プリント', unit: 'sheet', minutesPerUnit: 15, isSubmission: false },
  { kind: 'textbook', label: '教科書', unit: 'page', minutesPerUnit: 4, isSubmission: false },
  { kind: 'notes', label: '授業ノート', unit: 'page', minutesPerUnit: 4, isSubmission: false },
  { kind: 'vocab', label: '単語・漢字・用語', unit: 'item', minutesPerUnit: 0.6, isSubmission: false },
  { kind: 'other', label: 'その他', unit: 'page', minutesPerUnit: 5, isSubmission: false },
];

export const UNIT_LABEL: Record<Unit, { name: string; counter: string }> = {
  page: { name: 'ページ', counter: 'ページ' },
  problem: { name: '問題番号', counter: '問' },
  item: { name: '番号（単語など）', counter: '個' },
  sheet: { name: '枚', counter: '枚' },
};

export function materialPreset(kind: MaterialKind): MaterialPreset {
  return MATERIAL_PRESETS.find((p) => p.kind === kind) ?? MATERIAL_PRESETS[0];
}

export function newMaterial(id: string, kind: MaterialKind): Material {
  const p = materialPreset(kind);
  return {
    id,
    name: p.label,
    kind,
    unit: p.unit,
    rangeStart: 1,
    rangeEnd: 10,
    minutesPerUnit: p.minutesPerUnit,
    isSubmission: p.isSubmission,
    passes: 3,
  };
}

/** 勉強できる時間帯の初期値（平日は夜、休日は午前と午後） */
export const DEFAULT_WEEKLY: WeeklyPattern = {
  0: [
    { start: '09:30', end: '11:30' },
    { start: '14:00', end: '16:00' },
  ],
  1: [{ start: '19:30', end: '21:30' }],
  2: [{ start: '19:30', end: '21:30' }],
  3: [{ start: '19:30', end: '21:30' }],
  4: [{ start: '19:30', end: '21:30' }],
  5: [{ start: '19:30', end: '21:30' }],
  6: [
    { start: '09:30', end: '11:30' },
    { start: '14:00', end: '16:00' },
  ],
};
