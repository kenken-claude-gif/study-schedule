import { useRef, useState } from 'react';
import { isAppState, useStore } from '../app/store.tsx';
import { GUIDE } from '../domain/labels.ts';
import { todayISO } from '../domain/date.ts';

export function GuideView() {
  return (
    <>
      <header className="app-header">
        <h1>勉強のコツ</h1>
      </header>
      {GUIDE.map((g) => (
        <details key={g.title} className="card">
          <summary><b>{g.title}</b></summary>
          {g.body.map((p) => (
            <p key={p} className="small">{p}</p>
          ))}
        </details>
      ))}
      <SettingsCard />
      <BackupCard />
    </>
  );
}

function SettingsCard() {
  const { state, update } = useStore();
  const { settings } = state;
  return (
    <div className="card stack">
      <h2>設定</h2>
      <label className="field">
        <span>勉強できる時間のうち、計画で埋める割合：{Math.round(settings.loadFactor * 100)}%</span>
        <input
          type="range"
          min={50}
          max={100}
          step={5}
          value={Math.round(settings.loadFactor * 100)}
          onChange={(e) =>
            update((s) => ({ ...s, settings: { ...s.settings, loadFactor: Number(e.target.value) / 100 } }))
          }
        />
      </label>
      <p className="small muted" style={{ margin: 0 }}>
        100%にすると予備がなくなって、1日休んだだけで崩れやすくなる。80%くらいがおすすめ。
      </p>
      <label className="field">
        <span>1日にやる教科の数（最大）</span>
        <select
          value={settings.maxSubjectsPerDay}
          onChange={(e) =>
            update((s) => ({ ...s, settings: { ...s.settings, maxSubjectsPerDay: Number(e.target.value) } }))
          }
        >
          {[2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}教科</option>)}
        </select>
      </label>
    </div>
  );
}

function BackupCard() {
  const { state, replace } = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState('');

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `study-schedule-${todayISO()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setMsg('バックアップを保存したよ。');
  };

  const importJson = async (f: File) => {
    try {
      const data: unknown = JSON.parse(await f.text());
      if (!isAppState(data)) {
        setMsg('このファイルはバックアップの形式じゃないみたい。');
        return;
      }
      if (!confirm('今のデータをバックアップの内容で置き換える？')) return;
      replace(data);
      setMsg('バックアップから戻したよ。');
    } catch (e) {
      console.error('バックアップの読み込みに失敗:', e);
      setMsg('ファイルを読み込めなかった。');
    }
  };

  return (
    <div className="card stack">
      <h2>バックアップ</h2>
      <p className="small muted" style={{ margin: 0 }}>
        データはこのスマホの中だけに保存されていて、どこにも送信されない。機種変更やもしものために、ときどきバックアップを保存しておこう。
      </p>
      <div className="row">
        <button className="btn" style={{ flex: 1 }} onClick={exportJson}>保存する</button>
        <button className="btn" style={{ flex: 1 }} onClick={() => fileRef.current?.click()}>ファイルから戻す</button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void importJson(f);
          e.target.value = '';
        }}
      />
      {msg && <div className="small">{msg}</div>}
    </div>
  );
}
