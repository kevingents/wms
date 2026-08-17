import { NextRequest, NextResponse } from "next/server";
import { vereisSessie } from "@/lib/auth-server";
import {
  labelStand,
  labelInstellingen,
  locatiesZonderLabel,
  maakLabelBestand,
  recentePrints,
  type LabelSoort,
  type PrinterTaal,
} from "@/lib/labels";
import { BoekingsFout } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 60;

/** GET — hoeveel vakken missen een label, welke, en wat is er recent geprint. */
export async function GET() {
  const sessie = await vereisSessie();
  if (!sessie.ok) return sessie.response;

  const [stand, instellingen, zonder, prints] = await Promise.all([
    labelStand(),
    labelInstellingen(),
    locatiesZonderLabel(),
    recentePrints(15),
  ]);

  return NextResponse.json({
    ok: true,
    stand,
    formaat: instellingen.formaat,
    taal: instellingen.taal,
    zonderLabel: zonder,
    prints,
  });
}

/**
 * POST — genereert het labelbestand.
 *
 * `voorbeeld: true` legt de print niet vast. Dat onderscheid is belangrijk: een
 * vak dat iemand alleen bekeken heeft, hoort niet als "heeft een label" te
 * gelden — anders verdwijnt het uit de lijst zonder dat er iets geplakt is.
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

  const codes = Array.isArray(body.codes)
    ? (body.codes as unknown[]).map((c) => String(c ?? "").trim()).filter(Boolean)
    : [];

  try {
    const bestand = await maakLabelBestand({
      soort: String(body.soort || "locatie") as LabelSoort,
      codes,
      aantal: Number(body.aantal ?? 1),
      taal: body.taal ? (String(body.taal) as PrinterTaal) : undefined,
      door: sessie.user.name,
      vastleggen: body.voorbeeld !== true,
    });
    return NextResponse.json({ ok: true, bestand });
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
