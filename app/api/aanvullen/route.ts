import { NextRequest, NextResponse } from "next/server";
import { vereisSessie, vereisBeheer } from "@/lib/auth-server";
import { aanvulAdvies } from "@/lib/aanvullen";
import { maakPickOpdracht } from "@/lib/picken";
import { instelling } from "@/lib/instellingen";
import { BoekingsFout } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * GET — het aanvuladvies: welke winkels zitten onder hun ideaal, en wat kan het
 * magazijn daar vandaag van leveren.
 *
 * Het rekent live. Dat is met opzet: het advies hangt af van de vrije voorraad op
 * dít moment, en een advies van gisteren stuurt iemand naar een vak dat vannacht
 * is leeggehaald voor een weborder.
 */
export async function GET() {
  const sessie = await vereisSessie();
  if (!sessie.ok) return sessie.response;

  const minimum = Number(await instelling<number>("aanvullen.minimum_per_regel")) || 1;
  const advies = await aanvulAdvies(minimum);

  return NextResponse.json({ ok: true, minimum, ...advies });
}

/**
 * POST — zet het advies om in pickopdrachten, één per winkel.
 *
 * NOODUITGANG, GEEN HOOFDROUTE
 * ----------------------------
 * De bedoeling is dat de portal beslist wélke winkel wat krijgt — daar zit de
 * verkoophistorie, de herverdeling en de forecast, en die weging hoort niet in
 * het magazijn (zie lib/aanvullen.ts en docs/KOPPELING.md). De portal stuurt het
 * resultaat naar POST /api/koppeling/opdracht met bron 'aanvulling'.
 *
 * Zolang die knop in de portal nog niet bestaat, kan een teamleider het hier
 * doen. De verdeling die dan gebruikt wordt is evenredig naar tekort — eerlijk,
 * maar zonder verkoopsnelheid erin. Dat is bewust simpeler dan wat de portal
 * straks kan, en niemand hoort te denken dat dit hetzelfde is.
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

  const stores = Array.isArray(body.stores)
    ? (body.stores as unknown[]).map((s) => String(s ?? "").trim()).filter(Boolean)
    : [];

  if (stores.length === 0) {
    return NextResponse.json(
      { ok: false, message: "Kies minstens één winkel." },
      { status: 400 }
    );
  }

  /* De datum zit in de bron-referentie, waardoor twee keer op één dag aanvullen
     voor dezelfde winkel geen tweede ronde oplevert. */
  const datum = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Amsterdam",
  }).format(new Date());

  try {
    const minimum = Number(await instelling<number>("aanvullen.minimum_per_regel")) || 1;
    const advies = await aanvulAdvies(minimum);

    const gemaakt: string[] = [];
    const overgeslagen: string[] = [];

    for (const store of stores) {
      const regels = advies.regels
        .filter((r) => r.store === store && r.toegewezen > 0)
        .map((r) => ({ sku: r.sku, aantal: r.toegewezen }));

      if (regels.length === 0) {
        overgeslagen.push(store);
        continue;
      }

      const opdracht = await maakPickOpdracht({
        bron: "aanvulling",
        /* Datum in de referentie: twee keer op één dag aanvullen voor dezelfde
           winkel levert geen tweede ronde op. */
        bronRef: `${datum}:${store}`,
        bestemming: store,
        prioriteit: 3,
        door: sessie.user.name,
        note: `Aanvulling tot ideaal — ${regels.length} regels`,
        regels,
      });

      if (opdracht) gemaakt.push(opdracht.code);
      else overgeslagen.push(store);
    }

    return NextResponse.json({ ok: true, datum, gemaakt, overgeslagen });
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
