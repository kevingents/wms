-- ═══════════════════════════════════════════════════════════════════════════
-- GENTS WMS — deel 3: financieel sluitend
--
-- Tot nu toe telt het systeem stuks. Een magazijn dat meetelt in de jaarrekening
-- moet ook euro's tellen, en wel zó dat de voorraadwaarde in het WMS exact
-- aansluit op de grootboekrekening Voorraad in Exact. Anders krijg je bij elke
-- afsluiting dezelfde discussie: welk getal klopt?
--
-- HET PRINCIPE
-- ------------
-- Elke voorraadmutatie krijgt op het moment van boeken een waarde mee. Die
-- waarde is historisch — hij bevriest bij de boeking en verandert nooit meer,
-- net als de mutatie zelf. Daarmee geldt op elk moment:
--
--     som(waarde in) − som(waarde uit) = voorraadwaarde op dit moment
--
-- Dat is de sluitcontrole, en die is met één query te draaien.
--
-- WAARDERINGSMETHODE: VOORTSCHRIJDEND GEMIDDELDE
-- ----------------------------------------------
-- Bij ontvangst gaat de nieuwe inkoopprijs mee in het gemiddelde; bij uitgifte
-- boeken we tegen dat gemiddelde af. Niet FIFO, en dat is een bewuste keuze:
-- FIFO vraagt kostlagen per ontvangst, en de kostprijsbron die er is (de
-- SRS-verkopen-export) levert één prijs per artikel, geen lagen. Een FIFO-
-- administratie op geschatte lagen is schijnnauwkeurigheid.
--
-- Voortschrijdend gemiddelde is toegestaan onder zowel IFRS als de Nederlandse
-- richtlijnen, en past bij mode: binnen een seizoen wisselt de inkoopprijs van
-- een artikel nauwelijks, dus het verschil met FIFO is klein en stabiel.
--
-- FIFO blijft wél de fysieke regel op de vloer — oudste eerst pikken. Dat is
-- voorraadbeheer, geen waardering, en die twee hoeven niet gelijk te zijn.
--
-- Statements gescheiden door `--;;`. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Kostprijzen ─────────────────────────────────────────────────────────────
-- Eén geldige kostprijs per artikel, met historie. `geldig_vanaf` maakt het
-- mogelijk terug te kijken wat de prijs was toen er geboekt werd — nodig zodra
-- iemand vraagt waarom een boeking van vorige maand die waarde had.
CREATE TABLE IF NOT EXISTS wms.kostprijzen (
  id            bigserial PRIMARY KEY,
  sku           text NOT NULL,
  kostprijs_cent integer NOT NULL,
  bron          text NOT NULL DEFAULT 'handmatig',
  geldig_vanaf  timestamptz NOT NULL DEFAULT now(),
  ingevoerd_door text,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kostprijs_positief_chk CHECK (kostprijs_cent >= 0),
  CONSTRAINT kostprijs_bron_chk CHECK (
    bron IN ('srs', 'inkoop', 'ontvangst', 'handmatig', 'import')
  )
)
--;;
CREATE INDEX IF NOT EXISTS idx_kostprijzen_sku
  ON wms.kostprijzen (sku, geldig_vanaf DESC)
--;;

-- De actuele kostprijs per artikel: de meest recente die al geldig is.
CREATE OR REPLACE VIEW wms.kostprijs_actueel AS
SELECT DISTINCT ON (sku)
       sku, kostprijs_cent, bron, geldig_vanaf
  FROM wms.kostprijzen
 WHERE geldig_vanaf <= now()
 ORDER BY sku, geldig_vanaf DESC, id DESC
--;;

-- ── Waarde op de mutatie ────────────────────────────────────────────────────
-- `waarde_cent` is de totale waarde van de mutatie, `kostprijs_cent` de prijs
-- per stuk waartegen geboekt is. Beide staan vast zodra de rij bestaat.
ALTER TABLE wms.stock_moves ADD COLUMN IF NOT EXISTS kostprijs_cent integer
--;;
ALTER TABLE wms.stock_moves ADD COLUMN IF NOT EXISTS waarde_cent bigint
--;;
CREATE INDEX IF NOT EXISTS idx_moves_waarde
  ON wms.stock_moves (created_at) WHERE waarde_cent IS NOT NULL
--;;

-- ── Voorraadwaarde per artikel ──────────────────────────────────────────────
-- Het voortschrijdend gemiddelde leeft hier. Niet afleidbaar uit de saldi alleen,
-- want de gemiddelde prijs hangt af van de vólgorde waarin er ontvangen en
-- uitgegeven is — dus houden we hem bij, net als de saldi.
CREATE TABLE IF NOT EXISTS wms.artikel_waarde (
  sku              text PRIMARY KEY,
  aantal           integer NOT NULL DEFAULT 0,
  waarde_cent      bigint NOT NULL DEFAULT 0,
  gem_kostprijs_cent integer NOT NULL DEFAULT 0,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT waarde_niet_negatief_chk CHECK (waarde_cent >= 0)
)
--;;

-- ── Perioden ────────────────────────────────────────────────────────────────
-- Een afgesloten periode mag niet meer bewegen. Zonder dit kan een boeking van
-- vandaag de cijfers van vorige maand veranderen nadat de accountant ernaar
-- gekeken heeft, en dan is elke afsluiting voorlopig.
CREATE TABLE IF NOT EXISTS wms.perioden (
  jaar            integer NOT NULL,
  maand           integer NOT NULL,
  status          text NOT NULL DEFAULT 'open',
  afgesloten_door text,
  afgesloten_at   timestamptz,
  waarde_eind_cent bigint,
  note            text,
  PRIMARY KEY (jaar, maand),
  CONSTRAINT periode_maand_chk CHECK (maand BETWEEN 1 AND 12),
  CONSTRAINT periode_status_chk CHECK (status IN ('open', 'afgesloten'))
)
--;;

-- ── De waarderingstrigger ───────────────────────────────────────────────────
-- Draait BEFORE INSERT, want hij vult velden op de rij zelf. Volgorde van de
-- takken volgt de boekhoudkundige logica:
--
--   instroom  (van NULL)  → waarde erbij tegen de inkoopprijs, gemiddelde herrekenen
--   uitstroom (naar NULL) → waarde eraf tegen het huidige gemiddelde (= kostprijs verkopen)
--   intern                → geen waardemutatie, alleen een andere plek
--
-- Bij een telling die voorraad bijmaakt gebruiken we ook de inkoopprijs; een
-- gevonden artikel is immers evenveel waard als een gekocht artikel.
CREATE OR REPLACE FUNCTION wms.waardeer_stock_move() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_periode   record;
  v_kostprijs integer;
  v_huidig    record;
  v_nieuw_aantal integer;
  v_nieuwe_waarde bigint;
BEGIN
  /* Periodeslot: niets boeken in een afgesloten maand. */
  SELECT * INTO v_periode
    FROM wms.perioden
   WHERE jaar = extract(year FROM NEW.created_at)::int
     AND maand = extract(month FROM NEW.created_at)::int;

  IF FOUND AND v_periode.status = 'afgesloten' THEN
    RAISE EXCEPTION
      'Periode %-% is afgesloten; boeken kan niet meer.',
      v_periode.jaar, lpad(v_periode.maand::text, 2, '0')
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_huidig FROM wms.artikel_waarde WHERE sku = NEW.sku;

  IF NEW.from_location_id IS NULL THEN
    /* ── Instroom ───────────────────────────────────────────────────────── */
    v_kostprijs := coalesce(
      NEW.kostprijs_cent,
      (SELECT kostprijs_cent FROM wms.kostprijs_actueel WHERE sku = NEW.sku),
      coalesce(v_huidig.gem_kostprijs_cent, 0)
    );

    NEW.kostprijs_cent := v_kostprijs;
    NEW.waarde_cent := v_kostprijs::bigint * NEW.qty;

    v_nieuw_aantal := coalesce(v_huidig.aantal, 0) + NEW.qty;
    v_nieuwe_waarde := coalesce(v_huidig.waarde_cent, 0) + NEW.waarde_cent;

    INSERT INTO wms.artikel_waarde (sku, aantal, waarde_cent, gem_kostprijs_cent)
    VALUES (
      NEW.sku, v_nieuw_aantal, v_nieuwe_waarde,
      CASE WHEN v_nieuw_aantal > 0
           THEN round(v_nieuwe_waarde::numeric / v_nieuw_aantal)::int
           ELSE v_kostprijs END
    )
    ON CONFLICT (sku) DO UPDATE
      SET aantal = excluded.aantal,
          waarde_cent = excluded.waarde_cent,
          gem_kostprijs_cent = excluded.gem_kostprijs_cent,
          updated_at = now();

  ELSIF NEW.to_location_id IS NULL THEN
    /* ── Uitstroom ──────────────────────────────────────────────────────── */
    v_kostprijs := coalesce(
      v_huidig.gem_kostprijs_cent,
      (SELECT kostprijs_cent FROM wms.kostprijs_actueel WHERE sku = NEW.sku),
      0
    );

    NEW.kostprijs_cent := v_kostprijs;
    NEW.waarde_cent := v_kostprijs::bigint * NEW.qty;

    v_nieuw_aantal := greatest(coalesce(v_huidig.aantal, 0) - NEW.qty, 0);
    /* Nooit onder nul: bij een afrondingsrest gaat de laatste cent mee met het
       laatste stuk. Anders blijft er een waarde staan zonder voorraad. */
    v_nieuwe_waarde := CASE
      WHEN v_nieuw_aantal = 0 THEN 0
      ELSE greatest(coalesce(v_huidig.waarde_cent, 0) - NEW.waarde_cent, 0)
    END;

    INSERT INTO wms.artikel_waarde (sku, aantal, waarde_cent, gem_kostprijs_cent)
    VALUES (NEW.sku, v_nieuw_aantal, v_nieuwe_waarde, v_kostprijs)
    ON CONFLICT (sku) DO UPDATE
      SET aantal = excluded.aantal,
          waarde_cent = excluded.waarde_cent,
          updated_at = now();

  ELSE
    /* ── Intern: alleen een andere plek, geen waardemutatie. ─────────────── */
    NEW.kostprijs_cent := coalesce(v_huidig.gem_kostprijs_cent, 0);
    NEW.waarde_cent := 0;
  END IF;

  RETURN NEW;
END;
$$
--;;
DROP TRIGGER IF EXISTS trg_waardeer_stock_move ON wms.stock_moves
--;;
CREATE TRIGGER trg_waardeer_stock_move
  BEFORE INSERT ON wms.stock_moves
  FOR EACH ROW EXECUTE FUNCTION wms.waardeer_stock_move()
--;;

-- ── Grootboekboekingen ──────────────────────────────────────────────────────
-- Wat er naar Exact moet. Eén rij per journaalpost-regel, dubbel boekhouden:
-- per gebeurtenis staat er debet en credit voor hetzelfde bedrag, dus de som
-- van alle regels is nul. Dat is de tweede sluitcontrole, naast de voorraad.
--
-- Wordt niet automatisch doorgeschoten: de regels worden klaargezet en pas
-- verstuurd als iemand de periode afsluit. Een magazijnmedewerker hoort niet
-- rechtstreeks in het grootboek te boeken.
CREATE TABLE IF NOT EXISTS wms.grootboek_regels (
  id            bigserial PRIMARY KEY,
  move_id       bigint REFERENCES wms.stock_moves (id),
  soort         text NOT NULL,
  jaar          integer NOT NULL,
  maand         integer NOT NULL,
  grootboek     text NOT NULL,
  omschrijving  text,
  debet_cent    bigint NOT NULL DEFAULT 0,
  credit_cent   bigint NOT NULL DEFAULT 0,
  sku           text,
  ref_type      text,
  ref_id        text,
  status        text NOT NULL DEFAULT 'klaar',
  exact_ref     text,
  verstuurd_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gb_bedrag_chk CHECK (
    debet_cent >= 0 AND credit_cent >= 0 AND (debet_cent = 0) <> (credit_cent = 0)
  ),
  CONSTRAINT gb_status_chk CHECK (status IN ('klaar', 'verstuurd', 'mislukt'))
)
--;;
CREATE INDEX IF NOT EXISTS idx_gb_periode ON wms.grootboek_regels (jaar, maand, status)
--;;
CREATE INDEX IF NOT EXISTS idx_gb_move ON wms.grootboek_regels (move_id)
--;;

-- Maakt de journaalpost bij een gewaardeerde mutatie. Alleen instroom en
-- uitstroom raken het grootboek; een interne verplaatsing verandert geen waarde
-- en hoort dus ook geen post op te leveren.
--
-- De rekeningnummers komen uit wms.settings, zodat ze zonder deploy aangepast
-- kunnen worden als het rekeningschema wijzigt.
CREATE OR REPLACE FUNCTION wms.boek_grootboek() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_voorraad   text;
  v_tegen      text;
  v_soort      text;
  v_omschrijving text;
  v_jaar       integer := extract(year FROM NEW.created_at)::int;
  v_maand      integer := extract(month FROM NEW.created_at)::int;
BEGIN
  IF NEW.waarde_cent IS NULL OR NEW.waarde_cent = 0 THEN
    RETURN NEW;
  END IF;

  SELECT trim(both '"' FROM value::text) INTO v_voorraad
    FROM wms.settings WHERE key = 'financieel.gl_voorraad';
  IF v_voorraad IS NULL OR v_voorraad = '' THEN
    /* Geen rekeningschema ingesteld: niets klaarzetten. De waardering staat
       er wel, dus later alsnog genereren kan. */
    RETURN NEW;
  END IF;

  IF NEW.from_location_id IS NULL THEN
    v_soort := 'ontvangst';
    v_omschrijving := 'Voorraad ontvangen';
    SELECT trim(both '"' FROM value::text) INTO v_tegen
      FROM wms.settings WHERE key = 'financieel.gl_te_ontvangen';
  ELSE
    IF NEW.reason IN ('afschrijving') THEN
      v_soort := 'afschrijving';
      v_omschrijving := 'Voorraad afgeschreven';
      SELECT trim(both '"' FROM value::text) INTO v_tegen
        FROM wms.settings WHERE key = 'financieel.gl_voorraadverschil';
    ELSIF NEW.reason IN ('telling', 'correctie') THEN
      v_soort := 'voorraadverschil';
      v_omschrijving := 'Voorraadverschil bij telling';
      SELECT trim(both '"' FROM value::text) INTO v_tegen
        FROM wms.settings WHERE key = 'financieel.gl_voorraadverschil';
    ELSE
      v_soort := 'uitgifte';
      v_omschrijving := 'Kostprijs verkopen';
      SELECT trim(both '"' FROM value::text) INTO v_tegen
        FROM wms.settings WHERE key = 'financieel.gl_kostprijs_verkopen';
    END IF;
  END IF;

  IF v_tegen IS NULL OR v_tegen = '' THEN
    RETURN NEW;
  END IF;

  IF NEW.from_location_id IS NULL THEN
    /* Instroom: voorraad debet, tegenrekening credit. */
    INSERT INTO wms.grootboek_regels
      (move_id, soort, jaar, maand, grootboek, omschrijving, debet_cent, sku, ref_type, ref_id)
    VALUES (NEW.id, v_soort, v_jaar, v_maand, v_voorraad, v_omschrijving,
            NEW.waarde_cent, NEW.sku, NEW.ref_type, NEW.ref_id);
    INSERT INTO wms.grootboek_regels
      (move_id, soort, jaar, maand, grootboek, omschrijving, credit_cent, sku, ref_type, ref_id)
    VALUES (NEW.id, v_soort, v_jaar, v_maand, v_tegen, v_omschrijving,
            NEW.waarde_cent, NEW.sku, NEW.ref_type, NEW.ref_id);
  ELSE
    /* Uitstroom: tegenrekening debet (kosten), voorraad credit. */
    INSERT INTO wms.grootboek_regels
      (move_id, soort, jaar, maand, grootboek, omschrijving, debet_cent, sku, ref_type, ref_id)
    VALUES (NEW.id, v_soort, v_jaar, v_maand, v_tegen, v_omschrijving,
            NEW.waarde_cent, NEW.sku, NEW.ref_type, NEW.ref_id);
    INSERT INTO wms.grootboek_regels
      (move_id, soort, jaar, maand, grootboek, omschrijving, credit_cent, sku, ref_type, ref_id)
    VALUES (NEW.id, v_soort, v_jaar, v_maand, v_voorraad, v_omschrijving,
            NEW.waarde_cent, NEW.sku, NEW.ref_type, NEW.ref_id);
  END IF;

  RETURN NEW;
END;
$$
--;;
-- Beide namen droppen: de trigger heette eerst trg_boek_grootboek en is
-- hernoemd zodat hij alfabetisch ná trg_apply_stock_move valt.
DROP TRIGGER IF EXISTS trg_boek_grootboek ON wms.stock_moves
--;;
DROP TRIGGER IF EXISTS trg_z_boek_grootboek ON wms.stock_moves
--;;
-- Na de saldotrigger, want die kan de boeking nog weigeren (niet-negatief).
-- Alfabetisch valt 'trg_z_boek…' achter 'trg_apply…', en Postgres vuurt
-- triggers met dezelfde timing op naam-volgorde.
CREATE TRIGGER trg_z_boek_grootboek
  AFTER INSERT ON wms.stock_moves
  FOR EACH ROW EXECUTE FUNCTION wms.boek_grootboek()
--;;

-- ── Sluitcontroles ──────────────────────────────────────────────────────────
-- De kern: som van waarde in min waarde uit hoort exact gelijk te zijn aan de
-- voorraadwaarde die we bijhouden. Wijkt dat af, dan is er iets buiten de
-- trigger om gebeurd en klopt de administratie niet meer.
CREATE OR REPLACE VIEW wms.waarde_sluitcontrole AS
SELECT
  (SELECT coalesce(sum(waarde_cent), 0) FROM wms.stock_moves
    WHERE from_location_id IS NULL)                       AS waarde_in_cent,
  (SELECT coalesce(sum(waarde_cent), 0) FROM wms.stock_moves
    WHERE to_location_id IS NULL)                         AS waarde_uit_cent,
  (SELECT coalesce(sum(waarde_cent), 0) FROM wms.artikel_waarde) AS waarde_op_voorraad_cent,
  (SELECT coalesce(sum(waarde_cent), 0) FROM wms.stock_moves WHERE from_location_id IS NULL)
  - (SELECT coalesce(sum(waarde_cent), 0) FROM wms.stock_moves WHERE to_location_id IS NULL)
  - (SELECT coalesce(sum(waarde_cent), 0) FROM wms.artikel_waarde) AS verschil_cent
--;;

-- Loopt het grootboek in balans? Debet min credit hoort nul te zijn, altijd.
CREATE OR REPLACE VIEW wms.grootboek_balans AS
SELECT jaar, maand,
       sum(debet_cent)  AS debet_cent,
       sum(credit_cent) AS credit_cent,
       sum(debet_cent) - sum(credit_cent) AS verschil_cent,
       count(*)::int    AS regels,
       count(*) FILTER (WHERE status = 'verstuurd')::int AS verstuurd
  FROM wms.grootboek_regels
 GROUP BY jaar, maand
--;;

-- Voorraadwaarde per zone — voor de balans én om te zien waar het geld ligt.
CREATE OR REPLACE VIEW wms.waarde_per_zone AS
SELECT coalesce(l.zone, 'zonder zone') AS zone,
       count(DISTINCT s.sku)::int      AS skus,
       sum(s.qty)::int                 AS stuks,
       sum(s.qty::bigint * coalesce(w.gem_kostprijs_cent, 0)) AS waarde_cent
  FROM wms.stock_levels s
  JOIN wms.locations l ON l.id = s.location_id
  LEFT JOIN wms.artikel_waarde w ON w.sku = s.sku
 WHERE s.qty > 0
 GROUP BY coalesce(l.zone, 'zonder zone')
--;;

-- Voorraad zonder kostprijs: elk artikel hier is een gat in de waardering.
CREATE OR REPLACE VIEW wms.waarde_ontbreekt AS
SELECT s.sku,
       sum(s.qty)::int AS stuks,
       count(DISTINCT s.location_id)::int AS locaties
  FROM wms.stock_levels s
  LEFT JOIN wms.artikel_waarde w ON w.sku = s.sku
 WHERE s.qty > 0
   AND (w.sku IS NULL OR w.gem_kostprijs_cent = 0)
 GROUP BY s.sku
--;;

-- ── Slotting: omloopsnelheid per artikel ────────────────────────────────────
-- ABC-indeling op basis van hoe vaak er gepikt is. A = hardlopers, die horen
-- vooraan bij de expeditie te liggen; C = stilstaanders, die mogen achterin.
-- Dit is de basis onder slotting-advies en onder de telfrequentie.
CREATE OR REPLACE VIEW wms.artikel_klasse AS
WITH picks AS (
  SELECT sku, count(*)::int AS keer, sum(qty)::int AS stuks
    FROM wms.stock_moves
   WHERE reason = 'pick' AND created_at > now() - interval '90 days'
   GROUP BY sku
), gerangschikt AS (
  SELECT sku, keer, stuks,
         sum(stuks) OVER (ORDER BY stuks DESC, sku)::numeric
           / nullif(sum(stuks) OVER (), 0) AS cumulatief
    FROM picks
)
SELECT sku, keer, stuks,
       round(cumulatief * 100, 1) AS cumulatief_pct,
       CASE WHEN cumulatief <= 0.8 THEN 'A'
            WHEN cumulatief <= 0.95 THEN 'B'
            ELSE 'C' END AS klasse
  FROM gerangschikt
--;;
