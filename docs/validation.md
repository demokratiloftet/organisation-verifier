# Kontrollert 13. oktober 2026

- 32 tester, typekontroll og bygg bestått lokalt. Lokal Node er 26.3.0; CI bruker låst Node 24.17.
- Oppdatert produksjonsimage (Node 24.17): ekte isolert PDS-integrasjon, varig worker og nettverksisolasjon bestått i separat Compose-prosjekt.
- 31 av 32 enhetstester bestod også i det minimale produksjonsimaget; TLS-testen krever `openssl`, som bare finnes i utviklings-/CI-miljøet. Den bestod lokalt. Dette er en manglende testavhengighet i runtime-imaget, ikke en verifisert CI-kjøring.
- Ingen kjente moderate eller høyere sårbarheter fra `pnpm audit` i app eller fixture.
- PSL-regelen er testet med `co.uk`, `com.au`, `github.io` og `s3.amazonaws.com`, inkludert vern mot å hoppe til selve suffixet.
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
