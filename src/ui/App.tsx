import { useState } from 'react';
import { TodayView } from './TodayView.tsx';
import { PlanView } from './PlanView.tsx';
import { ExamView } from './ExamView.tsx';
import { ScheduleView } from './ScheduleView.tsx';
import { GuideView } from './GuideView.tsx';

export type TabKey = 'today' | 'plan' | 'exam' | 'schedule' | 'guide';

const TABS: { key: TabKey; label: string; ico: string }[] = [
  { key: 'today', label: '今日', ico: '✅' },
  { key: 'plan', label: '計画', ico: '🗓️' },
  { key: 'exam', label: 'テスト範囲', ico: '📚' },
  { key: 'schedule', label: '予定', ico: '🏀' },
  { key: 'guide', label: 'コツ・設定', ico: '💡' },
];

export function App() {
  const [tab, setTab] = useState<TabKey>('today');
  return (
    <>
      <main className="app">
        {tab === 'today' && <TodayView goTo={setTab} />}
        {tab === 'plan' && <PlanView goTo={setTab} />}
        {tab === 'exam' && <ExamView />}
        {tab === 'schedule' && <ScheduleView />}
        {tab === 'guide' && <GuideView />}
      </main>
      <nav className="tabs">
        <div className="tabs-inner">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={`tab ${tab === t.key ? 'active' : ''}`}
              onClick={() => {
                setTab(t.key);
                window.scrollTo(0, 0);
              }}
            >
              <span className="ico">{t.ico}</span>
              {t.label}
            </button>
          ))}
        </div>
      </nav>
    </>
  );
}
