import { NextRequest, NextResponse } from "next/server";
import { controleerAlles } from "@/lib/signalen";
import { isDbConfigured } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Loopt elke ochtend alle bewakingsregels af.
 *
 * Vroeg genoeg dat een teamleider het bij binnenkomst op het dashboard ziet, en
 * ná de werkplanning zodat aanvultaken al bestaan — anders meldt de bewaking een
 * leeg pikvak waar drie minuten later al werk voor stond.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, message: "Niet toegestaan." }, { status: 401 });
  }
  if (!isDbConfigured()) {
    return NextResponse.json({ ok: false, message: "Geen database." }, { status: 503 });
  }

  return NextResponse.json({ ok: true, ...(await controleerAlles()) });
}
