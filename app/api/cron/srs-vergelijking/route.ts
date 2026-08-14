import { NextRequest, NextResponse } from "next/server";
import { query, queryOne, isDbConfigured } from "@/lib/db";
import { instelling } from "@/lib/instellingen";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Nachtelijke shadow-vergelijking. Legt per SKU vast wat SRS zegt en wat het WMS
 * zegt, zodat je over de tijd kunt zien of de afwijking kleiner wordt. Dát is
 * het cutover-criterium — niet een gevoel.
 *
 * De bron staat al in deze database (public.srs_stock, branch 99), dus dit is
 * puur SQL: geen API-call, geen SRS-token nodig.
 */

function magDraaien(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; /* geen secret ingesteld: alleen handmatig zinvol */
  const kop = req.headers.get("authorization") || "";
  return kop === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!magDraaien(req)) {
    return NextResponse.json({ ok: false, message: "Niet toegestaan." }, { status: 401 });
  }
  if (!isDbConfigured()) {
    return NextResponse.json({ ok: false, message: "Geen database." }, { status: 503 });
  }

  const actief = await instelling<boolean>("shadow.actief");
  if (!actief) {
    return NextResponse.json({ ok: true, overgeslagen: "shadow.actief staat uit" });
  }

  const gen = await queryOne<{ gen: string }>(
    `SELECT gen FROM public.srs_stock ORDER BY created_at DESC LIMIT 1`
  );

  const run = await queryOne<{ id: number }>(
    `INSERT INTO wms.reconcile_runs (bron, srs_gen) VALUES ('srs', $1) RETURNING id`,
    [gen?.gen ?? null]
  );
  if (!run) {
    return NextResponse.json({ ok: false, message: "Run niet aangemaakt." }, { status: 500 });
  }

  try {
    /* Eén statement: de hele vergelijking wordt server-side weggeschreven. Bij
       4.000+ sku's scheelt dat duizenden round-trips. */
    await query(
      `INSERT INTO wms.reconcile_lines (run_id, sku, srs_qty, wms_qty, diff)
       SELECT $1, sku, srs_qty, wms_qty, diff FROM wms.shadow_verschil
       ON CONFLICT (run_id, sku) DO NOTHING`,
      [run.id]
    );

    const totalen = await queryOne<Record<string, string>>(
      `UPDATE wms.reconcile_runs r
          SET finished_at = now(),
              status      = 'klaar',
              aantal_skus = t.n,
              aantal_diff = t.n_diff,
              stuks_diff  = t.stuks
         FROM (SELECT count(*)::int AS n,
                      count(*) FILTER (WHERE diff <> 0)::int AS n_diff,
                      coalesce(sum(abs(diff)), 0)::int AS stuks
                 FROM wms.reconcile_lines WHERE run_id = $1) t
        WHERE r.id = $1
       RETURNING r.aantal_skus, r.aantal_diff, r.stuks_diff`,
      [run.id]
    );

    return NextResponse.json({
      ok: true,
      runId: run.id,
      srsGen: gen?.gen ?? null,
      skus: Number(totalen?.aantal_skus ?? 0),
      skusMetVerschil: Number(totalen?.aantal_diff ?? 0),
      stuksVerschil: Number(totalen?.stuks_diff ?? 0),
    });
  } catch (err) {
    await query(
      `UPDATE wms.reconcile_runs SET status = 'fout', fout = $2, finished_at = now()
        WHERE id = $1`,
      [run.id, String((err as Error).message).slice(0, 500)]
    );
    throw err;
  }
}
