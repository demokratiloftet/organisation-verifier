# LOFT-76: ferdigkriterier og videre bruk

Oppdatert 14. oktober 2026. [LOFT-76](https://devotta.atlassian.net/browse/LOFT-76)
krever en full registergjennomgang og faktisk offentlig publisering. Kode og en
positiv manuell kontroll er ikke alene nok til å lukke oppgaven.

Fullimport er kjørt på VPS-en (1 177 860 enheter i snapshotet). Registerendringer
og kontroller behandles fortløpende. Offentlig utstedelse er aktiv for alle organisasjoner som består
kontrollene, med eksplisitt `all_matching`-omfang. 22 records er publisert og lest
utenfra; se [gjennomgang og akseptanse](automatic-issuance-2026-10-14.md). Automatikken er merget i PR #6.
Utstederkontoen ligger nå hos Eurosky; operatørsiden kjører på Demokratiloftet-domenet. Se
[oppsett og gjennomført akseptanse](public-issuer.md).

## Kort restliste

- [x] Dedikert offentlig Demokratiloftet-utsteder på Eurosky, med offentlig PLC/DNS og HTTPS.
- [ ] Bekreft hva vi lover: domenetilknytning, navnekrav, delte domener og regler for tilbaketrekking. Fullfør angrepsgjennomgangen i LOFT-87.
- [x] Fullfør import og endringsavstemming. Nye Brreg-endringer behandles fortløpende.
- [x] Publiser Devotta-piloten offentlig og les recorden utenfra og fra begge egne apper. Ny kontroll beholdt samme record uten duplikater. Den gamle private verifikasjonen ble faktisk trukket tilbake; publisering/tilbaketrekking er også testet mot isolert PDS i CI.
- [ ] Fullfør første kontrollbatch, dokumenter feil/unntak og avklar hvilke treff som er godkjent for offentlig utstedelse. Alle 22 hittil positive kandidater besto en fersk kontroll 14. oktober; tekniske feil og navneavvik skal fortsatt ikke utstedes.
- [ ] Avtal driftsansvar, varsling og backup/gjenoppretting; dokumenter akseptansen før LOFT-76 lukkes.

## Hva er en utstederkonto?

En vanlig atproto-konto som eies av den som går god for kontrollen, for eksempel
Demokratiloftet. Kontoens DID identifiserer avsenderen. Dens repository på en PDS
inneholder `app.bsky.graph.verification`-records som peker på organisasjonenes DIDs.
Å skrive den offentlige recorden til repositoryet er publiseringen; det er ikke
et vanlig innlegg i en sosial feed. Kontoen som verifiseres er en annen rolle.

Utstederen ble byttet til Eurosky 14. oktober:
`er-verifier.demokratiloftet.no`, DID `did:plc:ajyco6mbknwtlx567ugu4wer`.
PDS-en er `https://eurosky.social`. Publisheren låser
utsteder-DID og eksplisitt utstedelsesomfang. `all_matching` åpner for alle som består
reglene, uten å svekke domene-, identitets- eller navnekravene.
App-passord ligger i en beskyttet fil på VPS-en, aldri i chat, Git eller klientkode.
Både den tidligere private og den tidligere offentlige VPS-utstederens Devotta-records
er trukket tilbake; historikken beholdes. Førstegangsforsøkene er gjennomført,
men tekniske feil er fortsatt uavklarte og må ikke regnes som ferdige kontroller.

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
