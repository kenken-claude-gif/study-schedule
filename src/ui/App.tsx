import { useCallback, useEffect, useRef, useState } from 'react';
import { TodayView } from './TodayView.tsx';
import { PlanView } from './PlanView.tsx';
import { ExamView } from './ExamView.tsx';
import { ScheduleView } from './ScheduleView.tsx';
import { GuideView } from './GuideView.tsx';
import { ScoresView } from './ScoresView.tsx';
import { appToday } from './common.tsx';
import { useStore } from '../app/store.tsx';

export type TabKey = 'today' | 'plan' | 'exam' | 'schedule' | 'scores' | 'guide';

const TABS: { key: TabKey; label: string; ico: string }[] = [
  { key: 'today', label: '今日', ico: '✅' },
  { key: 'plan', label: '計画', ico: '🗓️' },
  { key: 'exam', label: '範囲', ico: '📚' },
  { key: 'schedule', label: '予定', ico: '🏀' },
  { key: 'scores', label: '成績', ico: '📈' },
  { key: 'guide', label: 'コツ', ico: '💡' },
];

/** 日付の確認間隔（ミリ秒） */
const DAY_CHECK_INTERVAL_MS = 60_000;

/**
 * 日付が変わったら画面を描き直す。
 * スマホではアプリを開いたまま翌日になることが多く、そのままだと昨日の計画が出続けるため
 */
function useDayRollover(): void {
  const [, setDay] = useState(appToday);
  useEffect(() => {
    const check = () => setDay((d) => (d === appToday() ? d : appToday()));
    const onVisible = () => document.visibilityState === 'visible' && check();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', check);
    const timer = window.setInterval(check, DAY_CHECK_INTERVAL_MS);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', check);
      window.clearInterval(timer);
    };
  }, []);
}

/**
 * タブの切り替えを履歴に積む。Android の戻るボタンで、アプリが閉じずに前のタブへ戻れるようにする
 */
function useTabHistory(): [TabKey, (t: TabKey) => void] {
  const [tab, setTab] = useState<TabKey>('today');
  useEffect(() => {
    history.replaceState({ tab: 'today' }, '');
    const onPop = (e: PopStateEvent) => {
      const t = (e.state as { tab?: TabKey } | null)?.tab;
      setTab(t && TABS.some((x) => x.key === t) ? t : 'today');
      window.scrollTo(0, 0);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const current = useRef(tab);
  current.current = tab;
  const go = useCallback((t: TabKey) => {
    if (current.current !== t) {
      history.pushState({ tab: t }, '');
      setTab(t);
    }
    window.scrollTo(0, 0);
  }, []);
  return [tab, go];
}

export function App() {
  useDayRollover();
  const [tab, go] = useTabHistory();
  const { saveError } = useStore();
  return (
    <>
      <main className="app">
        {saveError && (
          <div className="banner bad small">
            ⚠️ データを保存できなかった（スマホの空き容量が足りないかも）。今の内容は、アプリを閉じると消える可能性があるよ。「コツ → バックアップ」でファイルに保存しておこう。
          </div>
        )}
        {tab === 'today' && <TodayView goTo={go} />}
        {tab === 'plan' && <PlanView goTo={go} />}
        {tab === 'exam' && <ExamView />}
        {tab === 'schedule' && <ScheduleView />}
        {tab === 'scores' && <ScoresView />}
        {tab === 'guide' && <GuideView />}
      </main>
      <nav className="tabs">
        <div className="tabs-inner">
          {TABS.map((t) => (
            <button key={t.key} className={`tab ${tab === t.key ? 'active' : ''}`} onClick={() => go(t.key)}>
              <span className="ico">{t.ico}</span>
              {t.label}
            </button>
          ))}
        </div>
      </nav>
    </>
  );
}
