import { NextRequest, NextResponse } from "next/server";
import { backendJson, backendBase } from "@/lib/backend";
import { signSession, SESSION_COOKIE } from "@/lib/session";
import { rolVoor, registreerLogin } from "@/lib/toegang";

export const runtime = "nodejs";

/**
 * Inloggen met SRS-personeelsnummer + pincode, via de bestaande
 * storegents-backend. Er komt géén tweede accountadministratie bij: wie in de
 * portal kan, kan hier ook — de rol bepaalt wat je mag.
 */

interface BackendLogin {
  success?: boolean;
  message?: string;
  sessionToken?: string;
  employee?: Record<string, unknown>;
}

/** Toon nooit rauwe SOAP/HTML/XML backend-fouten aan de gebruiker. */
function nettteFout(raw: unknown, terugval: string): string {
  const s = String(raw ?? "").trim();
  if (!s) return terugval;
  if (/<\?xml|<!doctype|<html|soap-env|<\/?[a-z][^>]*>/i.test(s)) return terugval;
  return s.length > 180 ? terugval : s;
}

export async function POST(req: NextRequest) {
  if (!backendBase()) {
    return NextResponse.json(
      { ok: false, message: "BACKEND_API_BASE ontbreekt — inloggen is niet geconfigureerd." },
      { status: 503 }
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const personnelId = String(body.personnelId || "").trim();
  const pincode = String(body.pincode || "").trim();
  if (!personnelId || !pincode) {
    return NextResponse.json(
      { ok: false, message: "Vul je personeelsnummer en pincode in." },
      { status: 400 }
    );
  }

  const { ok, status, data } = await backendJson<BackendLogin>("api/srs/personnel/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ personnelId, posLoginCode: pincode }),
  });

  if (!ok || !data?.success || !data.sessionToken) {
    return NextResponse.json(
      { ok: false, message: nettteFout(data?.message, "Inloggen mislukt — controleer je gegevens.") },
      { status: status || 401 }
    );
  }

  const emp = (data.employee || {}) as Record<string, unknown>;
  const userId = String(emp.personnelId || personnelId);
  const naam =
    String(emp.name || emp.externalName || emp.internalName || "").trim() || "Medewerker";

  /* Vastleggen dat deze medewerker binnenkwam, vóór het bepalen van de rol: zo
     verschijnt hij vanzelf in het gebruikersscherm en hoeft een beheerder geen
     personeelsnummers over te typen. Dat is precies de stap waar zulke schermen
     normaal op stuklopen. Mislukt het, dan is inloggen belangrijker. */
  try {
    await registreerLogin(userId, naam);
  } catch {
    /* De sessie mag hier niet op vastlopen. */
  }

  const sessie = {
    userId,
    name: naam,
    rol: await rolVoor(userId),
    token: data.sessionToken,
  };

  const res = NextResponse.json({ ok: true, user: { name: naam, rol: sessie.rol } });
  res.cookies.set(SESSION_COOKIE, await signSession(sessie), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    /* Gedeelde scanner: sessiecookie, dus na afsluiten opnieuw inloggen. De
       JWT verloopt sowieso na 12 uur, gelijk aan de SRS-token. */
  });
  return res;
}
