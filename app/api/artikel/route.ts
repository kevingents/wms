import { NextRequest, NextResponse } from "next/server";
import { vereisSessie } from "@/lib/auth-server";
import { zoekArtikel, zoekArtikelen, saldiVanArtikel, totaalVanArtikel } from "@/lib/voorraad";

export const runtime = "nodejs";

/**
 * GET /api/artikel?code=…   → exact op barcode of SKU, mét saldi (scan-resolutie)
 * GET /api/artikel?zoek=…   → vrije zoekopdracht, lijst zonder saldi
 */
export async function GET(req: NextRequest) {
  const sessie = await vereisSessie();
  if (!sessie.ok) return sessie.response;

  const code = req.nextUrl.searchParams.get("code")?.trim();
  const zoek = req.nextUrl.searchParams.get("zoek")?.trim();

  if (code) {
    const artikel = await zoekArtikel(code);
    if (!artikel) {
      return NextResponse.json(
        { ok: false, message: `Onbekende code: ${code}` },
        { status: 404 }
      );
    }
    const [saldi, totaal] = await Promise.all([
      saldiVanArtikel(artikel.sku),
      totaalVanArtikel(artikel.sku),
    ]);
    return NextResponse.json({ ok: true, artikel, saldi, totaal });
  }

  if (zoek) {
    return NextResponse.json({ ok: true, artikelen: await zoekArtikelen(zoek) });
  }

  return NextResponse.json(
    { ok: false, message: "Geef `code` of `zoek` mee." },
    { status: 400 }
  );
}
