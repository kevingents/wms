import { NextRequest, NextResponse } from "next/server";
import { vereisSessie } from "@/lib/auth-server";
import { ronde, rondeBakken, rondeStops, startRonde } from "@/lib/rondes";
import { BoekingsFout } from "@/lib/db";

export const runtime = "nodejs";

/** GET — de ronde met zijn bakken en de looplijst op vakvolgorde. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessie = await vereisSessie();
  if (!sessie.ok) return sessie.response;

  const { id } = await params;
  const gevonden = await ronde(Number(id));
  if (!gevonden) {
    return NextResponse.json({ ok: false, message: "Niet gevonden." }, { status: 404 });
  }

  const [bakken, stops] = await Promise.all([
    rondeBakken(gevonden.id),
    rondeStops(gevonden.id),
  ]);
  return NextResponse.json({ ok: true, ronde: gevonden, bakken, stops });
}

/** POST { actie: "start" } — ronde en alle opdrachten erin op naam zetten. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessie = await vereisSessie();
  if (!sessie.ok) return sessie.response;

  const { id } = await params;
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  try {
    if (body.actie === "start") {
      const bijgewerkt = await startRonde(
        Number(id),
        sessie.user.userId,
        sessie.user.name
      );
      return NextResponse.json({ ok: true, ronde: bijgewerkt });
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
