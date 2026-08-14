import { NextResponse } from "next/server";
import { vereisSessie, vereisBeheer } from "@/lib/auth-server";
import { beginvoorraadVoorbeeld, laadBeginvoorraad } from "@/lib/inslag";
import { BoekingsFout } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 120;

/** GET — wat zou er geladen worden, en is het al gebeurd? */
export async function GET() {
  const sessie = await vereisSessie();
  if (!sessie.ok) return sessie.response;
  return NextResponse.json({ ok: true, voorbeeld: await beginvoorraadVoorbeeld() });
}

/**
 * POST — laadt de SRS-magazijnvoorraad als startsaldo. Eenmalig: een tweede
 * poging wordt geweigerd, want die zou de voorraad verdubbelen.
 */
export async function POST() {
  const sessie = await vereisBeheer();
  if (!sessie.ok) return sessie.response;

  try {
    const resultaat = await laadBeginvoorraad(sessie.user.name);
    return NextResponse.json({ ok: true, ...resultaat });
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
