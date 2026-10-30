/*
 * Iluminura: service worker de disponibilidade offline.
 * Estratégia: rede primeiro, cache como fallback.
 */
'use strict';

const CACHE = 'iluminura-v1.7.0';
const CORE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/style.css',
  './assets/app.js',
  './assets/markdown.js',
  './assets/caminhos.js',
  './assets/diff.js',
  './assets/exportar.js',
  './assets/logo.svg',
  './assets/icons/favicon.svg',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './exemplo.md'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(CORE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if (url.pathname.endsWith('/sw.js')) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then((cached) => {
        if (cached) return cached;
        if (request.mode === 'navigate') {
          return caches.match('./index.html').then((fallback) => fallback || new Response(
            'Iluminura indisponível offline. Abra a aplicação uma vez com o servidor ligado.',
            { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
          ));
        }
        return new Response('Recurso indisponível offline.', {
          status: 504,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      }))
  );
});
