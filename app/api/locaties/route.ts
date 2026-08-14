import { NextRequest, NextResponse } from "next/server";
import { vereisSessie, vereisBeheer } from "@/lib/auth-server";
import { alleLocaties, maakLocatie, saldiVanLocatie, zoekLocatie } from "@/lib/voorraad";
import { BoekingsFout } from "@/lib/db";

export const runtime = "nodejs";

/**
 * GET  /api/locaties          → alle actieve locaties
 * GET  /api/locaties?code=…   → één locatie mét wat erop ligt (scan-resolutie)
 * POST /api/locaties          → aanmaken of bijwerken (teamleider/beheer)
 */
export async function GET(req: NextRequest) {
  const sessie = await vereisSessie();
  if (!sessie.ok) return sessie.response;

  const code = req.nextUrl.searchParams.get("code")?.trim();
  if (code) {
    const locatie = await zoekLocatie(code);
    if (!locatie) {
      return NextResponse.json(
        { ok: false, message: `Onbekende locatie: ${code}` },
        { status: 404 }
      );
    }
    return NextResponse.json({
      ok: true,
      locatie,
      inhoud: await saldiVanLocatie(locatie.id),
    });
  }

  const alles = req.nextUrl.searchParams.get("alles") === "1";
  return NextResponse.json({ ok: true, locaties: await alleLocaties(!alles) });
}

export async function POST(req: NextRequest) {
  const sessie = await vereisBeheer();
  if (!sessie.ok) return sessie.response;

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const code = String(body.code || "").trim();
  if (!code) {
    return NextResponse.json({ ok: false, message: "Code is verplicht." }, { status: 400 });
  }

  try {
    const locatie = await maakLocatie({
      code,
      name: (body.naam as string) || null,
      zone: (body.zone as string) || null,
      kind: (body.soort as string) || "pick",
      sortOrder: Number(body.volgorde ?? 0) || 0,
      pickable: body.pickbaar !== false,
      note: (body.notitie as string) || null,
    });
    return NextResponse.json({ ok: true, locatie });
  } catch (err) {
    if (err instanceof BoekingsFout) {
      return NextResponse.json({ ok: false, message: err.message }, { status: 400 });
    }
    throw err;
  }
}
