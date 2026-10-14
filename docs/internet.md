# Operatørside på internett

Demokratiloftets operatørside er
**https://verifikasjon.demokratiloftet.no/** og krever innlogging.
Oppsettet er beskrevet per 14. oktober 2026; [utstederstatus](public-issuer.md)
og [driftsnotatet](automatic-issuance-2026-10-14.md) dokumenterer utrullingen.

Brreg-fanen gjør ferske oppslag og lagrer resultatet uten å publisere.
Bakgrunnsarbeideren har separat aktivering og kan utstede fra den konfigurerte
Eurosky-kontoen med `all_matching`. Lokal standardkonfigurasjon har dette avslått.
Se [kontrollregler og aktivering](automation.md).

## Data og tilgang

SQLite og kontrollhistorikk lagres hos operatøren. Brreg-, DNS-, DID-, profil-
og Jetstream-oppslag bruker offentlige kilder. Kildene kan se forespørslene;
operatør- og utstederpassord sendes ikke med disse oppslagene. Utstederens
app-passord brukes bare mot den konfigurerte PDS-en.

Innloggede operatører kan lese historikk og kjøre kontroller. Dette er en felles
operatørinnlogging, ikke åpne brukerkontoer. Verifikasjonsrecords fra den offentlige
utstederen kan leses av andre; lokal kontrollhistorikk er ikke et offentlig API.
Fixture-PDS/PLC har ingen vertsporter eller internettilgang.

## HTTPS-oppsett

`compose.internet.yaml` er et **miljøspesifikt eksempel** for den tidligere direkte
HTTPS-adressen `verifikasjon.dev.demokratiloftet.no:8443`. Det er ikke et ferdig
oppsett for andre domener eller en kopi av den nåværende gatewaykonfigurasjonen.
Tilpass origin, binding og sertifikatmappe til ditt miljø før bruk.

Appen krever følgende ved HTTPS:

- `APP_ORIGIN` med nøyaktig adresse og eventuell port.
- `OPERATOR_CREDENTIALS_FILE` med `bruker:tilfeldig-passord`, minst 32 tegn i
  passordet. Bruk bokstaver, siffer, bindestrek eller understrek.
- `TLS_CERT_FILE` og `TLS_KEY_FILE` med gyldig sertifikat og privat nøkkel.

Legg hemmeligheter i beskyttede filer utenfor Git. Compose-eksemplet monterer
`.runtime/operator-credentials` som secret. Den må kunne leses av containerens
UID 1000, men ikke av andre brukere. Bruk modus 0600 og beskytt foreldremappen.
Ikke legg passord i URL, kommandolinjeargumenter eller logger.

Appen avviser offentlig vertsnavn uten innlogging og operatørpassord over HTTP.
Alle sider og API-ruter krever innlogging, også health/readiness. Host og Origin
kontrolleres i tillegg. Sertifikatfilene kontrolleres hvert minutt og lastes på
nytt ved endring; fornyelsen må håndteres av driftsmiljøet.

## Oppdatering

Behold Compose-prosjekt, volum, utstederkonfigurasjon og hemmeligheter ved oppgradering.
Ta SQLite-backup og behold forrige image. Bygg fra kontrollert kode og oppgrader
bare appen ved vanlige kodeendringer. Kontroller anonym 401, gyldig innlogging,
fremmed Host/Origin 403 og readiness. Ekstern kontroll skal validere TLS normalt.

`node dist/src/healthcheck.js` er en lokal liveness-sjekk inne i appcontaineren.
`/ready` kontrollerer også bakgrunnstjenestens ferskhet når automatikk er aktiv.
Se [drift](operations.md) og [backup/restore](automation.md).
