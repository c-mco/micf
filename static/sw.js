// ============================================================
// MICF Insights — Service Worker
//
// Provides offline support and instant reload from cache.
// Strategies:
//   Static assets (CSS/JS): cache-first
//   HTML page & API:        stale-while-revalidate
//   Export endpoints:        network-only (not cached)
// ============================================================

// CACHE_VERSION is injected by the server at serve time (git commit hash).
var CACHE = 'micf-' + CACHE_VERSION;

var PRECACHE = [
  '/static/dist/bundle.js',
  '/static/dist/worker.bundle.js',
  '/static/dist/app.min.css',
];

// Install: precache static assets
self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE).then(function(cache) {
      return cache.addAll(PRECACHE);
    })
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE; })
            .map(function(k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

// Fetch: route to appropriate strategy
self.addEventListener('fetch', function(e) {
  var url = new URL(e.request.url);

  // Skip export endpoints — always go to network
  if (url.pathname.startsWith('/export/')) return;

  // Static assets: cache-first
  if (url.pathname.startsWith('/static/')) {
    e.respondWith(cacheFirst(e.request));
    return;
  }

  // Everything else (HTML page, API): stale-while-revalidate
  e.respondWith(staleWhileRevalidate(e.request));
});

// --- Strategies ---

function cacheFirst(request) {
  return caches.match(request).then(function(cached) {
    if (cached) return cached;
    return fetch(request).then(function(response) {
      if (response.ok) {
        var clone = response.clone();
        caches.open(CACHE).then(function(c) { c.put(request, clone); });
      }
      return response;
    });
  });
}

function staleWhileRevalidate(request) {
  return caches.open(CACHE).then(function(cache) {
    return cache.match(request).then(function(cached) {
      var fetchPromise = fetch(request).then(function(response) {
        if (response.ok) cache.put(request, response.clone());
        return response;
      }).catch(function() {
        return cached; // offline fallback
      });
      return cached || fetchPromise;
    });
  });
}
