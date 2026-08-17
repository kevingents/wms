import { query, queryOne, BoekingsFout } from "./db";
import type { WmsRol } from "./session";

/**
 * Wie mag wat. Bewust minimaal: het magazijn heeft drie rollen, niet dertig.
 *
 *   magazijn    — scannen, verplaatsen, picken, tellen. Het dagelijkse werk.
 *   teamleider  — plus locaties beheren, telverschillen accorderen, werk uitzetten.
 *   beheer      — plus instellingen, gebruikers, afschrijven en de boekhouding.
 *
 * Geen extra accountadministratie: er wordt ingelogd met het bestaande
 * SRS-personeelsnummer. Deze tabel zegt alleen wat iemand daarna mag.
 *
 * WAAROM EEN TABEL EN GEEN INSTELLING
 * -----------------------------------
 * Dit stond in `wms.settings` onder één sleutel. Dat werkt tot je wilt weten wie
 * wanneer welke rol kreeg, en bij toegangsrechten wil je dat altijd — "sinds
 * wanneer mocht hij dat?" is precies de vraag die je op het verkeerde moment
 * krijgt. Nu is het een echte tabel met een spoor, en elke wijziging gaat ook
 * het audit-log in.
 *
 * BOOTSTRAP
 * ---------
 * Zolang de tabel leeg is krijgt iedereen die kan inloggen `beheer`. Anders kan
 * niemand de eerste beheerder aanwijzen en sta je buiten je eigen systeem. Zodra
 * er één gebruiker in staat, geldt de tabel — en wie er niet in staat krijgt
 * `magazijn`, niet niks: een medewerker die kan inloggen hoort te kunnen werken.
 */

export interface Gebruiker {
  personnel_id: string;
  naam: string | null;
  rol: WmsRol;
  actief: boolean;
  laatste_login: string | null;
  toegevoegd_door: string | null;
  created_at: string;
}

export const ROLLEN: { waarde: WmsRol; label: string; uitleg: string }[] = [
  {
    waarde: "magazijn",
    label: "Magazijn",
    uitleg: "Scannen, picken, inpakken, tellen — al het dagelijkse werk.",
  },
  {
    waarde: "teamleider",
    label: "Teamleider",
    uitleg: "Plus locaties beheren, werk uitzetten en telverschillen accorderen.",
  },
  {
    waarde: "beheer",
    label: "Beheer",
    uitleg: "Plus instellingen, gebruikers, afschrijven en de boekhouding.",
  },
];

/* ── Eenmalige overgang uit de oude instelling ─────────────────────────────── */

let migratieGedaan = false;

/**
 * Neemt de rollen over die nog in `wms.settings` staan.
 *
 * Draait hoogstens één keer per proces en doet niets als de tabel al gevuld is.
 * Bewust geen apart migratiescript: dit moet gebeuren op het moment dat iemand
 * inlogt, ook op een omgeving waar niemand ooit een script draait.
 */
async function neemOudeRollenOver(): Promise<void> {
  if (migratieGedaan) return;
  migratieGedaan = true;

  const bestaat = await queryOne<{ n: string }>(
    `SELECT count(*)::text AS n FROM wms.gebruikers`
  );
  if (Number(bestaat?.n ?? 0) > 0) return;

  const oud = await queryOne<{ value: Record<string, string> }>(
    `SELECT value FROM wms.settings WHERE key = 'toegang.rollen'`
  );
  const toewijzingen = oud?.value ?? {};

  for (const [personnelId, rol] of Object.entries(toewijzingen)) {
    if (!personnelId || !["magazijn", "teamleider", "beheer"].includes(rol)) continue;
    await query(
      `INSERT INTO wms.gebruikers (personnel_id, rol, toegevoegd_door)
       VALUES ($1, $2, 'overgenomen uit instellingen')
       ON CONFLICT (personnel_id) DO NOTHING`,
      [personnelId, rol]
    );
  }
}

/* ── Lezen ─────────────────────────────────────────────────────────────────── */

export async function alleGebruikers(): Promise<Gebruiker[]> {
  await neemOudeRollenOver();
  return query<Gebruiker>(
    `SELECT * FROM wms.gebruikers
      ORDER BY actief DESC,
               CASE rol WHEN 'beheer' THEN 0 WHEN 'teamleider' THEN 1 ELSE 2 END,
               coalesce(naam, personnel_id)`
  );
}

/** Staat er niemand, dan is de bootstrap actief en mag iedereen alles. */
export async function bootstrapActief(): Promise<boolean> {
  await neemOudeRollenOver();
  const rij = await queryOne<{ n: string }>(
    `SELECT count(*)::text AS n FROM wms.gebruikers WHERE actief`
  );
  return Number(rij?.n ?? 0) === 0;
}

export async function rolVoor(personnelId: string): Promise<WmsRol> {
  await neemOudeRollenOver();

  const rij = await queryOne<{ rol: WmsRol; actief: boolean }>(
    `SELECT rol, actief FROM wms.gebruikers WHERE personnel_id = $1`,
    [personnelId]
  );

  if (rij?.actief) return rij.rol;

  /* Op non-actief gezet: geen rechten, maar wel kunnen inloggen zodat de
     medewerker een duidelijke melding krijgt in plaats van een weigering
     waarvan niemand de reden ziet. */
  if (rij && !rij.actief) return "magazijn";

  return (await bootstrapActief()) ? "beheer" : "magazijn";
}

/**
 * Werkt bij wanneer iemand voor het laatst binnenkwam, en legt onbekende
 * medewerkers vast zodat een beheerder ze kan vinden zonder personeelsnummers
 * over te typen. Ze krijgen `magazijn` — het minimum, niet het maximum.
 */
export async function registreerLogin(
  personnelId: string,
  naam: string
): Promise<void> {
  await neemOudeRollenOver();
  await query(
    `INSERT INTO wms.gebruikers (personnel_id, naam, rol, laatste_login, toegevoegd_door)
     VALUES ($1, $2, 'magazijn', now(), 'automatisch bij inloggen')
     ON CONFLICT (personnel_id) DO UPDATE
       SET laatste_login = now(),
           naam = coalesce(nullif(excluded.naam, ''), wms.gebruikers.naam),
           updated_at = now()`,
    [personnelId, naam]
  );
}

/* ── Schrijven ─────────────────────────────────────────────────────────────── */

export async function zetRol(
  personnelId: string,
  rol: WmsRol,
  door: string | null
): Promise<Gebruiker> {
  if (!ROLLEN.some((r) => r.waarde === rol)) {
    throw new BoekingsFout(`Onbekende rol: ${rol}`, "ongeldige_rol");
  }

  await bewaakLaatsteBeheerder(personnelId, rol, true);

  const rij = await queryOne<Gebruiker>(
    `INSERT INTO wms.gebruikers (personnel_id, rol, toegevoegd_door)
     VALUES ($1, $2, $3)
     ON CONFLICT (personnel_id) DO UPDATE
       SET rol = excluded.rol, updated_at = now()
     RETURNING *`,
    [personnelId.trim(), rol, door]
  );
  if (!rij) throw new BoekingsFout("Rol niet opgeslagen.");
  return rij;
}

export async function zetActief(
  personnelId: string,
  actief: boolean,
  door: string | null
): Promise<Gebruiker> {
  if (!actief) await bewaakLaatsteBeheerder(personnelId, null, false);

  const rij = await queryOne<Gebruiker>(
    `UPDATE wms.gebruikers
        SET actief = $2, updated_at = now(),
            toegevoegd_door = coalesce(toegevoegd_door, $3)
      WHERE personnel_id = $1
      RETURNING *`,
    [personnelId, actief, door]
  );
  if (!rij) throw new BoekingsFout("Deze medewerker bestaat niet.", "onbekend");
  return rij;
}

/**
 * Voorkomt dat de laatste actieve beheerder zichzelf buitensluit.
 *
 * Dat klinkt als een randgeval en is het niet: het gebeurt precies één keer, op
 * vrijdagmiddag, en dan kan niemand er meer bij. De database kan dit niet
 * afdwingen met een constraint omdat het over een telling gaat, dus het staat
 * hier — op de enige plek waar rollen gewijzigd worden.
 */
async function bewaakLaatsteBeheerder(
  personnelId: string,
  nieuweRol: WmsRol | null,
  isRolWijziging: boolean
): Promise<void> {
  const huidig = await queryOne<{ rol: WmsRol; actief: boolean }>(
    `SELECT rol, actief FROM wms.gebruikers WHERE personnel_id = $1`,
    [personnelId]
  );
  if (!huidig?.actief || huidig.rol !== "beheer") return;
  if (isRolWijziging && nieuweRol === "beheer") return;

  const rij = await queryOne<{ n: string }>(
    `SELECT count(*)::text AS n FROM wms.gebruikers
      WHERE actief AND rol = 'beheer' AND personnel_id <> $1`,
    [personnelId]
  );
  if (Number(rij?.n ?? 0) === 0) {
    throw new BoekingsFout(
      "Dit is de laatste beheerder. Wijs eerst iemand anders aan, anders kan niemand er nog bij.",
      "laatste_beheerder"
    );
  }
}
