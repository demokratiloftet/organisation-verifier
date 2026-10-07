# Demo: fire minutter

Åpne http://127.0.0.1:3012 etter `pnpm demo:up`, eller bruk SSH-oppsettet i [driftsveiledningen](operations.md).

1. **Formålet:** «Vi finner eksisterende atproto-kontoer fra hjemmesiden i Brreg. Vi oppretter ingen bedriftsbruker.» Vis de fire trinnene.
2. **Publisering:** velg «Alt stemmer» og kjør. Vis domenet, DID og navnet. Utvid «Vis record og tekniske detaljer». Dette er en ekte `app.bsky.graph.verification` på en isolert PDS.
3. **Omkjøring:** kjør «Alt stemmer» igjen. Vis at URI, nøkkel og `createdAt` er de samme. Vi lager ikke en ny verifikasjon hver gang.
4. **Tilbakekalling:** velg «Profilnavnet endres». Vis «Må vurderes» og «Trukket tilbake». Recorden er faktisk slettet på PDS-en; kontrollhistorikken er bevart.
5. **Live API:** bytt til Brreg-fanen og hent `974760673`. Vis faktiske registerdata og en ærlig konklusjon. Denne enheten forventes ikke å gi en positiv kontroll på det eksakte `www`-domenet. Ingen offentlig record blir publisert.
6. **Neste steg:** policyavklaringer, full registerimport, varige jobber, offentlig utsteder og kontinuerlig overvåking. Vis [oppgavene](roadmap.md).

Valgfritt: kjør «Midlertidig nettverksfeil» etter en positiv kontroll. En timeout skal ikke automatisk trekke tilbake en eksisterende verifikasjon.

## Materiale

- [Skjermopptak uten lyd](media/demo-flow.webm)
- [Skjermbilde](media/demo-overview.png)
- [Arkitektur og sekvensdiagram](architecture.md)

Opptaket bruker syntetiske organisasjonsdata og private testkontoer i demonstrasjonsfanen. Live-fanen viser et faktisk Brreg-oppslag. Det er ikke et opptak av offentlig utstedelse eller et synlig Bluesky-merke.
