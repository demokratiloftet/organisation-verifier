# Organisation verifier

Et kjørbart utgangspunkt for **LOFT-76**: koble en organisasjon i Enhetsregisteret til en eksisterende atproto-konto via registrert hjemmeside, og publisere en verifikasjon fra en utstederkonto.

To moduser:

- **Demonstrasjon:** fiktivt registergrunnlag, ekte DID-katalog og PDS. Viser publisering, omkjøring uten duplikater, nettverksfeil og tilbaketrekking.
- **Brreg live:** direkte API-oppslag og toveis kontroll av offentlige atproto-identiteter. Kun lesing; ingen offentlig publisering.

Dette verifiserer **domenetilknytning**, ikke en persons juridiske fullmakt. Publisering gir heller ikke automatisk et synlig Bluesky-merke.

## Start

Krever Docker Compose, Node **24.17** og pnpm **11.8**.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm demo:up
```

Åpne **http://127.0.0.1:3012**. Bruk denne adressen, siden vert og Origin kontrolleres.

Velg «Alt stemmer», kjør to ganger, og velg deretter «Profilnavnet endres». Utvid recorden for å se hva som ble publisert og trukket tilbake. [Demomanus og opptak](docs/demo.md).

```sh
pnpm check             # typer, tester og bygg
pnpm test:integration  # krever demo:up; leser og kontrollerer records på den ekte test-PDS-en
pnpm format:check
pnpm demo:down         # stopper demoen; beholder SQLite-volumet
```

**Testnettverket er disponibelt:** PDS-kontoer og DIDs opprettes på nytt når fixture-containeren starter på nytt. Appens SQLite-historikk består. Gamle records vises ikke som aktive records i et nytt testnettverk.

## Videre arbeid

[Arkitektur og figurer](docs/architecture.md) · [Beslutninger og delegerbare oppgaver](docs/roadmap.md) · [VPS og drift](docs/operations.md)

Utførte kontroller er beskrevet i [valideringsloggen](docs/validation.md).

Vanlig TypeScript, Fastify, SQLite og atproto-SDK. Ingen frontend-rammeverk er nødvendig for dette kontrollpanelet. Policy, kilder, lagring og publisering ligger i hver sin modul under `src/`.

Demoen er et første snitt gjennom flyten. Full registerimport, kontinuerlig overvåking, offentlig utsteder og produksjonsdrift er egne, gjenstående leveranser.

![Kontrollgrunnlag og publisering i demoen](docs/media/demo-overview.png)
