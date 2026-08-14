import { NextRequest, NextResponse } from "next/server";
import { vereisSessie } from "@/lib/auth-server";
import {
  openOntvangsten,
  maakOntvangst,
  boekOntvangstRegel,
  slaOntvangstRegelOver,
  startOntvangst,
  voegOnverwachteRegelToe,
} from "@/lib/ontvangst";
import { BoekingsFout } from "@/lib/db";

export const runtime = "nodejs";

/** GET — openstaande ontvangsten. */
export async function GET() {
  const sessie = await vereisSessie();
  if (!sessie.ok) return sessie.response;
  return NextResponse.json({ ok: true, ontvangsten: await openOntvangsten() });
}

/**
 * POST — meerdere acties op één eindpunt, want ze horen bij hetzelfde scherm:
 *   { actie: "nieuw", regels }            → levering aanmelden
 *   { actie: "start", id }                → beginnen met uitpakken
 *   { actie: "boek", regelId, ontvangen } → regel inboeken
 *   { actie: "extra", id, sku }           → onverwacht artikel toevoegen
 *   { actie: "overslaan", regelId }       → regel niet ontvangen
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
          ? (body.regels as { sku?: unknown; verwacht?: unknown }[]).map((r) => ({
              sku: String(r.sku || "").trim(),
              verwacht: Math.floor(Number(r.verwacht ?? 0)),
            }))
          : [];
        const gemaakt = await maakOntvangst({
          bron: (body.bron as string) || "handmatig",
          bronRef: (body.bronRef as string) || null,
          leverancier: (body.leverancier as string) || null,
          referentie: (body.referentie as string) || null,
          verwachtOp: (body.verwachtOp as string) || null,
          note: (body.notitie as string) || null,
          door: sessie.user.name,
          regels,
        });
        if (!gemaakt) {
          return NextResponse.json(
            { ok: false, message: "Deze levering is al aangemeld." },
            { status: 409 }
          );
        }
        return NextResponse.json({ ok: true, ontvangst: gemaakt });
      }

      case "start":
        return NextResponse.json({
          ok: true,
          ontvangst: await startOntvangst(Number(body.id), sessie.user.name),
        });

      case "boek":
        return NextResponse.json({
          ok: true,
          regel: await boekOntvangstRegel({
            regelId: Number(body.regelId),
            ontvangen: Number(body.ontvangen),
            afgekeurd: Number(body.afgekeurd ?? 0),
            locatieCode: (body.locatieCode as string) || null,
            redenAfkeur: (body.redenAfkeur as string) || null,
            actorId: sessie.user.userId,
            actorNaam: sessie.user.name,
            idempotencyKey: (body.idempotencyKey as string) || null,
          }),
        });

      case "extra":
        return NextResponse.json({
          ok: true,
          regel: await voegOnverwachteRegelToe(
            Number(body.id),
            String(body.sku || "")
          ),
        });

      case "overslaan":
        await slaOntvangstRegelOver(
          Number(body.regelId),
          String(body.reden || "Niet geleverd")
        );
        return NextResponse.json({ ok: true });
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
