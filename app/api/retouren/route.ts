import { NextRequest, NextResponse } from "next/server";
import { vereisSessie, vereisBeheer } from "@/lib/auth-server";
import {
  openRetouren,
  opentRetour,
  beoordeel,
  retour,
  retourRegels,
  schrijfAf,
  type Oordeel,
} from "@/lib/retouren";
import { BoekingsFout } from "@/lib/db";

export const runtime = "nodejs";

/** GET — openstaande retouren, of één met ?id=. */
export async function GET(req: NextRequest) {
  const sessie = await vereisSessie();
  if (!sessie.ok) return sessie.response;

  const id = req.nextUrl.searchParams.get("id");
  if (id) {
    const gevonden = await retour(Number(id));
    if (!gevonden) {
      return NextResponse.json({ ok: false, message: "Niet gevonden." }, { status: 404 });
    }
    return NextResponse.json({
      ok: true,
      retour: gevonden,
      regels: await retourRegels(gevonden.id),
    });
  }
  return NextResponse.json({ ok: true, retouren: await openRetouren() });
}

/**
 * POST — de retourbalie:
 *   { actie: "nieuw", regels }                 → retour aannemen en inboeken
 *   { actie: "beoordeel", regelId, oordeel }   → verkoopbaar / herstel / afkeur
 *   { actie: "afschrijven", sku, aantal }      → afgekeurde voorraad wegboeken
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

  try {
    switch (body.actie) {
      case "nieuw": {
        const regels = Array.isArray(body.regels)
          ? (body.regels as { sku?: unknown; aantal?: unknown }[]).map((r) => ({
              sku: String(r.sku || "").trim(),
              aantal: Math.floor(Number(r.aantal ?? 1)),
            }))
          : [];
        return NextResponse.json({
          ok: true,
          retour: await opentRetour({
            bron: (body.bron as string) || "webshop",
            bronRef: (body.bronRef as string) || null,
            klant: (body.klant as string) || null,
            note: (body.notitie as string) || null,
            actorId: sessie.user.userId,
            actorNaam: sessie.user.name,
            regels,
          }),
        });
      }

      case "beoordeel":
        return NextResponse.json({
          ok: true,
          regel: await beoordeel({
            regelId: Number(body.regelId),
            oordeel: String(body.oordeel) as Oordeel,
            locatieCode: (body.locatieCode as string) || null,
            reden: (body.reden as string) || null,
            actorId: sessie.user.userId,
            actorNaam: sessie.user.name,
          }),
        });

      case "afschrijven": {
        /* Geld weggooien is een teamleider-actie. */
        const beheer = await vereisBeheer();
        if (!beheer.ok) return beheer.response;
        await schrijfAf({
          sku: String(body.sku || ""),
          aantal: Number(body.aantal),
          reden: String(body.reden || "Afgekeurd"),
          actorId: sessie.user.userId,
          actorNaam: sessie.user.name,
        });
        return NextResponse.json({ ok: true });
      }
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
