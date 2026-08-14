/**
 * Client naar de bestaande storegents-backend. Server-only — de ADMIN_TOKEN mag
 * de browser nooit zien.
 *
 * Het WMS gebruikt de backend voor precies twee dingen, en dat blijft zo:
 *   1. inloggen met SRS-personeelsnummer + pincode (geen tweede accountbeheer);
 *   2. de SRS-magazijnvoorraad ophalen voor de shadow-vergelijking.
 * Al het overige is eigen data in Neon.
 */

export function backendBase(): string {
  return (process.env.BACKEND_API_BASE || "").replace(/\/+$/, "");
}

export interface BackendResultaat<T> {
  ok: boolean;
  status: number;
  data: T | null;
}

export async function backendJson<T>(
  pad: string,
  init: RequestInit = {},
  metAdminToken = false
): Promise<BackendResultaat<T>> {
  const base = backendBase();
  if (!base) return { ok: false, status: 0, data: null };

  const headers = new Headers(init.headers);
  if (metAdminToken && process.env.ADMIN_TOKEN) {
    headers.set("x-admin-token", process.env.ADMIN_TOKEN);
  }

  try {
    const res = await fetch(`${base}/${pad.replace(/^\/+/, "")}`, {
      ...init,
      headers,
      cache: "no-store",
    });
    let data: T | null = null;
    try {
      data = (await res.json()) as T;
    } catch {
      data = null;
    }
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}
