# GENTS WMS — volledige kaart

> Wat een volwaardig WMS bevat, wat hiervan af is, en waarom de rest in deze
> volgorde staat. Bijgewerkt 14 augustus 2026.

## Uitgangspunt

Een WMS is geen verzameling schermen maar een **gesloten goederenstroom**. Elk
stuk dat binnenkomt moet er ook weer uit, en elke beweging ertussenin moet
herleidbaar zijn. Waar die keten gaten heeft, ontstaat precies het probleem dat
we oplossen: voorraad die niet klopt en niemand die kan zeggen waarom.

```
        ┌── inkoop/leverancier ──┐
        │                        ▼
        │                   ONTVANGST ──► quarantaine
        │                        │
        │                        ▼
   RETOUR ◄─────┐            INSLAG (putaway)
        ▲       │                │
        │       │                ▼
        │       │           VOORRAAD ◄──► TELLEN
        │       │            (locaties)      ▲
        │       │                │           │
        │       │                ▼           │
        │       │        REPLENISHMENT ──────┘
        │       │           (bulk→pick)
        │       │                │
        │       │                ▼
        │       │            PICKEN ──► rondes met bakken
        │       │                │
        │       │                ▼
        │       └──────────── INPAKKEN
        │                        │
        │                        ▼
        └──────────────────── VERZENDEN
```

## Status per blok

| Blok | Status | Toelichting |
|---|---|---|
| **Fundament** | | |
| Locaties, zones, looproute | ✅ | Reeksgenerator, `sort_order` = pickroute |
| Voorraad-grootboek (append-only) | ✅ | Trigger-bewaakt, niet-negatief, herleidbaar |
| Scannen (handterminal, PWA) | ✅ | Keyboard-wedge + camera-terugval, offline outbox |
| Rechten en rollen | ✅ | SRS-personeelsnummer, drie rollen |
| Instellingen in de tool | ✅ | `wms.settings`, geen redeploy nodig |
| **Inbound** | | |
| Ontvangst tegen verwachting | ✅ | Regels, afwijkingen, quarantaine |
| Inslag / putaway | ✅ | Snelle inslag, locatie blijft staan |
| Cross-docking | ⬜ | Ontvangst direct naar expeditie, zonder inslag |
| **Voorraad** | | |
| Tellen (ad hoc, blind) | ✅ | Verschil-drempel, controle-markering |
| Cyclustellingen (ABC-programma) | ✅ | Telkandidaten op omloopsnelheid + ouderdom |
| Replenishment bulk → pick | ✅ | Min/max per piklocatie, taken-wachtrij |
| Slotting-advies | ⬜ | Hardlopers vooraan; vraagt verkoophistorie |
| **Outbound** | | |
| Picken per order | ✅ | Toewijzing, tekortafhandeling |
| Batchpicken met bakken | ✅ | Eén ronde, één keer lopen |
| Inpakken | ✅ | Doos kiezen, controleren, gewicht |
| Verzenden en labels | 🟡 | Zending vastgelegd; vervoerder-API nog niet |
| **Reverse** | | |
| Retouren ontvangen en beoordelen | ✅ | Verkoopbaar / herstel / afkeur |
| **Sturing** | | |
| SRS-schaduwvergelijking | ✅ | Nachtelijk, per sku |
| Koppeling met de portal | ✅ | Eén deur, beide richtingen |
| Werkvoorraad en taken | ✅ | Generieke takenwachtrij |
| KPI's en productiviteit | ✅ | Picks per uur, doorlooptijd, telnauwkeurigheid |
| Audit-spoor buiten voorraad | ✅ | Wie wijzigde welke instelling of locatie |
| **Later** | | |
| Vervoerder-integratie (DHL/Sendcloud) | ⬜ | Label ophalen, tracking terugkoppelen |
| Labels printen (locatie, artikel) | ⬜ | Vraagt printerkeuze (ZPL?) |
| Slotting op verkoopsnelheid | ⬜ | Ná een paar maanden echte pickdata |
| Taakinterleaving | ⬜ | Inslag combineren met pickronde |
| Vision voor artikelen zonder barcode | ⬜ | 17% van het magazijn |

## Waarom deze volgorde

**De cyclus eerst dichtmaken.** Een volle bak zonder inpakstation is een
doodlopend eind; ontvangst zonder verwachting is tellen zonder referentie. Zolang
er gaten in de keten zitten, blijft er handwerk buiten het systeem om — en dáár
ontstaat het verschil dat je later niet meer kunt verklaren.

**Optimaliseren pas daarna.** Slotting, taakinterleaving en vraagvoorspelling
hebben allemaal historie nodig die er nu niet is: het grootboek is leeg. Ze
bouwen vóór er data is, levert modellen op die op aannames draaien. Eerst een
paar maanden echt werk erdoorheen, dan meten wat er te winnen valt.

**Vervoerder-integratie is bewust uitgesteld.** Het label ophalen bij DHL of
Sendcloud is een dag werk, maar het raakt aan lopende afspraken en tarieven. De
zending wordt nu volledig vastgelegd — vervoerder, tracking, gewicht en doos —
zodat aansluiten later alleen nog een API-call is en geen datamodel-wijziging.

## Wat dit systeem bewust niet doet

- **Geen inkoopmodule.** Inkoop hoort bij de portal en SRS. Het WMS ontvangt
  tegen een verwachting, maar bepaalt niet wat er besteld wordt.
- **Geen adviesmodellen.** Herverdeling, forecast en replenishment tussen
  winkels rekent de portal uit. Zie [KOPPELING.md](KOPPELING.md).
- **Geen serienummers of houdbaarheid.** Niet van toepassing op kleding; het
  variantniveau (kleur × maat) is fijn genoeg.
- **Geen eigen artikelbeheer.** Het WMS leest `public.product_variants`.
