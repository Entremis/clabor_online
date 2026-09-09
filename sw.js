'use strict';
const CACHE = 'clabor-shell-__CACHE_VERSION__';
const FILES = ['index.html','game_page.html','history.html','players.html','statistics.html',
    'setup.js','game_logic.js','game_engine.js','game_store.js','database.js','player_library.js',
    'confirmation.js','history.js','players.js','statistics.js','app_shell.js','styles.css',
    'manifest.webmanifest','icons/icon.svg','icons/icon-192.png','icons/icon-512.png',
    'icons/apple-touch-icon.png','vendor/dexie.min.js','vendor/DEXIE-LICENSE'];
const base = new URL('./', self.location.href);
const urls = new Set(FILES.map(file => new URL(file,base).href));
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll([...urls]))));
self.addEventListener('activate', event => event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('clabor-shell-') && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
})()));
self.addEventListener('message', event => { if (event.data?.type === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;
    const url = new URL(event.request.url);
    if (url.origin !== base.origin) return;
    url.search = ''; url.hash = '';
    if (url.href === base.href) url.pathname += 'index.html';
    if (!urls.has(url.href)) return;
    event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(url.href)) || fetch(event.request)));
});
