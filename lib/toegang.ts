import { query, queryOne } from "./db";
import type { WmsRol } from "./session";

/**
 * Wie mag wat. Bewust minimaal: het magazijn heeft drie rollen, niet dertig.
 *
 *   magazijn    — scannen, verplaatsen, tellen. Het dagelijkse werk.
 *   teamleider  — plus locaties beheren en telverschillen accorderen.
 *   beheer      — plus instellingen en de shadow-vergelijking.
 *
 * De toewijzing staat in wms.settings onder `toegang.rollen`, bewerkbaar via
 * /instellingen. Geen extra accountadministratie: er wordt ingelogd met het
 * bestaande SRS-personeelsnummer.
 *
 * BOOTSTRAP: zolang er niemand is toegewezen krijgt iedereen die kan inloggen
 * `beheer`. Zodra de eerste beheerder is vastgelegd geldt de lijst. Dat staat
 * ook als waarschuwing op het instellingenscherm.
 */

export interface RolToewijzing {
  [personnelId: string]: WmsRol;
}

export async function rolToewijzingen(): Promise<RolToewijzing> {
  const rij = await queryOne<{ value: RolToewijzing }>(
    `SELECT value FROM wms.settings WHERE key = 'toegang.rollen'`
  );
  return rij?.value ?? {};
}

export async function rolVoor(personnelId: string): Promise<WmsRol> {
  const toewijzingen = await rolToewijzingen();
  if (Object.keys(toewijzingen).length === 0) return "beheer";
  return toewijzingen[personnelId] ?? "magazijn";
}

export async function zetRol(
  personnelId: string,
  rol: WmsRol | null,
  door: string | null
): Promise<RolToewijzing> {
  const huidig = await rolToewijzingen();
  if (rol === null) delete huidig[personnelId];
  else huidig[personnelId] = rol;

  await query(
    `INSERT INTO wms.settings (key, value, updated_by)
     VALUES ('toegang.rollen', $1::jsonb, $2)
     ON CONFLICT (key) DO UPDATE
       SET value = excluded.value, updated_at = now(), updated_by = excluded.updated_by`,
    [JSON.stringify(huidig), door]
  );
  return huidig;
}
