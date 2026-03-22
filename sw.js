// CodeLab Service Worker v2.0
// Estrategia: Cache First para assets, Network First para APIs externas

const CACHE_NAME = 'codelab-v2.0';
const RUNTIME_CACHE = 'codelab-runtime-v2.0';

// Assets a cachear en instalación (shell de la app)
const PRECACHE_ASSETS = [
  '/qr_barcode_app/index.html',
  '/qr_barcode_app/manifest.json',
  '/qr_barcode_app/icons/icon-192x192.png',
  '/qr_barcode_app/icons/icon-512x512.png',
  '/qr_barcode_app/icons/apple-touch-icon.png',
];

// CDN libs a cachear dinámicamente en primer uso
const CDN_PATTERNS = [
  'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
];

// =====================
// INSTALL — precachear shell
// =====================
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW] Precaching app shell...');
      return cache.addAll(PRECACHE_ASSETS);
    }).then(() => {
      console.log('[SW] App shell cached. Skipping waiting.');
      return self.skipWaiting();
    }).catch(err => {
      console.warn('[SW] Precache failed (esperado en file://):', err);
      return self.skipWaiting();
    })
  );
});

// =====================
// ACTIVATE — limpiar caches viejos
// =====================
self.addEventListener('activate', event => {
  const validCaches = [CACHE_NAME, RUNTIME_CACHE];
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => !validCaches.includes(key))
          .map(key => {
            console.log('[SW] Eliminando cache antiguo:', key);
            return caches.delete(key);
          })
      )
    ).then(() => {
      console.log('[SW] Activado. Tomando control de todos los clientes.');
      return self.clients.claim();
    })
  );
});

// =====================
// FETCH — estrategia inteligente por tipo de recurso
// =====================
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Ignorar chrome-extension y requests no-HTTP
  if (!event.request.url.startsWith('http')) return;

  // Ignorar requests de cámara/API del navegador
  if (event.request.url.includes('getUserMedia')) return;

  // CDN libs → Cache First (si falla, red; si también falla, seguir sin él)
  if (CDN_PATTERNS.some(p => url.hostname.includes(p))) {
    event.respondWith(cacheFirstThenNetwork(event.request));
    return;
  }

  // App shell (HTML, manifest, iconos) → Network First con fallback a cache
  if (
    url.pathname.endsWith('.html') ||
    url.pathname.endsWith('.json') ||
    url.pathname.includes('/icons/')
  ) {
    event.respondWith(networkFirstThenCache(event.request));
    return;
  }

  // Todo lo demás → Stale While Revalidate
  event.respondWith(staleWhileRevalidate(event.request));
});

// =====================
// ESTRATEGIAS DE CACHÉ
// =====================

// Cache First → para CDN libs (cambian raramente)
async function cacheFirstThenNetwork(request) {
  const cached = await caches.match(request);
  if (cached) {
    console.log('[SW] Cache hit:', request.url);
    return cached;
  }
  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, response.clone());
      console.log('[SW] Cacheado desde red:', request.url);
    }
    return response;
  } catch (err) {
    console.warn('[SW] Sin red y sin cache para:', request.url);
    return new Response('', { status: 503 });
  }
}

// Network First → para HTML (siempre intentar la versión más nueva)
async function networkFirstThenCache(request) {
  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    // Fallback al index si el recurso no existe offline
    return caches.match('/qr_barcode_app/index.html');
  }
}

// Stale While Revalidate → devuelve cache inmediatamente, actualiza en segundo plano
async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request).then(response => {
    if (response && response.status === 200) {
      cache.put(request, response.clone());
    }
    return response;
  }).catch(() => null);

  return cached || await fetchPromise || new Response('', { status: 503 });
}

// =====================
// SYNC / MENSAJES
// =====================
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'GET_VERSION') {
    event.ports[0].postMessage({ version: CACHE_NAME });
  }
});

// Notificar a clientes cuando hay actualización disponible
self.addEventListener('message', event => {
  if (event.data === 'CHECK_UPDATE') {
    self.clients.matchAll().then(clients => {
      clients.forEach(client => client.postMessage({ type: 'SW_UPDATED', version: CACHE_NAME }));
    });
  }
});

console.log('[SW] CodeLab Service Worker', CACHE_NAME, 'cargado.');
