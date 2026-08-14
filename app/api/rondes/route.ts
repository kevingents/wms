import { NextRequest, NextResponse } from "next/server";
import { vereisSessie } from "@/lib/auth-server";
import { openRondes, maakRonde } from "@/lib/rondes";
import { werkvoorraad } from "@/lib/picken";
import { BoekingsFout } from "@/lib/db";

export const runtime = "nodejs";

/** GET — lopende rondes plus de opdrachten die nog vrij zijn om te verzamelen. */
export async function GET() {
  const sessie = await vereisSessie();
  if (!sessie.ok) return sessie.response;

  const [rondes, opdrachten] = await Promise.all([openRondes(), werkvoorraad()]);
  return NextResponse.json({ ok: true, rondes, opdrachten });
}

/** POST — stelt een ronde samen uit gekozen opdrachten; één bak per opdracht. */
export async function POST(req: NextRequest) {
  const sessie = await vereisSessie();
  if (!sessie.ok) return sessie.response;

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const ids = Array.isArray(body.pickOrderIds)
    ? (body.pickOrderIds as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n > 0)
    : [];

  try {
    const resultaat = await maakRonde({
      pickOrderIds: ids,
      door: sessie.user.userId,
      doorNaam: sessie.user.name,
      note: (body.notitie as string) || null,
    });
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
