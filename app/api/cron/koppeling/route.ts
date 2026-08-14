import { NextRequest, NextResponse } from "next/server";
import { leegWachtrij } from "@/lib/koppeling";
import { isDbConfigured } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Bezorgt de terugmeldingen aan de portal. Draait elke vijf minuten.
 *
 * Waarom een wachtrij en geen directe call bij het afsluiten van een
 * pickopdracht: als de portal even niet bereikbaar is, mag dat de magazijnvloer
 * niet stilleggen. De gebeurtenis staat vast in het WMS; de bezorging volgt
 * vanzelf. Mislukt het zes keer, dan blijft hij als 'mislukt' staan in plaats
 * van eeuwig te blijven proberen.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, message: "Niet toegestaan." }, { status: 401 });
  }
  if (!isDbConfigured()) {
    return NextResponse.json({ ok: false, message: "Geen database." }, { status: 503 });
  }

  const resultaat = await leegWachtrij(50);
  return NextResponse.json({ ok: true, ...resultaat });
}
