# Publication boundary

Release the portfolio source from a reviewed clean snapshot into a fresh repository with fresh history. Keep the existing development repository private; do not change its visibility or mirror archived refs. One maintained implementation feeds both releases, with an explicit source manifest for each promotion.

Public source is synthetic only. Preserve the current `UNLICENSED` position: publicly readable source grants no reuse rights. Bundled font licenses and notices remain in force. The owner-provided YourSet mark is included for this product; no production application code is copied.

Before pushing the exact release, record its source commit, included-file manifest, asset provenance, dependency/advisory report, synthetic browser results and history audit. Verify a clean install/build and a complete decision/review walkthrough. Documentation must distinguish local synthetic validation from source integration and operational use. See the [capability matrix](CAPABILITIES.md).

The static build uses an explicit file allowlist. It excludes collectors, provider projections, SQL, private configuration and validation records. No private API, credentials or real-data imports belong in that bundle. Source publication does not create a hosted demo; a hosting destination and deployment configuration are separate decisions.

Review secrets **and ordinary personal measurements**. A secret scanner cannot establish that a table or screenshot is synthetic. Private planning, real records, operational reports and credentials stay outside the source tree. Never copy private preview fixtures, screenshots or repository history into the public release. Public copies cannot be recalled by reverting visibility.

## Reproducible source export

`docs/release-files.txt` is the exact source allowlist, reviewed before each release. From a committed candidate, run `node scripts/export-source.mjs EMPTY_DESTINATION HEAD`. It reads Git blobs from that commit, preserves executable modes, refuses a nonempty destination and emits `SOURCE_RELEASE.json` with content hashes. It copies no `.git` directory or archived refs. Review and initialize fresh history in the destination, then run the documented clean-install, build, browser, privacy and dependency checks there before publication. Keep the private source/public release mapping in an external release ledger.
