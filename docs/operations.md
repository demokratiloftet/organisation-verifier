# Kjøring og drift

## Lokalt

`pnpm demo:up` bygger og starter to tjenester. Første bygg laster ned avhengigheter til den offisielle test-PDS-en og tar lengre tid enn senere oppstarter.

```sh
docker compose ps
docker compose logs --tail=50 app fixture
pnpm test:integration
```

Bare appen eksponeres: `127.0.0.1:3012`. Fixture-PDS, kontroll-API og PLC har ingen publiserte porter. Fixture-nettverket har `internal: true`; appen har i tillegg et eget nett for offentlige, SSRF-beskyttede oppslag.

`pnpm dev` starter en lokal Node-prosess med live-oppslag. Den trenger en fixture-adapter for demonstrasjonsfanen; standard Compose eksponerer med hensikt ikke fixture-porter. For hele flyten, bruk Compose og bygg appen på nytt etter endringer:

```sh
docker compose up -d --build --no-deps app
```

`.env.example` dokumenterer innstillinger. Node laster ikke denne filen automatisk; Compose setter sine innstillinger direkte.

## VPS

Tjenesten ligger separat i `/root/organisation-verifier` på prosjektets VPS. Den benytter eget Compose-prosjekt, eget volum og egne nett. Det eksisterende `server-infrastructure`-oppsettet og domenene berøres ikke.

Webappen på VPS-en er bare tilgjengelig over loopback. For demonstrasjon fra egen maskin må lokal app på samme port stoppes først:

```sh
docker compose stop app
ssh -N -L 127.0.0.1:3012:127.0.0.1:3012 root@187.124.129.149
```

La SSH-terminalen stå åpen. Åpne **http://127.0.0.1:3012**. SSH er tilgangskontrollen for denne operatørdemoen; det finnes ingen innlogging i appen. Ikke bind porten til `0.0.0.0` eller sett en offentlig proxy foran operatørendepunktene.

Under oppsettet er det startet en bakgrunnstunnel fra denne arbeidsmaskinen med kontrollsocket `.runtime/vps.sock`. Demo-adressen peker dermed på VPS-en. Før du starter appen lokalt igjen, avslutt tunnelen fra repo-mappen:

```sh
ssh -S .runtime/vps.sock -O exit root@187.124.129.149
pnpm demo:up
```

På VPS-en:

```sh
cd /root/organisation-verifier
docker compose ps
docker compose exec -T app node dist/test/integration.js
docker compose logs --tail=50 app fixture
```

For oppdatering kan en godkjent commit eksporteres med `git archive` og overføres til denne separate katalogen; bygg deretter med `docker compose up -d --build --wait`. Ikke kopier lokale data, miljøfiler eller node_modules. Et normalt appbygg lar fixture-containeren fortsette å kjøre; en endring i fixture-image eller full nedstenging oppretter et nytt testnett neste gang.

## Tilstand og restart

- SQLite ligger i Docker-volumet `organisation-verifier_verifier-data`.
- `docker compose restart app` beholder både historikk og testnett. Neste kontroll finner igjen eksisterende record.
- En restart av **fixture** lager nye kontoer og DIDs. Gamle utstederrecords hører til forrige testnett og vises ikke som aktive i det nye. Historikken beholdes for inspeksjon.
- `docker compose down` beholder SQLite-volumet. Unngå `down -v` med mindre du uttrykkelig ønsker å slette historikken.
- En feil i et PDS-kall lagres som publiseringsfeil; kjør kontrollen på nytt for avstemming ved samme nøkkel. Det er ingen automatisk scheduler i denne demoversjonen.

Dette er et disponibelt testnett, ikke en backup-/migrasjonsløsning for en produksjons-PDS. Produksjonsbackup, overvåking, retensjon og rollestyrt operatørtilgang er egne oppgaver.

## Automatisk appoppdatering

Etter grønne `Check`-kontroller på `main` kan GitHub Actions oppdatere bare
app-containeren via den begrensede SSH-mottakeren i infrastrukturrepoet.
`DEMO_DEPLOY_ENABLED=true` aktiverer dette. Workflow-tokenet har bare lesetilgang
til dette repoet og lagres ikke på VPS-en. SSH-nøkkelen har ingen vanlig shell.

SQLite-volumet beholdes. Et mislykket helsesjekk bytter tilbake til forrige image.
Fixture, lagringsskjema og Compose-endringer krever separat driftsgjennomgang;
de rulles ikke automatisk ut. Fixture er disponibel og lager nye DIDs ved omstart.
Se [felles driftsveiledning](https://github.com/demokratiloftet/server-infrastructure/blob/master/deploy/README.md).
