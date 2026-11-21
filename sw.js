// Studydot offline worker: keeps a copy of the app on the device so it opens and
// works without internet. Each time you're online it quietly fetches the newest
// version for next time. Change VERSION when files are added or removed.
const VERSION = "studydot-v2";
const APP_FILES = [
  "./", "index.html", "style.css", "app.js", "sync.js", "sat.js", "emoji.js",
  "courses/spanish.js", "courses/french.js", "courses/latin.js", "courses/mandarin.js",
  "manifest.json", "icon.svg", "icon-192.png", "icon-512.png", "apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const sameSite = url.origin === location.origin;
  // Fonts and the account code from Google: keep a copy once loaded.
  const keepable = sameSite || ["fonts.googleapis.com", "fonts.gstatic.com", "www.gstatic.com"].includes(url.hostname);
  if (!keepable) return;

  // Show the saved copy right away (fast, works offline), and update it in the
  // background when online. Pages fall back to the saved app if offline.
  e.respondWith(caches.open(VERSION).then(async (cache) => {
    const saved = await cache.match(req, { ignoreSearch: sameSite });
    const fresh = fetch(req).then((res) => {
      if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone());
      return res;
    }).catch(() => null);
    if (saved) { e.waitUntil(fresh); return saved; }
    const res = await fresh;
    if (res) return res;
    if (req.mode === "navigate") return (await cache.match("index.html")) || Response.error();
    return Response.error();
  }));
});
