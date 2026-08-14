"use client";

/**
 * Offline-outbox voor boekingen.
 *
 * Magazijn-wifi is zelden overal even goed — achter een stelling of bij de kade
 * valt hij weg. Zonder buffer verliest de medewerker dan scans, of erger: hij
 * scant opnieuw en boekt dubbel. Daarom gaat élke boeking eerst de outbox in
 * (IndexedDB, overleeft een herstart) en wordt hij daarna verzonden. De
 * `idempotencyKey` wordt lokaal gegenereerd, zodat een retry na een onduidelijk
 * afgebroken request nooit dubbel boekt.
 *
 * Bewust geen library: dit is 100 regels en moet exact doen wat het doet.
 */

const DB_NAAM = "gents-wms";
const STORE = "outbox";
const DB_VERSIE = 1;

export interface OutboxItem {
  id: string;
  pad: string;
  body: unknown;
  pogingen: number;
  aangemaakt: number;
  laatsteFout?: string;
}

let _db: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (_db) return _db;
  _db = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAAM, DB_VERSIE);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(STORE)) {
        d.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _db;
}

async function transactie<T>(
  modus: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, modus);
    const req = fn(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function nieuweSleutel(): string {
  return crypto.randomUUID();
}

export async function inWachtrij(item: Omit<OutboxItem, "pogingen" | "aangemaakt">) {
  await transactie("readwrite", (s) =>
    s.put({ ...item, pogingen: 0, aangemaakt: Date.now() })
  );
  meldWijziging();
}

export async function wachtrij(): Promise<OutboxItem[]> {
  const alles = await transactie<OutboxItem[]>("readonly", (s) => s.getAll());
  return alles.sort((a, b) => a.aangemaakt - b.aangemaakt);
}

async function verwijder(id: string) {
  await transactie("readwrite", (s) => s.delete(id));
}

async function bewaar(item: OutboxItem) {
  await transactie("readwrite", (s) => s.put(item));
}

/* ── Verzenden ─────────────────────────────────────────────────────────────── */

let bezig = false;

/**
 * Werkt de wachtrij af, oudste eerst. Stopt bij het eerste netwerkprobleem —
 * volgorde is belangrijk, want een verplaatsing kan afhangen van de ontvangst
 * ervóór. Een inhoudelijke afwijzing (4xx) is definitief: die blijft staan met
 * de foutmelding erbij, zodat een teamleider 'm kan bekijken.
 */
export async function verzendWachtrij(): Promise<{ verzonden: number; over: number }> {
  if (bezig) return { verzonden: 0, over: (await wachtrij()).length };
  bezig = true;
  let verzonden = 0;

  try {
    for (const item of await wachtrij()) {
      if (item.pogingen >= 5 && item.laatsteFout) continue;

      let res: Response;
      try {
        res = await fetch(item.pad, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(item.body),
        });
      } catch {
        /* Netwerk weg — later opnieuw, volgorde bewaren. */
        break;
      }

      if (res.ok) {
        await verwijder(item.id);
        verzonden += 1;
        continue;
      }

      if (res.status >= 500) break;

      /* 4xx: de server weigert dit inhoudelijk. Nog eens sturen helpt niet. */
      let melding = `Geweigerd (${res.status})`;
      try {
        const data = (await res.json()) as { message?: string };
        if (data?.message) melding = data.message;
      } catch {
        /* geen json-body */
      }
      await bewaar({ ...item, pogingen: item.pogingen + 1, laatsteFout: melding });
    }
  } finally {
    bezig = false;
    meldWijziging();
  }

  return { verzonden, over: (await wachtrij()).length };
}

export async function verwijderUitWachtrij(id: string) {
  await verwijder(id);
  meldWijziging();
}

/* ── Meldingen naar de UI ──────────────────────────────────────────────────── */

const WIJZIGING = "wms-outbox-wijziging";

function meldWijziging() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(WIJZIGING));
}

export function opOutboxWijziging(fn: () => void): () => void {
  window.addEventListener(WIJZIGING, fn);
  window.addEventListener("online", fn);
  return () => {
    window.removeEventListener(WIJZIGING, fn);
    window.removeEventListener("online", fn);
  };
}

/** Start het automatisch legen: bij online komen en elke 15 seconden. */
export function startOutboxLus(): () => void {
  const probeer = () => {
    if (navigator.onLine) void verzendWachtrij();
  };
  probeer();
  const timer = window.setInterval(probeer, 15_000);
  window.addEventListener("online", probeer);
  return () => {
    window.clearInterval(timer);
    window.removeEventListener("online", probeer);
  };
}
