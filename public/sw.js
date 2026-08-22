/*
 * HiExplore Service Worker —— 只做两件事：让 App 能装到主屏、断网时还能打开。
 *
 * 刻意不做的事：
 * 1. **不缓存 API 请求**。待办和回填必须是实时的，缓存一份旧待办比没有更糟。
 * 2. **不做后台同步**。手机后台会被系统挂起，做了也不可靠，还容易在用户不知情时烧 FC 调用。
 *
 * 缓存策略：静态资源用 stale-while-revalidate（先给缓存、后台更新），
 * 导航请求走 network-first（保证发版后能拿到新页面），断网才回落到缓存的壳。
 */
const CACHE = 'hiexplore-v1';
const SHELL = ['/', '/index.html', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // 跨域（模型 API、同步后端、统计）一律不碰
  if (url.origin !== self.location.origin) return;
  // 同步接口绝不缓存
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return;

  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request)
        .then((r) => { caches.open(CACHE).then((c) => c.put('/index.html', r.clone())); return r; })
        .catch(() => caches.match('/index.html')),
    );
    return;
  }

  e.respondWith(
    caches.match(request).then((cached) => {
      const net = fetch(request)
        .then((r) => { if (r.ok) caches.open(CACHE).then((c) => c.put(request, r.clone())); return r; })
        .catch(() => cached);
      return cached || net;
    }),
  );
});
