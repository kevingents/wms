-- ═══════════════════════════════════════════════════════════════════════════
-- GENTS WMS — deel 4: de laatste laag
--
-- Colli en cross-docking, labels, koppelingen naar buiten (Exact, vervoerder),
-- en bewaking. Dit is de laag die het systeem van "werkt" naar "draait vanzelf"
-- brengt.
--
-- Statements gescheiden door `--;;`. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Colli (LPN) ─────────────────────────────────────────────────────────────
-- Een collo is een fysieke drager: een doos, pallet of rolcontainer met een
-- eigen label. Grote WMS'en noemen dit een License Plate Number.
--
-- Waarom dit helpt: bij ontvangst scan je één label in plaats van veertig
-- artikelen, en je weet nog steeds wat erin zit. En bij inslag verplaats je de
-- hele pallet in één handeling naar een vak, in plaats van stuk voor stuk.
--
-- De inhoud is een momentopname bij het aanmaken; de waarheid over voorraad
-- blijft het grootboek. Een collo is een hulpmiddel voor de handeling, geen
-- tweede voorraadadministratie.
CREATE TABLE IF NOT EXISTS wms.colli (
  id            bigserial PRIMARY KEY,
  code          text NOT NULL UNIQUE,
  soort         text NOT NULL DEFAULT 'doos',
  status        text NOT NULL DEFAULT 'open',
  locatie_id    bigint REFERENCES wms.locations (id),
  ontvangst_id  bigint REFERENCES wms.ontvangsten (id) ON DELETE SET NULL,
  zending_id    bigint REFERENCES wms.zendingen (id) ON DELETE SET NULL,
  aangemaakt_door text,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  gesloten_at   timestamptz,
  CONSTRAINT collo_soort_chk CHECK (soort IN ('doos', 'pallet', 'rolcontainer', 'zak')),
  CONSTRAINT collo_status_chk CHECK (status IN ('open', 'gesloten', 'verwerkt', 'vervallen'))
)
--;;
CREATE INDEX IF NOT EXISTS idx_colli_open
  ON wms.colli (created_at) WHERE status IN ('open', 'gesloten')
--;;
CREATE TABLE IF NOT EXISTS wms.collo_regels (
  id         bigserial PRIMARY KEY,
  collo_id   bigint NOT NULL REFERENCES wms.colli (id) ON DELETE CASCADE,
  sku        text NOT NULL,
  aantal     integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (collo_id, sku),
  CONSTRAINT collo_regel_aantal_chk CHECK (aantal > 0)
)
--;;
CREATE SEQUENCE IF NOT EXISTS wms.collo_nummer START 1
--;;

-- ── Cross-docking ───────────────────────────────────────────────────────────
-- Binnengekomen goederen die meteen weer weg moeten, zonder de omweg via een
-- schaplocatie. Scheelt twee handelingen per stuk: geen inslag, geen pick.
--
-- Het WMS bepaalt dit niet zelf — het kijkt of er open pickregels op wachten.
-- Ligt er vraag, dan is cross-docken de snelste route; ligt die er niet, dan
-- hoort het gewoon het schap in.
CREATE OR REPLACE VIEW wms.crossdock_kansen AS
SELECT r.id                AS ontvangst_regel_id,
       r.ontvangst_id,
       o.code              AS ontvangst_code,
       r.sku,
       r.verwacht,
       r.ontvangen,
       coalesce(sum(l.gevraagd - l.gepikt), 0)::int AS gevraagd_open,
       count(DISTINCT l.pick_order_id)::int         AS opdrachten
  FROM wms.ontvangst_regels r
  JOIN wms.ontvangsten o ON o.id = r.ontvangst_id
  JOIN wms.pick_lines l ON l.sku = r.sku AND l.status = 'open'
 WHERE o.status IN ('verwacht', 'bezig')
 GROUP BY r.id, r.ontvangst_id, o.code, r.sku, r.verwacht, r.ontvangen
HAVING sum(l.gevraagd - l.gepikt) > 0
--;;

-- ── Labels ──────────────────────────────────────────────────────────────────
-- Zonder geprinte locatielabels werkt het scannen niet. Dat klinkt triviaal en
-- is het niet: de hele flow gaat ervan uit dat een medewerker een vak kan
-- scannen, en dat kan alleen als daar een barcode op zit.
--
-- We bewaren wat er geprint is, zodat je kunt zien welke vakken nog geen label
-- hebben gehad — en zodat herprinten na een verhuizing te volgen is.
CREATE TABLE IF NOT EXISTS wms.label_prints (
  id           bigserial PRIMARY KEY,
  soort        text NOT NULL,
  object_id    text NOT NULL,
  aantal       integer NOT NULL DEFAULT 1,
  formaat      text,
  geprint_door text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT label_soort_chk CHECK (soort IN ('locatie', 'artikel', 'collo', 'zending'))
)
--;;
CREATE INDEX IF NOT EXISTS idx_label_object
  ON wms.label_prints (soort, object_id, created_at DESC)
--;;

-- Welke actieve locaties hebben nog nooit een label gehad?
CREATE OR REPLACE VIEW wms.locaties_zonder_label AS
SELECT l.id, l.code, l.zone, l.kind, l.sort_order
  FROM wms.locations l
  LEFT JOIN wms.label_prints p
         ON p.soort = 'locatie' AND p.object_id = l.code
 WHERE l.active AND p.id IS NULL
--;;

-- ── Koppelingen naar buiten ─────────────────────────────────────────────────
-- Eén tabel voor de stand van externe koppelingen: wat is er verstuurd, wat
-- ging mis, en wanneer. Exact, de vervoerder en wat er later bijkomt gebruiken
-- dezelfde vorm, want het probleem is elke keer hetzelfde.
CREATE TABLE IF NOT EXISTS wms.externe_calls (
  id           bigserial PRIMARY KEY,
  systeem      text NOT NULL,
  actie        text NOT NULL,
  ref_type     text,
  ref_id       text,
  verzoek      jsonb,
  antwoord     jsonb,
  status       text NOT NULL DEFAULT 'wachtend',
  pogingen     integer NOT NULL DEFAULT 0,
  fout         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  afgerond_at  timestamptz,
  CONSTRAINT externe_status_chk CHECK (
    status IN ('wachtend', 'gelukt', 'mislukt', 'overgeslagen')
  )
)
--;;
CREATE INDEX IF NOT EXISTS idx_externe_wachtend
  ON wms.externe_calls (systeem, created_at) WHERE status = 'wachtend'
--;;
CREATE INDEX IF NOT EXISTS idx_externe_ref
  ON wms.externe_calls (ref_type, ref_id)
--;;

-- Vervoerder-gegevens op de zending. Bewust losse kolommen en geen jsonb:
-- hierop wordt gezocht ("waar is pakket X"), en dat moet snel zijn.
ALTER TABLE wms.zendingen ADD COLUMN IF NOT EXISTS vervoerder_zending_id text
--;;
ALTER TABLE wms.zendingen ADD COLUMN IF NOT EXISTS label_formaat text
--;;
ALTER TABLE wms.zendingen ADD COLUMN IF NOT EXISTS afleveradres jsonb
--;;
CREATE INDEX IF NOT EXISTS idx_zendingen_tracking
  ON wms.zendingen (tracking) WHERE tracking IS NOT NULL
--;;

-- Doorschiet-status van journaalposten naar de boekhouding.
ALTER TABLE wms.grootboek_regels ADD COLUMN IF NOT EXISTS batch_id text
--;;
CREATE INDEX IF NOT EXISTS idx_gb_batch ON wms.grootboek_regels (batch_id)
--;;

-- ── Bewaking ────────────────────────────────────────────────────────────────
-- Signalen die iemand moet zien. Niet elk probleem is een foutmelding: werk dat
-- blijft liggen, een sluitcontrole die wegloopt of een telverschil boven de
-- drempel zijn geen crashes maar wel dingen die opgelost moeten worden.
CREATE TABLE IF NOT EXISTS wms.signalen (
  id           bigserial PRIMARY KEY,
  soort        text NOT NULL,
  ernst        text NOT NULL DEFAULT 'let_op',
  titel        text NOT NULL,
  toelichting  text,
  ref_type     text,
  ref_id       text,
  waarde       numeric,
  status       text NOT NULL DEFAULT 'open',
  afgehandeld_door text,
  afgehandeld_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT signaal_ernst_chk CHECK (ernst IN ('info', 'let_op', 'urgent')),
  CONSTRAINT signaal_status_chk CHECK (status IN ('open', 'afgehandeld', 'genegeerd'))
)
--;;
CREATE INDEX IF NOT EXISTS idx_signalen_open
  ON wms.signalen (ernst DESC, created_at DESC) WHERE status = 'open'
--;;
-- Eén open signaal per (soort, ref): anders staat er morgen dertig keer
-- hetzelfde en kijkt niemand er meer naar.
CREATE UNIQUE INDEX IF NOT EXISTS idx_signalen_uniek
  ON wms.signalen (soort, coalesce(ref_type, ''), coalesce(ref_id, ''))
  WHERE status = 'open'
--;;

-- ── Gebruikers ──────────────────────────────────────────────────────────────
-- Rollen stonden in wms.settings onder één sleutel. Dat werkt tot je wilt weten
-- wie wanneer welke rol kreeg, en dat wil je bij toegangsrechten altijd.
CREATE TABLE IF NOT EXISTS wms.gebruikers (
  personnel_id text PRIMARY KEY,
  naam         text,
  rol          text NOT NULL DEFAULT 'magazijn',
  actief       boolean NOT NULL DEFAULT true,
  laatste_login timestamptz,
  toegevoegd_door text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gebruiker_rol_chk CHECK (rol IN ('magazijn', 'teamleider', 'beheer'))
)
--;;
CREATE INDEX IF NOT EXISTS idx_gebruikers_actief ON wms.gebruikers (rol) WHERE actief
--;;
