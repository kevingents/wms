# GENTS WMS — volledige kaart

> Wat een volwaardig WMS bevat, wat hiervan af is, en waarom de rest in deze
> volgorde staat. Bijgewerkt 15 augustus 2026.

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
| Rechten en rollen | ✅ | Drie rollen in `wms.gebruikers`, met audit-spoor |
| Instellingen in de tool | ✅ | `wms.settings`, geen redeploy nodig |
| Locaties uit SRS | ✅ | 611 vakken, looproute uit de code, telhistorie mee |
| **Inbound** | | |
| Ontvangst tegen verwachting | ✅ | Regels, afwijkingen, quarantaine |
| Inslag / putaway | ✅ | Snelle inslag, locatie blijft staan |
| Colli (LPN) | ✅ | Doos of pallet als eenheid; verplaatsen in één handeling |
| Cross-docking | ✅ | Ontvangst direct naar expeditie waar vraag op wacht |
| **Voorraad** | | |
| Tellen (ad hoc, blind) | ✅ | Verschil-drempel, controle-markering |
| Cyclustellingen (ABC-programma) | ✅ | Telkandidaten op omloopsnelheid + ouderdom |
| Replenishment bulk → pick | ✅ | Min/max per piklocatie, taken-wachtrij |
| Slotting-advies | ⬜ | Hardlopers vooraan; vraagt verkoophistorie |
| **Outbound** | | |
| Weborders uit SRS | ✅ | De huidige stroom; bron instelbaar (srs/core/beide) |
| Picken per order | ✅ | Toewijzing, tekortafhandeling |
| Batchpicken met bakken | ✅ | Eén ronde, één keer lopen |
| Winkelaanvulling (looplijst) | ✅ | Tekort vs. vrije voorraad, evenredig verdeeld |
| Inpakken | ✅ | Doos kiezen, controleren, gewicht |
| Verzenden en labels | 🟡 | Zending vastgelegd; vervoerder-API nog niet |
| **Reverse** | | |
| Retouren ontvangen en beoordelen | ✅ | Verkoopbaar / herstel / afkeur |
| **Financieel** | | |
| Kostprijs per artikel, met historie | ✅ | Uit SRS-verkopen; handmatig te overrulen |
| Waardering per mutatie | ✅ | Voortschrijdend gemiddelde, bevroren bij boeking |
| Sluitcontrole voorraadwaarde | ✅ | in − uit = op voorraad, één query |
| Journaalposten (dubbel boekhouden) | ✅ | Debet = credit per gebeurtenis |
| Periodeafsluiting met slot | ✅ | Database weigert boeken in een dichte maand |
| Doorschieten naar Exact | 🟡 | Regels staan klaar; de API-call zelf nog niet |
| **Sturing** | | |
| SRS-schaduwvergelijking | ✅ | Nachtelijk, per sku |
| Koppeling met de portal | ✅ | Eén deur, beide richtingen |
| Werkvoorraad en taken | ✅ | Generieke takenwachtrij |
| KPI's en productiviteit | ✅ | Picks per uur, doorlooptijd, telnauwkeurigheid |
| Audit-spoor buiten voorraad | ✅ | Wie wijzigde welke instelling, rol of locatie |
| Bewaking en signalen | ✅ | Acht regels; wat opgelost is sluit zichzelf |
| Labels printen (locatie, artikel) | ✅ | ZPL of afdrukbare pagina, eigen Code128 |
| Handleiding voor de vloer | ✅ | In de app en als los document |
| **Later** | | |
| Vervoerder-integratie (DHL/Sendcloud) | ⬜ | Label ophalen, tracking terugkoppelen |
| Slotting op verkoopsnelheid | ⬜ | Ná een paar maanden echte pickdata |
| Taakinterleaving | ⬜ | Inslag combineren met pickronde |
| Vision voor artikelen zonder barcode | ⬜ | 17% van het magazijn |

## Wat er nu tussen zit en ingebruikname

Het systeem is af genoeg om mee te beginnen; wat resteert is geen bouwwerk maar
inrichting:

1. **617 vakken hebben nog geen label.** Zonder geplakte barcode kan niemand
   scannen. Print per zone bij `/labels` — zone H is 68 vakken en groot genoeg
   om de hele flow op te proberen.
2. **De beginvoorraad moet erin.** Tot die tijd staat elke pickopdracht op "geen
   voorraad toegewezen" en toont de looplijst nul leverbaar. Beide zijn correct
   gedrag, geen storing.
3. **Wijs een beheerder aan** bij `/gebruikers`. Zolang die lijst leeg is heeft
   iedereen die inlogt alle rechten.

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
