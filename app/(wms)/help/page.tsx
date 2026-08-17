import { Kaart } from "@/components/ui/Basis";
import { Icon } from "@/components/ui/Icon";

export const dynamic = "force-dynamic";

/**
 * Handleiding voor de vloer.
 *
 * Geschreven voor iemand die het magazijn in loopt, niet voor een ontwikkelaar.
 * Per taak staat er wat je doet en waaróm het zo werkt — dat tweede is wat mensen
 * onthouden. Wie snapt waarom hij blind moet tellen, gaat niet spieken; wie het
 * alleen als regel hoort, wel.
 */

function Stap({ nummer, children }: { nummer: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-navy text-xs font-bold text-white">
        {nummer}
      </span>
      <span className="text-sm text-navy">{children}</span>
    </li>
  );
}

function Waarom({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-3 rounded-lg bg-navy-50 px-3 py-2 text-sm text-slate">
      <span className="font-semibold text-navy">Waarom: </span>
      {children}
    </p>
  );
}

export default function HelpPagina() {
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-bold text-navy">Handleiding</h1>
        <p className="text-sm text-slate">
          Hoe je met het magazijnsysteem werkt, en waarom het zo werkt.
        </p>
      </header>

      <Kaart titel="De terminal">
        <ol className="space-y-2">
          <Stap nummer={1}>
            Log in met je personeelsnummer en je pincode — dezelfde als in de portal.
            Je hoeft niets nieuws te onthouden.
          </Stap>
          <Stap nummer={2}>
            Op het startscherm staan tegels met een getal erop. Dat getal is hoeveel
            werk er ligt. Geen getal betekent: hier hoef je nu niet te zijn.
          </Stap>
          <Stap nummer={3}>
            Scannen doe je gewoon met de scanner. Het invulveld staat al scherp, dus
            richten en knijpen is genoeg. Typen mag ook, als een label onleesbaar is.
          </Stap>
        </ol>
        <Waarom>
          De terminal is een app op je scherm, geen website in een browser. Daardoor
          start hij volledig scherm op en zit je nooit per ongeluk in een verkeerd
          tabblad.
        </Waarom>
      </Kaart>

      <Kaart titel="Als de wifi wegvalt">
        <p className="text-sm text-navy">
          Achter een stelling of bij de kade valt de verbinding soms weg. Je merkt dat
          aan een gele balk bovenaan. Blijf gewoon doorwerken: je scans worden bewaard
          op de terminal zelf en verstuurd zodra er weer verbinding is.
        </p>
        <p className="mt-2 text-sm text-navy">
          Zie je een rode balk met &ldquo;geweigerd&rdquo;, dan is er iets inhoudelijk
          mis met een boeking — bijvoorbeeld meer weggehaald dan er lag. Meld dat bij
          je teamleider; opnieuw scannen helpt dan niet.
        </p>
        <Waarom>
          Scans die verdwijnen zijn erger dan scans die later aankomen. En omdat elke
          scan een eigen kenmerk meekrijgt, kan hij nooit dubbel geboekt worden — ook
          niet als de terminal het twee keer probeert.
        </Waarom>
      </Kaart>

      <Kaart titel="Ontvangst: een levering uitpakken">
        <ol className="space-y-2">
          <Stap nummer={1}>Kies de levering en druk op beginnen met uitpakken.</Stap>
          <Stap nummer={2}>Scan een artikel uit de doos.</Stap>
          <Stap nummer={3}>Tel hoeveel je ervan hebt en tik dat aantal in.</Stap>
          <Stap nummer={4}>
            Beschadigd? Vul in hoeveel, en wat er mis is. Die gaan naar quarantaine, niet
            het schap in.
          </Stap>
          <Stap nummer={5}>Volgende artikel scannen. Zo tot de doos leeg is.</Stap>
        </ol>
        <Waarom>
          Het verwachte aantal staat er pas nádat je jouw aantal hebt ingevuld. Wie ziet
          dat er tien verwacht worden, telt er tien — ook als er negen liggen. Dit is de
          enige plek waar je een fout van de leverancier nog kunt vinden.
        </Waarom>
      </Kaart>

      <Kaart titel="Inslag: voorraad wegzetten">
        <ol className="space-y-2">
          <Stap nummer={1}>Scan het vak waar je gaat inboeken.</Stap>
          <Stap nummer={2}>
            Scan daarna artikel na artikel. Het vak blijft staan — je hoeft het niet elke
            keer opnieuw te scannen.
          </Stap>
          <Stap nummer={3}>
            Misgescand? Druk op &ldquo;ongedaan&rdquo; achter die regel.
          </Stap>
        </ol>
        <Waarom>
          Ongedaan maken haalt de boeking niet weg maar zet er een tegenboeking
          tegenover. Zo blijft zichtbaar wát er gebeurd is. Voorraad die stil verdwijnt
          uit de historie is precies hoe niemand later nog kan uitleggen waarom het niet
          klopt.
        </Waarom>
      </Kaart>

      <Kaart titel="Picken met bakken">
        <ol className="space-y-2">
          <Stap nummer={1}>
            Zet de bakken op je kar, genummerd 1, 2, 3 — in de volgorde waarin ze op het
            scherm staan.
          </Stap>
          <Stap nummer={2}>
            Loop naar het vak dat groot in beeld staat. Scan het vak, scan het artikel.
          </Stap>
          <Stap nummer={3}>
            Pak het totale aantal dat er staat — dat is voor de hele kar samen.
          </Stap>
          <Stap nummer={4}>
            Verdeel het over de bakken zoals eronder staat, en druk op gepakt en
            verdeeld.
          </Stap>
          <Stap nummer={5}>
            Ligt er te weinig? Druk per bak op de knop en geef aan wat je wél had. Jij
            bepaalt welke bak voorrang krijgt.
          </Stap>
        </ol>
        <Waarom>
          Je loopt het magazijn één keer door voor tien orders in plaats van tien keer
          voor één. Het lopen kost de tijd, niet het pakken. En jij staat bij de
          stelling — jij ziet welke order haast heeft, het systeem niet.
        </Waarom>
      </Kaart>

      <Kaart titel="Inpakken">
        <ol className="space-y-2">
          <Stap nummer={1}>Kies de bak of order aan de paktafel.</Stap>
          <Stap nummer={2}>Scan elk artikel dat je in de doos legt.</Stap>
          <Stap nummer={3}>Kies de doosmaat, weeg, en druk op doos dicht.</Stap>
          <Stap nummer={4}>
            Plak het label, scan of tik het trackingnummer, en verzend.
          </Stap>
        </ol>
        <Waarom>
          Dit is de laatste plek waar een verkeerd artikel nog op tafel ligt in plaats
          van onderweg naar Groningen. Twee seconden scannen per stuk kost minder dan één
          retour. Scan je iets dat er niet bij hoort, dan zegt het scherm dat direct.
        </Waarom>
      </Kaart>

      <Kaart titel="Retouren beoordelen">
        <ol className="space-y-2">
          <Stap nummer={1}>Scan het ordernummer van het retourlabel.</Stap>
          <Stap nummer={2}>Scan de artikelen die erin zitten.</Stap>
          <Stap nummer={3}>
            Geef per artikel je oordeel: verkoopbaar, herstel, of afkeur.
          </Stap>
        </ol>
        <Waarom>
          Doe het oordeel meteen, terwijl de doos openligt en je het artikel in je hand
          hebt. Later betekent alles twee keer aanraken. Herstel en afkeur zijn echte
          plekken in het magazijn, geen vinkje — de spullen liggen ergens, dus horen ze
          ergens te staan.
        </Waarom>
      </Kaart>

      <Kaart titel="Tellen">
        <ol className="space-y-2">
          <Stap nummer={1}>Scan het vak dat je gaat tellen.</Stap>
          <Stap nummer={2}>Scan een artikel en tik in hoeveel je ervan telt.</Stap>
          <Stap nummer={3}>
            Onderaan staat wat je nog niet geteld hebt. Tel je iets niet, dan blijft dat
            saldo staan zoals het was.
          </Stap>
        </ol>
        <Waarom>
          Je ziet niet hoeveel er verwacht wordt. Dat is bewust: met het verwachte getal
          in beeld tel je onbewust naar dat getal toe. Wat jij telt wordt de nieuwe
          waarheid, dus het moet van het schap komen en niet van het scherm.
        </Waarom>
      </Kaart>

      <Kaart titel="Taken">
        <p className="text-sm text-navy">
          Niets omhanden? Ga naar Taken en pak de bovenste. De lijst staat op looproute,
          dus van boven naar beneden werken betekent dat je niet heen en weer loopt.
        </p>
        <p className="mt-2 text-sm text-navy">
          Bij aanvullen krijg je te zien uit welk vak je het kunt halen. Ligt het er
          niet? Kies een ander vak uit de lijst, of meld het bij je teamleider.
        </p>
        <Waarom>
          Aanvullen gebeurt voordat een pikvak leeg is, niet erna. Een picker die voor
          een leeg vak staat, kost een halve ronde.
        </Waarom>
      </Kaart>

      <Kaart titel="Als iets niet klopt">
        <ul className="space-y-2 text-sm text-navy">
          <li className="flex gap-2">
            <Icon name="alert" size={18} className="mt-0.5 shrink-0 text-warn" />
            <span>
              <span className="font-semibold">Er ligt minder dan het systeem zegt.</span>{" "}
              Boek niet door — tel het vak bij Tellen. Dan komt het verschil in de
              administratie terecht in plaats van te verdwijnen.
            </span>
          </li>
          <li className="flex gap-2">
            <Icon name="alert" size={18} className="mt-0.5 shrink-0 text-warn" />
            <span>
              <span className="font-semibold">Een artikel heeft geen barcode.</span> Typ
              de SKU over. Ongeveer één op de zes artikelen heeft er nog geen; daar wordt
              aan gewerkt.
            </span>
          </li>
          <li className="flex gap-2">
            <Icon name="alert" size={18} className="mt-0.5 shrink-0 text-warn" />
            <span>
              <span className="font-semibold">Een vak heeft geen label.</span> Meld het,
              of print het zelf bij Labels. Zonder label kan niemand dat vak scannen.
            </span>
          </li>
        </ul>
        <Waarom>
          Een verschil dat je meldt, is een verschil dat opgelost wordt. Een verschil dat
          je wegboekt om verder te kunnen, komt over drie maanden terug als een
          voorraadstand die niemand meer kan uitleggen.
        </Waarom>
      </Kaart>
    </div>
  );
}
