# GENTS WMS

Magazijnbeheer voor GENTS Herenmode. Neemt van SRS het stuk over dat SRS als
laatste nog vasthoudt: de voorraad in het centrale magazijn (SRS branch `99`).

**Wat dit toevoegt dat er nog niet was:** voorraad per *plek binnen het magazijn*.
De bestaande commerce-core in `gentsnext` weet per winkel wat er ligt; het
magazijn is daarin één bak van ~4.400 sku's en ~47.000 stuks zonder te weten wáár
iets ligt. Dat gat vult dit.

## Stack

| | |
|---|---|
| Framework | Next.js 15 (App Router) + React 19 + Tailwind — Vercel preset **Next.js** |
| Regio | `fra1` (Frankfurt), gelijk aan de database en de andere portals |
| Database | Neon Postgres, schema `wms` in hetzelfde project als de commerce-core |
| Driver | `@neondatabase/serverless` (HTTP) |
| Sessie | HS256-JWT in httpOnly-cookie (`jose`), login via SRS-personeelsnummer |

## Kernprincipe

**Voorraad is een grootboek, geen getal.**

- `wms.stock_moves` — append-only ledger. Nooit UPDATE, nooit DELETE; een
  databasetrigger blokkeert dat actief. Een fout corrigeer je met een
  tegenboeking.
- `wms.stock_levels` — afgeleide saldi, uitsluitend bijgewerkt door de trigger op
  `stock_moves`. Niemand schrijft hier direct in.
- `CHECK (qty >= 0)` op de saldi: je kunt niet pikken wat er niet ligt. Een
  poging laat de héle boeking falen in plaats van stil een negatief saldo te
  maken.

Daardoor is "de voorraad klopt niet" altijd beantwoordbaar — er is een spoor tot
op de scan.

## Aan de slag

```bash
npm install
```

Kopieer `.env.example` naar `.env.local` en vul `DATABASE_URL` en
`SESSION_SECRET` in. `DATABASE_URL` is dezelfde Neon-string als `gentsnext`
gebruikt — het WMS leeft in schema `wms` van datzelfde project. Daarna:

```bash
npm run db:migrate
```

De migratie is idempotent en mag zo vaak draaien als je wilt. Controleer daarna
de invarianten:

```bash
npm run db:smoke
```

## Scripts

| Script | Doet |
|---|---|
| `npm run dev` | Ontwikkelserver |
| `npm run build` | Productiebuild |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:migrate` | Voert `db/schema.sql` uit (idempotent) |
| `npm run db:smoke` | Test de voorraad- én pick-invarianten tegen de echte database |
| `npm run db:status` | Read-only: schema, shadow-stand, pickwerk, scanbaarheid |
| `node scripts/db-inspect.mjs` | Read-only: welke schema's en tabellen staan er |
| `node scripts/db-verkennen.mjs` | Read-only: vorm van de bestaande voorraaddata |

## Verhouding tot de rest

```
gentsnext (Neon, schema public)          dit repo (Neon, schema wms)
├─ product_variants  ─── view ──────────► wms.artikelen, wms.barcodes
├─ srs_stock (branch 99) ─── view ──────► wms.shadow_verschil
├─ stock_levels (per winkel)             wms.stock_levels (per magazijnlocatie)
└─ store_stock_movements (per winkel)    wms.stock_moves (per magazijnlocatie)
```

Bewust **geen eigen artikeltabel**: het WMS leest `public.product_variants` via
een view. Een tweede artikelregistratie zou precies de dubbele waarheid opleveren
die we aan het opruimen zijn. Sleutel is `sku`, net als in `srs_stock` en
`stock_levels`; scannen gebeurt op barcode en wordt naar sku vertaald.

Eigen schema, niet `public`: Drizzle beheert `public` vanuit gentsnext en zou
losse tabellen daar als drift zien.

## Picken

Het uitgaande werk. Pickopdrachten komen uit twee bronnen, beide al aanwezig in
deze database:

- **Weborders** — `public.orders.fulfillment_plan` bevat `shipments[]`, elk met
  een `branchId`. Alles met `branchId '99'` of `isWarehouse` is magazijnwerk. De
  core doet de verdeling winkel-vs-magazijn al; het WMS neemt die over en
  bedenkt 'm niet opnieuw.
- **Transfers** — `public.inbound_shipments` met `from_location` = magazijn.

De import is idempotent via `UNIQUE (bron, bron_ref)`.

**Toewijzing is advies, geen reservering.** De voorraad blijft op zijn plek tot
er echt gepikt wordt; de view `wms.vrije_voorraad` trekt alleen af wat aan open
pickregels is toegezegd, zodat twee pickers niet naar dezelfde vier stuks worden
gestuurd. Ligt het er onverhoopt niet, dan meldt de picker "minder gevonden" en
wijst het systeem het restant toe aan een andere locatie. Een echte reservering
met tegenboekingen kost hier meer dan het oplevert.

Picken is **twee boekingen**, niet één:

1. `pick` — van de piklocatie naar `EXPEDITIE`. De goederen zijn uit het schap
   maar nog in het pand, dus een doos op de kade blijft vindbaar.
2. `verzonden` — van `EXPEDITIE` naar buiten, bij het afsluiten van de opdracht.

De pickvolgorde volgt `locations.sort_order` — dát is waar de looproute aan
hangt, en de reden dat locaties met een reeksgenerator worden aangemaakt.

## Shadow-fase

SRS blijft de waarheid tot de cijfers kloppen. Elke nacht om 04:30 vergelijkt
`/api/cron/srs-vergelijking` per SKU wat SRS zegt (`public.srs_stock`, branch 99)
met wat het WMS zegt, en legt dat vast in `wms.reconcile_runs` /
`wms.reconcile_lines`. Het scherm **SRS-check** toont de stand.

De cutover is verantwoord als die lijst structureel leeg blijft — niet eerder.

## Configuratie

Huisregel: alles wat het magazijn zelf moet kunnen aanpassen staat **in de tool**
(tabel `wms.settings`, scherm `/instellingen`), niet in Vercel. Alleen secrets
horen in de environment:

| Env-var | Waarom |
|---|---|
| `DATABASE_URL` | secret |
| `SESSION_SECRET` | secret |
| `BACKEND_API_BASE` | platform-config (storegents-API voor login) |
| `ADMIN_TOKEN` | secret |
| `CRON_SECRET` | secret |

Een nieuwe instelling toevoegen is één regel in `lib/instellingen.ts`; het
instellingenscherm bouwt zichzelf uit die definities.

## Offline

Magazijn-wifi valt weg achter een stelling. Elke boeking gaat daarom eerst de
outbox in (IndexedDB, overleeft een herstart) met een lokaal gegenereerde
`idempotencyKey`, en wordt daarna verstuurd. Een retry na een afgebroken request
boekt nooit dubbel. Zie `lib/outbox.ts`.

Tellingen gaan bewust **niet** via de outbox: het verschil wordt server-side
berekend tegen het saldo op dát moment, dus een telling die een uur later alsnog
verstuurd wordt zou het verkeerde verschil boeken.
