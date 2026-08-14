import { NextRequest, NextResponse } from "next/server";
import { vereisSessie } from "@/lib/auth-server";
import {
  pickOpdracht,
  pickRegels,
  startPicken,
  verzendPickOpdracht,
} from "@/lib/picken";
import { BoekingsFout } from "@/lib/db";

export const runtime = "nodejs";

/** GET — één pickopdracht met zijn regels, in looproutevolgorde. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessie = await vereisSessie();
  if (!sessie.ok) return sessie.response;

  const { id } = await params;
  const opdracht = await pickOpdracht(Number(id));
  if (!opdracht) {
    return NextResponse.json({ ok: false, message: "Niet gevonden." }, { status: 404 });
  }
  return NextResponse.json({
    ok: true,
    opdracht,
    regels: await pickRegels(opdracht.id),
  });
}

/**
 * POST — statusovergangen.
 *   { actie: "start" }     → toewijzen aan jezelf en beginnen
 *   { actie: "verzenden" } → van expeditie het pand uit
 */
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
      const opdracht = await startPicken(
        Number(id),
        sessie.user.userId,
        sessie.user.name
      );
      return NextResponse.json({ ok: true, opdracht });
    }

    if (body.actie === "verzenden") {
      const opdracht = await verzendPickOpdracht({
        id: Number(id),
        actorId: sessie.user.userId,
        actorNaam: sessie.user.name,
      });
      return NextResponse.json({ ok: true, opdracht });
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
