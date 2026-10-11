# Automatisk verifikasjon

Implementasjonen bruker samme Fastify-prosess og SQLite-database som demoen. Én
bakgrunnsarbeider behandler varige jobber. Ingen Redis, ny tjeneste eller
innloggingsplattform er nødvendig. Demonstrasjonsfanen og manuelle Brreg-oppslag
beholder sine tidligere grenser. Offentlig publisering er avslått som standard.

## Foreløpige regler som må bekreftes før offentlig pilot

- Vi bekrefter domenetilknytning til en Brreg-enhet, ikke juridisk fullmakt.
- Bare eksakt registrert host godtas. Ingen automatisk fjerning av `www`, overgang
  til foreldredomene, navneunntak eller manuell overstyring.
- Profilnavnet må samsvare etter Unicode-, mellomrom- og bokstavnormalisering.
- Flere enheter med samme registrerte host gir manuell vurdering. Nettsteder med
  en sti telles med ved konfliktkontroll, selv om de ikke selv kan verifiseres.
- Positive kontroller gjentas daglig; andre kjente domener ukentlig. Register- og
  kontohendelser kølegger tidligere kontroll. Identitetshendelser uten handle og
  nye aktive kontoer får først et DID-oppslag for å finne relevante enheter.
- Usikre oppslag prøves igjen etter 30 sekunder, deretter eksponentielt opptil én
  time. Etter syv dager uten en fullført kontroll trekkes eksisterende verifikasjon
  tilbake. En vellykket kontroll kan utstede på nytt. Dette er en foreslått policy.
- Ny utstedelse krever komplett import, ferdig registeravstemming og registerpoll
  innen fem minutter. Tilbaketrekking kan fortsette under registerfeil.
- Utstedelse begrenses til en eksplisitt pilotliste. Fjerner man en enhet fra
  listen, trekkes tidligere utstedelse tilbake ved neste kontroll. Å slå av
  offentlig utstedelse stopper alle writes; det tilbakekaller ikke automatisk.
- Operatørtilgang er fortsatt SSH/loopback. Offentlig operatørgrensesnitt og flere
  tilgangsroller er ikke innført; det er ikke nødvendig for denne driftsmodellen.

Policyversjonen `exact-domain-v1` lagres med nye kontroller. Ingen prøveidentiteter
kan passere den offentlige publisheren. En offentlig utstederkonto og en konto
som skal verifiseres er to ulike roller.

**Devotta som kandidat:** Brreg-oppslag 11. oktober 2026 fant DEVOTTA AS,
`922669708`, uten registrert hjemmeside. Det er en nyttig negativ kontroll, men
kan ikke gi et positivt treff før registergrunnlaget og atproto-kontoen støtter det.

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

Dette er en seriell verifier med inntil fire samtidige Brreg-oppslag under
registeravstemming. Endringsjobber og rechecks av kjente kontoer prioriteres foran
førstegangsskanning. En landsdekkende gjennomgang tar tid; mål køalder og faktisk
gjennomløp før det avtales noen tidsfrist. Det er ingen påstand om at hele Norges
register allerede er identitetskontrollert eller lasttestet mot offentlige API-er.
Selve importen er prøvd lokalt med den offisielle filen: 1 177 715 enheter,
114 124 kølagte kontroller, cirka tre minutter inkludert nedlasting og 524 MiB
maksimal RSS. Dette måler import, ikke gjennomløp for nettverkskontrollene.

## Slå på en avgrenset offentlig pilot

Før dette steget: avtal reglene ovenfor, velg utstederkonto og PDS, bekreft mål-
kontoenes domener og registrerte navn, kjør fullimport og gjennomgå forhåndsvisningen.
Synlig Bluesky-merke avhenger av klientens tillit til utstederen og loves ikke.

Legg følgende ikke-hemmelige innstillinger i den ignorerte `.env`-filen:
`ISSUER_PDS` (HTTPS-origin), `ISSUER_DID`, `ISSUER_IDENTIFIER` og `PILOT_ORGNRS`
(kommadelt liste). Legg utstederens app-passord i `.runtime/issuer-password`, med
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
akseptansen. Ingen offentlig pilot er aktivert av utviklingsarbeidet.

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
