import { NextRequest, NextResponse } from "next/server";
import { leesVerzoek, neemOpdrachtAan, opdrachtStandOpRef } from "@/lib/koppeling";
import { BoekingsFout } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * De deur waardoor de portal werk bij het magazijn neerlegt.
 *
 * Server-naar-server, dus géén gebruikerssessie maar een gedeeld geheim. Elk
 * rekenmodel in de portal — herverdeling, replenishment, forecast, inkoop —
 * gebruikt ditzelfde eindpunt; alleen `bron` verschilt. Een nieuw model vraagt
 * dus geen nieuwe koppeling.
 *
 * POST /api/koppeling/opdracht
 *   {
 *     "bron": "herverdeling",
 *     "ref": "herv-2026-08-14-utrecht",
 *     "bestemming": "GENTS Utrecht",
 *     "prioriteit": 5,
 *     "callbackUrl": "https://storegents.vercel.app/api/wms/terugmelding",
 *     "regels": [{ "sku": "2900003390031", "aantal": 3 }]
 *   }
 *
 * Antwoord bevat per sku hoeveel er toegewezen kon worden en hoeveel niet —
 * zodat het model weet wat het de winkel kan beloven vóórdat het dat doet.
 *
 * GET /api/koppeling/opdracht?bron=herverdeling&ref=… → de stand van zaken.
 */

function magBinnen(req: NextRequest): boolean {
  const secret = process.env.KOPPELING_SECRET;
  if (!secret) return false;
  const kop = req.headers.get("authorization") || "";
  return kop === `Bearer ${secret}`;
}

function geweigerd(): NextResponse {
  return NextResponse.json(
    { ok: false, message: "Niet geautoriseerd." },
    { status: 401 }
  );
}

export async function POST(req: NextRequest) {
  if (!magBinnen(req)) return geweigerd();

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  try {
    const verzoek = leesVerzoek(body);
    const antwoord = await neemOpdrachtAan(verzoek);
    return NextResponse.json({ ok: true, ...antwoord }, { status: antwoord.nieuw ? 201 : 200 });
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

export async function GET(req: NextRequest) {
  if (!magBinnen(req)) return geweigerd();

  const bron = req.nextUrl.searchParams.get("bron")?.trim();
  const ref = req.nextUrl.searchParams.get("ref")?.trim();
  if (!bron || !ref) {
    return NextResponse.json(
      { ok: false, message: "Geef `bron` en `ref` mee." },
      { status: 400 }
    );
  }

  const stand = await opdrachtStandOpRef(bron, ref);
  if (!stand) {
    return NextResponse.json(
      { ok: false, message: "Onbekende opdracht." },
      { status: 404 }
    );
  }
  return NextResponse.json({ ok: true, ...stand });
}
