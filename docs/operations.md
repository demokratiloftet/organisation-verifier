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

**14. oktober 2026:** Verifikatoren publiserer fra Eurosky med `ISSUANCE_SCOPE=all_matching`.
Gjeldende image og omfang finnes i `/var/lib/loftet-deploy/organisation-verifier/current.json`.
GitHub-autodeploy (`DEMO_DEPLOY_ENABLED`) er fortsatt avslått etter den kontrollerte
utrullingen. Ikke bygg den eldre checkouten i `/root/organisation-verifier`.
Se [akseptanse og rollback](automatic-issuance-2026-10-14.md).

Operatørsiden er [verifikasjon.demokratiloftet.no](https://verifikasjon.demokratiloftet.no/).
Se [tilgang og HTTPS](internet.md). Oppsettet er miljøspesifikt; lokal Compose
skal ikke kopieres over produksjonskonfigurasjonen.

Kjørende kode bygges fra en separat release under
`/var/lib/loftet-deploy/organisation-verifier/releases/`. `/root/organisation-verifier`
eier det godkjente Compose-oppsettet. Ved oppdatering beholdes eksisterende volum,
nett, HTTPS og utstederinnstillinger.

Fixture- eller Compose-endringer krever en separat driftsutrulling med automatisk
deploy satt på pause, backup og gjennomgått kildekode. Ikke kopier lokale data,
miljøfiler eller node_modules. En endring i fixture-image eller full nedstenging
oppretter et nytt testnett neste gang.

## Tilstand og restart

- SQLite ligger i Docker-volumet `organisation-verifier_verifier-data`.
- `docker compose restart app` beholder både historikk og testnett. Neste kontroll finner igjen eksisterende record.
- En restart av **fixture** lager nye kontoer og DIDs. Gamle utstederrecords hører til forrige testnett og vises ikke som aktive i det nye. Historikken beholdes for inspeksjon.
- `docker compose down` beholder SQLite-volumet. Unngå `down -v` med mindre du uttrykkelig ønsker å slette historikken.
- En feil i et PDS-kall lagres som publiseringsfeil; kjør kontrollen på nytt for avstemming ved samme nøkkel. Standarddemoen har ingen scheduler; den valgfrie bakgrunnstjenesten håndterer automatiske gjenforsøk. Se [automatikk](automation.md).

Fixture er et disponibelt testnett. For den varige verifikatordatabasen, se
[backup, restore, retensjon og overvåking](automation.md).

## Automatisk appoppdatering

Når `DEMO_DEPLOY_ENABLED=true`, vil grønne `Check`-kontroller på `main` oppdatere bare
app-containeren via den begrensede SSH-mottakeren i infrastrukturrepoet.
Dette er avslått i driftsstatusen ovenfor. Workflow-tokenet har bare lesetilgang
til dette repoet og lagres ikke på VPS-en. SSH-nøkkelen har ingen vanlig shell.

SQLite-volumet beholdes. En mislykket helsesjekk bytter tilbake til forrige image.
Fixture, lagringsskjema og Compose-endringer krever separat driftsgjennomgang;
de rulles ikke automatisk ut. Fixture er disponibel og lager nye DIDs ved omstart.
Se [felles driftsveiledning](https://github.com/demokratiloftet/server-infrastructure/blob/master/deploy/README.md).
