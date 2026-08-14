-- ═══════════════════════════════════════════════════════════════════════════
-- GENTS WMS — deel 2: de rest van de goederenstroom
--
-- db/schema.sql legt het fundament (locaties, grootboek, picken, koppeling).
-- Dit bestand maakt de keten dicht: ontvangst, inpakken, verzenden, retouren,
-- een generieke takenwachtrij, cyclustellingen en meetbaarheid.
--
-- Alles hangt aan hetzelfde grootboek. Er is geen enkele tabel hier die zelf
-- voorraad bijhoudt — iedere beweging is een rij in wms.stock_moves, en deze
-- tabellen bewaren alleen het wérkproces eromheen. Dat is met opzet: zodra twee
-- tabellen allebei "de voorraad" bijhouden, gaan ze uit elkaar lopen.
--
-- Statements gescheiden door `--;;`. Idempotent; mag herhaald draaien.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Ontvangst ───────────────────────────────────────────────────────────────
-- Goederenontvangst tegen een verwachting. Zonder verwachting is ontvangen
-- hetzelfde als tellen: je boekt wat je ziet en niemand merkt dat de leverancier
-- veertig stuks stuurde waar er vijftig besteld waren. Dáár lekt geld weg.
--
-- De verwachting komt uit de portal (inkooporder) of uit SRS, via dezelfde deur
-- als het pickwerk. Handmatig aanmaken kan ook — een leverancier die onaangekondigd
-- voor de deur staat is geen uitzondering.
CREATE TABLE IF NOT EXISTS wms.ontvangsten (
  id              bigserial PRIMARY KEY,
  code            text NOT NULL UNIQUE,
  bron            text NOT NULL DEFAULT 'handmatig',
  bron_ref        text,
  leverancier     text,
  referentie      text,
  status          text NOT NULL DEFAULT 'verwacht',
  verwacht_op     date,
  aangemaakt_door text,
  gestart_door    text,
  gestart_at      timestamptz,
  afgerond_at     timestamptz,
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bron, bron_ref),
  CONSTRAINT ontvangst_bron_chk CHECK (
    bron IN ('inkoop', 'leverancier', 'winkel', 'retour', 'handmatig')
  ),
  CONSTRAINT ontvangst_status_chk CHECK (
    status IN ('verwacht', 'bezig', 'afgerond', 'geannuleerd')
  )
)
--;;
CREATE INDEX IF NOT EXISTS idx_ontvangsten_open
  ON wms.ontvangsten (verwacht_op, created_at) WHERE status IN ('verwacht', 'bezig')
--;;

-- `verwacht` mag 0 zijn: iets ontvangen dat niet besteld was is een geldige
-- uitkomst en moet zichtbaar blijven, niet weggemoffeld worden.
CREATE TABLE IF NOT EXISTS wms.ontvangst_regels (
  id            bigserial PRIMARY KEY,
  ontvangst_id  bigint NOT NULL REFERENCES wms.ontvangsten (id) ON DELETE CASCADE,
  sku           text NOT NULL,
  verwacht      integer NOT NULL DEFAULT 0,
  ontvangen     integer NOT NULL DEFAULT 0,
  afgekeurd     integer NOT NULL DEFAULT 0,
  locatie_id    bigint REFERENCES wms.locations (id),
  reden_afkeur  text,
  move_id       bigint REFERENCES wms.stock_moves (id),
  afkeur_move_id bigint REFERENCES wms.stock_moves (id),
  status        text NOT NULL DEFAULT 'open',
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  afgerond_at   timestamptz,
  UNIQUE (ontvangst_id, sku),
  CONSTRAINT ontvangst_regel_aantal_chk CHECK (
    verwacht >= 0 AND ontvangen >= 0 AND afgekeurd >= 0 AND afgekeurd <= ontvangen
  ),
  CONSTRAINT ontvangst_regel_status_chk CHECK (
    status IN ('open', 'ontvangen', 'afwijking', 'overgeslagen')
  )
)
--;;
CREATE INDEX IF NOT EXISTS idx_ontvangst_regels_open
  ON wms.ontvangst_regels (ontvangst_id) WHERE status = 'open'
--;;
CREATE SEQUENCE IF NOT EXISTS wms.ontvangst_nummer START 1
--;;

-- ── Inpakken en verzenden ───────────────────────────────────────────────────
-- Een zending is één fysieke doos die het pand verlaat. Eén pickopdracht kan
-- meer dozen opleveren (te groot, te zwaar) en dat moet het model aankunnen —
-- anders gaat de tweede doos buiten het systeem om en klopt de tracking niet.
CREATE TABLE IF NOT EXISTS wms.doos_types (
  code            text PRIMARY KEY,
  naam            text NOT NULL,
  lengte_mm       integer,
  breedte_mm      integer,
  hoogte_mm       integer,
  max_gewicht_g   integer,
  tarra_gram      integer NOT NULL DEFAULT 0,
  actief          boolean NOT NULL DEFAULT true,
  sort_order      integer NOT NULL DEFAULT 0
)
--;;
INSERT INTO wms.doos_types (code, naam, lengte_mm, breedte_mm, hoogte_mm, max_gewicht_g, tarra_gram, sort_order)
VALUES ('S',  'Klein — 1 artikel',      300, 200, 100, 10000, 150, 10),
       ('M',  'Middel — 2-4 artikelen', 400, 300, 200, 20000, 280, 20),
       ('L',  'Groot — 5+ artikelen',   600, 400, 300, 30000, 450, 30),
       ('PAK','Pakzak / envelop',       350, 250,  50,  5000,  40, 5)
ON CONFLICT (code) DO NOTHING
--;;

CREATE TABLE IF NOT EXISTS wms.zendingen (
  id             bigserial PRIMARY KEY,
  code           text NOT NULL UNIQUE,
  pick_order_id  bigint REFERENCES wms.pick_orders (id) ON DELETE SET NULL,
  bestemming     text,
  status         text NOT NULL DEFAULT 'open',
  doos_type      text REFERENCES wms.doos_types (code),
  gewicht_gram   integer,
  vervoerder     text,
  tracking       text,
  label_url      text,
  ingepakt_door  text,
  ingepakt_naam  text,
  ingepakt_at    timestamptz,
  verzonden_at   timestamptz,
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT zending_status_chk CHECK (
    status IN ('open', 'ingepakt', 'verzonden', 'geannuleerd')
  ),
  CONSTRAINT zending_gewicht_chk CHECK (gewicht_gram IS NULL OR gewicht_gram >= 0)
)
--;;
CREATE INDEX IF NOT EXISTS idx_zendingen_open
  ON wms.zendingen (created_at) WHERE status IN ('open', 'ingepakt')
--;;
CREATE INDEX IF NOT EXISTS idx_zendingen_order ON wms.zendingen (pick_order_id)
--;;
CREATE TABLE IF NOT EXISTS wms.zending_regels (
  id          bigserial PRIMARY KEY,
  zending_id  bigint NOT NULL REFERENCES wms.zendingen (id) ON DELETE CASCADE,
  sku         text NOT NULL,
  aantal      integer NOT NULL,
  gecontroleerd boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (zending_id, sku),
  CONSTRAINT zending_regel_aantal_chk CHECK (aantal > 0)
)
--;;
CREATE SEQUENCE IF NOT EXISTS wms.zending_nummer START 1
--;;

-- ── Retouren ────────────────────────────────────────────────────────────────
-- In mode komt een groot deel terug. Een retour is pas afgehandeld als er een
-- oordeel is: terug de verkoop in, naar herstel, of afgekeurd. Zonder dat
-- oordeel groeit er een stapel die niemand durft weg te boeken.
CREATE TABLE IF NOT EXISTS wms.retouren (
  id             bigserial PRIMARY KEY,
  code           text NOT NULL UNIQUE,
  bron           text NOT NULL DEFAULT 'webshop',
  bron_ref       text,
  klant          text,
  status         text NOT NULL DEFAULT 'open',
  ontvangen_door text,
  ontvangen_at   timestamptz,
  afgehandeld_at timestamptz,
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT retour_bron_chk CHECK (bron IN ('webshop', 'winkel', 'leverancier', 'handmatig')),
  CONSTRAINT retour_status_chk CHECK (status IN ('open', 'bezig', 'afgehandeld', 'geannuleerd'))
)
--;;
CREATE TABLE IF NOT EXISTS wms.retour_regels (
  id          bigserial PRIMARY KEY,
  retour_id   bigint NOT NULL REFERENCES wms.retouren (id) ON DELETE CASCADE,
  sku         text NOT NULL,
  aantal      integer NOT NULL,
  oordeel     text,
  locatie_id  bigint REFERENCES wms.locations (id),
  move_id     bigint REFERENCES wms.stock_moves (id),
  reden       text,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  afgerond_at timestamptz,
  CONSTRAINT retour_regel_aantal_chk CHECK (aantal > 0),
  CONSTRAINT retour_oordeel_chk CHECK (
    oordeel IS NULL OR oordeel IN ('verkoopbaar', 'herstel', 'afkeur')
  )
)
--;;
CREATE INDEX IF NOT EXISTS idx_retour_regels_open
  ON wms.retour_regels (retour_id) WHERE oordeel IS NULL
--;;
CREATE SEQUENCE IF NOT EXISTS wms.retour_nummer START 1
--;;

-- Vaste bestemmingen voor retour- en afkeurstromen.
INSERT INTO wms.locations (code, name, zone, kind, sort_order, pickable, note)
VALUES ('RETOUR',      'Retourbalie',        'RETOUR', 'inbound',    1, false,
        'Binnengekomen retouren, nog niet beoordeeld.'),
       ('HERSTEL',     'Herstel / vermaak',  'RETOUR', 'quarantine', 2, false,
        'Wacht op reparatie of reiniging.'),
       ('AFKEUR',      'Afkeur',             'RETOUR', 'quarantine', 3, false,
        'Niet meer verkoopbaar; wacht op afschrijving.'),
       ('QUARANTAINE', 'Quarantaine',        'QC',     'quarantine', 4, false,
        'Ontvangst met een probleem; wacht op beoordeling.')
ON CONFLICT (code) DO NOTHING
--;;

-- ── Taken: de generieke werkwachtrij ────────────────────────────────────────
-- Wat een WMS onderscheidt van een voorraadlijst is dat het wérk uitdeelt. Een
-- taak is één opdracht aan één persoon: haal dit daar weg en zet het daar neer,
-- of tel dit vak. Replenishment, cyclustellingen en opruimwerk zijn allemaal
-- dezelfde vorm; één tabel is genoeg en voorkomt drie half-af wachtrijen.
CREATE TABLE IF NOT EXISTS wms.taken (
  id              bigserial PRIMARY KEY,
  soort           text NOT NULL,
  sku             text,
  van_locatie_id  bigint REFERENCES wms.locations (id),
  naar_locatie_id bigint REFERENCES wms.locations (id),
  aantal          integer,
  prioriteit      integer NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'open',
  reden           text,
  ref_type        text,
  ref_id          text,
  toegewezen_aan  text,
  toegewezen_naam text,
  aangemaakt_door text,
  move_id         bigint REFERENCES wms.stock_moves (id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  started_at      timestamptz,
  finished_at     timestamptz,
  CONSTRAINT taak_soort_chk CHECK (
    soort IN ('replenishment', 'telling', 'opruimen', 'controle', 'verplaatsing')
  ),
  CONSTRAINT taak_status_chk CHECK (
    status IN ('open', 'bezig', 'klaar', 'geannuleerd')
  )
)
--;;
CREATE INDEX IF NOT EXISTS idx_taken_werkvoorraad
  ON wms.taken (prioriteit DESC, created_at) WHERE status IN ('open', 'bezig')
--;;
-- Eén open replenishment-taak per (sku, doellocatie): anders maakt de generator
-- elke minuut een nieuwe en staat de picker straks voor een lege stelling met
-- twintig identieke taken.
CREATE UNIQUE INDEX IF NOT EXISTS idx_taken_replen_uniek
  ON wms.taken (soort, sku, naar_locatie_id)
  WHERE status IN ('open', 'bezig') AND soort = 'replenishment'
--;;

-- ── Replenishment: min/max op piklocaties ───────────────────────────────────
-- Een piklocatie met een vast artikel en een min/max is wat bulk-naar-pick
-- aanvulling mogelijk maakt: zakt de voorraad onder het minimum, dan ontstaat er
-- werk om bij te vullen tot het maximum — vóórdat de picker voor een leeg vak
-- staat, niet erna.
ALTER TABLE wms.locations ADD COLUMN IF NOT EXISTS vaste_sku text
--;;
ALTER TABLE wms.locations ADD COLUMN IF NOT EXISTS min_voorraad integer
--;;
ALTER TABLE wms.locations ADD COLUMN IF NOT EXISTS max_voorraad integer
--;;
ALTER TABLE wms.locations DROP CONSTRAINT IF EXISTS locations_minmax_chk
--;;
ALTER TABLE wms.locations ADD CONSTRAINT locations_minmax_chk CHECK (
  min_voorraad IS NULL OR max_voorraad IS NULL OR min_voorraad <= max_voorraad
)
--;;
CREATE INDEX IF NOT EXISTS idx_locations_vast
  ON wms.locations (vaste_sku) WHERE vaste_sku IS NOT NULL AND active
--;;

-- Wat moet er bijgevuld worden, en kan dat? Bulk is alles wat niet de
-- piklocatie zelf is; expeditie en quarantaine tellen niet mee als bron.
CREATE OR REPLACE VIEW wms.replen_advies AS
SELECT l.id                              AS pick_locatie_id,
       l.code                            AS pick_locatie,
       l.vaste_sku                       AS sku,
       l.min_voorraad,
       l.max_voorraad,
       coalesce(s.qty, 0)                AS aanwezig,
       greatest(coalesce(l.max_voorraad, 0) - coalesce(s.qty, 0), 0) AS tekort,
       coalesce(b.bulk_vrij, 0)          AS bulk_vrij,
       least(
         greatest(coalesce(l.max_voorraad, 0) - coalesce(s.qty, 0), 0),
         coalesce(b.bulk_vrij, 0)
       )                                 AS aan_te_vullen
  FROM wms.locations l
  LEFT JOIN wms.stock_levels s
         ON s.location_id = l.id AND s.sku = l.vaste_sku
  LEFT JOIN (
    SELECT v.sku, sum(v.vrij)::int AS bulk_vrij
      FROM wms.vrije_voorraad v
     WHERE v.vrij > 0 AND v.kind NOT IN ('outbound', 'quarantine')
     GROUP BY v.sku
  ) b ON b.sku = l.vaste_sku
 WHERE l.active
   AND l.vaste_sku IS NOT NULL
   AND l.min_voorraad IS NOT NULL
   AND coalesce(s.qty, 0) <= l.min_voorraad
--;;

-- ── Cyclustellingen: welk vak is aan de beurt? ──────────────────────────────
-- Niet alles even vaak tellen. Vakken met veel omloop lopen sneller uit de pas,
-- dus die verdienen vaker een beurt dan een bulkvak waar in maanden niets
-- gebeurde. `score` weegt ouderdom tegen beweging; hoog = eerst tellen.
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
       t.laatst_geteld,
       coalesce(
         extract(day FROM now() - t.laatst_geteld)::int,
         999
       )                                     AS dagen_geleden,
       /* Ouderdom telt lineair, beweging als vermenigvuldiger. Een druk vak dat
          een maand niet geteld is scoort hoger dan een stil vak van een jaar. */
       (least(coalesce(extract(day FROM now() - t.laatst_geteld)::int, 999), 365)
        * (1 + coalesce(b.mutaties, 0)))::int AS score
  FROM wms.locations l
  LEFT JOIN wms.stock_levels s ON s.location_id = l.id AND s.qty > 0
  LEFT JOIN beweging b ON b.location_id = l.id
  LEFT JOIN laatst t ON t.location_id = l.id
 WHERE l.active AND l.kind NOT IN ('virtual', 'outbound')
 GROUP BY l.id, l.code, l.zone, l.sort_order, b.mutaties, t.laatst_geteld
--;;

-- ── Meten ───────────────────────────────────────────────────────────────────
-- Productiviteit per medewerker per dag. Uit het grootboek, niet uit een aparte
-- registratie — wat geboekt is, is gedaan.
CREATE OR REPLACE VIEW wms.productiviteit AS
SELECT (m.created_at AT TIME ZONE 'Europe/Amsterdam')::date AS dag,
       coalesce(m.actor_naam_norm, 'onbekend')              AS medewerker,
       m.reason                                             AS soort,
       count(*)::int                                        AS boekingen,
       sum(m.qty)::int                                      AS stuks,
       min(m.created_at)                                    AS eerste,
       max(m.created_at)                                    AS laatste
  FROM (
    SELECT created_at, reason, qty, nullif(trim(actor_name), '') AS actor_naam_norm
      FROM wms.stock_moves
  ) m
 GROUP BY 1, 2, 3
--;;

-- Doorlooptijd van pickopdrachten: van aanmaken tot de deur uit. Het verschil
-- tussen aangemaakt en gestart is wachttijd, tussen gestart en klaar is werk.
CREATE OR REPLACE VIEW wms.pick_doorlooptijd AS
SELECT o.id,
       o.code,
       o.bron,
       o.bestemming,
       o.created_at,
       o.started_at,
       o.finished_at,
       extract(epoch FROM (o.started_at - o.created_at)) / 60   AS wacht_minuten,
       extract(epoch FROM (o.finished_at - o.started_at)) / 60  AS werk_minuten,
       extract(epoch FROM (o.finished_at - o.created_at)) / 60  AS totaal_minuten,
       (SELECT count(*) FROM wms.pick_lines l WHERE l.pick_order_id = o.id)::int AS regels,
       (SELECT coalesce(sum(l.gepikt), 0) FROM wms.pick_lines l
         WHERE l.pick_order_id = o.id)::int                                      AS gepikt
  FROM wms.pick_orders o
 WHERE o.finished_at IS NOT NULL
--;;

-- Telnauwkeurigheid: hoeveel procent van de getelde regels klopte meteen. Dit is
-- hét cijfer dat zegt of het systeem de werkelijkheid volgt.
CREATE OR REPLACE VIEW wms.tel_nauwkeurigheid AS
SELECT (cl.created_at AT TIME ZONE 'Europe/Amsterdam')::date AS dag,
       count(*)::int                                          AS geteld,
       count(*) FILTER (WHERE cl.verschil = 0)::int           AS klopte,
       count(*) FILTER (WHERE cl.verschil <> 0)::int          AS afwijkend,
       coalesce(sum(abs(cl.verschil)), 0)::int                AS stuks_afwijking,
       round(
         100.0 * count(*) FILTER (WHERE cl.verschil = 0) / nullif(count(*), 0), 1
       )                                                      AS percentage_goed
  FROM wms.count_lines cl
 GROUP BY 1
--;;

-- ── Audit buiten de voorraad ────────────────────────────────────────────────
-- Het grootboek verantwoordt elke beweging van een artikel. Dit verantwoordt de
-- rest: wie zette een instelling om, wie deactiveerde een locatie, wie keurde
-- een telverschil goed. Zonder dit is "het stond gisteren anders" niet te
-- beantwoorden.
CREATE TABLE IF NOT EXISTS wms.audit_log (
  id          bigserial PRIMARY KEY,
  actor_id    text,
  actor_naam  text,
  actie       text NOT NULL,
  object_type text NOT NULL,
  object_id   text,
  oud         jsonb,
  nieuw       jsonb,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
)
--;;
CREATE INDEX IF NOT EXISTS idx_audit_recent ON wms.audit_log (created_at DESC)
--;;
CREATE INDEX IF NOT EXISTS idx_audit_object ON wms.audit_log (object_type, object_id)
--;;
