import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App.tsx';
import { StoreProvider } from './app/store.tsx';
import { ErrorBoundary } from './ui/ErrorBoundary.tsx';
import { ShareView } from './ui/ShareView.tsx';
import { SHARE_PREFIX } from './app/share.ts';
import './ui/styles.css';

// 共有リンクで開かれたら、見るだけの画面を出す（保存データには触らないので StoreProvider を通さない）
const isShareLink = location.hash.startsWith(SHARE_PREFIX);
window.addEventListener('hashchange', () => {
  if (isShareLink || location.hash.startsWith(SHARE_PREFIX)) location.reload();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      {isShareLink ? (
        <ShareView />
      ) : (
        <StoreProvider>
          <App />
        </StoreProvider>
      )}
    </ErrorBoundary>
  </StrictMode>,
);

// オフラインでも開けるように Service Worker を登録（開発サーバーでは使わない）
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js')
      .catch((e: unknown) => console.error('Service Worker の登録に失敗:', e));
  });
}
