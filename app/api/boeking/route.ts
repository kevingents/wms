import { NextRequest, NextResponse } from "next/server";
import { vereisSessie } from "@/lib/auth-server";
import { boekMutatie, recenteBoekingen } from "@/lib/voorraad";
import { BoekingsFout } from "@/lib/db";
import { REDEN_LABELS, type BoekingReden } from "@/lib/types";

export const runtime = "nodejs";

/**
 * POST /api/boeking — het enige schrijf-eindpunt voor voorraadmutaties.
 *
 * De client stuurt een `idempotencyKey` mee die hij zelf genereert en bij een
 * retry hergebruikt. Zonder die sleutel boekt een herhaalde verzending uit de
 * offline-outbox dubbel; mét de sleutel geeft de server gewoon de al verwerkte
 * boeking terug.
 */
export async function POST(req: NextRequest) {
  const sessie = await vereisSessie();
  if (!sessie.ok) return sessie.response;

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const reden = String(body.reden || "") as BoekingReden;
  if (!(reden in REDEN_LABELS)) {
    return NextResponse.json(
      { ok: false, message: `Onbekende reden: ${reden || "(leeg)"}` },
      { status: 400 }
    );
  }

  try {
    const boeking = await boekMutatie({
      sku: String(body.sku || ""),
      vanLocatieId: body.vanLocatieId ? Number(body.vanLocatieId) : null,
      naarLocatieId: body.naarLocatieId ? Number(body.naarLocatieId) : null,
      aantal: Number(body.aantal),
      reden,
      refType: (body.refType as string) || null,
      refId: (body.refId as string) || null,
      notitie: (body.notitie as string) || null,
      idempotencyKey: (body.idempotencyKey as string) || null,
      actorId: sessie.user.userId,
      actorNaam: sessie.user.name,
    });
    return NextResponse.json({ ok: true, boeking });
  } catch (err) {
    if (err instanceof BoekingsFout) {
      return NextResponse.json(
        { ok: false, message: err.message, code: err.code },
        { status: 400 }
      );
    }
    throw err;
  }
}

/** GET /api/boeking?limiet=50 — recente boekingen voor het overzicht. */
export async function GET(req: NextRequest) {
  const sessie = await vereisSessie();
  if (!sessie.ok) return sessie.response;

  const limiet = Math.min(Number(req.nextUrl.searchParams.get("limiet") ?? 50) || 50, 200);
  return NextResponse.json({ ok: true, boekingen: await recenteBoekingen(limiet) });
}
