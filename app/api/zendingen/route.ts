import { NextRequest, NextResponse } from "next/server";
import { vereisSessie } from "@/lib/auth-server";
import {
  openZendingen,
  maakZendingVoorOpdracht,
  controleerRegel,
  pakIn,
  verzend,
  zending,
  zendingRegels,
} from "@/lib/inpakken";
import { magBeheren } from "@/lib/session";
import { BoekingsFout } from "@/lib/db";

export const runtime = "nodejs";

/** GET — openstaande zendingen, of één met ?id=. */
export async function GET(req: NextRequest) {
  const sessie = await vereisSessie();
  if (!sessie.ok) return sessie.response;

  const id = req.nextUrl.searchParams.get("id");
  if (id) {
    const gevonden = await zending(Number(id));
    if (!gevonden) {
      return NextResponse.json({ ok: false, message: "Niet gevonden." }, { status: 404 });
    }
    return NextResponse.json({
      ok: true,
      zending: gevonden,
      regels: await zendingRegels(gevonden.id),
    });
  }
  return NextResponse.json({ ok: true, zendingen: await openZendingen() });
}

/**
 * POST — de paktafel:
 *   { actie: "nieuw", pickOrderId }        → inpakopdracht uit een pickopdracht
 *   { actie: "controleer", id, code }      → artikel afvinken door te scannen
 *   { actie: "inpakken", id, doosType, … } → doos dicht
 *   { actie: "verzenden", id, tracking }   → het pand uit boeken
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
      case "nieuw":
        return NextResponse.json({
          ok: true,
          zending: await maakZendingVoorOpdracht({
            pickOrderId: Number(body.pickOrderId),
            door: sessie.user.name,
          }),
        });

      case "controleer": {
        const resultaat = await controleerRegel({
          zendingId: Number(body.id),
          code: String(body.code || ""),
        });
        return NextResponse.json({
          ok: !resultaat.message,
          message: resultaat.message,
          regel: resultaat.regel,
          zending: await zending(Number(body.id)),
        });
      }

      case "inpakken":
        return NextResponse.json({
          ok: true,
          zending: await pakIn({
            zendingId: Number(body.id),
            doosType: (body.doosType as string) || null,
            gewichtGram: body.gewichtGram ? Number(body.gewichtGram) : null,
            vervoerder: (body.vervoerder as string) || null,
            actorId: sessie.user.userId,
            actorNaam: sessie.user.name,
            /* Controle overslaan mag alleen een teamleider — anders is de
               verplichting geen verplichting. */
            forceerZonderControle:
              body.forceer === true && magBeheren(sessie.user),
          }),
        });

      case "verzenden":
        return NextResponse.json({
          ok: true,
          zending: await verzend({
            zendingId: Number(body.id),
            tracking: (body.tracking as string) || null,
            actorId: sessie.user.userId,
            actorNaam: sessie.user.name,
          }),
        });
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
