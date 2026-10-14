# Utvidelse til automatisk offentlig utstedelse

Operatøren ba 14. oktober om å gå gjennom positive treff og åpne for alle som
består kontrollene. Dette erstatter Devotta-avgrensningen; kontrollreglene endres
ikke. Omfanget settes eksplisitt til `ISSUANCE_SCOPE=all_matching`.

## Gjennomgang før aktivering

Alle 22 organisasjoner med et tidligere positivt live-resultat ble kontrollert
på nytt, skrivebeskyttet, 14. oktober kl. 17.05.45–17.05.54 UTC. Alle fikk `match`
med fersk Brreg-enhet, aktiv konto, toveis domene/DID og samsvarende profilnavn.
For hvert domene viste fullregisterindeksen bare én enhet, også når `www`-varianten
ble tatt med. Ingen unntak for navneavvik eller domenegrenser ble lagt inn.

| Org.nr.   | Registrert navn                                | Kontoens handle         |
| --------- | ---------------------------------------------- | ----------------------- |
| 922669708 | DEVOTTA AS                                     | devotta.no              |
| 971524960 | STORTINGET                                     | stortinget.no           |
| 834785862 | AARHUS UNIVERSITET                             | au.dk                   |
| 830561382 | VARMERE VÅTERE VILLERE                         | varmerevaterevillere.no |
| 911706563 | NORSK FORENING FOR EUROPARETT                  | europarett.no           |
| 871023832 | FK HAUGESUND                                   | fkh.no                  |
| 879554802 | NORFUND                                        | norfund.no              |
| 914740045 | PSYNAPSE                                       | psynapse.no             |
| 915417930 | HARALD KOLDERUP                                | haraldkolderup.com      |
| 919513586 | APPARAT AS                                     | apparat.no              |
| 921440898 | FURWAY                                         | furway.no               |
| 927048647 | DRUGS FOR NEGLECTED DISEASES INITIATIVE (DNDI) | dndi.org                |
| 928693309 | STIKADO                                        | stikado.org             |
| 928914038 | DIASPORA BERGENSIS                             | diasporabergensis.no    |
| 931830015 | DISKUTOPIA                                     | diskutopia.no           |
| 971274042 | METEOROLOGISK INSTITUTT                        | met.no                  |
| 926692305 | TOONS MAG                                      | toonsmag.com            |
| 937646186 | ASLAK HELLEVIK                                 | aslakhellevik.no        |
| 986692401 | NORSK FORENING FOR INTERNASJONAL RETT          | nfir.no                 |
| 932977745 | DIGITAL HAZARISTAN                             | digitalhazaristan.com   |
| 984397569 | FRIBYTE                                        | fribyte.no              |
| 995306360 | NORSK KLIMASTIFTELSE                           | klimastiftelsen.no      |

Dette er en vurdering av kontrollgrunnlaget, ikke en generell kvalitetsvurdering
av organisasjonene. Verifikasjonen bekrefter domenetilknytning, kontoidentitet og
navnesamsvar, ikke juridisk fullmakt. Enkeltpersonforetak og utenlandske enheter
registrert i Brreg følger samme regler. Ingen organisasjonsform er unntatt eller
særskilt godkjent.

## Videre automatikk

Kjente kontoer kølegges for fersk kontroll ved oppstart. Hvert nytt positivt treff
kan utstedes uten manuell innmelding på en liste. Et gammelt treff er aldri alene
grunnlag for publisering. Navneavvik, delte domener og tekniske feil holdes tilbake.

Positive kontroller gjentas daglig; andre domener ukentlig. Relevante Brreg- og
kontohendelser fremskynder ny kontroll. Endringer bare i DNS kan vente på neste
planlagte kontroll hvis ingen kontohendelse kommer. Det loves ikke umiddelbar
oppdagelse eller at enhver organisasjon kan oppfylle reglene.

Ingen fullimport kjøres på nytt. Negative kandidater kan fortsatt bruke den ferske
registerindeksen, mens positive treff henter Brreg og identitet på nytt før
utstedelse. Brreg-poll, samtidighet og retry-grenser er beholdt.

## Validering

- `pnpm check`: 55 tester bestått, inkludert utstedelse uten pilotoppføring,
  duplikatvern, tilbaketrekking, tilbakegang til pilot og sperrer for foreldet
  kontroll, indeksgrunnlag, registerfeil, delte domener og usikre resultater.
- Ekte isolert PDS: publisering, gjenforsøk, databasegjenåpning og tilbaketrekking
  bestått. Worker-integrasjonen kjører `all_matching` med tom pilotliste.
- Nettverksisolasjon og hele CI-kontrollen bestått.
- Konsistent SQLite-backup med bestått integritetskontroll og tidligere Compose/
  deploy-konfigurasjon: `/root/loftet-rollbacks/verifier-all-matching-20261014`.

Rollback skal bevare ny publiseringshistorikk. Gå tilbake til pilotomfang og la
arbeideren trekke tilbake utstedelser utenfor listen. Å stoppe offentlig utstedelse
fryser writes og er ikke en tilbakekalling. Ikke gjenopprett en gammel database over
nye offentlige records.

## Bekreftet i produksjon

Kodeversjon `d35d8a321ea46b8bf0932acfaa74ecef7a43bfcd` ble rullet ut kun til
app-containeren etter grønn CI. Utstederen er fortsatt Eurosky-kontoen
`er-verifier.demokratiloftet.no` (`did:plc:ajyco6mbknwtlx567ugu4wer`).
Compose, image-override og deploy-metadata lagrer `all_matching` med tom pilotliste.

- 21 nye records ble publisert kl. 17.12.46–17.13.27 UTC, i tillegg til Devotta.
- Alle 22 records ble hentet offentlig fra Eurosky med paginering og sammenlignet
  med hele publiseringsintensjonen i databasen. 22 forskjellige subject-DIDs,
  ingen publiseringsfeil og ingen `app.bsky.feed.post`-records.
- Alle 22 fikk deretter en ny kontroll. Siste avstemming var kl. 17.14.35 UTC.
  Offentlige URI-er, CID-er, innhold og `createdAt` var uendret; ingen duplikater.
- Devottas opprinnelige Eurosky-record og CID er beholdt.
- Ekstern, autentisert HTTPS-readiness svarte 200. Worker, Brreg og Jetstream var
  ferske. Registeret var komplett og avstemt; ingen ny fullimport ble kjørt.

Dette betyr at automatisk utstedelse er aktiv for alle som består reglene. Det
betyr ikke at alle registrerte domener har en konto eller er ferdig avklart:
34 582 jobber ventet på nytt forsøk i målingen kl. 17.13 UTC. Tekniske feil er
fortsatt usikre resultater. Klienter må selv velge å stole på utstederen og vise
recordene; publisering gir ikke automatisk et merke i Bluesky eller andre apper.
