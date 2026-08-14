import { NextRequest, NextResponse } from "next/server";
import { vereisSessie } from "@/lib/auth-server";
import { ontvangst, ontvangstRegels } from "@/lib/ontvangst";

export const runtime = "nodejs";

/** GET — één ontvangst met zijn regels. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessie = await vereisSessie();
  if (!sessie.ok) return sessie.response;

  const { id } = await params;
  const gevonden = await ontvangst(Number(id));
  if (!gevonden) {
    return NextResponse.json({ ok: false, message: "Niet gevonden." }, { status: 404 });
  }
  return NextResponse.json({
    ok: true,
    ontvangst: gevonden,
    regels: await ontvangstRegels(gevonden.id),
  });
}
