import { NextResponse } from "next/server";
import { vereisSessie, vereisBeheer } from "@/lib/auth-server";
import { haalSrsLocaties, importeerSrsLocaties } from "@/lib/srs-locaties";
import { beginvoorraadGeladen } from "@/lib/inslag";
import { BoekingsFout } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 300;

/** GET — wat kent SRS aan locaties voor het magazijn? Alleen kijken, niet boeken. */
export async function GET() {
  const sessie = await vereisSessie();
  if (!sessie.ok) return sessie.response;

  try {
    const bronData = await haalSrsLocaties("99");
    const { rijen, generatedAt, bron, verwachteRegels, verwachteStuks, volledig } = bronData;
    const codes = new Set(rijen.map((r) => r.locatie.trim().toUpperCase()).filter(Boolean));
    const skus = new Set(rijen.map((r) => r.sku.trim()).filter(Boolean));

    return NextResponse.json({
      ok: true,
      generatedAt,
      bron,
      store: bronData.store,
      regels: rijen.length,
      locaties: codes.size,
      skus: skus.size,
      stuks: rijen.reduce((s, r) => s + Number(r.aantal || 0), 0),
      geblokkeerd: rijen.filter((r) => r.geblokkeerd).length,
      /* Wat SRS zégt te hebben, naast wat er doorkwam. Verschilt dat, dan ligt
         het aan het endpoint en niet aan de data — dat scheelt zoekwerk. */
      verwachteRegels,
      verwachteStuks,
      volledig,
      waarschuwing: volledig
        ? null
        : `Er kwamen ${rijen.length} van de ${verwachteRegels} regels door. storegents kapt af zonder paginering — merge en deploy storegents#416.`,
      alGeladen: await beginvoorraadGeladen(),
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

/** POST — maakt de locaties aan en boekt de voorraad erop. Eenmalig. */
export async function POST() {
  const sessie = await vereisBeheer();
  if (!sessie.ok) return sessie.response;

  try {
    const resultaat = await importeerSrsLocaties(sessie.user.name, "99");
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
