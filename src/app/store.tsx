import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { DEFAULT_WEEKLY } from '../domain/presets.ts';
import type { AppState } from '../domain/types.ts';
import { isAppState } from './validate.ts';

export { isAppState };

const STORAGE_KEY = 'study-schedule:v1';

export function initialState(): AppState {
  return {
    version: 1,
    exams: [],
    weekly: DEFAULT_WEEKLY,
    events: [],
    logs: [],
    dayPlans: {},
    settings: { loadFactor: 0.8, maxSubjectsPerDay: 3 },
  };
}

function load(): AppState {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return initialState();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isAppState(parsed)) return parsed;
    console.error('保存データの形式が違うため読み込めませんでした');
  } catch (e) {
    console.error('保存データの読み込みに失敗:', e);
  }
  // 壊れたデータは消さずに別名で残しておく（あとで手で復旧できるように）
  try {
    localStorage.setItem(`${STORAGE_KEY}:broken:${Date.now()}`, raw);
  } catch (e) {
    console.error('壊れたデータの退避に失敗:', e);
  }
  return initialState();
}

export function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

type Updater = (s: AppState) => AppState;
interface Store {
  state: AppState;
  update: (fn: Updater) => void;
  replace: (s: AppState) => void;
  /** 最後の保存に失敗したか（容量不足など） */
  saveError: boolean;
}

/** 今の状態を端末に保存する。容量不足などで失敗したら false */
function save(state: AppState): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    console.error('データの保存に失敗:', e);
    return false;
  }
}

/** 画面が落ちたときに、保存されている生のデータを取り出す（エラー画面のバックアップ用） */
export function rawSavedData(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch (e) {
    console.error('保存データを読めませんでした:', e);
    return null;
  }
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(load);
  const [saveError, setSaveError] = useState(false);

  useEffect(() => {
    setSaveError(!save(state));
  }, [state]);

  useEffect(() => {
    // 端末の空き容量が少ないときにブラウザがデータを消さないようにお願いする
    navigator.storage?.persist?.().catch((e: unknown) => console.warn('persist 失敗:', e));
  }, []);

  const update = useCallback((fn: Updater) => setState((s) => fn(s)), []);
  const replace = useCallback((s: AppState) => setState(s), []);
  return <Ctx.Provider value={{ state, update, replace, saveError }}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('StoreProvider の外で useStore が呼ばれました');
  return s;
}
