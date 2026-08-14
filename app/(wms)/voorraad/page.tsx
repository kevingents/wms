import { VoorraadZoeker } from "@/components/VoorraadZoeker";

export const dynamic = "force-dynamic";

export default function VoorraadPagina() {
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-bold text-navy">Voorraad</h1>
        <p className="text-sm text-slate">
          Zoek op artikel om te zien waar het ligt, of op locatie om te zien wat erop ligt.
        </p>
      </header>
      <VoorraadZoeker />
    </div>
  );
}
