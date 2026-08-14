/**
 * Service worker voor de handterminal.
 *
 * Bewust minimaal. Wat hij WEL doet: de statische assets cachen zodat de app
 * direct opent, ook op een trage of wegvallende magazijn-wifi, en een nette
 * offline-pagina tonen als er echt niets is.
 *
 * Wat hij bewust NIET doet: pagina's of API-antwoorden cachen. Alle schermen
 * zijn dynamisch en zitten achter een sessie; een gecachete voorraadstand die er
 * betrouwbaar uitziet maar drie uur oud is, is in een magazijn gevaarlijker dan
 * een foutmelding. Offline schrijven gaat via de outbox in IndexedDB, niet via
 * deze cache.
 */

const CACHE = "wms-shell-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll([OFFLINE_URL])).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((namen) => Promise.all(namen.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  /* Statische build-assets zijn onveranderlijk (hashed filenames) — cache-first. */
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            const kopie = res.clone();
            caches.open(CACHE).then((c) => c.put(req, kopie));
            return res;
          })
      )
    );
    return;
  }

  /* Paginanavigatie: altijd het netwerk proberen. Lukt dat niet, dan een
     eerlijke offline-pagina in plaats van verouderde data. */
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE_URL)));
  }
});
