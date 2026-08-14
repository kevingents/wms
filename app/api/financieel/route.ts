import { NextRequest, NextResponse } from "next/server";
import { vereisSessie, vereisBeheer } from "@/lib/auth-server";
import {
  sluitcontrole,
  grootboekBalans,
  waardePerZone,
  ontbrekendeWaarde,
  perioden,
  sluitPeriode,
  heropenPeriode,
  zetKostprijs,
  importeerKostprijzen,
  slottingAdvies,
} from "@/lib/financieel";
import { legVast } from "@/lib/kpi";
import { BoekingsFout } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 300;

/** GET — het financiële beeld in één keer. */
export async function GET() {
  const sessie = await vereisSessie();
  if (!sessie.ok) return sessie.response;

  const [controle, balans, zones, ontbreekt, maanden, slotting] = await Promise.all([
    sluitcontrole(),
    grootboekBalans(),
    waardePerZone(),
    ontbrekendeWaarde(50),
    perioden(12),
    slottingAdvies(20),
  ]);

  return NextResponse.json({
    ok: true,
    controle,
    balans,
    zones,
    ontbreekt,
    perioden: maanden,
    slotting,
  });
}

/**
 * POST — de acties die geld raken. Allemaal teamleider of hoger.
 *   { actie: "kostprijs", sku, kostprijsCent }
 *   { actie: "import-kostprijzen" }
 *   { actie: "sluit-periode", jaar, maand }
 *   { actie: "heropen-periode", jaar, maand, reden }
 */
export async function POST(req: NextRequest) {
  const sessie = await vereisBeheer();
  if (!sessie.ok) return sessie.response;

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  try {
    switch (body.actie) {
      case "kostprijs": {
        const cent = Math.round(Number(body.kostprijsCent));
        await zetKostprijs({
          sku: String(body.sku || ""),
          kostprijsCent: cent,
          bron: "handmatig",
          door: sessie.user.name,
          note: (body.notitie as string) || null,
        });
        await legVast({
          actorId: sessie.user.userId,
          actorNaam: sessie.user.name,
          actie: "kostprijs gezet",
          objectType: "artikel",
          objectId: String(body.sku || ""),
          nieuw: { kostprijs_cent: cent },
        });
        return NextResponse.json({ ok: true });
      }

      case "import-kostprijzen": {
        const resultaat = await importeerKostprijzen(sessie.user.name);
        await legVast({
          actorId: sessie.user.userId,
          actorNaam: sessie.user.name,
          actie: "kostprijzen geïmporteerd",
          objectType: "kostprijzen",
          nieuw: resultaat,
        });
        return NextResponse.json({ ok: true, ...resultaat });
      }

      case "sluit-periode": {
        const periode = await sluitPeriode({
          jaar: Number(body.jaar),
          maand: Number(body.maand),
          door: sessie.user.name,
        });
        await legVast({
          actorId: sessie.user.userId,
          actorNaam: sessie.user.name,
          actie: "periode afgesloten",
          objectType: "periode",
          objectId: `${body.jaar}-${String(body.maand).padStart(2, "0")}`,
          nieuw: { waarde_eind_cent: periode?.waarde_eind_cent },
        });
        return NextResponse.json({ ok: true, periode });
      }

      case "heropen-periode": {
        const reden = String(body.reden || "").trim();
        if (!reden) {
          return NextResponse.json(
            { ok: false, message: "Geef een reden — heropenen laat sporen na." },
            { status: 400 }
          );
        }
        await heropenPeriode({
          jaar: Number(body.jaar),
          maand: Number(body.maand),
          door: sessie.user.name,
          reden,
        });
        await legVast({
          actorId: sessie.user.userId,
          actorNaam: sessie.user.name,
          actie: "periode heropend",
          objectType: "periode",
          objectId: `${body.jaar}-${String(body.maand).padStart(2, "0")}`,
          note: reden,
        });
        return NextResponse.json({ ok: true });
      }
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
