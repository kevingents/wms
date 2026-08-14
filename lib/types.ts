/** Gedeelde datavormen tussen server en client. */

export type LocatieSoort =
  | "pick"
  | "bulk"
  | "inbound"
  | "outbound"
  | "quarantine"
  | "virtual";

export const LOCATIE_SOORTEN: { waarde: LocatieSoort; label: string }[] = [
  { waarde: "pick", label: "Piklocatie" },
  { waarde: "bulk", label: "Bulk / voorraadstelling" },
  { waarde: "inbound", label: "Ontvangst" },
  { waarde: "outbound", label: "Expeditie" },
  { waarde: "quarantine", label: "Quarantaine" },
  { waarde: "virtual", label: "Virtueel (tegenboeking)" },
];

/** Reden van een boeking — één-op-één met de CHECK in db/schema.sql. */
export type BoekingReden =
  | "ontvangst"
  | "inslag"
  | "verplaatsing"
  | "pick"
  | "verzonden"
  | "retour"
  | "telling"
  | "correctie"
  | "afschrijving"
  | "startsaldo";

export const REDEN_LABELS: Record<BoekingReden, string> = {
  ontvangst: "Ontvangst",
  inslag: "Inslag",
  verplaatsing: "Verplaatsing",
  pick: "Gepikt",
  verzonden: "Verzonden",
  retour: "Retour",
  telling: "Telling",
  correctie: "Correctie",
  afschrijving: "Afschrijving",
  startsaldo: "Startsaldo",
};

export interface Locatie {
  id: number;
  code: string;
  name: string | null;
  zone: string | null;
  kind: LocatieSoort;
  aisle: string | null;
  rack: string | null;
  level: string | null;
  sort_order: number;
  pickable: boolean;
  active: boolean;
  note: string | null;
}

/** Uit de view wms.artikelen — een leesvenster op public.product_variants. */
export interface Artikel {
  sku: string;
  barcode: string | null;
  srs_artikel_id: string | null;
  variant_id: string | null;
  omschrijving: string | null;
  merk: string | null;
  kleur: string | null;
  maat: string | null;
  afbeelding: string | null;
}

export interface SaldoRegel {
  sku: string;
  location_id: number;
  qty: number;
  updated_at: string;
  location_code: string;
  zone: string | null;
  omschrijving: string | null;
  maat: string | null;
  kleur: string | null;
}

export interface BoekingRegel {
  id: number;
  sku: string;
  from_location_id: number | null;
  to_location_id: number | null;
  qty: number;
  reason: BoekingReden;
  ref_type: string | null;
  ref_id: string | null;
  actor_id: string | null;
  actor_name: string | null;
  note: string | null;
  created_at: string;
  van_code: string | null;
  naar_code: string | null;
  omschrijving: string | null;
}

export interface ShadowRegel {
  sku: string;
  srs_qty: number;
  wms_qty: number;
  diff: number;
  omschrijving?: string | null;
}
