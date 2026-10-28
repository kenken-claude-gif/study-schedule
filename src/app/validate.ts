/** 保存データ・バックアップファイルの形の確認（画面の部品に依存しないので、テストから直接使える） */
import type { AppState } from '../domain/types.ts';

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * バックアップや保存データが今の形か確かめる（壊れたファイルを読み込んで画面が止まらないように）。
 * 画面が中まで読みにいく部分（テスト→教科→教材、記録、模試）まで見る
 */
export function isAppState(v: unknown): v is AppState {
  if (!isObject(v)) return false;
  const examsOk =
    Array.isArray(v.exams) &&
    v.exams.every(
      (e) =>
        isObject(e) &&
        typeof e.id === 'string' &&
        typeof e.studyStart === 'string' &&
        Array.isArray(e.subjects) &&
        e.subjects.every(
          (s) => isObject(s) && typeof s.examDate === 'string' && Array.isArray(s.materials) && s.materials.every(isObject),
        ),
    );
  const logsOk =
    Array.isArray(v.logs) &&
    v.logs.every((l) => isObject(l) && typeof l.materialId === 'string' && typeof l.amount === 'number');
  const mocksOk =
    v.mockExams === undefined ||
    (Array.isArray(v.mockExams) && v.mockExams.every((m) => isObject(m) && Array.isArray(m.scores)));
  return (
    v.version === 1 &&
    examsOk &&
    logsOk &&
    mocksOk &&
    Array.isArray(v.events) &&
    isObject(v.weekly) &&
    isObject(v.dayPlans) &&
    isObject(v.settings)
  );
}
