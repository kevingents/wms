import { SignJWT, jwtVerify } from "jose";

/**
 * Sessie-laag — identiek van vorm aan storeportal_next (HS256-JWT in een
 * httpOnly-cookie, `jose` zodat het op Edge én Node werkt). Zelfde vorm betekent
 * dat WMS en portal straks één sessie kunnen delen zodra ze onder één domein
 * draaien; tot die tijd heeft het WMS z'n eigen cookie-naam.
 *
 * Magazijnmedewerkers loggen in met hun SRS-personeelsnummer + pincode, via de
 * bestaande storegents-backend. Er komt dus géén tweede accountadministratie bij.
 */

export const SESSION_COOKIE = process.env.SESSION_COOKIE_NAME || "gents_wms_session";

/** 12 uur — gelijk aan de TTL van de SRS-personnel sessietoken in de backend. */
export const SESSION_TTL_SECONDS = 12 * 60 * 60;

export type WmsRol = "magazijn" | "teamleider" | "beheer";

export interface WmsSession {
  /** SRS personnelId. */
  userId: string;
  name: string;
  rol: WmsRol;
  /** SRS-sessietoken van de backend; nodig voor de shadow-vergelijking. */
  token?: string;
}

function secretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET || process.env.PERSONNEL_SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET ontbreekt in de environment.");
  return new TextEncoder().encode(secret);
}

export async function signSession(
  user: WmsSession,
  ttlSeconds: number = SESSION_TTL_SECONDS
): Promise<string> {
  return new SignJWT({ user: user as unknown as Record<string, unknown> })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(secretKey());
}

export async function verifySession(
  token: string | undefined | null
): Promise<WmsSession | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    return (payload.user as WmsSession) ?? null;
  } catch {
    return null;
  }
}

/** Mag deze gebruiker instellingen en locatiebeheer wijzigen? */
export function magBeheren(user: WmsSession | null): boolean {
  return user?.rol === "beheer" || user?.rol === "teamleider";
}
