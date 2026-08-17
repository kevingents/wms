-- ═══════════════════════════════════════════════════════════════════════════
-- GENTS WMS — deel 5: de echte magazijnindeling uit SRS
--
-- SRS kent 611 bin-locaties in het magazijn met per locatie het aantal stuks,
-- het aantal verschillende barcodes en de laatste inventarisatiedatum. Die
-- gegevens zijn om twee redenen waardevol, los van de codes zelf:
--
--   1. De inventarisatiedatum vult het cyclustel-programma op dag één. Zonder
--      dit begint elk vak op "nooit geteld" en is de prioritering willekeurig;
--      mét dit weet het systeem meteen dat er vakken zijn die 564 dagen niet
--      geteld zijn.
--   2. Het aantal stuks per locatie is een controlepunt. De SRS-vergelijking
--      werkt nu per sku over het hele magazijn; hiermee kan het ook per vak, en
--      dát is waar een medewerker iets mee kan ("in H01 1A1 zit een verschil").
--
-- Statements gescheiden door `--;;`. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

-- Herkomst en referentiestand per locatie. Bewust aparte kolommen met het
-- voorvoegsel `extern_`: dit is wat SRS zegt, niet wat wij weten. Ze worden
-- nooit gebruikt om voorraad te bepalen — alleen om te vergelijken.
ALTER TABLE wms.locations ADD COLUMN IF NOT EXISTS filiaal text
--;;
ALTER TABLE wms.locations ADD COLUMN IF NOT EXISTS laatst_geteld_extern timestamptz
--;;
ALTER TABLE wms.locations ADD COLUMN IF NOT EXISTS extern_stuks integer
--;;
ALTER TABLE wms.locations ADD COLUMN IF NOT EXISTS extern_skus integer
--;;
ALTER TABLE wms.locations ADD COLUMN IF NOT EXISTS extern_gepeild_op timestamptz
--;;
CREATE INDEX IF NOT EXISTS idx_locations_filiaal
  ON wms.locations (filiaal) WHERE active
--;;

-- Genormaliseerde code voor het zoeken. SRS is inconsistent: 551 locaties heten
-- `H01 1A1` maar 56 heten `L3110A1` — dezelfde vorm zonder spatie. Een picker die
-- een oud label scant moet het vak vinden, en een picker die een nieuw label
-- scant ook. Daarom zoeken we op de code zonder spaties en streepjes.
--
-- Een gegenereerde kolom en niet een functie-index, omdat er ook op gejoined
-- wordt (import, labels) en dan is een gewone kolom eenvoudiger te lezen.
ALTER TABLE wms.locations
  ADD COLUMN IF NOT EXISTS code_zoek text
  GENERATED ALWAYS AS (upper(regexp_replace(code, '[^A-Za-z0-9]', '', 'g'))) STORED
--;;
CREATE INDEX IF NOT EXISTS idx_locations_code_zoek ON wms.locations (code_zoek)
--;;

-- Telkandidaten opnieuw, nu met de SRS-inventarisatiedatum als terugval. Zolang
-- het WMS zelf nog niets geteld heeft, is dát de enige informatie die er is over
-- hoe oud de laatste controle is — en die is bruikbaar.
CREATE OR REPLACE VIEW wms.tel_kandidaten AS
WITH beweging AS (
  SELECT loc.id AS location_id, count(*)::int AS mutaties
    FROM wms.locations loc
    JOIN wms.stock_moves m
      ON m.from_location_id = loc.id OR m.to_location_id = loc.id
   WHERE m.created_at > now() - interval '90 days'
   GROUP BY loc.id
), laatst AS (
  SELECT cl.location_id, max(cl.created_at) AS laatst_geteld
    FROM wms.count_lines cl
   GROUP BY cl.location_id
)
SELECT l.id                AS location_id,
       l.code              AS locatie,
       l.zone,
       l.sort_order,
       coalesce(sum(s.qty), 0)::int          AS stuks,
       count(s.sku)::int                     AS skus,
       coalesce(b.mutaties, 0)               AS mutaties_90d,
       /* Eigen telling wint; anders wat SRS als laatste inventarisatie meldt. */
       coalesce(t.laatst_geteld, l.laatst_geteld_extern) AS laatst_geteld,
       coalesce(
         extract(day FROM now() - coalesce(t.laatst_geteld, l.laatst_geteld_extern))::int,
         999
       )                                     AS dagen_geleden,
       (least(
          coalesce(
            extract(day FROM now() - coalesce(t.laatst_geteld, l.laatst_geteld_extern))::int,
            999
          ), 365)
        * (1 + coalesce(b.mutaties, 0)))::int AS score
  FROM wms.locations l
  LEFT JOIN wms.stock_levels s ON s.location_id = l.id AND s.qty > 0
  LEFT JOIN beweging b ON b.location_id = l.id
  LEFT JOIN laatst t ON t.location_id = l.id
   /* Alleen echte voorraadvakken. De retourbalie, quarantaine en expeditie zijn
      doorgeefplekken: die horen leeg te lopen, en een telprogramma dat ze elke
      week bovenaan zet, leidt de aandacht weg van de stellingen waar de voorraad
      wél stilstaat. */
 WHERE l.active AND l.kind IN ('pick', 'bulk')
 GROUP BY l.id, l.code, l.zone, l.sort_order, b.mutaties, t.laatst_geteld,
          l.laatst_geteld_extern
--;;

-- Verschil per LOCATIE tussen wat SRS zegt en wat het WMS heeft staan.
-- De bestaande shadow-vergelijking werkt per sku over het hele magazijn; die
-- zegt "er zijn 40 stuks te veel" maar niet waar. Deze zegt in welk vak.
CREATE OR REPLACE VIEW wms.locatie_verschil AS
SELECT l.id                            AS location_id,
       l.code                          AS locatie,
       l.zone,
       l.filiaal,
       l.extern_stuks,
       l.extern_skus,
       l.extern_gepeild_op,
       coalesce(w.stuks, 0)            AS wms_stuks,
       coalesce(w.skus, 0)             AS wms_skus,
       coalesce(w.stuks, 0) - coalesce(l.extern_stuks, 0) AS diff_stuks
  FROM wms.locations l
  LEFT JOIN (
    SELECT location_id, sum(qty)::int AS stuks, count(*)::int AS skus
      FROM wms.stock_levels WHERE qty > 0 GROUP BY location_id
  ) w ON w.location_id = l.id
 WHERE l.active AND l.extern_stuks IS NOT NULL
--;;
