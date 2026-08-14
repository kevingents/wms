import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession, magBeheren, type WmsSession } from "./session";

/**
 * Server-side sessiehelpers voor route handlers en RSC.
 * `vereisSessie()` geeft óf een gebruiker, óf een kant-en-klare 401-response —
 * zodat elke route dezelfde afhandeling heeft zonder copy-paste.
 */

export async function huidigeGebruiker(): Promise<WmsSession | null> {
  const jar = await cookies();
  return verifySession(jar.get(SESSION_COOKIE)?.value);
}

export type SessieResultaat =
  | { ok: true; user: WmsSession }
  | { ok: false; response: NextResponse };

export async function vereisSessie(): Promise<SessieResultaat> {
  const user = await huidigeGebruiker();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, message: "Niet ingelogd." },
        { status: 401 }
      ),
    };
  }
  return { ok: true, user };
}

export async function vereisBeheer(): Promise<SessieResultaat> {
  const res = await vereisSessie();
  if (!res.ok) return res;
  if (!magBeheren(res.user)) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, message: "Je hebt geen rechten voor deze actie." },
        { status: 403 }
      ),
    };
  }
  return res;
}
