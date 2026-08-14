import { NextRequest, NextResponse } from "next/server";
import { vereisSessie, vereisBeheer } from "@/lib/auth-server";
import { alleInstellingen, zetInstelling, INSTELLINGEN } from "@/lib/instellingen";

export const runtime = "nodejs";

/** GET — alle instellingen plus hun definities, zodat de UI zichzelf kan bouwen. */
export async function GET() {
  const sessie = await vereisSessie();
  if (!sessie.ok) return sessie.response;
  return NextResponse.json({
    ok: true,
    definities: INSTELLINGEN,
    waarden: await alleInstellingen(),
  });
}

/** PUT — één of meer instellingen bijwerken. Alleen beheer/teamleider. */
export async function PUT(req: NextRequest) {
  const sessie = await vereisBeheer();
  if (!sessie.ok) return sessie.response;

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const wijzigingen = (body.wijzigingen ?? body) as Record<string, unknown>;
  const namen = Object.keys(wijzigingen);
  if (namen.length === 0) {
    return NextResponse.json({ ok: false, message: "Niets te wijzigen." }, { status: 400 });
  }

  try {
    for (const key of namen) {
      await zetInstelling(key, wijzigingen[key], sessie.user.name);
    }
  } catch (err) {
    return NextResponse.json(
      { ok: false, message: (err as Error).message },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true, waarden: await alleInstellingen() });
}
