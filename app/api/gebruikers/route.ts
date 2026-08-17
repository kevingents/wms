import { NextRequest, NextResponse } from "next/server";
import { vereisBeheer } from "@/lib/auth-server";
import {
  alleGebruikers,
  bootstrapActief,
  zetRol,
  zetActief,
  ROLLEN,
} from "@/lib/toegang";
import { legVast } from "@/lib/kpi";
import { BoekingsFout } from "@/lib/db";
import type { WmsRol } from "@/lib/session";

export const runtime = "nodejs";

/** GET — de gebruikerslijst. Alleen beheer: dit toont wie waarbij kan. */
export async function GET() {
  const sessie = await vereisBeheer();
  if (!sessie.ok) return sessie.response;

  const [gebruikers, bootstrap] = await Promise.all([
    alleGebruikers(),
    bootstrapActief(),
  ]);

  return NextResponse.json({
    ok: true,
    gebruikers,
    bootstrap,
    rollen: ROLLEN,
    ikZelf: sessie.user.userId,
  });
}

/**
 * POST — { actie: "rol" | "deactiveer" | "activeer", personnelId, rol }
 *
 * Elke wijziging gaat het audit-log in met de oude én de nieuwe waarde. Bij
 * toegangsrechten is "sinds wanneer mocht hij dat?" precies de vraag die je op
 * het verkeerde moment krijgt.
 */
export async function POST(req: NextRequest) {
  const sessie = await vereisBeheer();
  if (!sessie.ok) return sessie.response;

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const personnelId = String(body.personnelId || "").trim();
  if (!personnelId) {
    return NextResponse.json(
      { ok: false, message: "Geen personeelsnummer opgegeven." },
      { status: 400 }
    );
  }

  const bestaand = (await alleGebruikers()).find((g) => g.personnel_id === personnelId);

  try {
    if (body.actie === "rol") {
      const rol = String(body.rol) as WmsRol;
      const gebruiker = await zetRol(personnelId, rol, sessie.user.name);
      await legVast({
        actorId: sessie.user.userId,
        actorNaam: sessie.user.name,
        actie: "rol gewijzigd",
        objectType: "gebruiker",
        objectId: personnelId,
        oud: bestaand ? { rol: bestaand.rol } : null,
        nieuw: { rol },
      });
      return NextResponse.json({ ok: true, gebruiker });
    }

    if (body.actie === "deactiveer" || body.actie === "activeer") {
      const actief = body.actie === "activeer";
      const gebruiker = await zetActief(personnelId, actief, sessie.user.name);
      await legVast({
        actorId: sessie.user.userId,
        actorNaam: sessie.user.name,
        actie: actief ? "gebruiker geactiveerd" : "gebruiker gedeactiveerd",
        objectType: "gebruiker",
        objectId: personnelId,
        oud: bestaand ? { actief: bestaand.actief } : null,
        nieuw: { actief },
      });
      return NextResponse.json({ ok: true, gebruiker });
    }
  } catch (err) {
    if (err instanceof BoekingsFout) {
      return NextResponse.json(
        { ok: false, message: err.message, code: err.code },
        { status: 400 }
      );
    }
    throw err;
  }

  return NextResponse.json({ ok: false, message: "Onbekende actie." }, { status: 400 });
}
