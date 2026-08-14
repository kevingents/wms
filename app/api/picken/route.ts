import { NextRequest, NextResponse } from "next/server";
import { vereisSessie, vereisBeheer } from "@/lib/auth-server";
import { werkvoorraad, importeerPickwerk, maakPickOpdracht } from "@/lib/picken";
import { BoekingsFout } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 60;

/** GET — de werkvoorraad: alles wat open staat of onderhanden is. */
export async function GET() {
  const sessie = await vereisSessie();
  if (!sessie.ok) return sessie.response;
  return NextResponse.json({ ok: true, opdrachten: await werkvoorraad() });
}

/**
 * POST — nieuw pickwerk.
 *   { actie: "import" }                 → haalt weborders en transfers binnen
 *   { regels: [{ sku, aantal }], … }    → handmatige opdracht
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

  if (body.actie === "import") {
    const resultaat = await importeerPickwerk(sessie.user.name);
    return NextResponse.json({ ok: true, ...resultaat });
  }

  /* Handmatig aanmaken is een teamleider-actie: het omzeilt de planning uit de
     core, dus niet iets voor elke picker. */
  const beheer = await vereisBeheer();
  if (!beheer.ok) return beheer.response;

  const regels = Array.isArray(body.regels)
    ? (body.regels as { sku?: unknown; aantal?: unknown }[])
        .map((r) => ({ sku: String(r.sku || "").trim(), aantal: Number(r.aantal) }))
        .filter((r) => r.sku && Number.isInteger(r.aantal) && r.aantal > 0)
    : [];

  if (regels.length === 0) {
    return NextResponse.json(
      { ok: false, message: "Geef minstens één regel met sku en aantal." },
      { status: 400 }
    );
  }

  try {
    const opdracht = await maakPickOpdracht({
      bron: "handmatig",
      bronRef: String(body.referentie || `handmatig-${Date.now()}`),
      bestemming: (body.bestemming as string) || null,
      prioriteit: Number(body.prioriteit ?? 0) || 0,
      note: (body.notitie as string) || null,
      door: sessie.user.name,
      regels,
    });
    if (!opdracht) {
      return NextResponse.json(
        { ok: false, message: "Er bestaat al een opdracht met deze referentie." },
        { status: 409 }
      );
    }
    return NextResponse.json({ ok: true, opdracht });
  } catch (err) {
    if (err instanceof BoekingsFout) {
      return NextResponse.json({ ok: false, message: err.message }, { status: 400 });
    }
    throw err;
  }
}
