"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Knop, Melding } from "@/components/ui/Basis";

/**
 * Camera-scanner als terugvalweg.
 *
 * Een echte handterminal heeft een laserscanner die de code gewoon intypt —
 * daar is dit niet voor nodig en dan is het ook trager. Dit is voor het geval
 * iemand met een telefoon in het magazijn staat, of als de scannerkop stuk is.
 *
 * De zxing-bibliotheek wordt pas geladen als je de camera opent (dynamische
 * import). Anders sleept elke pagina ~200 kB mee voor iets wat zelden gebruikt
 * wordt — op een handterminal met matige wifi merk je dat.
 */
export function CameraScanner({
  onCode,
  label = "Scan met camera",
}: {
  onCode: (code: string) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [fout, setFout] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!open) return;
    let afgebroken = false;

    (async () => {
      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        const reader = new BrowserMultiFormatReader();
        const controls = await reader.decodeFromVideoDevice(
          undefined,
          videoRef.current ?? undefined,
          (resultaat) => {
            if (afgebroken || !resultaat) return;
            const tekst = resultaat.getText();
            if (!tekst) return;
            /* Eén treffer is genoeg: sluiten voorkomt dat dezelfde code twintig
               keer per seconde wordt doorgegeven. */
            afgebroken = true;
            stopRef.current?.();
            setOpen(false);
            onCode(tekst);
          }
        );
        stopRef.current = () => controls.stop();
      } catch {
        setFout(
          "Camera niet beschikbaar. Geef toestemming, of typ de code over."
        );
        setOpen(false);
      }
    })();

    return () => {
      afgebroken = true;
      stopRef.current?.();
      stopRef.current = null;
    };
  }, [open, onCode]);

  return (
    <div className="space-y-2">
      {fout && <Melding soort="warn">{fout}</Melding>}

      {open ? (
        <div className="space-y-2">
          <div className="overflow-hidden rounded-lg border-2 border-navy bg-black">
            <video
              ref={videoRef}
              className="aspect-[4/3] w-full object-cover"
              playsInline
              muted
            />
          </div>
          <Knop variant="secundair" onClick={() => setOpen(false)} className="w-full">
            <Icon name="kruis" size={16} />
            Camera sluiten
          </Knop>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setFout("");
            setOpen(true);
          }}
          className="flex min-h-tap w-full items-center justify-center gap-2 rounded-lg border border-navy-100 bg-white text-sm font-medium text-slate"
        >
          <Icon name="camera" size={18} />
          {label}
        </button>
      )}
    </div>
  );
}
