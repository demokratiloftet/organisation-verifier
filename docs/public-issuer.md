# Offentlig Demokratiloftet-utsteder på Eurosky

Oppdatert 14. oktober 2026. Verifikatoren kjører fortsatt på vår VPS, men publiserer
fra den dedikerte Eurosky-kontoen. Operatørsiden er fortsatt
[verifikasjon.demokratiloftet.no](https://verifikasjon.demokratiloftet.no/).

- Handle: `er-verifier.demokratiloftet.no`
- Utsteder-DID: `did:plc:ajyco6mbknwtlx567ugu4wer`
- PDS: `https://eurosky.social`
- Collection: `app.bsky.graph.verification`
- Aktiv pilot: DEVOTTA AS (`922669708`). Andre organisasjoner kontrolleres uten offentlig utstedelse.

DNS TXT på `_atproto.er-verifier.demokratiloftet.no` peker til denne DID-en.
DID-dokumentet peker tilbake til handle og Eurosky. Utstederkontoen trenger ikke
selv å bestå Brreg-kontrollen; leserne må uttrykkelig velge å stole på utstederen.

## Hva publiseres?

En offentlig record med `subject` (organisasjonskontoens DID), `handle`,
`displayName` og `createdAt`. Den ligger i utstederens repository, ikke på
organisasjonskontoen. Dette oppretter ikke et sosialt innlegg. Organisasjonsnummer,
Brreg-grunnlag og intern kontrollhistorikk ligger fortsatt hos verifikatoren.
Bekreftelsen gjelder domenetilknytning, toveis kontoidentitet og navnesamsvar;
den beviser ikke juridisk fullmakt eller medlemskap.

Lesere kan hente records med `com.atproto.repo.listRecords` på Eurosky og må følge
`cursor`, kontrollere utsteder-DID, gjeldende handle/navn og håndtere tilbaketrekking.
Offentlig tilgjengelighet betyr ikke automatisk merke eller godkjenning i MU,
Bluesky eller andre apper. En JSON-record alene er ikke et selvstendig signaturbevis.

```text
GET https://eurosky.social/xrpc/com.atproto.repo.listRecords
    ?repo=did:plc:ajyco6mbknwtlx567ugu4wer
    &collection=app.bsky.graph.verification
```

## Bekreftet overgang 14. oktober

Fersk Brreg-, domene-, toveis identitets- og profilnavnkontroll ga `match` for
Devotta kl. 18.49 norsk tid (16.49 UTC). Bakgrunnsarbeideren publiserte:

```text
at://did:plc:ajyco6mbknwtlx567ugu4wer/app.bsky.graph.verification/3mxtyv4hdy22k
subject: did:plc:f7vvzsi3zfydiswbw2uejxec
handle: devotta.no
displayName: Devotta AS
createdAt: 2026-10-14T16:49:15.859Z
```

Recorden ble lest offentlig uten innlogging. En ny kontroll kl. 18.50 beholdt
samme URI, CID og `createdAt`, uten duplikater. Readiness svarte 200, og kontoen
hadde ingen `app.bsky.feed.post`-records. Den gamle offentlige recorden hos
`did:plc:coubd2izvctyl4emmh426pf7` ble deretter trukket tilbake gjennom publisherens
varige `revoking`-tilstand. Ekstern lesing bekreftet `RecordNotFound`.
Kontrollhistorikk og den gamle kontoen beholdes. Se
[historisk VPS-oppsett](public-issuer-vps-history.md).

## Drift og hemmeligheter

Eksisterende applikasjonsbilde og kontrollregler er beholdt. Bare utstederens PDS,
DID, identifier og passordfil ble endret. Pilotlisten er fortsatt kun Devotta.
Brreg-importen ble ikke kjørt på nytt. Worker- og endringsbehandling fortsetter.

Et eget app-passord uten privilegert tilgang ble opprettet av operatøren og sendt
rett til serveren over SSH. Kontopassordet ble ikke lagret på serveren.
App-passordet ligger i `.runtime/eurosky-issuer-password`, under en root-beskyttet
katalog (0700). Filen har modus 0600 og containerbrukerens UID/GID 1000 for lesing
via Compose secret. Passord og sesjonstokens skal aldri inn i Git, logger eller chat.

Compose-konfigurasjonen og deploy-metadata peker til Eurosky. En konsistent
SQLite-sikkerhetskopi med bestått integritetskontroll og de tidligere
konfigurasjonsfilene finnes på VPS-en i
`/root/loftet-rollbacks/verifier-eurosky-20261014`.

Rollback må avstemme offentlige records, ikke gjenopprette en gammel database over
nyere historikk. Den gamle Devotta-recorden er trukket tilbake; et eventuelt bytte
tilbake krever fersk kontroll og eksplisitt vedlikehold av begge utstederes records.
Den gamle PDS-en er beholdt. Lesere som var konfigurert med gammel utsteder-DID,
må bytte til den nye. Synlige merker i andre apper inngår ikke i denne overgangen.
