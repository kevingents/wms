import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

/**
 * Toegangspoort. Alles achter de login, behalve de loginpagina zelf, de
 * auth-endpoints en de cron. `jose` verifieert op de Edge-runtime, dus de
 * sessiecheck kost geen function-invocatie.
 */

/* `/api/koppeling/*` heeft géén gebruikerssessie maar een gedeeld geheim: dat
   is server-naar-server verkeer vanuit de portal. De route bewaakt zichzelf. */
const OPEN_PADEN = [
  /^\/login/,
  /^\/api\/auth\//,
  /^\/api\/cron\//,
  /^\/api\/koppeling\//,
];

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

/* Buiten de poort: build-assets, en alles wat de PWA nodig heeft vóórdat er een
   sessie is. Een service worker of manifest achter een redirect naar /login
   maakt de app onistalleerbaar. */
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icon|apple-icon|sw\\.js|offline\\.html).*)",
  ],
};
