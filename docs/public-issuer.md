# Offentlig Demokratiloftet-utsteder

Besluttet 13. oktober 2026: eksterne leverandører skal kunne lese vanlige atproto-
verifikasjoner. Utstederen bruker Demokratiloftet-domenet og en separat offentlig
PDS på samme VPS. Hovednettsiden og de private demo-PDS-ene beholdes.

- Operatørside / handle: `https://verifikasjon.demokratiloftet.no`
- Utsteder-DID: `did:plc:coubd2izvctyl4emmh426pf7`
- PDS: `https://pds.verifikasjon.demokratiloftet.no`
- Collection: `app.bsky.graph.verification`
- Første pilot: DEVOTTA AS (`922669708`). Andre enheter sjekkes uten utstedelse.

Den nye DID-en er registrert i **offentlig** PLC. TXT
`_atproto.verifikasjon.demokratiloftet.no` og den offentlige
`/.well-known/atproto-did` peker til samme DID; DID-dokumentet peker tilbake til
handle og PDS. Dagens private pilot-DID tilhører en annen konto og skal ikke
brukes av eksterne leverandører. Gamle private pilotrecords trekkes tilbake ved
byttet. Historikken beholdes på VPS-en.

## For MU og andre lesere

MU må selv velge å stole på utsteder-DID-en ovenfor. Tilgjengelig publisering
betyr ikke at MU eller Bluesky har godkjent utstederen eller viser et merke.

```text
GET https://pds.verifikasjon.demokratiloftet.no/xrpc/com.atproto.repo.listRecords
    ?repo=did:plc:coubd2izvctyl4emmh426pf7
    &collection=app.bsky.graph.verification
```

Følg `cursor` ved paginering. Records inneholder `subject` (organisasjonskontoens
DID), `handle`, `displayName` og `createdAt`. Orgnummer og kontrollgrunnlag er ikke
felter i standardrecorden. Tjenesten bekrefter koblingen mellom registrert domene,
toveis atproto-identitet og profilnavn, ikke juridisk fullmakt eller medlemskap.

Leseren må kontrollere riktig utsteder-repository, gjeldende handle/profilnavn og
håndtere slettinger. Et uendret gammelt cachetreff er ikke tilstrekkelig.
`com.atproto.sync.getRepo` og `com.atproto.sync.subscribeRepos` gir standard
repoeksport og endringsstrøm; offentlig PLC gir nøklene til signaturverifikasjon.
En JSON-record fra `getRecord` alene er ikke et selvstendig signaturbevis.

Verifikasjonene og utstederprofilen er **offentlige** og kan kopieres og indekseres
av andre. Kontoens masterlagring, nøkler, operatørhistorikk og Brreg-database er på
vår VPS. Ingen privat demoaktivitet flyttes til den offentlige PDS-en. Kontoen
oppretter ingen sosiale innlegg; standardrecorden er selve publiseringen.

## Drift

`deploy/public-pds/compose.yaml` starter kun den separate, digest-låste offisielle
PDS-en, uten hostporter, på et eget internt backend-nett og et eget nett for
utgående offentlig atproto-trafikk. Den er ikke medlem av demomiljøets nettverk.
SSRF-beskyttelse og rate limits er på; selvregistrering og import er stengt.
Det finnes ingen offentlig adminrute. Gatewayen tillater bare de dokumenterte
leseendepunktene, utstedersesjonene og autentiserte record-writes.

Eksisterende private Traefik skaffer sertifikatet med DNS-01. Den eksisterende
sertifikattimeren kjører `deploy/public-pds/export-tls.py`; gatewayen laster den
atomiske filen på nytt uten restart. Bare de to nye DNS A-recordene og utstederens
TXT-record legges til. Ingen wildcard- eller apex-endring trengs.

`deploy/public-pds/provision.py` gjenbruker konto og identitet ved omkjøring.
Nøkler, admin-/master-/app-passord ligger bare i beskyttede filer under VPS-ens
`/root/organisation-verifier/.runtime/`. De følger ikke Git, lokale maskiner eller
nettlesersvar. E-postlevering er ikke satt opp; kontoen administreres av operatøren
på VPS-en. Bevar PDS-data, PDS-konfigurasjon, kontofil og utstederpassord sammen.

Verifier bruker `PUBLIC_ISSUANCE_ENABLED=true`, `PRIVATE_ISSUANCE_ENABLED=false`,
den offentlige PDS-adressen, låst offentlig utsteder-DID og eksisterende pilotliste.
Full registeravstemming og gjeldende policy kreves fortsatt før nye records.
Omkjøring bruker samme record; endret grunnlag eller utløpt evidens trekker tilbake.

Ved rollback skal offentlige records ikke forlates uten vedlikehold. Hold
publisheren i drift eller trekk records kontrollert tilbake før den stoppes.
Gjenopprett gateway/operatørkonfigurasjon fra VPS-backup ved rutefeil, men ikke
slett PDS/PLC-identitet eller gjenopprett eldre data over nyere writes. Den gamle
private kontoen og dens historikk beholdes for revisjon, ikke som parallell utsteder.

## Kontrollert 13. oktober 2026

Offentlig Devotta-verifikasjon ble utstedt av bakgrunnsarbeideren kl. 17:32 UTC,
etter fersk Brreg-, domene-, toveis identitets-, profilnavn- og delte-domener-kontroll:

```text
at://did:plc:coubd2izvctyl4emmh426pf7/app.bsky.graph.verification/3mxrksmrlhs2n
subject: did:plc:f7vvzsi3zfydiswbw2uejxec
handle: devotta.no
displayName: Devotta AS
```

- Recorden ble lest over offentlig HTTPS fra en ekstern klient uten innlogging.
- En ny automatisk kontroll kl. 17:35 UTC beholdt samme record-nøkkel og `createdAt`, uten duplikat.
- Social- og kalender-containerne hentet samme record uten utstederpassord. Deres begrensede nett bruker gateway `10.249.90.20:8443`, med offentlig PDS-host i både TLS SNI og HTTP Host og vanlig sertifikatvalidering. PDS-en er ikke koblet til det private demonettet.
- Offentlig PLC, TXT og well-known peker til samme konto. HTTPS/SNI, repoeksport og faktisk WebSocket-oppgradering for endringsstrømmen passerte.
- Operatørsiden krever innlogging (401 uten), og readiness svarte 200. Admin, registrering, import og rå XRPC-lesing av den private Spaces-PDS-en ble avvist. Eksisterende demoapper svarte fortsatt.
- Den gamle private Devotta-recorden ble trukket tilbake før offentlig utstedelse. Kontrollhistorikken beholdes.

To forbigående tidsavbrudd holdt først publiseringen tilbake. Vanlig retry lyktes;
verken identitetskrav eller feilhåndtering ble svekket. Jetstream hadde dessuten
gått tilbake i sekvensnummer med nyere hendelser. Arbeideren håndterer nå dette
som et gap og planlegger nye autoritative kontroller; live strøm er i gang igjen.

Utrullet verifier-revisjon: `bf004a73db9c23c18882a10d803cb95630e21a1e`.
Gateway fra loftet-social: `2bc953ed556002de3b6b007fecb1970171b3802a`.
Begge main-CI-kjøringene passerte, inkludert ekte isolert PDS og nettverksisolasjon;
verifier har 35 beståtte tester. Oppsett, database og den nye PDS-en er sikkerhetskopiert
på VPS-en. Automatisk GitHub-deploy av verifier er fortsatt pauset etter tidligere
SSH-tidsavbrudd; denne utrullingen ble gjort manuelt.

Dette er en offentlig pilot, ikke ferdig utrulling til alle organisasjoner. Første
registerbatch kjører fortsatt. MU må velge å stole på utsteder-DID-en og implementere
lesing/tilbaketrekking; synlige merker i social og kalender er heller ikke implementert.
Driftsansvar, varsling og testet gjenoppretting gjenstår i [restlisten](roadmap.md).
