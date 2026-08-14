import { NextRequest, NextResponse } from "next/server";
import { genereerReplenTaken, planTellingen } from "@/lib/taken";
import { instelling } from "@/lib/instellingen";
import { isDbConfigured } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Maakt elke ochtend het werk klaar dat niemand hoeft te bedenken:
 * aanvultaken voor piklocaties onder hun minimum, en de cyclustellingen van
 * vandaag.
 *
 * Beide zijn idempotent — een bestaande open taak wordt niet gedupliceerd — dus
 * vaker draaien kan zonder schade.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, message: "Niet toegestaan." }, { status: 401 });
  }
  if (!isDbConfigured()) {
    return NextResponse.json({ ok: false, message: "Geen database." }, { status: 503 });
  }

  const replen = await genereerReplenTaken("cron");
  const perDag = Number(await instelling<number>("tellen.per_dag")) || 10;
  const tellingen = await planTellingen(perDag, "cron");

  return NextResponse.json({
    ok: true,
    replenishment: replen,
    tellingen,
  });
}
