# Security and maintenance

The verifier reads public registry and account data. Public issuance is opt-in;
the local demo uses synthetic data on an isolated PDS. A passing audit is not a
guarantee of security. Do not put real credentials or identity evidence in the
fixtures. Repository visibility does not make committed credentials safe.

- Report suspected vulnerabilities privately to an organisation maintainer.
  Do not include tokens, passwords, private keys, database contents or personal
  information in an issue or pull request.
- Keep environment files, runtime accounts, signing keys and databases out of
  Git and Docker build contexts. Back up persistent data together with its keys.
- Run the README checks before merging. CI tests changes and scans full Git
  history for secrets. Dependencies and Actions are checked weekly by Dependabot.
- Authentication, identity links and handle ownership do not grant membership.
  Check authorization at the point of access and fail closed on upstream failure.
- Preserve isolation tests, synthetic identities and pinned image digests.
  Never use `down -v` on a shared deployment. PDS upgrades need a backup and
  migration review; do not automatically roll out an alpha database upgrade.

See the README for this repository's specific deployment and trust boundaries.
