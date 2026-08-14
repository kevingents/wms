import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

/**
 * Toegangspoort. Alles achter de login, behalve de loginpagina zelf, de
 * auth-endpoints en de cron. `jose` verifieert op de Edge-runtime, dus de
 * sessiecheck kost geen function-invocatie.
 */

const OPEN_PADEN = [/^\/login/, /^\/api\/auth\//, /^\/api\/cron\//];

export async function middleware(req: NextRequest) {
  const pad = req.nextUrl.pathname;
  if (OPEN_PADEN.some((p) => p.test(pad))) return NextResponse.next();

  const user = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (user) return NextResponse.next();

  /* API's krijgen een nette 401; pagina's een redirect met terugkeer-adres. */
  if (pad.startsWith("/api/")) {
    return NextResponse.json({ ok: false, message: "Niet ingelogd." }, { status: 401 });
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("verder", pad);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icons/).*)"],
};
