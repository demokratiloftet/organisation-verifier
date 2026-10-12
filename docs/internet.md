# Verifikasjonsdemo på internett

Adresse: **https://verifikasjon.dev.demokratiloftet.no:8443/**.
Tailscale er ikke nødvendig. Nettleseren ber om operatørbruker/passord.
Port 8443 er valgt for å bevare den eksisterende inngangen til kalender og sosial app.

## Hva dette bekrefter

Brreg oppgir organisasjonens hjemmeside. Vi sjekker at domenet peker på en
bestemt atproto-konto, at kontoen peker tilbake, og at profilnavnet samsvarer.
Man må kunne endre domenets DNS eller en bestemt fil på nettsiden for å sette
opp denne koblingen. Å skrive firmanavnet eller bruke en e-postadresse er ikke nok.
Dette bekrefter domenetilknytning, ikke at personen bak kontoen har juridisk fullmakt.

Demoen kan publisere, gjenta og trekke tilbake verifikasjoner i en isolert PDS.
Brreg-fanen gjør ekte oppslag, men publiserer ingenting. Offentlig utstedelse er
avslått. Landsdekkende import og verifikasjon er ikke startet på denne VPS-en.
Foreløpige regler og valgene før en offentlig pilot står i [automation.md](automation.md).

## Data og tilgang

SQLite, kontrollhistorikk og test-PDS kjører på VPS-en. Det er ingen ekstern
appdatabase, analyseplattform eller offentlig videredistribusjon av testrecords.
Innloggede operatører kan lese historikken og kjøre demoen; resultatene leveres
til nettleseren deres. Dette er en felles operatørinnlogging, ikke åpne brukerkontoer.

Brreg-, DNS-, DID-, profil- og Jetstream-oppslag bruker offentlige kilder. Kildene
kan se forespørslene. Innlogging og hemmeligheter sendes ikke til disse kildene.
Fixture-PDS/PLC har ingen publiserte porter og kan ikke kontakte internett.
Ingen innlogging, testrecord eller databaseinnhold lagres i GitHub.

## Drift

Bruk samme Compose-prosjekt og eksisterende datavolum. Offentlig oppstart krever
`compose.internet.yaml`, valgt image og filen `.runtime/operator-credentials`
med `bruker:tilfeldig-passord` (minst 32 tegn i passordet). Filen skal ha modus
0600 og eies av containerens UID 1000. Aldri legg passord i `.env`, Git eller URL.

Det eksisterende sertifikatet eksporteres til
`/root/server-infrastructure/public-demo/.tls`. Appen monterer mappen skrivebeskyttet
og leser nye sertifikater hvert minutt. Det eksisterende fornyelsesoppsettet beholdes.

På VPS-en ligger det godkjente HTTPS-oppsettet direkte i
`/root/organisation-verifier/compose.yaml`, slik at den vanlige deploy-mottakeren
ikke kan falle tilbake til ubeskyttet HTTP. Kilde-overlayet bevares ved siden av.
Appen avviser offentlig vertsnavn uten innlogging og nekter passord over HTTP.
Alle sider og API-ruter krever innlogging, også health/readiness. Host og Origin
kontrolleres i tillegg. Bruk `node dist/src/healthcheck.js` inne i appcontaineren;
ekstern kontroll skal alltid validere sertifikatet normalt.

Før utrulling: pause automatisk deploy, ta en kontrollert SQLite-backup og behold
forrige Compose-oppsett/image. Bygg fra en ren Git-release, oppgrader bare appen,
og behold fixture-containeren og volumet. Kontroller anonym 401, gyldig innlogging,
fremmed Origin/Host 403, demoens publisering/tilbaketrekking og fixture-isolasjon.

Automatisk deploy forblir pauset så lenge denne feature-branchen kjører på VPS-en.
Etter sammenslåing og kontroll kan den aktiveres igjen. Ikke kjør gamle main over
nytt skjema ved et uhell. Backup og tidligere release ligger under
`/root/loftet-rollbacks/verifier-20261012`.

Ved rollback: steng den offentlige porten før gammel app uten innlogging startes.
Gjenopprett forrige godkjente Compose/image og kontroller loopback-demoen. Ikke
slett eller erstatt datavolumet ved en vanlig kode-rollback.
