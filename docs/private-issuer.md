> Historisk intern pilot. Den nye offentlige utstederen er dokumentert i [public-issuer.md](public-issuer.md).
> Den private Devotta-recorden ble slettet fra PDS-en 13. oktober 2026 kl. 17:30 UTC.
> Privat utstedelse er nå avslått; konto og historikk beholdes. Statusen nedenfor beskriver den tidligere piloten.

# Intern Demokratiloftet-utsteder

Valgt av operatøren 13. oktober 2026: lagre verifikasjoner på egen VPS og bruke
samme utsteder i egne apper først. Ingen Eurosky-konto eller offentlig DNS-endring
trengs for utstederen.

- Konto: `verifikasjon.spaces-pds.dev.demokratiloftet.no`
- Betrodd utsteder-DID: `did:plc:ifkuegcojgr6lmmpzr5l2rai`
- Internt endepunkt: `http://spaces-pds:3000`
- Collection: `app.bsky.graph.verification`
- Pilot: DEVOTTA AS, `922669708`.

Kontoen ligger i eksisterende varig Spaces-PDS, med privat PLC. Det er ikke den
isolerte, slettbare verifier-fixturen. PDS-en har ingen rå XRPC-rute gjennom den
offentlige gatewayen. Bare eksisterende OAuth-ruter er tilgjengelige eksternt.
Verifikasjonsrecordene er vanlige repo-records som kan leses inne på VPS-nettet;
de er ikke kryptert eller tilgangsstyrt med Spaces. VPS-administratorer og interne
tjenester er betrodd. Ikke legg privat kontrollgrunnlag i recordene.

## Oppsett og drift

`scripts/provision-private-issuer.py` kjøres som root på VPS-en. Den gjenbruker
kontoen ved omkjøring og lagrer hovedpassordet før oppretting, slik at tapt svar
kan gjenopprettes. Hovedpassordet blir bare i root-beskyttet
`.runtime/private-issuer-account.json`; appen får kun `.runtime/issuer-password`.
Begge filer holdes utenfor Git, logger, nettleser og lokale arbeidsmaskiner.
`private-issuer.json` inneholder bare kontoens ikke-hemmelige metadata.

`compose.private-issuer.yaml` er et eksplisitt tillegg til automatikk og eksisterende
HTTPS/operatørkonfigurasjon. Det kobler bare verifier-appen til det eksisterende
`server-infrastructure_private-demo`-nettet. PDS, PLC, apper og datavolumer
opprettes ikke på nytt. På managed VPS brukes den kontrollerte, sammenslåtte
konfigurasjonen i `/root/organisation-verifier/compose.yaml` og gjeldende image-overlay.

`PRIVATE_ISSUANCE_ENABLED=true` og `PUBLIC_ISSUANCE_ENABLED=false`. Begge samtidig
avvises. Privat transport godtar bare det faste interne endepunktet, verifiserer
innlogget DID og følger ingen omdirigeringer. Samme domene-/navnekrav, komplett
registeravstemming, eksplisitte pilotliste og tilbaketrekking gjelder som før.
Syntetiske fixture-kontroller kan aldri skrives til denne kontoen.

Før endring tas SQLite-backup og konfigurasjonskopi. Bevar også PDS-volumet
`server-infrastructure_loftet-spaces-data`, den private PLC-databasen og
utstederfilene i VPS-ens backup. Konto-ID-en skal overleve appomstarter.
Å slå av intern utstedelse stopper også tilbaketrekking; trekk pilotens records
tilbake før en varig avvikling. Ikke slett konto, PDS-volumer eller historikk for
å angre en appversjon.

## Lesing fra egne apper

Både social og kalender kan lese den betrodde utstederens repository over det
interne nettet, uten å få utstederpassordet:

```text
GET http://spaces-pds:3000/xrpc/com.atproto.repo.listRecords
  ?repo=did:plc:ifkuegcojgr6lmmpzr5l2rai
  &collection=app.bsky.graph.verification
```

Følg `cursor` ved flere sider. Godta bare records fra denne konfigurerte repo-DID-en
på denne PDS-en. `subject` er kontoen som ble kontrollert; `handle` og `displayName`
må fortsatt stemme med kontoens autoritative identitet. Ved sletting, endring
eller mislykket oppslag skal appen ikke vise et bekreftet merke fra gammel cache.
Å finne en record alene beviser ikke at et merke fortsatt er gyldig.

**Ingen navnebasert kobling:** Devottas offentlige `devotta.no`-konto er forskjellig
fra en lokal demokonto, selv om begge heter «Devotta». Private PLC-DIDs skal heller
ikke slås opp i den offentlige PLC-en. Ikke gi personkontoer eller grupper en
organisasjonsverifikasjon på grunnlag av tekst/navn. En reell kontokobling kreves.

UI-merket i social/kalender er en egen integrasjon og er ikke implementert her.
Oppsettet gjør utstedelse og intern lesing mulig. Kalenderens eksisterende
arrangørfullmakter er en annen type kontroll og beholdes uendret.

## Kontrollert på VPS 13. oktober 2026

Intern pilot er aktivert med offentlig utstedelse avslått. Devottas ferske
Brreg-/domene-/navnekontroll og delte-domener-kontroll ga samsvar etter full
registeravstemming. Arbeideren lagret:

```text
at://did:plc:ifkuegcojgr6lmmpzr5l2rai/app.bsky.graph.verification/3mxqxzhcgmk2h
subject: did:plc:f7vvzsi3zfydiswbw2uejxec
handle: devotta.no
displayName: Devotta AS
```

En ny automatisk kontroll beholdt samme record-nøkkel og createdAt, uten duplikat.
Begge appenes kjørende backend-containere leste denne recorden direkte fra PDS-en,
uten utstederens passord. Dette er en test av intern lesing, ikke implementert
merkevisning i appenes UI. Offentlig XRPC-lesing fra Spaces-PDS-host ble avvist
med 404; verifier uten operatørinnlogging ga 401. Autentisert HTTPS og readiness
passerte. PDS, social, kalender og datavolumene ble beholdt; bare verifier-appen
ble restartet. Konfigurasjons- og SQLite-backup ligger på VPS-en.

PR #8 bestod 34 tester, typecheck, build, formatering, sårbarhets-/hemmelighetssjekk,
ekte isolert PDS-livssyklus, worker-test og nettverksisolasjon. Utstedelsen på VPS
bruker samme policy/livssyklus; bare utstedertransporten er intern. Full første
Brreg-kontrollbatch kjører fortsatt. Automatisk GitHub-deploy er fortsatt pauset
etter tidligere SSH-tidsavbrudd; denne utrullingen ble gjort manuelt.
