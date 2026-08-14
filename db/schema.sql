-- ═══════════════════════════════════════════════════════════════════════════
-- GENTS WMS — schema `wms` (Neon Postgres, eu-central-1; zie DATABASE_URL)
--
-- CONTEXT — waarom dit schema is zoals het is
-- ---------------------------------------------------------------------------
-- Deze database bevat al een commerce-core (schema `public`, beheerd door
-- Drizzle vanuit gentsnext). Daar staat álles op WINKEL-niveau:
--   public.product_variants   34k varianten — sku, barcode, srs_artikel_id
--   public.srs_stock          SRS-voorraadspiegel per sku × branch (nachtelijk)
--   public.stock_levels       saldo per sku × branch_id (winkel)
--   public.store_stock_movements  mutatielog per winkel
--   public.inbound_shipments  zendingen magazijn → winkel
--
-- Wat er NIET is, en precies het gat dat een WMS vult: voorraad per PLEK BINNEN
-- het magazijn. `branch 99 = GENTS Magazijn` is nu één grote bak van 4.389 sku's
-- en 47.045 stuks zonder te weten wáár iets ligt.
--
-- Daarom:
--   * GEEN eigen artikeltabel — we gebruiken public.product_variants. Een tweede
--     artikelregistratie zou exact de dubbele-waarheid opleveren die we opruimen.
--   * Sleutel is `sku` (text), net als in srs_stock en stock_levels. Barcodes
--     resolven we via de view wms.artikelen naar sku.
--   * Eigen schema, niet public: Drizzle beheert public en zou losse tabellen
--     daar als drift zien.
--
-- KERNREGEL — VOORRAAD IS EEN GROOTBOEK, GEEN GETAL
--   wms.stock_moves  = append-only ledger. Nooit UPDATE, nooit DELETE.
--   wms.stock_levels = afgeleide saldi, alleen bijgewerkt door de trigger.
-- Elk saldo is daardoor herleidbaar tot de scans die het veroorzaakten — precies
-- wat bij SRS ontbreekt als "de voorraad klopt opeens niet".
--
-- Statements gescheiden door een regel met exact `--;;` (de Neon HTTP-driver
-- voert één statement per call uit). Alles idempotent; mag herhaald draaien.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE SCHEMA IF NOT EXISTS wms
--;;

-- ── Locaties ────────────────────────────────────────────────────────────────
-- Elke plek waar voorraad kan liggen: schaplocatie, ontvangstkade, quarantaine,
-- of een virtuele tegenboekingslocatie. `sort_order` is de looproute — daar
-- hangt straks de pickvolgorde aan.
CREATE TABLE IF NOT EXISTS wms.locations (
  id          bigserial PRIMARY KEY,
  code        text NOT NULL UNIQUE,
  name        text,
  zone        text,
  kind        text NOT NULL DEFAULT 'pick',
  aisle       text,
  rack        text,
  level       text,
  sort_order  integer NOT NULL DEFAULT 0,
  pickable    boolean NOT NULL DEFAULT true,
  active      boolean NOT NULL DEFAULT true,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT locations_kind_chk CHECK (
    kind IN ('pick', 'bulk', 'inbound', 'outbound', 'quarantine', 'virtual')
  )
)
--;;
CREATE INDEX IF NOT EXISTS idx_locations_zone ON wms.locations (zone) WHERE active
--;;
CREATE INDEX IF NOT EXISTS idx_locations_route ON wms.locations (sort_order, code)
--;;

-- ── Voorraad-grootboek (append-only) ────────────────────────────────────────
-- `qty` is ALTIJD positief; de richting zit in from/to:
--   from NULL, to X    → instroom (ontvangst leverancier, retour van buiten)
--   from X,    to Y    → verplaatsing binnen het magazijn
--   from X,    to NULL → uitstroom (verzonden naar winkel/klant, afgeschreven)
--
-- `idempotency_key` maakt herhaald versturen veilig — cruciaal, want de scan-app
-- stuurt bij slechte magazijn-wifi opnieuw vanuit de offline-outbox.
--
-- Geen FK op sku: public.product_variants heeft geen unieke sku (34k varianten,
-- 22.7k unieke sku's) en srs_stock kent sku's die nog geen variant hebben. De
-- koppeling loopt via de view wms.artikelen; onbekende sku's blokkeren de
-- magazijnvloer niet.
CREATE TABLE IF NOT EXISTS wms.stock_moves (
  id               bigserial PRIMARY KEY,
  sku              text NOT NULL,
  from_location_id bigint REFERENCES wms.locations (id),
  to_location_id   bigint REFERENCES wms.locations (id),
  qty              integer NOT NULL,
  reason           text NOT NULL,
  ref_type         text,
  ref_id           text,
  actor_id         text,
  actor_name       text,
  note             text,
  idempotency_key  text UNIQUE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT moves_qty_chk CHECK (qty > 0),
  CONSTRAINT moves_sku_chk CHECK (sku <> ''),
  CONSTRAINT moves_endpoint_chk CHECK (
    from_location_id IS NOT NULL OR to_location_id IS NOT NULL
  ),
  CONSTRAINT moves_niet_zelfde_chk CHECK (
    from_location_id IS NULL OR to_location_id IS NULL
    OR from_location_id <> to_location_id
  ),
  CONSTRAINT moves_reason_chk CHECK (
    reason IN ('ontvangst', 'inslag', 'verplaatsing', 'pick', 'verzonden',
               'retour', 'telling', 'correctie', 'afschrijving', 'startsaldo')
  )
)
--;;
CREATE INDEX IF NOT EXISTS idx_moves_sku ON wms.stock_moves (sku, created_at DESC)
--;;
CREATE INDEX IF NOT EXISTS idx_moves_recent ON wms.stock_moves (created_at DESC)
--;;
CREATE INDEX IF NOT EXISTS idx_moves_ref ON wms.stock_moves (ref_type, ref_id)
--;;

-- ── Afgeleide saldi ─────────────────────────────────────────────────────────
-- CHECK (qty >= 0) is bewust een harde grens: je kunt niet pikken wat er niet
-- ligt. Een poging daartoe laat de héle boeking falen i.p.v. stil een negatief
-- saldo te maken — de medewerker krijgt "locatie leeg, tel opnieuw".
CREATE TABLE IF NOT EXISTS wms.stock_levels (
  sku         text NOT NULL,
  location_id bigint NOT NULL REFERENCES wms.locations (id),
  qty         integer NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sku, location_id),
  CONSTRAINT levels_niet_negatief_chk CHECK (qty >= 0)
)
--;;
CREATE INDEX IF NOT EXISTS idx_levels_location ON wms.stock_levels (location_id)
  WHERE qty > 0
--;;
CREATE INDEX IF NOT EXISTS idx_levels_sku ON wms.stock_levels (sku) WHERE qty > 0
--;;

-- ── De enige schrijfroute naar stock_levels ─────────────────────────────────
-- Trigger op INSERT van een move. Eén INSERT = één atomaire boeking, ook op de
-- Neon HTTP-driver (die één statement per call doet). Beide takken nemen een
-- rijlock, dus twee medewerkers die tegelijk dezelfde locatie scannen
-- serialiseren netjes in plaats van elkaars saldo te overschrijven.
--
-- LET OP bij de afboek-tak: géén `INSERT … ON CONFLICT DO UPDATE`. PostgreSQL
-- draait ExecConstraints op de vóórgestelde rij vóórdat het conflict wordt
-- afgehandeld, dus de negatieve tussenwaarde (-qty) knalt dan tegen
-- levels_niet_negatief_chk — óók als het bestaande saldo ruim voldoende is.
-- Daarom: eerst UPDATE (die de CHECK op het eindsaldo evalueert, precies wat we
-- willen), en alleen als er nog geen saldorij was een INSERT — die dan terecht
-- faalt, want afboeken van een locatie zonder voorraad hoort niet te kunnen.
CREATE OR REPLACE FUNCTION wms.apply_stock_move() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.from_location_id IS NOT NULL THEN
    UPDATE wms.stock_levels
       SET qty = qty - NEW.qty, updated_at = now()
     WHERE sku = NEW.sku AND location_id = NEW.from_location_id;

    IF NOT FOUND THEN
      INSERT INTO wms.stock_levels (sku, location_id, qty)
      VALUES (NEW.sku, NEW.from_location_id, -NEW.qty);
    END IF;
  END IF;

  IF NEW.to_location_id IS NOT NULL THEN
    INSERT INTO wms.stock_levels (sku, location_id, qty)
    VALUES (NEW.sku, NEW.to_location_id, NEW.qty)
    ON CONFLICT (sku, location_id) DO UPDATE
      SET qty = wms.stock_levels.qty + NEW.qty, updated_at = now();
  END IF;

  RETURN NEW;
END;
$$
--;;
DROP TRIGGER IF EXISTS trg_apply_stock_move ON wms.stock_moves
--;;
CREATE TRIGGER trg_apply_stock_move
  AFTER INSERT ON wms.stock_moves
  FOR EACH ROW EXECUTE FUNCTION wms.apply_stock_move()
--;;

-- Het grootboek is onveranderlijk. Een fout corrigeer je met een tegenboeking,
-- niet met een UPDATE — anders klopt de herleidbaarheid niet meer.
CREATE OR REPLACE FUNCTION wms.ledger_is_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'wms.stock_moves is append-only — corrigeer met een tegenboeking';
END;
$$
--;;
DROP TRIGGER IF EXISTS trg_ledger_append_only ON wms.stock_moves
--;;
CREATE TRIGGER trg_ledger_append_only
  BEFORE UPDATE OR DELETE ON wms.stock_moves
  FOR EACH ROW EXECUTE FUNCTION wms.ledger_is_append_only()
--;;

-- ── Artikelen: view op de core, geen kopie ──────────────────────────────────
-- Eén rij per sku, met de beste beschikbare barcode/omschrijving. DISTINCT ON
-- omdat product_variants ~100 dubbele sku's kent; we kiezen deterministisch de
-- variant mét barcode, dan de nieuwste.
CREATE OR REPLACE VIEW wms.artikelen AS
SELECT DISTINCT ON (v.sku)
       v.sku,
       nullif(v.barcode, '')        AS barcode,
       nullif(v.srs_artikel_id, '') AS srs_artikel_id,
       v.id                         AS variant_id,
       p.title                      AS omschrijving,
       nullif(p.vendor, '')         AS merk,
       nullif(v.color, '')          AS kleur,
       nullif(v.size, '')           AS maat,
       nullif(v.image_url, '')      AS afbeelding
  FROM public.product_variants v
  LEFT JOIN public.products p ON p.id = v.product_id
 WHERE v.sku <> ''
 ORDER BY v.sku, (nullif(v.barcode, '') IS NOT NULL) DESC, v.updated_at DESC
--;;

-- Barcode → sku. Scannen gebeurt op barcode (dat is ook de `stock_key` die de
-- bestaande winkel-app gebruikt), boeken gebeurt op sku.
CREATE OR REPLACE VIEW wms.barcodes AS
SELECT DISTINCT ON (v.barcode)
       v.barcode, v.sku
  FROM public.product_variants v
 WHERE v.barcode <> '' AND v.sku <> ''
 ORDER BY v.barcode, v.updated_at DESC
--;;

-- Totaal per sku over alle magazijnlocaties — dít getal wordt met SRS branch 99
-- vergeleken tijdens de shadow-fase.
CREATE OR REPLACE VIEW wms.voorraad_totaal AS
SELECT sku, sum(qty)::int AS qty, max(updated_at) AS updated_at
  FROM wms.stock_levels
 WHERE qty > 0
 GROUP BY sku
--;;

-- ── Tellingen ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wms.counts (
  id           bigserial PRIMARY KEY,
  code         text NOT NULL UNIQUE,
  scope        text NOT NULL DEFAULT 'locatie',
  status       text NOT NULL DEFAULT 'open',
  zone         text,
  started_by   text,
  started_at   timestamptz NOT NULL DEFAULT now(),
  closed_at    timestamptz,
  note         text,
  CONSTRAINT counts_status_chk CHECK (status IN ('open', 'afgerond', 'geannuleerd'))
)
--;;
CREATE TABLE IF NOT EXISTS wms.count_lines (
  id          bigserial PRIMARY KEY,
  count_id    bigint NOT NULL REFERENCES wms.counts (id) ON DELETE CASCADE,
  location_id bigint NOT NULL REFERENCES wms.locations (id),
  sku         text NOT NULL,
  verwacht    integer NOT NULL DEFAULT 0,
  geteld      integer NOT NULL,
  verschil    integer NOT NULL DEFAULT 0,
  move_id     bigint REFERENCES wms.stock_moves (id),
  actor_id    text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (count_id, location_id, sku)
)
--;;
CREATE INDEX IF NOT EXISTS idx_count_lines_verschil
  ON wms.count_lines (count_id) WHERE verschil <> 0
--;;

-- ── Instellingen (huisregel: config in de tool, niet in Vercel) ─────────────
CREATE TABLE IF NOT EXISTS wms.settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
)
--;;

-- ── Shadow-fase: vergelijking met SRS ───────────────────────────────────────
-- Zolang SRS de waarheid is draait het WMS ernaast mee. De bron staat al in deze
-- database: public.srs_stock, branch_id '99' (GENTS Magazijn). Er is dus geen
-- API-call nodig — de vergelijking is puur SQL. Pas als deze lijst structureel
-- leeg is, is de cutover verantwoord.
CREATE TABLE IF NOT EXISTS wms.reconcile_runs (
  id          bigserial PRIMARY KEY,
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  bron        text NOT NULL DEFAULT 'srs',
  srs_gen     text,
  aantal_skus integer NOT NULL DEFAULT 0,
  aantal_diff integer NOT NULL DEFAULT 0,
  stuks_diff  integer NOT NULL DEFAULT 0,
  status      text NOT NULL DEFAULT 'bezig',
  fout        text
)
--;;
CREATE TABLE IF NOT EXISTS wms.reconcile_lines (
  id      bigserial PRIMARY KEY,
  run_id  bigint NOT NULL REFERENCES wms.reconcile_runs (id) ON DELETE CASCADE,
  sku     text NOT NULL,
  srs_qty integer NOT NULL,
  wms_qty integer NOT NULL,
  diff    integer NOT NULL,
  UNIQUE (run_id, sku)
)
--;;
CREATE INDEX IF NOT EXISTS idx_reconcile_lines_diff
  ON wms.reconcile_lines (run_id, abs(diff) DESC) WHERE diff <> 0
--;;

-- Actuele afwijking t.o.v. SRS, live berekend — de kern van het shadow-dashboard.
-- FULL JOIN, want een sku kan aan één van beide kanten ontbreken; dat is juist
-- het interessante geval.
CREATE OR REPLACE VIEW wms.shadow_verschil AS
WITH srs AS (
  SELECT sku, sum(qty)::int AS srs_qty
    FROM public.srs_stock
   WHERE branch_id = '99'
     AND gen = (SELECT gen FROM public.srs_stock ORDER BY created_at DESC LIMIT 1)
   GROUP BY sku
)
SELECT coalesce(srs.sku, w.sku)     AS sku,
       coalesce(srs.srs_qty, 0)     AS srs_qty,
       coalesce(w.qty, 0)           AS wms_qty,
       coalesce(w.qty, 0) - coalesce(srs.srs_qty, 0) AS diff
  FROM srs
  FULL JOIN wms.voorraad_totaal w ON w.sku = srs.sku
--;;
