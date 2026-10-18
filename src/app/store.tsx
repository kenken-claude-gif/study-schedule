import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { DEFAULT_WEEKLY } from '../domain/presets.ts';
import type { AppState } from '../domain/types.ts';

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

/** バックアップや保存データが今の形かざっくり確かめる（壊れたデータで画面が落ちないように） */
export function isAppState(v: unknown): v is AppState {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    o.version === 1 &&
    Array.isArray(o.exams) &&
    Array.isArray(o.events) &&
    Array.isArray(o.logs) &&
    typeof o.weekly === 'object' &&
    typeof o.dayPlans === 'object' &&
    typeof o.settings === 'object'
  );
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
  localStorage.setItem(`${STORAGE_KEY}:broken:${Date.now()}`, raw);
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
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(load);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  useEffect(() => {
    // 端末の空き容量が少ないときにブラウザがデータを消さないようにお願いする
    navigator.storage?.persist?.().catch((e: unknown) => console.warn('persist 失敗:', e));
  }, []);

  const update = useCallback((fn: Updater) => setState((s) => fn(s)), []);
  const replace = useCallback((s: AppState) => setState(s), []);
  return <Ctx.Provider value={{ state, update, replace }}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('StoreProvider の外で useStore が呼ばれました');
  return s;
}
