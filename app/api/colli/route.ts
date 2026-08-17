import { NextRequest, NextResponse } from "next/server";
import { vereisSessie } from "@/lib/auth-server";
import {
  openColli,
  collo,
  zoekCollo,
  colloRegels,
  maakCollo,
  voegToe,
  verwijderRegel,
  sluitCollo,
  verplaatsCollo,
  crossdockKansen,
  crossdockNaarExpeditie,
  type ColloSoort,
} from "@/lib/colli";
import { BoekingsFout } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * GET — de colli in omloop.
 *   ?id=            → één collo met zijn paklijst
 *   ?code=          → idem, op collolabel (scanveld)
 *   ?crossdock=1    → wat binnenkomt waar al vraag op wacht
 */
export async function GET(req: NextRequest) {
  const sessie = await vereisSessie();
  if (!sessie.ok) return sessie.response;

  const id = req.nextUrl.searchParams.get("id");
  const code = req.nextUrl.searchParams.get("code");

  if (id || code) {
    const gevonden = id ? await collo(Number(id)) : await zoekCollo(String(code));
    if (!gevonden) {
      return NextResponse.json(
        { ok: false, message: `Onbekend collo: ${code ?? id}` },
        { status: 404 }
      );
    }
    return NextResponse.json({
      ok: true,
      collo: gevonden,
      regels: await colloRegels(gevonden.id),
    });
  }

  if (req.nextUrl.searchParams.get("crossdock") === "1") {
    return NextResponse.json({ ok: true, kansen: await crossdockKansen(50) });
  }

  return NextResponse.json({ ok: true, colli: await openColli() });
}

/**
 * POST — het werk aan de kade:
 *   { actie: "nieuw", soort, locatieCode }
 *   { actie: "toevoegen", id, code, aantal }
 *   { actie: "verwijderen", id, sku }
 *   { actie: "sluiten", id }
 *   { actie: "verplaatsen", id, naarLocatieCode }
 *   { actie: "crossdock", ontvangstRegelId, aantal }
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
          collo: await maakCollo({
            soort: (body.soort as ColloSoort) || "doos",
            locatieCode: (body.locatieCode as string) || null,
            ontvangstId: body.ontvangstId ? Number(body.ontvangstId) : null,
            notitie: (body.notitie as string) || null,
            door: sessie.user.name,
          }),
        });

      case "toevoegen": {
        const regels = await voegToe(
          Number(body.id),
          String(body.code || ""),
          Number(body.aantal ?? 1)
        );
        return NextResponse.json({
          ok: true,
          regels,
          collo: await collo(Number(body.id)),
        });
      }

      case "verwijderen": {
        const regels = await verwijderRegel(Number(body.id), String(body.sku || ""));
        return NextResponse.json({
          ok: true,
          regels,
          collo: await collo(Number(body.id)),
        });
      }

      case "sluiten":
        return NextResponse.json({ ok: true, collo: await sluitCollo(Number(body.id)) });

      case "verplaatsen": {
        const resultaat = await verplaatsCollo(
          Number(body.id),
          String(body.naarLocatieCode || ""),
          {
            actorId: sessie.user.userId,
            actorNaam: sessie.user.name,
            idempotencyKey: (body.idempotencyKey as string) || null,
          }
        );
        /* Een half gelukte verplaatsing is geen fout maar ook geen succes: de
           client moet de melding tonen, niet stilzwijgend doorgaan. */
        return NextResponse.json({ ok: true, ...resultaat });
      }

      case "crossdock":
        return NextResponse.json({
          ok: true,
          resultaat: await crossdockNaarExpeditie({
            ontvangstRegelId: Number(body.ontvangstRegelId),
            aantal: body.aantal ? Number(body.aantal) : undefined,
            actorId: sessie.user.userId,
            actorNaam: sessie.user.name,
            idempotencyKey: (body.idempotencyKey as string) || null,
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
