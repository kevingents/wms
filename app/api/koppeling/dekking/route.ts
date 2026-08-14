import { NextRequest, NextResponse } from "next/server";
import { aanvulAdvies } from "@/lib/aanvullen";
import { huidigeGebruiker } from "@/lib/auth-server";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/koppeling/dekking
 *
 * Wat kan het magazijn van de keten-tekorten daadwerkelijk leveren? Bedoeld voor
 * de adviesmodellen in de portal: die weten wát ze willen verdelen, maar niet
 * hoeveel er ná aftrek van lopende pickopdrachten nog vrij ligt.
 *
 * Bewust alleen lezen. Wie welke stuks krijgt beslist de portal; die stuurt het
 * resultaat terug naar POST /api/koppeling/opdracht.
 *
 * Toegankelijk voor de portal (gedeeld geheim) én voor een ingelogde gebruiker,
 * zodat een teamleider dezelfde cijfers kan bekijken.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.KOPPELING_SECRET;
  const viaPortal = Boolean(secret) && req.headers.get("authorization") === `Bearer ${secret}`;

  if (!viaPortal && !(await huidigeGebruiker())) {
    return NextResponse.json({ ok: false, message: "Niet geautoriseerd." }, { status: 401 });
  }

  const minimum = Math.max(Number(req.nextUrl.searchParams.get("minimum") ?? 1) || 1, 1);
  const advies = await aanvulAdvies(minimum);

  /* Zonder detail is het antwoord klein genoeg om vaak op te halen; met
     ?detail=1 krijgt de portal de regels erbij. */
  const detail = req.nextUrl.searchParams.get("detail") === "1";

  return NextResponse.json({
    ok: true,
    totaalTekort: advies.totaalTekort,
    totaalLeverbaar: advies.totaalToegewezen,
    skusMetTekort: advies.skusMetTekort,
    skusLeverbaar: advies.skusLeverbaar,
    perWinkel: advies.perWinkel,
    ...(detail ? { regels: advies.regels } : {}),
  });
}
