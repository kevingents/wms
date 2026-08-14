import { NextRequest, NextResponse } from "next/server";
import { vereisSessie } from "@/lib/auth-server";
import { bevestigPickRegel, slaRegelOver } from "@/lib/picken";
import { BoekingsFout } from "@/lib/db";

export const runtime = "nodejs";

/**
 * POST /api/picken/regel — bevestigt of slaat één pickregel over.
 *
 * Bevestigen boekt van de piklocatie naar expeditie. Is er minder gevonden dan
 * gevraagd, dan komt het restant terug als nieuwe regel op een andere locatie;
 * de picker hoeft niet zelf te bedenken waar de rest ligt.
 */
export async function POST(req: NextRequest) {
  const sessie = await vereisSessie();
  if (!sessie.ok) return sessie.response;

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const regelId = Number(body.regelId);
  if (!Number.isInteger(regelId) || regelId <= 0) {
    return NextResponse.json({ ok: false, message: "Ongeldige regel." }, { status: 400 });
  }

  try {
    if (body.actie === "overslaan") {
      await slaRegelOver(regelId, String(body.reden || "Overgeslagen door picker"));
      return NextResponse.json({ ok: true });
    }

    const resultaat = await bevestigPickRegel({
      regelId,
      aantal: Number(body.aantal),
      actorId: sessie.user.userId,
      actorNaam: sessie.user.name,
      idempotencyKey: (body.idempotencyKey as string) || null,
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
