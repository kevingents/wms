"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import {
  opOutboxWijziging,
  startOutboxLus,
  verzendWachtrij,
  verwijderUitWachtrij,
  wachtrij,
  type OutboxItem,
} from "@/lib/outbox";

/**
 * Statusbalk boven elke pagina. Verschijnt alleen als er iets aan de hand is:
 * geen verbinding, of boekingen die nog niet verwerkt zijn. In het normale geval
 * blijft het scherm dus schoon.
 */
export function OutboxBalk() {
  const [items, setItems] = useState<OutboxItem[]>([]);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const ververs = () => {
      void wachtrij().then(setItems);
      setOnline(navigator.onLine);
    };
    ververs();
    const stopLus = startOutboxLus();
    const stopLuisteraar = opOutboxWijziging(ververs);
    const offline = () => setOnline(false);
    const weerOnline = () => setOnline(true);
    window.addEventListener("offline", offline);
    window.addEventListener("online", weerOnline);
    return () => {
      stopLus();
      stopLuisteraar();
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", weerOnline);
    };
  }, []);

  const geweigerd = items.filter((i) => i.laatsteFout);
  const wachtend = items.filter((i) => !i.laatsteFout);

  if (online && items.length === 0) return null;

  return (
    <div className="space-y-px">
      {!online && (
        <div className="flex items-center gap-2 bg-warn px-4 py-2 text-sm font-semibold text-white">
          <Icon name="offline" size={18} />
          Geen verbinding — scans worden bewaard en later verstuurd.
        </div>
      )}

      {wachtend.length > 0 && (
        <div className="flex items-center gap-2 bg-navy-600 px-4 py-2 text-sm font-medium text-white">
          <Icon name="klok" size={18} />
          {wachtend.length} boeking{wachtend.length === 1 ? "" : "en"} wacht
          {wachtend.length === 1 ? "" : "en"} op verzending
          {online && (
            <button
              type="button"
              onClick={() => void verzendWachtrij()}
              className="ml-auto underline underline-offset-2"
            >
              Nu versturen
            </button>
          )}
        </div>
      )}

      {geweigerd.length > 0 && (
        <div className="bg-bad px-4 py-2 text-sm text-white">
          <div className="flex items-center gap-2 font-semibold">
            <Icon name="alert" size={18} />
            {geweigerd.length} boeking{geweigerd.length === 1 ? "" : "en"} geweigerd
          </div>
          <ul className="mt-1 space-y-1">
            {geweigerd.map((i) => (
              <li key={i.id} className="flex items-center gap-2 text-xs">
                <span className="flex-1">{i.laatsteFout}</span>
                <button
                  type="button"
                  onClick={() => void verwijderUitWachtrij(i.id)}
                  className="underline underline-offset-2"
                >
                  Verwijder
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
