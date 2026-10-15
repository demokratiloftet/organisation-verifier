# Automatisk verifikasjon

Implementasjonen bruker samme Fastify-prosess og SQLite-database som demoen. En avgrenset
pool behandler varige jobber, med fire samtidige kontroller som standard. Ingen Redis, ny tjeneste eller
innloggingsplattform er nødvendig. Demonstrasjonsfanen og manuelle Brreg-oppslag
beholder sine tidligere grenser. Offentlig publisering er avslått som standard.

## Regler for automatisk utstedelse

- Vi bekrefter domenetilknytning til en Brreg-enhet, ikke juridisk fullmakt.
- Registrert host prøves først. Hvis ingen konto er toveis bekreftet der, kan én
  innledende `www.` fjernes og domenet kontrolleres på nytt. Nettverksfeil eller
  navneavvik gir ikke dette unntaket. Public Suffix List hindrer fallback til et offentlig eller privat suffix.
  Andre foreldredomener støttes ikke.
- Profilnavnet må samsvare etter Unicode-, mellomrom- og bokstavnormalisering.
  Ett avsluttende, separat `AS` i registernavnet kan utelates i profilnavnet.
  Vi fjerner ikke `ASA`, `A/S`, prefikser eller ord inne i navnet. Profilens faktiske
  navn beholdes i verifikasjonsrecorden.
- HTTPS-oppslaget for en handle følger videresendinger, slik AT-protokollen tillater.
  Hvert hopp må fortsatt bruke HTTPS på standardport til en offentlig adresse, og
  hele kjeden har åtte sekunders tidsgrense. DID-dokumentet må bekrefte opprinnelig
  handle; en videresending endrer ikke hvilken identitet som kontrolleres.
- Flere enheter med samme host, med eller uten `www`, tillates bare når
  profilnavnet matcher nøyaktig én av dem etter samme navneregel. Nettsteder med
  sti telles med, selv om de ikke selv kan verifiseres. To mulige navnetreff gir
  vurderingsbehov; et eksakt treff prioriteres ikke foran et treff uten `AS`.
  Slettede enheter teller ikke. Unikheten kontrolleres også før selve publiseringen.
- Positive kontroller gjentas daglig; andre kjente domener ukentlig. Register- og
  kontohendelser kølegger tidligere kontroll. Identitetshendelser uten handle og
  nye aktive kontoer får først et DID-oppslag for å finne relevante enheter.
- Usikre oppslag prøves igjen etter 30 sekunder, deretter eksponentielt. Kjente
  kontoer og pilot-/publiseringsjobber har maksimalt én time mellom forsøk; andre
  vedvarende feil har maksimalt ett døgn. Nye relevante hendelser fremskynder kontrollen. Etter syv dager uten en fullført kontroll trekkes eksisterende verifikasjon
  tilbake. En vellykket kontroll kan utstede på nytt. Dette er gjeldende policy.
- Ny utstedelse krever komplett import, ferdig registeravstemming og registerpoll
  innen fem minutter. Tilbaketrekking kan fortsette under registerfeil.
- Utstedelsesomfang velges eksplisitt: `ISSUANCE_SCOPE=pilot` krever `PILOT_ORGNRS`;
  `ISSUANCE_SCOPE=all_matching` tillater alle organisasjoner som består kontrollene.
  Standard er fortsatt pilot. Ingen liste omgår kravene. Bytte tilbake til pilot
  trekker utstedelser utenfor listen tilbake ved neste kontroll. Å slå av
  offentlig utstedelse stopper alle writes; det tilbakekaller ikke automatisk.
- Publisheren avviser positive kontroller fra lokalindeksen og kontroller eldre enn
  fem minutter. Ved oppstart med `all_matching` kølegges kjente kontoer for fersk
  kontroll; gamle treff publiseres aldri direkte. Nyoppdagede treff utstedes fortløpende.
- VPS-en har HTTPS og en felles operatørinnlogging. Flere tilgangsroller er ikke innført.

Policyversjonen `name-unique-v4` lagres med nye kontroller. Ingen prøveidentiteter
kan passere den offentlige publisheren. En offentlig utstederkonto og en konto
som skal verifiseres er to ulike roller.

Ved overgang til `name-unique-v4` kølegges alle eksisterende enheter med domene
eller kjent konto for fersk kontroll, én gang per policyversjon. Det inkluderer
kandidater som tidligere ble stoppet før identitetsoppslag. Ingen ny fullimport
eller databaseendring kreves. Vanlig frekvensgrense og alle utstedelseskrav gjelder.
`worker.policyVersion` lagres atomisk med køleggingen. Nye navne-/domeneendringer
fremskynder kontroll av berørte kontoer, også på domener med flere enn to enheter.

Eksempler fra offentlige oppslag 14. oktober 2026, dekket av isolerte tester:

| Organisasjon           | Profilnavn             | Ny vurdering                                                      |
| ---------------------- | ---------------------- | ----------------------------------------------------------------- |
| MILJØPARTIET DE GRØNNE | Miljøpartiet De Grønne | Navnet identifiserer hovedorganisasjonen blant enhetene på mdg.no |
| AFTENPOSTEN AS         | Aftenposten            | Tillatt utelatelse av avsluttende AS                              |
| MORGENBLADET AS        | Morgenbladet           | Tillatt utelatelse av avsluttende AS                              |

Dette er ikke faste godkjenninger: hver utstedelse krever fortsatt ferske kilder,
aktiv konto, toveis identitet og entydighet i det oppdaterte registeret.

Ta SQLite-backup før utrulling og behold eksisterende utsteder-, HTTPS- og
Compose-konfigurasjon. Automatisk deploy er avslått; endringen i `store.ts` krever
kontrollert app-utrulling. Ved rollback til eldre policy kan de nylig tillatte
verifikasjonene bli trukket tilbake ved neste kontroll. Behold nyere database og
publiseringshistorikk; ikke gjenopprett gammel database for å rulle tilbake kode.

**Devotta som kandidat:** Et faktisk oppslag 13. oktober 2026 bekreftet DEVOTTA AS,
`922669708`, med registrert hjemmeside `www.devotta.no` og toveis koblet konto
`devotta.no` på Eurosky. Profilnavnet samsvarer. Dette er en positiv manuell
kontroll, ikke en offentlig utstedelse eller fullregisterkontroll av delte domener.

## Start automatikk uten offentlig publisering

Kjør følgende fra repoet, med de låste Node-/pnpm-versjonene, Docker og Compose:

```sh
pnpm install --frozen-lockfile
pnpm check

dc() { docker compose -f compose.yaml -f compose.automation.yaml "$@"; }
dc build app
dc up -d --wait
# Legg en enkelt reell organisasjon i kø før fullimport, kun som forhåndsvisning:
dc exec -T app node dist/src/cli.js enqueue 922669708
dc exec -T app node dist/src/cli.js status
```

Operatørsiden viser kø, retry-status og registerfremdrift når automatikk er på.
`http://127.0.0.1:3012/api/automation` gir samme informasjon maskinlesbart.
Bakgrunnsprosessen kobler til Jetstream v2 og gjør kun offentlige lesinger.

## Førstegangsimport

Brreg leverer et daglig gzip-komprimert JSON-snapshot. Nedlasting skriver en
`.part`-fil og flytter den først når den er komplett. Filen ved siden av, `.since`,
lagrer tidspunktet endringsstrømmen skal spilles fra: én dag før snapshotets
Last-Modified. Dette inkluderer endringer mellom snapshot-produksjon og nedlasting.

```sh
dc exec -T app node dist/src/cli.js download /data/register.json.gz
# Bare appen stoppes. Fixture og andre prosjekter skal ikke stoppes.
dc stop app
dc run --rm --no-deps app node dist/src/cli.js import /data/register.json.gz
dc up -d --wait app
```

Importer med appen stoppet, én importprosess av gangen. Importen streamer JSON
og lagrer 250 enheter og fremdrift i samme transaksjon. Etter avbrudd kjøres samme
importkommando med samme fil. Den verifiserer filens SHA-256 og leser frem til siste
lagrede posisjon. Den laster aldri hele registeret inn i minnet. En annen fil
starter en ny import. Ikke rediger snapshot eller `.since` manuelt. Velg et nytt filnavn ved neste
nedlasting; en ferdig fil overskrives ikke.

Etter import hentes registerendringer i stigende ID-rekkefølge. Enhetens nåværende
innhold hentes før jobb og cursor lagres atomisk. Først når endringsstrømmen er
innhentet, kan offentlig utstedelse begynne. Organisasjoner uten hjemmeside
indekseres, men trenger ingen innledende atproto-kontroll.

## Effektiv behandling og målbar fremdrift

- Registerpoll og kontrollpool kjører uavhengig. En treg nettside blokkerer ikke
  registeroppdateringen, og avstemming begrenser ikke lenger kontroller til én per
  minutt. Utstedelse venter fortsatt på komplett og ferskt register.
- Standard er fire samtidige jobber. `WORKER_CONCURRENCY` kan settes til 1–8 i
  appens miljø; uansett startes høyst fire jobber per sekund totalt. Alle oppslag
  beholder sine tidsavbrudd og SSRF-grenser.
- Hver fjerde ledige køplass reserveres til førstegangsskanning når det er etterslep.
  Eksplisitte pilotjobber går først. Endringsjobber og retries kan ikke holde hele
  førstegangskøen tilbake. Leases hindrer at to arbeidere behandler samme jobb.
- Når registeret er komplett og nylig avstemt, brukes lokalindeksen til
  kandidatkontroll. Dette sparer ett Brreg-oppslag for hver negativ kandidat.
  Også delte domener får identitetsoppslag, siden profilnavnet avgjør unikheten. Positive kandidater kontrolleres
  på nytt mot fersk Brreg-enhet og fersk identitet. Kjente kontoer, pilotjobber og
  eksisterende utstedelser får alltid ferske oppslag. Manuelle kontroller er uendret.
- Brreg-endringer hentes i sider på 100, med høyst fire samtidige enhetsoppslag.
  Flere hendelser for samme enhet på én side krever bare ett oppslag. Endringer
  uten betydning for navn, hjemmeside eller sletting starter ingen ny kontroll.
  Organisasjoner uten hjemmeside/kjent konto trenger ingen identitetskontroll.
- Scheduler bruker en delindeks over organisasjoner med host eller DID. Den
  undersøker ikke alle enheter uten nettside hvert minutt. Indeksen opprettes
  også på eksisterende databaser, uten å endre eller fjerne data.
- Register-/kontohendelser som kommer under en kontroll gjør resultatet foreldet.
  Det forkastes før lagring/publisering, og nyere køversjon beholdes.

Operatørsiden skiller mellom registerstørrelse, registrerte domener, organisasjoner
med minst én fullført kontroll (også uten treff), organisasjonskø og kontooppslag fra Jetstream. Den
viser faktisk behandlede jobber siste minutt, **inkludert mislykkede forsøk**.
Dette tallet er ikke antall vellykkede verifikasjoner eller en ferdigdato.
`worker.completed`, `worker.meanDurationMs`, `worker.active` og
`worker.completedLastMinute` i status-API-et gjelder inneværende prosess; kø og
kontrollhistorikk overlever restart.

Landsdekkende første gjennomgang er fortsatt en bakgrunnsjobb. Ingen ny fullfil
lastes ned ved vanlig restart eller sidevisning. Den opprinnelige strømmeimporten
ble prøvd lokalt med 1 177 715 enheter, 114 124 kølagte kontroller, cirka tre minutter
inkludert nedlasting og 524 MiB maksimal RSS. Det måler import, ikke nettverkskontroller.

En reproducerbar lokal måling uten offentlige nettverkskall:

```sh
pnpm build
node dist/scripts/benchmark-worker.js
```

Målingen sammenligner én og fire arbeidere med 16 jobber og 1,2 sekunders simulert
kildelatens, inklusive ekte kø/leases og felles frekvensgrense. Den er ingen
lasttest av Brreg, DNS eller PDS. Se [valideringsloggen](validation.md) for resultater.

## Slå på en avgrenset offentlig pilot

Før dette steget: avtal reglene ovenfor, velg utstederkonto og PDS, bekreft mål-
kontoenes domener og registrerte navn, kjør fullimport og gjennomgå forhåndsvisningen.
Synlig Bluesky-merke avhenger av klientens tillit til utstederen og loves ikke.

Legg følgende ikke-hemmelige innstillinger i den ignorerte `.env`-filen:
`ISSUER_PDS` (HTTPS-origin), `ISSUER_DID`, `ISSUER_IDENTIFIER`, `ISSUANCE_SCOPE=pilot`
og `PILOT_ORGNRS` (kommadelt liste). For automatisk utstedelse til alle som består,
sett `ISSUANCE_SCOPE=all_matching`; pilotlisten kan da være tom. Privat utstedelse
støtter bare pilotomfang. Legg utstederens app-passord i `.runtime/issuer-password`, med
lesetilgang bare for operatøren og containerens UID 1000. Ikke legg passord i Git,
kommandolinjeargumenter eller logger. Bruk en dedikert utstederkonto.

```sh
# Ta backup først; kommandoen under krever den eksisterende kjørende appen.
dc exec -T app node dist/src/cli.js backup /data/before-pilot.sqlite
# Behold alle tre filer i senere driftskommandoer:
docker compose -f compose.yaml -f compose.automation.yaml -f compose.issuer.yaml up -d --wait app
```

Utstederens innloggede DID må være nøyaktig den konfigurerte DID-en. SDK-kall får
ikke flytte legitimasjonen til en annen origin. `PUBLIC_ISSUANCE_ENABLED` uten
komplett konfigurasjon avvises. Ingen HTTP-rute kan slå på publisering.

Etter oppstart, gjennomgå en publisert record på utstederens PDS, gjenta kontrollen,
og gjennomfør en avtalt tilbaketrekking. Dette krever en faktisk utsteder og
målorganisasjon; automatiske tester mot den isolerte PDS-en erstatter ikke denne
akseptansen. Se [gjeldende produksjonsstatus](public-issuer.md).

## Backup, gjenoppretting og oppgradering

`node dist/src/cli.js backup <ny-fil.sqlite>` bruker SQLite sin online-backup og
kjører `integrity_check` på kopien. Kopier backupen ut av VPS-en med eksisterende
backupverktøy. Ta vare på konfigurasjon og utstederhemmelighet separat; de er ikke
i SQLite. Kjør backup daglig og før migrasjon.

Ved restore: stopp appen, behold den skadde databasen og dens `-wal`/`-shm`-filer
under nye navn, kopier den kontrollerte backupen til `DATABASE_PATH`, og sett riktig
eier/filrettigheter før appen startes. Ikke bland en gjenopprettet hovedfil med
gamle WAL-filer. Start med offentlig publisering avslått. Kontroller kø, historikk,
cursor og utstederkonto før writes aktiveres igjen. Periodiske kontroller
avstemmer kjente records med PDS; ikke gjenopprett fixture-DIDs som produksjonsdata.

Skjemaversjon 1 er en additiv migrasjon fra den gamle demoen. Eksisterende checks
og publications beholdes. Nyere ukjente skjemaversjoner avvises. Testen for
backup/restore åpner den faktiske backupen og kontrollerer jobb, cursor og record.

**Eksisterende VPS:** dette er en endring i skjema og driftskonfigurasjon, så den
krever kontrollert utrulling i tråd med `operations.md`. Ikke bygg over den aktive
managed-deploy-installasjonen fra en gammel checkout. Automatikk og offentlig
publisering er separate opt-ins; eksisterende demo fortsetter uten dem.

## Overvåking og feil

- `/health`: prosessen svarer. Brukes til containerens helsesjekk.
- `/ready`: HTTP 503 ved manglende worker-heartbeat, gammel registerpoll eller
  stille Jetstream når disse er aktivert. Koble eksisterende overvåking til denne
  adressen over SSH/loopback og varsle ved vedvarende 503.
- `/api/automation` eller CLI `status`: importfase, køstørrelse, retry-antall,
  eldste jobb og kildefremdrift. Se særlig etter voksende kø og retry-jobber.
- Jetstream-cursor og jobbinnlegging lagres atomisk. Reconnect spiller fra et
  overlappende tidspunkt. Duplikater ignoreres. En rapportert retention-gap setter
  alle organisasjoner til ny kontroll, så hendelser ikke er eneste sannhetskilde.
- Ukjent utfall av put/delete avstemmes ved samme record-nøkkel. Eksternt endrede
  records overskrives/slettes ikke automatisk; operatøren må undersøke dem.
- Rutinehistorikk beholdes i 90 dager. Publiseringsintensjon/-historikk beholdes.
  Ingen nye e-post-, SMS- eller Slack-varsler er konfigurert.

## Kilder og verifikasjon

- [Brreg API og oppdateringsstrøm](https://data.brreg.no/enhetsregisteret/api/dokumentasjon/no/index.html)
- [Jetstream v2-protokoll](https://bsky.network/docs/jetstream/)
- [Handle-kontroll](https://atproto.com/specs/handle)

`pnpm check` tester migrasjon, importavbrudd, jobb-retry/lease, atomiske cursors,
Jetstream-duplikater/gaps, policy, offentlig transportgrense og backup/restore.
`pnpm test:integration` og `pnpm test:worker-integration` kontrollerer records på
en ekte isolert PDS. CI kjører begge, samt nettverksisolasjon og sikkerhetsskann.
