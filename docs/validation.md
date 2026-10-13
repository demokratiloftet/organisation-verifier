# Kontrollert 13. oktober 2026

- 32 tester, typekontroll og bygg bestått lokalt. Lokal Node er 26.3.0; CI bruker låst Node 24.17.
- Oppdatert produksjonsimage (Node 24.17): ekte isolert PDS-integrasjon, varig worker og nettverksisolasjon bestått i separat Compose-prosjekt.
- 31 av 32 enhetstester bestod også i det minimale produksjonsimaget; TLS-testen krever `openssl`, som bare finnes i utviklings-/CI-miljøet. Den bestod lokalt. Dette er en manglende testavhengighet i runtime-imaget. Hele CI-kjøringen på Node 24.17 bestod senere, inkludert TLS-testen.
- Ingen kjente moderate eller høyere sårbarheter fra `pnpm audit` i app eller fixture.
- PSL-regelen er testet med `co.uk`, `com.au`, `github.io` og `s3.amazonaws.com`, inkludert vern mot å hoppe til selve suffixet.
- GitHub Check bestod for PR #6 og merge-commit `d0c31ca`, inkludert PDS-/worker-integrasjon, nettverksisolasjon og hemmelighetsskann.
- VPS-import: 1 177 860 enheter. Endringsavstemming og kontrollkø startet med offentlig utstedelse deaktivert.
- Nettleser: en manuell Devotta-kontroll beholdes når en simulert bakgrunnsoppdatering erstatter historikken.
- VPS-en svarte med readiness 200 og Devotta ga en positiv manuell kontroll. Offentlig utstedelse er fortsatt deaktivert.

Eldre observasjoner nedenfor er historikk: siden 11. oktober er VPS-en oppgradert,
HTTPS/operatørinnlogging innført og Devotta har fått registrert hjemmeside og positiv kontroll.
Gjeldende restliste står i [roadmap.md](roadmap.md).

## Verifisert 11. oktober 2026

Automatikken er kontrollert lokalt. Den eksisterende VPS-demoen er ikke oppgradert,
og offentlig publisering er fortsatt avslått.

| Kontroll                                  | Resultat                                                                                                                               |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript, 25 automatiske tester og bygg | Bestått; også kjørt i appens Node 24.17.0-container                                                                                    |
| Ekte isolert PDS                          | Eksisterende integrasjon og ny worker-integrasjon bestått: publisering, gjentakelse etter SQLite-restart og tilbaketrekking            |
| Varig arbeid                              | Importavbrudd/gjenopptak, migrasjon, lease/retry, hendelser under pågående jobb, cursor, Jetstream-gap og backup/restore testet        |
| Publiseringsgrenser                       | Opt-in, pilotliste, versjonert policy, fast utsteder-DID/origin og sperre mot syntetiske records testet                                |
| Kildeutfall                               | DNS-/HTTP-feil holdes usikre; utløp og tilbaketrekking ved gammel registerstrøm testet                                                 |
| Offisiell Brreg-fil                       | 1 177 715 enheter importert, 114 124 kontroller kølagt; 183,8 sekunder inkludert nedlasting, maksimal RSS 524 MiB på lokal Node 26.3.0 |
| Offentlig identitetsoppslag               | `atproto.com` løst toveis; kun lesing                                                                                                  |
| Pilotkandidat                             | DEVOTTA AS (`922669708`) finnes, men mangler registrert hjemmeside og gir derfor ingen positiv verifikasjon                            |
| Lokal forhåndsvisning                     | Jetstream v2 koblet til, `/ready` svarte 200, operatørsiden kontrollert i nettleser uten JavaScript-feil                               |
| Isolasjon og hygiene                      | Fixture uten offentlig TCP/DNS, ingen fixture-porter, non-root/read-only; dependency-audit, formatering og workflow-kontroll bestått   |

Importmålingen omfatter ikke nettverkskontroll av hele registeret. En reell
utstederkonto, positiv målorganisasjon, offentlig akseptansetest, VPS-utrulling og
ekstern backup/varsling gjenstår. Se [antakelser og driftsoppsett](automation.md).
Etter import ble første side fra Brregs faktiske endringsstrøm hentet og lagret
med nåværende enheter og cursor. Hele endringskøen ble ikke avstemt i denne testen.

## Tidligere demonstrasjon: 7. oktober 2026

Gjennomført på macOS med Node 24.17 og Docker, og på prosjektets Linux VPS.

| Kontroll                                                                                     | Resultat                                                                                           |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| TypeScript, syv automatiske tester og bygg                                                   | Bestått                                                                                            |
| Formatering                                                                                  | Bestått                                                                                            |
| Ekte test-PDS: publiser, gjenta, nettverksfeil, trekk tilbake, bytt domene og publiser igjen | Bestått lokalt og på VPS                                                                           |
| Omkjøring uten duplikater                                                                    | Samme URI, CID og `createdAt` i integrasjonstesten                                                 |
| Tapt svar etter put/delete                                                                   | Testet med simulert transportfeil; avstemmes ved samme record-nøkkel                               |
| Apprestart på VPS                                                                            | Samme record og publiseringshistorikk etter ny kontroll                                            |
| Brreg API fra VPS                                                                            | `974760673` ga registrert hjemmeside `www.brreg.no`; ingen publiseringsendring                     |
| Offentlig atproto-adapter                                                                    | `atproto.com` løst toveis, profil lest fra kontoens PDS; ingen write                               |
| Nettverksisolasjon                                                                           | Fixture-nett er internt; direkte offentlig HTTPS fra fixture feilet som forventet lokalt og på VPS |
| Operatørendepunkter                                                                          | Fremmed Host/Origin og ugyldige request bodies avvist før kildeoppslag                             |
| Nettleser                                                                                    | Desktop og 390 px mobilvisning kontrollert; publisering og tilbaketrekking kjørt fra UI            |

[Skjermopptaket](media/demo-flow.webm) viser den faktiske demoen. PDS-integrasjonstesten sjekker serverens records, ikke bare statusen i brukergrensesnittet.

Dette var en demonstrasjon av publiseringsflyten. Status for videre implementasjon
og gjenstående driftsavklaringer står i [oppgavelisten](roadmap.md).

## Effektiv automatikk, 13. oktober 2026

Før endringen viste VPS-en 1 178 294 registerenheter og omtrent 120 700 jobber i kø,
inkludert 6 555 DID-oppslag. Av 113 876 enheter med registrert host hadde bare 423
minst én fullført kontroll. Siste times historikk hadde 1 578 utilgjengelige svar,
117 negative svar (109 uten hjemmeside), to vurderingssaker og tre positive
kontroller. Det er **kontrollforsøk**, ikke unike verifikasjoner. Retry-prioritering
og seriell behandling hindret førstegangsskanningen i å komme videre.

Lokal reproducerbar måling med `node dist/scripts/benchmark-worker.js`: 16 jobber,
1,2 sekunders simulert kildelatens, ekte SQLite-kø/leases, ingen ekstern trafikk.
Én arbeider brukte 20 086 ms; fire brukte 5 751 ms (3,49 ganger gjennomløpet).
Dette sammenligner den nye poolens innstillinger, ikke hele den gamle tjenesten
eller offentlig API-kapasitet.

Regresjonstester dekker avgrenset samtidighet, uavhengig registerpoll, tømming ved
stopp, rettferdig kø, registry-cache/fersk positiv kontroll, relevant filtrering
og deduplisering av endringer, Brreg 410, forskjellige retry-grenser og utdaterte
resultater. En domenekonflikt som oppstår under publisherens remote-lesing hindrer
ny put. Ekte isolert PDS bekrefter publisering, omkjøring uten duplikat, restart og
tilbaketrekking; fixture-isolasjonen er også kontrollert.

Statuspanelet er inspisert i Chromium med syntetiske køtall; norske tusenskiller,
køtyper og tydelig merking av at gjennomløp også inkluderer mislykkede forsøk.
Ingen nettleserfeil. Ingen offentlig prøvepublisering ble brukt i testene.

Scheduler-spørringen ble også målt på en disponibel kopi av VPS-backupen med
1 178 295 enheter, i en container uten nettverk. Den nye dekkende delindeksen
returnerte samme 112 942 kandidater som den gamle: 43–67 ms over tre målinger,
mot 191–817 ms med gammel indeks. Tallene inkluderer materialisering av resultatet
og påvirkes av cache/GC; `EXPLAIN QUERY PLAN` bekrefter dekkende indeks. Kopien
ble slettet med containeren; produksjonsdatabasen ble ikke brukt som testdatabase.
