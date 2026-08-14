import { NextRequest, NextResponse } from "next/server";
import { vereisSessie } from "@/lib/auth-server";
import { boekTelling } from "@/lib/voorraad";
import { BoekingsFout } from "@/lib/db";
import { instelling } from "@/lib/instellingen";

export const runtime = "nodejs";

/**
 * POST /api/telling — zet het saldo op een locatie naar het gételde aantal.
 *
 * Het antwoord bevat `controle: true` als het verschil boven de ingestelde
 * drempel ligt; de app markeert die regel dan voor een teamleider. We blokkeren
 * niet — de teller staat bij de stelling en heeft gezien wat er ligt.
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

  try {
    const resultaat = await boekTelling({
      sku: String(body.sku || ""),
      locatieId: Number(body.locatieId),
      geteld: Number(body.geteld),
      notitie: (body.notitie as string) || null,
      idempotencyKey: (body.idempotencyKey as string) || null,
      actorId: sessie.user.userId,
      actorNaam: sessie.user.name,
    });

    const drempel = Number(await instelling<number>("tellen.verschil_drempel")) || 0;
    return NextResponse.json({
      ok: true,
      ...resultaat,
      controle: drempel > 0 && Math.abs(resultaat.verschil) >= drempel,
    });
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
