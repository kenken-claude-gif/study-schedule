import { Component, type ErrorInfo, type ReactNode } from 'react';
import { rawSavedData } from '../app/store.tsx';
import { todayISO } from '../domain/date.ts';

interface State {
  error: Error | null;
}

/**
 * 画面の描画中に想定外のエラーが起きたときの受け皿。
 * 真っ白な画面のままにせず、データをファイルに保存して救い出せるようにする
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('画面の表示中にエラー:', error, info.componentStack);
  }

  private download = (): void => {
    const raw = rawSavedData();
    if (!raw) return;
    const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `study-schedule-${todayISO()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <main className="app">
        <div className="card stack">
          <h2>うまく表示できなかった</h2>
          <p className="small">
            ごめんね、アプリの中でエラーが起きたみたい。入れたデータは消えていないよ。
            念のため、まず下のボタンでデータをファイルに保存してから、再読み込みしてみてね。
          </p>
          <button className="btn primary" onClick={this.download}>データをファイルに保存</button>
          <button className="btn" onClick={() => location.reload()}>再読み込み</button>
          <p className="small muted" style={{ margin: 0 }}>
            直らないときは、保存したファイルとこの文を家族に見せてね：{error.message}
          </p>
        </div>
      </main>
    );
  }
}
