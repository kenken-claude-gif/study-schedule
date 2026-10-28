// オフラインでも開けるようにするための Service Worker。
// ビルドごとにファイル名が変わるので、事前キャッシュではなく「使ったものを順にキャッシュ」する。
// 画面（HTML）はネット優先（更新をすぐ反映）、それ以外はキャッシュ優先＋裏で更新。
// 名前を変えると、切り替わったときに古いキャッシュが丸ごと消える（v1 の頃にたまった古い版を片付けるため v2 に）
const CACHE = 'study-schedule-v2';

self.addEventListener('install', () => self.skipWaiting());

// ビルドのたびにファイル名の後ろのハッシュ（例: index-AbC12_xY.js）が変わる。
// 新しい版を保存したら、同じ名前の古い版を消して、端末にたまらないようにする
const HASHED = /-[A-Za-z0-9_-]{8}\.(js|css)$/;
function stemOf(pathname) {
  return pathname.replace(HASHED, '.$1');
}
function dropOldBuilds(cache, url) {
  const path = new URL(url).pathname;
  if (!HASHED.test(path)) return Promise.resolve();
  const stem = stemOf(path);
  return cache.keys().then((keys) =>
    Promise.all(
      keys
        .map((k) => new URL(k.url).pathname)
        .filter((p) => p !== path && HASHED.test(p) && stemOf(p) === stem)
        .map((p) => cache.delete(p)),
    ),
  );
}

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('./'))),
    );
    return;
  }

  // 裏で最新版を取りにいき、保存と古い版の削除が終わるまで Service Worker を止めない
  const update = fetch(req).then((res) => {
    if (!res.ok) return res;
    const copy = res.clone();
    return caches
      .open(CACHE)
      .then((c) => c.put(req, copy).then(() => dropOldBuilds(c, req.url)))
      .then(() => res);
  });
  event.waitUntil(update.catch(() => undefined));
  event.respondWith(caches.match(req).then((cached) => cached || update));
});
