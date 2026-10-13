# LOFT-76: ferdigkriterier og videre bruk

Oppdatert 13. oktober 2026. [LOFT-76](https://devotta.atlassian.net/browse/LOFT-76)
krever en full registergjennomgang og faktisk offentlig publisering. Kode og en
positiv manuell kontroll er ikke alene nok til å lukke oppgaven.

Fullimport er kjørt på VPS-en (1 177 860 enheter i snapshotet). Registerendringer
og kontroller behandles fortløpende. Intern utstedelse er aktivert for Devotta;
andre organisasjoner kontrolleres uten utstedelse. Automatikken er merget i PR #6.

## Kort restliste

- [x] Dedikert Demokratiloftet-utsteder på egen VPS: konto og app-passord er opprettet; intern pilot er valgt. Driftsansvar står på restlisten nedenfor.
- [ ] Bekreft hva vi lover: domenetilknytning, navnekrav, delte domener og regler for tilbaketrekking. Fullfør angrepsgjennomgangen i LOFT-87.
- [ ] Fullfør endringsavstemming og gjennomgå positive treff uten publisering. Full Brreg-import på VPS-en er gjort.
- [ ] Publiser for en avgrenset pilot og verifiser at en annen klient kan lese recorden. Test omkjøring uten duplikater og faktisk tilbaketrekking.
- [ ] Fullfør første kontrollbatch, dokumenter feil/unntak og avklar hvilke treff som er godkjent for offentlig utstedelse. Dagens pilotliste tillater ikke automatisk publisering for alle treff.
- [ ] Avtal driftsansvar, varsling og backup/gjenoppretting; dokumenter akseptansen før LOFT-76 lukkes.

## Hva er en utstederkonto?

En vanlig atproto-konto som eies av den som går god for kontrollen, for eksempel
Demokratiloftet. Kontoens DID identifiserer avsenderen. Dens repository på en PDS
inneholder `app.bsky.graph.verification`-records som peker på organisasjonenes DIDs.
Å skrive den offentlige recorden til repositoryet er publiseringen; det er ikke
et vanlig innlegg i en sosial feed. Kontoen som verifiseres er en annen rolle.

LOFT-76 foreslår Eurosky, men en egen Demokratiloftet-konto på vår VPS er også mulig.
Intern pilot på egen VPS er valgt 13. oktober. Utstederen er
`verifikasjon.spaces-pds.dev.demokratiloftet.no`, DID
`did:plc:ifkuegcojgr6lmmpzr5l2rai`. Se [privat utsteder](private-issuer.md).
Publisheren låser utsteder-DID og pilotliste. Offentlig publisering er avslått. App-passord legges i en
beskyttet fil på VPS-en, aldri i chat, Git eller klientkode.

## Public Suffix List og domeneregelen

`tldts` bruker Public Suffix List, inkludert private suffixes, til å hindre at
`www`-fallback krysser en registrerbar domenegrense. `www.firma.co.uk` kan prøves
som `firma.co.uk`; `www.co.uk` skal ikke bli `co.uk`, og `www.github.io` skal ikke
bli `github.io`. Vanlige eksakte handle-oppslag krever ikke at suffixet er kjent i
listen. PSL beviser verken eierskap eller at et domene finnes.

Vi beholder én begrenset `www`-fallback, med full toveis identitets- og navnekontroll.
Vi innfører ikke LOFT-79s foreslåtte generelle hopp fra vilkårlige underdomener til
registrerbart domene. Det må vurderes sammen med LOFT-87. Listen følger den låste
`tldts`-versjonen; eksisterende ukentlige Dependabot-oppdateringer må gjennomgås og
merges for å holde den oppdatert. Kilde: https://publicsuffix.org/learn/.

## Bruk i loftet-social og calendar

Begge appene kan lese recordene fra utstederens PDS og vise «Domenetilknytning
bekreftet». De må stole på en konfigurert utsteder-DID, koble `subject` til riktig
organisasjonskonto, kontrollere gjeldende handle/navn og oppdatere visningen ved
sletting eller endring. Ikke godta en record fra en vilkårlig avsender.

Dette er en mulig neste integrasjon, ikke implementert visning i disse appene.
Standardrecorden inneholder ikke organisasjonsnummer eller Brreg-grunnlag; hvis
appene trenger dette, må koblingen formidles separat. Privat kontrollhistorikk
blir på VPS-en. Offentlige records kan hentes og kopieres av andre. Bluesky-merke
krever separat tillit i Bluesky og følger ikke automatisk av publiseringen.
