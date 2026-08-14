# Koppeling portal ↔ WMS

> Voor wie een rekenmodel in de portal aan het magazijn wil koppelen.

## Rolverdeling

**De portal is het brein.** Herverdeling, replenishment, forecast en inkoop
bepalen daar wát er moet gebeuren, op basis van verkoopsnelheid, ideaalvoorraad,
seizoen en marge — dingen die het WMS niet weet en niet hoeft te weten.

**Het WMS zijn de handen.** Waar ligt het, is het nog vrij, pak het, boek het,
meld terug wat er echt gebeurd is.

De verleiding is om per rekenmodel een koppeling te bouwen. Dat wordt een web.
In plaats daarvan: **één deur, in beide richtingen.** Een nieuw model in de
portal vraagt geen nieuwe koppeling — alleen een andere `bron`.

```
portal                                   WMS
------                                   ---
herverdeling-store.js   ┐
replenishment-advice.js ├─► POST /api/koppeling/opdracht ─► pickopdracht
demand-forecast.js      │        (bron, ref, regels)         in vakvolgorde
inkoop                  ┘                                          │
                                                                   ▼
       callbackUrl  ◄── POST terugmelding ◄── wms.koppeling_uitgaand
                        (gevraagd vs gepikt)      (cron, elke 5 min)
```

## Werk aanbieden

```http
POST /api/koppeling/opdracht
Authorization: Bearer <KOPPELING_SECRET>
Content-Type: application/json

{
  "bron": "herverdeling",
  "ref": "herv-2026-08-14-utrecht",
  "bestemming": "GENTS Utrecht",
  "prioriteit": 5,
  "notitie": "Herverdeling wolblend, week 33",
  "callbackUrl": "https://storegents.vercel.app/api/wms/terugmelding",
  "regels": [
    { "sku": "2900003390031", "aantal": 3 },
    { "sku": "2900004711033", "aantal": 1 }
  ]
}
```

Geldige bronnen: `herverdeling`, `aanvulling`, `forecast`, `weborder`,
`transfer`, `inkoop`, `handmatig`.

**Idempotent op `(bron, ref)`.** Opnieuw versturen geeft de bestaande opdracht
terug in plaats van een tweede ronde te maken. Kies een `ref` die het model zelf
kan reproduceren — bijvoorbeeld `<model>-<datum>-<winkel>`.

Het antwoord is niet alleen "ontvangen", maar meteen wat ervan te maken valt:

```json
{
  "ok": true,
  "code": "P-000042",
  "status": "open",
  "regels": [
    { "sku": "2900003390031", "gevraagd": 3, "toegewezen": 3, "tekort": 0,
      "locaties": ["A1-04-2", "BULK-07"] },
    { "sku": "2900004711033", "gevraagd": 1, "toegewezen": 0, "tekort": 1,
      "locaties": [] }
  ],
  "totaalGevraagd": 4, "totaalToegewezen": 3, "totaalTekort": 1
}
```

Dat `tekort` is het belangrijkste veld voor een adviesmodel: het weet nu dat het
die ene niet moet beloven aan de winkel. `toegewezen` is een reservering in
adviesvorm — de voorraad is nog niet verplaatst, maar telt niet meer mee als
vrij voor een volgende opdracht.

## Stand opvragen

```http
GET /api/koppeling/opdracht?bron=herverdeling&ref=herv-2026-08-14-utrecht
Authorization: Bearer <KOPPELING_SECRET>
```

## Terugmelding ontvangen

Als er een `callbackUrl` is meegegeven, POST het WMS daarheen zodra de opdracht
gepikt en zodra hij verzonden is:

```json
{
  "soort": "verzonden",
  "bron": "herverdeling",
  "ref": "herv-2026-08-14-utrecht",
  "code": "P-000042",
  "status": "afgesloten",
  "gevraagd": 4,
  "gepikt": 3,
  "regels": [
    { "sku": "2900003390031", "gevraagd": 3, "gepikt": 3,
      "locatie": "A1-04-2", "status": "gepikt" },
    { "sku": "2900004711033", "gevraagd": 1, "gepikt": 0,
      "locatie": null, "status": "overgeslagen" }
  ]
}
```

`gevraagd` versus `gepikt` is de feedbackloop. Een model dat structureel meer
vraagt dan er gepikt wordt, rekent met een voorraad die er niet is — en dat zie
je hier, per sku.

De terugmelding draagt hetzelfde `Bearer <KOPPELING_SECRET>` mee, zodat de portal
weet dat hij van het WMS komt.

**Wachtrij, geen directe call.** De terugmelding gaat eerst in
`wms.koppeling_uitgaand` en wordt elke vijf minuten bezorgd door
`/api/cron/koppeling`. Als de portal even weg is, mag dat de magazijnvloer niet
stilleggen. Na zes mislukte pogingen blijft de gebeurtenis als `mislukt` staan in
plaats van eeuwig door te proberen.

## Leverbaarheid opvragen

Voordat een model beslist, kan het vragen wat er überhaupt te verdelen valt:

```http
GET /api/koppeling/dekking?detail=1
Authorization: Bearer <KOPPELING_SECRET>
```

Dit zet de keten-tekorten (`srs_stock.tekort`) af tegen de **vrije** voorraad in
het magazijn — dus ná aftrek van wat al aan lopende pickopdrachten is toegezegd.
Dat laatste weet SRS niet, en zonder die correctie beloof je dezelfde stuks aan
twee winkels.

Let op wat dit **niet** is: geen aanvuladvies. De evenredige verdeling in het
antwoord is een haalbaarheidsschatting, geen opdracht. Wie welke stuks krijgt
beslist de portal.

Ter grootte-orde, gemeten op 14 augustus 2026: van de ~26.000 stuks tekort in de
keten kon het magazijn er ~3.800 dekken. De rest is inkoopwerk, geen
magazijnwerk — en dat is precies waarom je die lijst niet ongefilterd op een
looplijst moet zetten.

## Configuratie

| Env-var | Waar | Waarvoor |
|---|---|---|
| `KOPPELING_SECRET` | beide kanten, zelfde waarde | authenticatie server-naar-server |
| `CRON_SECRET` | WMS | beveiligt `/api/cron/koppeling` |

Beide zijn secrets en horen in Vercel, niet in de instellingen-tabel.
