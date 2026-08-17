import { cn } from "@/lib/cn";

/**
 * SVG-icon helper (huisregel: altijd SVG-iconen, nooit emoji's). Lijn-iconen in
 * 24×24, currentColor. Voeg nieuwe iconen toe aan PATHS — gebruik nooit een
 * emoji als vervanging.
 */

const PATHS: Record<string, React.ReactNode> = {
  box: (
    <>
      <path d="M21 8 12 3 3 8v8l9 5 9-5Z" />
      <path d="m3 8 9 5 9-5" />
      <path d="M12 13v8" />
    </>
  ),
  scan: (
    <>
      <path d="M3 7V5a2 2 0 0 1 2-2h2" />
      <path d="M17 3h2a2 2 0 0 1 2 2v2" />
      <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
      <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
      <path d="M3 12h18" />
    </>
  ),
  locatie: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </>
  ),
  users: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.9" />
      <path d="M16 3.1a4 4 0 0 1 0 7.8" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" />
      <path d="M12 17h.01" />
    </>
  ),
  label: (
    <>
      <path d="M3 7a2 2 0 0 1 2-2h8l8 8-8 8-8-8V7Z" />
      <circle cx="8" cy="10" r="1.3" />
    </>
  ),
  /* Winkelpui — de aanvulstroom naar de filialen. */
  winkel: (
    <>
      <path d="M3 9V7l2-3h14l2 3v2" />
      <path d="M3 9h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9Z" />
      <path d="M9 21v-6h6v6" />
    </>
  ),
  collo: (
    <>
      <rect x="3" y="8" width="18" height="12" rx="1" />
      <path d="M3 12h18" />
      <path d="M9 8V5h6v3" />
    </>
  ),
  euro: (
    <>
      <path d="M17 5.3A7 7 0 0 0 7.6 9M7.6 15a7 7 0 0 0 9.4 3.7" />
      <path d="M4 10h9" />
      <path d="M4 14h9" />
    </>
  ),
  retour: (
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
      <path d="M12 8v4l3 2" />
    </>
  ),
  grafiek: (
    <>
      <path d="M3 3v16a2 2 0 0 0 2 2h16" />
      <path d="m7 15 3.5-4 3 2.5L19 8" />
    </>
  ),
  taken: (
    <>
      <path d="M9 5h9a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h1" />
      <rect x="8" y="3" width="8" height="4" rx="1" />
      <path d="m9 13 2 2 4-4" />
    </>
  ),
  /* Pickkar met bakken — batchpicken. */
  kar: (
    <>
      <rect x="3" y="5" width="18" height="10" rx="1" />
      <path d="M9 5v10" />
      <path d="M15 5v10" />
      <circle cx="7.5" cy="19" r="1.5" />
      <circle cx="16.5" cy="19" r="1.5" />
    </>
  ),
  terminal: (
    <>
      <rect x="6" y="2" width="12" height="20" rx="2" />
      <path d="M10 6h4" />
      <path d="M9 18h6" />
    </>
  ),
  camera: (
    <>
      <path d="M3 8a2 2 0 0 1 2-2h2l1.5-2h7L17 6h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
      <circle cx="12" cy="12.5" r="3.5" />
    </>
  ),
  inslag: (
    <>
      <path d="M12 3v10" />
      <path d="m8 9 4 4 4-4" />
      <path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
    </>
  ),
  pick: (
    <>
      <path d="M3 4h3l1.6 9.6a2 2 0 0 0 2 1.7h7.7a2 2 0 0 0 2-1.6L21 7H6.5" />
      <circle cx="10" cy="20" r="1.3" />
      <circle cx="18" cy="20" r="1.3" />
    </>
  ),
  tellen: (
    <>
      <path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4" />
      <path d="M7 8h6" />
      <path d="M7 12h4" />
      <path d="m15 9 2 2 5-5" />
    </>
  ),
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </>
  ),
  instellingen: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </>
  ),
  zoek: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </>
  ),
  pijl: (
    <>
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </>
  ),
  vink: <path d="m5 13 4 4L19 7" />,
  kruis: (
    <>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </>
  ),
  alert: (
    <>
      <path d="M10.3 3.3 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.3a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </>
  ),
  klok: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  offline: (
    <>
      <path d="M2 2l20 20" />
      <path d="M8.5 16.5a5 5 0 0 1 7 0" />
      <path d="M2 8.8a15 15 0 0 1 4.2-2.5" />
      <path d="M22 8.8a15 15 0 0 0-6-3.3" />
      <path d="M5.5 12.8a10 10 0 0 1 3.2-2" />
      <path d="M18.5 12.8a10 10 0 0 0-2-1.4" />
      <path d="M12 20h.01" />
    </>
  ),
  synchroniseer: (
    <>
      <path d="M21 12a9 9 0 0 1-9 9 9 9 0 0 1-7.5-4" />
      <path d="M3 12a9 9 0 0 1 9-9 9 9 0 0 1 7.5 4" />
      <path d="M19.5 3v4h-4" />
      <path d="M4.5 21v-4h4" />
    </>
  ),
  uitloggen: (
    <>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  min: <path d="M5 12h14" />,
};

export type IconName = keyof typeof PATHS | string;

export function Icon({
  name,
  className,
  size = 20,
}: {
  name: IconName;
  className?: string;
  size?: number;
}) {
  const path = PATHS[name] ?? PATHS.box;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("shrink-0", className)}
      aria-hidden="true"
    >
      {path}
    </svg>
  );
}
