import { NextRequest, NextResponse } from "next/server";
import { vereisSessie, vereisBeheer } from "@/lib/auth-server";
import {
  openTaken,
  startTaak,
  rondTaakAf,
  annuleerTaak,
  genereerReplenTaken,
  planTellingen,
  bronnenVoor,
  replenAdvies,
  telKandidaten,
  type TaakSoort,
} from "@/lib/taken";
import { instelling } from "@/lib/instellingen";
import { BoekingsFout } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET — de werkwachtrij.
 *   ?soort=replenishment  → filter
 *   ?advies=1             → het replenishment-advies en de telkandidaten erbij,
 *                           voor het beheerscherm
 *   ?bronnen=<sku>        → waar kan dit vandaan gehaald worden
 */
export async function GET(req: NextRequest) {
  const sessie = await vereisSessie();
  if (!sessie.ok) return sessie.response;

  const sku = req.nextUrl.searchParams.get("bronnen");
  if (sku) {
    const behalve = req.nextUrl.searchParams.get("behalve");
    return NextResponse.json({
      ok: true,
      bronnen: await bronnenVoor(sku, behalve ? Number(behalve) : null),
    });
  }

  const soort = req.nextUrl.searchParams.get("soort") as TaakSoort | null;
  const taken = await openTaken(soort ?? undefined);

  if (req.nextUrl.searchParams.get("advies") === "1") {
    return NextResponse.json({
      ok: true,
      taken,
      replen: await replenAdvies(),
      telkandidaten: await telKandidaten(15),
    });
  }

  return NextResponse.json({ ok: true, taken });
}

/**
 * POST — taken oppakken en afronden:
 *   { actie: "start", id }
 *   { actie: "afronden", id, vanLocatieId, aantal }
 *   { actie: "annuleren", id, reden }
 *   { actie: "genereer-replen" }   → advies omzetten in taken (teamleider)
 *   { actie: "plan-tellingen" }    → cyclustellingen inplannen (teamleider)
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
      case "start":
        return NextResponse.json({
          ok: true,
          taak: await startTaak(Number(body.id), sessie.user.userId, sessie.user.name),
        });

      case "afronden":
        return NextResponse.json({
          ok: true,
          taak: await rondTaakAf({
            taakId: Number(body.id),
            vanLocatieId: Number(body.vanLocatieId),
            aantal: Number(body.aantal),
            actorId: sessie.user.userId,
            actorNaam: sessie.user.name,
            idempotencyKey: (body.idempotencyKey as string) || null,
          }),
        });

      case "annuleren":
        await annuleerTaak(Number(body.id), String(body.reden || "Niet nodig"));
        return NextResponse.json({ ok: true });

      case "genereer-replen": {
        const beheer = await vereisBeheer();
        if (!beheer.ok) return beheer.response;
        return NextResponse.json({
          ok: true,
          ...(await genereerReplenTaken(sessie.user.name)),
        });
      }

      case "plan-tellingen": {
        const beheer = await vereisBeheer();
        if (!beheer.ok) return beheer.response;
        const perDag = Number(await instelling<number>("tellen.per_dag")) || 10;
        return NextResponse.json({
          ok: true,
          ...(await planTellingen(Number(body.aantal ?? perDag), sessie.user.name)),
        });
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
