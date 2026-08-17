/**
 * Smoke-test op de verdeling van de looplijst.
 *
 * De verdeelregel is de kern van winkelaanvulling: het magazijn kan zelden
 * iedereen bedienen, dus wíe krijgt de schaarse voorraad. Dat moet uitlegbaar
 * zijn en het mag nooit meer weggeven dan er ligt of dan een winkel vroeg.
 *
 * Deze test draait de verdeelfunctie los, zonder database — het is pure rekenkunde
 * en dan hoort er ook geen infrastructuur bij nodig te zijn.
 *
 *   node scripts/smoke-aanvullen.mjs
 */

let mislukt = 0;

function check(naam, geslaagd, detail = "") {
  console.log(`  ${geslaagd ? "ok  " : "FOUT"} ${naam}${detail ? ` — ${detail}` : ""}`);
  if (!geslaagd) mislukt += 1;
}

/* Kopie van lib/aanvullen.ts. Bewust gedupliceerd: de lib is TypeScript en deze
   test moet zonder bouwstap kunnen draaien. Wijzigt de logica daar, dan hoort
   deze test mee te veranderen — en dat is precies wanneer je 'm wilt draaien. */
function urgentie(r) {
  const ideaal = Number(r.ideaal) || 0;
  if (ideaal <= 0) return 1;
  const dekking = Math.min(Math.max(Number(r.aanwezig) / ideaal, 0), 1);
  return 1 + (1 - dekking);
}

function verdeel(vragen, beschikbaar) {
  const totaalGevraagd = vragen.reduce((s, v) => s + v.gevraagd, 0);
  const totaalGewicht = vragen.reduce((s, v) => s + v.gewicht, 0);

  if (totaalGevraagd === 0 || beschikbaar <= 0) return vragen.map(() => 0);
  if (beschikbaar >= totaalGevraagd) return vragen.map((v) => v.gevraagd);
  if (totaalGewicht === 0) return vragen.map(() => 0);

  const exact = vragen.map((v) =>
    Math.min((v.gewicht * beschikbaar) / totaalGewicht, v.gevraagd)
  );
  const toegewezen = exact.map((e) => Math.floor(e));
  let rest = beschikbaar - toegewezen.reduce((s, v) => s + v, 0);

  const opRest = exact
    .map((e, i) => ({ i, rest: e - Math.floor(e) }))
    .sort((a, b) => b.rest - a.rest);

  let vorigeRest = -1;
  while (rest > 0 && rest !== vorigeRest) {
    vorigeRest = rest;
    for (const { i } of opRest) {
      if (rest <= 0) break;
      if (toegewezen[i] < vragen[i].gevraagd) {
        toegewezen[i] += 1;
        rest -= 1;
      }
    }
  }
  return toegewezen;
}

function maak(tekort, aanwezig, ideaal) {
  return { gevraagd: tekort, gewicht: tekort * urgentie({ aanwezig, ideaal }) };
}

console.log("Smoke-test verdeling winkelaanvulling\n");

/* 1 — genoeg voor iedereen: iedereen krijgt precies zijn tekort. */
const ruim = verdeel([maak(5, 0, 10), maak(3, 8, 10)], 20);
check(
  "bij genoeg voorraad krijgt iedereen precies zijn tekort",
  ruim[0] === 5 && ruim[1] === 3,
  `[${ruim}]`
);

/* 2 — nooit meer dan er ligt. */
const krap = verdeel([maak(10, 0, 10), maak(10, 0, 10)], 7);
check(
  "de som is nooit hoger dan wat er beschikbaar is",
  krap[0] + krap[1] === 7,
  `${krap[0]}+${krap[1]}=${krap[0] + krap[1]}`
);

/* 3 — nooit meer dan gevraagd, ook niet bij hoge urgentie. */
const overvraag = verdeel([maak(2, 0, 10), maak(20, 9, 10)], 15);
check(
  "een winkel krijgt nooit meer dan zijn tekort",
  overvraag[0] <= 2 && overvraag[1] <= 20,
  `[${overvraag}] tegenover gevraagd [2, 20]`
);
check(
  "restant gaat naar wie het nog kwijt kan i.p.v. verloren te gaan",
  overvraag[0] + overvraag[1] === 15,
  `som=${overvraag[0] + overvraag[1]}`
);

/* 4 — de lege winkel gaat voor bij gelijk tekort. */
const eerlijk = verdeel([maak(6, 0, 6), maak(6, 24, 30)], 6);
check(
  "bij gelijk tekort krijgt de lege winkel meer dan de bijna volle",
  eerlijk[0] > eerlijk[1],
  `leeg=${eerlijk[0]} vol=${eerlijk[1]}`
);

/* 5 — zonder ideaal valt hij terug op puur tekort. */
const zonderIdeaal = verdeel([maak(4, 0, 0), maak(4, 0, 0)], 4);
check(
  "zonder ideaal verdeelt hij gelijk over gelijke tekorten",
  zonderIdeaal[0] === 2 && zonderIdeaal[1] === 2,
  `[${zonderIdeaal}]`
);

/* 6 — niets beschikbaar levert niemand iets op. */
const leeg = verdeel([maak(5, 0, 10), maak(5, 0, 10)], 0);
check("zonder voorraad krijgt niemand iets", leeg.every((v) => v === 0));

/* 7 — geen stuk verdwijnt aan afronding. */
const drie = verdeel([maak(1, 0, 3), maak(1, 1, 3), maak(1, 2, 3)], 2);
check(
  "afronding laat geen stuks verdwijnen",
  drie.reduce((s, v) => s + v, 0) === 2,
  `[${drie}]`
);

/* 8 — urgentie zit tussen 1 en 2, nooit daarbuiten. */
const grenzen = [
  urgentie({ aanwezig: 0, ideaal: 10 }),
  urgentie({ aanwezig: 10, ideaal: 10 }),
  urgentie({ aanwezig: 50, ideaal: 10 }),
  urgentie({ aanwezig: 0, ideaal: 0 }),
];
check(
  "urgentie blijft tussen 1 en 2",
  grenzen.every((g) => g >= 1 && g <= 2),
  `[${grenzen.map((g) => g.toFixed(2))}]`
);

console.log(`\n${mislukt === 0 ? "Alles in orde." : `${mislukt} test(s) mislukt.`}`);
process.exit(mislukt === 0 ? 0 : 1);
