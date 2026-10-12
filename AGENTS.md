# Organisation verifier

- Use pnpm and the configured Git identity. No co-author trailers.
- Keep verification policy pure and separate from fetching, storage and publication.
- Use the AT Protocol SDK and validate handles bidirectionally. Never trust a Jetstream event or a registry search hit as proof.
- Synthetic records may only be published to the isolated fixture PDS. Manual live checks are read-only; public background issuance requires the explicit issuer configuration and pilot allowlist.
- Do not give anonymous public visitors read/write access. Internet deployment requires HTTPS and operator authentication. Keep operator credentials out of logs, pages and Git.
- Persist publication intent before remote writes and reconcile uncertain results at the same record key.
- Keep code small and readable. Prefer direct functions to generic frameworks.
- Run pnpm check and the real-PDS integration test for changes to the publication lifecycle. Record limitations honestly.
- Preserve other repositories and running VPS services.
