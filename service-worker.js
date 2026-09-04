const CACHE_NAME = 'finance-glance-v2'; // 배포할 때마다 이 숫자를 올리면 옛날 캐시가 자동으로 정리됩니다.
const CORE_ASSETS = [
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // 페이지 자체(HTML)는 항상 네트워크에서 최신 버전을 먼저 받아옵니다.
  // 예전 방식(캐시 우선)은 배포를 새로 해도 사용자에게 계속 옛날 페이지가
  // 보이는 문제가 있었습니다. 오프라인일 때만 캐시로 대체합니다.
  const isHtmlRequest = req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');
  if (isHtmlRequest) {
    event.respondWith(
      fetch(req).catch(() => caches.match(req))
    );
    return;
  }

  // 아이콘/매니페스트 같은 정적 자산은 캐시 우선(오프라인에서도 잘 뜨도록).
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req))
  );
});
