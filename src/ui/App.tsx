import { useState } from 'react';
import { TodayView } from './TodayView.tsx';
import { PlanView } from './PlanView.tsx';
import { ExamView } from './ExamView.tsx';
import { ScheduleView } from './ScheduleView.tsx';
import { GuideView } from './GuideView.tsx';
import { ScoresView } from './ScoresView.tsx';

export type TabKey = 'today' | 'plan' | 'exam' | 'schedule' | 'scores' | 'guide';

const TABS: { key: TabKey; label: string; ico: string }[] = [
  { key: 'today', label: '今日', ico: '✅' },
  { key: 'plan', label: '計画', ico: '🗓️' },
  { key: 'exam', label: '範囲', ico: '📚' },
  { key: 'schedule', label: '予定', ico: '🏀' },
  { key: 'scores', label: '成績', ico: '📈' },
  { key: 'guide', label: 'コツ', ico: '💡' },
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
        {tab === 'scores' && <ScoresView />}
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
