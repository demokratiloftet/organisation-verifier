# Organisation verifier

Kobler en organisasjon i **Enhetsregisteret (Brreg)** til en eksisterende
**AT Protocol-konto**, og kan publisere en verifikasjon fra en utstederkonto.
Koblingen bygger på registrert hjemmeside, toveis domene/konto-kontroll og
samsvarende profilnavn.

Dette bekrefter **domenetilknytning**, ikke juridisk fullmakt eller medlemskap.
En publisert verifikasjon gir ikke automatisk et synlig merke i Bluesky eller andre apper.

## Prøv lokalt

Du trenger Docker med Compose. Node og pnpm trengs bare for utvikling og sjekkene nedenfor.

```sh
git clone https://github.com/demokratiloftet/organisation-verifier.git
cd organisation-verifier
docker compose up -d --build --wait
```

Åpne **http://127.0.0.1:3012**. Bruk akkurat denne adressen; appen kontrollerer Host og Origin.
Første bygg kan ta noen minutter.

- **Demonstrasjon:** fiktive organisasjoner og ekte kontoer i en isolert test-PDS
  (serveren som lagrer atproto-kontodata). Velg «Alt stemmer» to ganger for å se at
  recorden gjenbrukes. Velg «Profilnavnet endres» for å trekke den tilbake.
- **Brreg:** skriv inn et organisasjonsnummer for et ferskt oppslag i offentlige
  kilder. Resultatet lagres lokalt; knappen publiserer ingen offentlig verifikasjon.
- **Bakgrunnskontroller og offentlig utstedelse:** avslått som standard. Se
  [oppsett for automatikk](docs/automation.md) for import, kontroller og eksplisitt aktivering.

Stopp med `docker compose down`. SQLite-historikken beholdes. Testkontoer og DIDs
opprettes på nytt når fixture-containeren starter på nytt; gamle testrecords
regnes da ikke som aktive.

## Slik hentes og kontrolleres data

1. **Brreg → hjemmeside.** Hent organisasjonsnummer, navn, hjemmeside og slettestatus
   fra `https://data.brreg.no/enhetsregisteret/api/enheter/{orgnr}`.
   Det er API-oppslag, ikke skraping av nettsider.
2. **Domene → konto-ID (DID).** Prøv domenet i hjemmesiden som kontoens handle.
   Les DNS TXT på `_atproto.<domene>`, eventuelt HTTPS-filen
   `https://<domene>/.well-known/atproto-did`. Hvis ingen konto bekreftes, kan én
   innledende `www.` fjernes. Nettverksfeil gir ikke dette unntaket.
3. **Konto-ID → domene.** Hent DID-dokumentet fra PLC-katalogen (`did:plc`) eller
   domenet (`did:web`). Dokumentets første gyldige handle må peke tilbake til
   domenet som ble kontrollert. Dokumentet angir også kontoens PDS.
4. **PDS → kontostatus og profilnavn.** Les `com.atproto.sync.getRepoStatus` og
   `app.bsky.actor.profile` direkte fra PDS-en. Kontoen må være aktiv. Profilnavnet
   må samsvare med Brreg-navnet etter normalisering av Unicode, mellomrom og store/små bokstaver.
   Ett avsluttende, separat `AS` i Brreg-navnet kan utelates i profilnavnet.
5. **Lagre resultatet.** Kontrollen blir `match`, `no_match`, `needs_review` eller
   `unavailable`. En timeout eller kildefeil er aldri et positivt resultat.

Nettsider med sti, egen port eller andre tvetydigheter godkjennes ikke automatisk.
Bakgrunnskontrollen sjekker også om flere Brreg-enheter deler domenet, med eller
uten `www`. Delt domene tillates bare når profilnavnet matcher **nøyaktig én**
organisasjon på domenet etter samme navneregel. Også enheter med sti i hjemmesiden
telles med; to mulige treff krever vurdering. En manuell kontroll alene dekker ikke
fullregisterets konfliktkontroll.

### Når automatikk er slått på

Brregs daglige gzip-fil importeres én gang, strømmet til SQLite. Deretter hentes
registerendringer, og relevante Jetstream-hendelser fra atproto legger nye
kontroller i kø. Hendelsene er **bare varsler om å sjekke på nytt**, aldri bevis.
Vanlig oppstart eller sidevisning laster ikke ned hele registeret igjen. Ved ny
policyversjon kølegges eksisterende kandidater én gang for fersk kontroll.

Lokalindeksen brukes til å finne kandidater. Positive treff sjekkes på nytt mot
ferske Brreg- og identitetsdata før utstedelse. Kjente kontoer kontrolleres med
ferske oppslag. Godkjente kontroller gjentas daglig, andre domener ukentlig.

Utstedelse krever en konfigurert utsteder, komplett og oppdatert register og valgt
omfang: `pilot` med organisasjonsliste, eller `all_matching` for alle som består.
Verifikasjonen lagres som `app.bsky.graph.verification` i **utstederens** repository.
Den inneholder kontoens DID, handle, profilnavn og tidspunkt. Organisasjonsnummer og
kontrollhistorikk lagres lokalt, ikke i recorden.

Endret grunnlag trekker verifikasjonen tilbake. Midlertidige feil prøves igjen;
etter syv dager uten fullført kontroll trekkes den tilbake. Publiseringsintensjonen
lagres før nettverkskallet, og gjenforsøk bruker samme record-nøkkel for å unngå duplikater.

## Utvikling og sjekker

Bruk Node **24.17.0** (`.node-version`) og pnpm **11.8.0** (`packageManager`).
Andre Node-hovedversjoner støttes ikke.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm check                       # typer, tester og bygg
pnpm format:check
pnpm --dir fixture install --frozen-lockfile
pnpm --dir fixture typecheck
pnpm audit --audit-level=moderate
pnpm --dir fixture audit --audit-level=moderate

# Med Docker-demoen startet og bygget fra gjeldende kode:
pnpm test:integration             # publisering, gjenforsøk og tilbaketrekking på ekte test-PDS
pnpm test:worker-integration      # varig jobbkø og omstart mot samme test-PDS
pnpm test:isolation               # test-PDS kan ikke nå internett
```

`pnpm dev` bygger og starter en lokal prosess med automatisk restart. Brreg-oppslag
fungerer der, men test-PDS-en har ingen vertsporter; bruk Compose for hele demoen.
Etter kodeendringer: `docker compose up -d --build --no-deps --wait app`.
[.env.example](.env.example) forklarer innstillingene; Node leser ikke filen automatisk.

Én Fastify-prosess, SQLite og vanlig HTML/CSS/TypeScript. Ingen frontend-rammeverk
eller separat køtjeneste. Start lesingen her:

| Fil                                                                      | Ansvar                                      |
| ------------------------------------------------------------------------ | ------------------------------------------- |
| [src/domain.ts](src/domain.ts)                                           | Rene regler for domene, navn og beslutning  |
| [src/sources.ts](src/sources.ts), [src/identity.ts](src/identity.ts)     | Brreg-oppslag og toveis identitetskontroll  |
| [src/registry.ts](src/registry.ts), [src/jetstream.ts](src/jetstream.ts) | Registerimport og endringsvarsler           |
| [src/worker.ts](src/worker.ts), [src/automation.ts](src/automation.ts)   | Jobber, gjenforsøk og periodiske kontroller |
| [src/publisher.ts](src/publisher.ts), [src/store.ts](src/store.ts)       | Publisering og varig tilstand               |
| [src/app.ts](src/app.ts), [public/](public/)                             | Beskyttede operatørendepunkter og nettside  |

## Tilgang og videre lesing

Lokal demo er bundet til loopback. Internettoppsett krever HTTPS og operatørinnlogging
på alle sider og API-ruter. Offentlige oppslag bruker beskyttelse mot private
nettverksadresser, størrelsesgrenser og tidsavbrudd. Fixture-nettverket er isolert.

Passord, nøkler, databaser og runtime-filer skal ikke inn i Git. CI skanner hele
Git-historikken med Gitleaks og kontrollerer avhengigheter, kode og PDS-isolasjon.
Se [sikkerhetspolicy](SECURITY.md).

- [Arkitektur og kontrollregler](docs/architecture.md)
- [Automatikk, import, utstedelse og backup](docs/automation.md)
- [Lokal drift og internettoppsett](docs/operations.md)
- [Demokratiloftets utsteder og datert driftsstatus](docs/public-issuer.md)
- [Veiledning for kontoeiere](public/veiledning.html) · [demomanus](docs/demo.md)
- [Gjenstående arbeid](docs/roadmap.md) · [tidligere validering](docs/validation.md)

Demokratiloftets [operatørside](https://verifikasjon.demokratiloftet.no/) krever innlogging.
