/* ═══════════════════════════════════════════════════════════════
   PressingPro — Service Worker (P3.4)
   Strategy:
     • STATIC_CACHE  → cache-first  (shell: HTML, JS, icons, manifest)
     • RUNTIME_CACHE → stale-while-revalidate (fonts, images, misc assets)
     • API calls     → network-only  (no offline API caching)
     • Offline fallback → /offline.html when network fails on navigation
   ═══════════════════════════════════════════════════════════════ */
'use strict';

const CACHE_VERSION = 'pp-v1';
const STATIC_CACHE  = `static-${CACHE_VERSION}`;
const RUNTIME_CACHE = `runtime-${CACHE_VERSION}`;

// App shell — cached on install
const SHELL_URLS = [
  '/',
  '/app.js',
  '/manifest.json',
  '/offline.html'
];

/* ── INSTALL ── */
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(STATIC_CACHE)
      .then(c => c.addAll(SHELL_URLS))
      .then(() => self.skipWaiting())
  );
});

/* ── ACTIVATE — purge old caches ── */
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => k !== STATIC_CACHE && k !== RUNTIME_CACHE)
          .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* ── FETCH ── */
self.addEventListener('fetch', e => {
  const { request } = e;
  const url = new URL(request.url);

  // Skip non-GET and cross-origin
  if (request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  // API calls → network only (no cache)
  if (url.pathname.startsWith('/api/')) return;

  // Navigation requests → network first, offline fallback
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request)
        .catch(() => caches.match('/offline.html'))
    );
    return;
  }

  // Shell assets → cache first
  if (SHELL_URLS.includes(url.pathname)) {
    e.respondWith(
      caches.match(request)
        .then(cached => cached || fetch(request).then(resp => {
          const clone = resp.clone();
          caches.open(STATIC_CACHE).then(c => c.put(request, clone));
          return resp;
        }))
    );
    return;
  }

  // Other assets → stale-while-revalidate
  e.respondWith(
    caches.match(request).then(cached => {
      const fetchPromise = fetch(request).then(resp => {
        if (resp.ok) {
          const clone = resp.clone();
          caches.open(RUNTIME_CACHE).then(c => c.put(request, clone));
        }
        return resp;
      }).catch(() => cached);

      return cached || fetchPromise;
    })
  );
});

/* ── MESSAGE — force update ── */
self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});
