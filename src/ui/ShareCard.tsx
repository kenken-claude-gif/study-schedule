import { useState } from 'react';
import { useStore } from '../app/store.tsx';
import { buildShareLink } from '../app/share.ts';
import type { Exam, ISODate } from '../domain/types.ts';

/** 今の計画と進み具合を、家族に見せるためのリンクを作って送る */
export function ShareCard({ exam, today }: { exam: Exam; today: ISODate }) {
  const { state } = useStore();
  const [msg, setMsg] = useState('');
  // 共有メニューもコピーも使えない端末では、リンクをそのまま出して手でコピーしてもらう
  const [manualUrl, setManualUrl] = useState('');

  const share = async () => {
    setMsg('');
    setManualUrl('');
    const { url, cut } = await buildShareLink(state, exam, today, `${location.origin}${location.pathname}`);
    const cutNote = cut > 0 ? `リンクが長くなるので、先の${cut}日分は省いたよ。` : '';
    if (navigator.share) {
      try {
        await navigator.share({ title: 'テスト勉強の様子', text: `${exam.name}の計画と進み具合`, url });
        setMsg(cutNote);
        return;
      } catch (e) {
        // 共有メニューを閉じただけならエラーではない
        if (e instanceof DOMException && e.name === 'AbortError') return;
        console.warn('共有メニューを開けませんでした:', e);
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setMsg(`リンクをコピーしたよ。LINEなどに貼り付けて送ってね。${cutNote}`);
    } catch (e) {
      console.warn('コピーできませんでした:', e);
      setManualUrl(url);
      setMsg(`下のリンクをコピーして送ってね。${cutNote}`);
    }
  };

  return (
    <div className="card stack">
      <h2>家族に共有</h2>
      <p className="small muted" style={{ margin: 0 }}>
        今の計画と進み具合を見られるリンクを送れるよ。見るだけで、編集はできない。成績は入らない。
        送った時点の内容なので、最新を見せたいときは送り直してね。リンクを知っている人は誰でも見られるから、家族にだけ送ろう。
      </p>
      <button
        className="btn block"
        onClick={() => {
          share().catch((e: unknown) => {
            console.error('共有リンクを作れませんでした:', e);
            setMsg('共有リンクを作れなかった。もう一度試してみてね。');
          });
        }}
      >
        共有リンクを送る
      </button>
      {msg && <div className="small">{msg}</div>}
      {manualUrl && <textarea readOnly rows={4} value={manualUrl} onFocus={(e) => e.target.select()} />}
    </div>
  );
}
