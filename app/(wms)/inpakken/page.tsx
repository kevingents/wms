import { openZendingen } from "@/lib/inpakken";
import { query } from "@/lib/db";
import { InpakLijst } from "@/components/InpakLijst";
import type { PickOpdracht } from "@/lib/picken";

export const dynamic = "force-dynamic";

export default async function InpakkenPagina() {
  /* Gepikte opdrachten waar nog geen open zending voor is — dát is het werk dat
     anders blijft liggen omdat niemand ziet dat het klaarstaat. */
  const [zendingen, gepikt] = await Promise.all([
    openZendingen(),
    query<PickOpdracht>(
      `SELECT o.*,
              (SELECT count(*) FROM wms.pick_lines l WHERE l.pick_order_id = o.id)::int AS regels,
              0::int AS open_regels,
              (SELECT coalesce(sum(l.gepikt), 0) FROM wms.pick_lines l
                WHERE l.pick_order_id = o.id)::int AS stuks
         FROM wms.pick_orders o
        WHERE o.status = 'gepikt'
          AND NOT EXISTS (
            SELECT 1 FROM wms.zendingen z
             WHERE z.pick_order_id = o.id AND z.status IN ('open', 'ingepakt', 'verzonden')
          )
        ORDER BY o.finished_at NULLS LAST, o.created_at`
    ),
  ]);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-bold text-navy">Inpakken</h1>
        <p className="text-sm text-slate">
          Scan wat de doos in gaat — de laatste kans om een mispick te vangen.
        </p>
      </header>
      <InpakLijst zendingen={zendingen} gepikt={gepikt} />
    </div>
  );
}
