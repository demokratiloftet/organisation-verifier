# Verifisert 7. oktober 2026

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

Dette er ikke en produksjonsgodkjenning: full registerbatch, varige bakgrunnsjobber, Jetstream, full feiltaksonomi, offentlig utsteder og tillitspolicy står fortsatt på [oppgavelisten](roadmap.md).
