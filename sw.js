// Minimal service worker: lets the site install as an app and shows the page shell offline.
// Only same-origin page loads are cached; API / Firebase / Supabase / PayPal calls always go to the network.
const CACHE = "amitesh-tech-v1";
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.add("/")).catch(() => {})); self.skipWaiting(); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== CACHE).map(x => caches.delete(x)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== "GET" || u.origin !== location.origin) return;
  if (r.mode === "navigate") {
    e.respondWith(fetch(r).then(res => { caches.open(CACHE).then(c => c.put("/", res.clone())); return res; }).catch(() => caches.match("/")));
  }
});
