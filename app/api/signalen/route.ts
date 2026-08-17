import { NextRequest, NextResponse } from "next/server";
import { vereisSessie, vereisBeheer } from "@/lib/auth-server";
import { openSignalen, handelAf, negeer, controleerAlles } from "@/lib/signalen";

export const runtime = "nodejs";
export const maxDuration = 120;

/** GET — alles wat open staat, urgent eerst. */
export async function GET() {
  const sessie = await vereisSessie();
  if (!sessie.ok) return sessie.response;
  return NextResponse.json({ ok: true, signalen: await openSignalen(100) });
}

/**
 * POST — { actie: "afhandelen" | "negeren", id } of { actie: "controleer" }.
 *
 * Afhandelen en negeren zijn beide eindstations, maar met verschillende
 * betekenis: afgehandeld zegt "opgelost", genegeerd zegt "gezien en akkoord".
 * Dat onderscheid is later het verschil tussen een probleem en een uitzondering.
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

  if (body.actie === "controleer") {
    const beheer = await vereisBeheer();
    if (!beheer.ok) return beheer.response;
    return NextResponse.json({ ok: true, ...(await controleerAlles()) });
  }

  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ ok: false, message: "Ongeldig signaal." }, { status: 400 });
  }

  if (body.actie === "afhandelen") {
    await handelAf(id, sessie.user.name);
    return NextResponse.json({ ok: true });
  }
  if (body.actie === "negeren") {
    await negeer(id, sessie.user.name);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: false, message: "Onbekende actie." }, { status: 400 });
}
