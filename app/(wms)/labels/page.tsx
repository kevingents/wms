import { LabelsView } from "@/components/LabelsView";

export const dynamic = "force-dynamic";

export default function LabelsPagina() {
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-bold text-navy">Labels</h1>
        <p className="text-sm text-slate">
          Zonder geplakt label kan een vak niet gescand worden. Dit is dus geen bijzaak
          maar de voorwaarde om te beginnen.
        </p>
      </header>
      <LabelsView />
    </div>
  );
}
