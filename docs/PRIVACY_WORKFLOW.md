# Privacy workflow

How private material is kept out of this repository, and what each safeguard
can and cannot do. Complements `docs/PUBLICATION.md`, which governs the
publication decision itself.

## Keep private material outside the source tree

The tracked source is synthetic-only. Real records, secrets and private reports live outside the repository, even during local development. Repository visibility is a separate boundary; the existing development history remains private and public releases use a fresh reviewed source export.

## Private material has a default location

The failure mode is not a missed regex. It is writing an operational report
into a tracked directory and only then deciding it was private, a judgement
no scanner can make for you. So the location is the decision:

| Material | Goes to |
| --- | --- |
| Private validation runs, diagnostics and operational reports | a dedicated private directory outside the repository |
| Owner context, planning packages, handoffs | outside the repository |
| Real measurements, auth stores and exports | a dedicated protected application-support directory outside the repository |
| Secrets | protected external configuration or an approved credential store |

The ignore rules also reject common accidental private paths. They are a backstop, not permission to keep private records under the source tree. Generic dated test results may be documented publicly only when they contain no operational or personal information.

## Layers, and the limit of each

| Layer | Prevents | Limit |
| --- | --- | --- |
| Default location | the mistake existing | relies on habit |
| `pre-commit` | entry into local history | bypassable; per-clone |
| `pre-push` | **data leaving the machine** | bypassable; per-clone |
| CI (`privacy.yml`) | nothing; it runs after the push | tripwire and publish gate only |
| `publish-audit` | publishing a dirty history | run it before every publish |

`pre-push` is the layer that matters most. A commit can be rewritten; a push
cannot be recalled. GitHub does not garbage-collect unreachable objects, so
anything ever pushed stays retrievable by SHA even after a force-push.

## Tooling

    brew install gitleaks

`gitleaks` is the credential gate: a maintained ruleset covering JWT-form
Supabase keys, provider tokens, cloud access keys and private-key blocks.
The hand-written patterns in `scripts/privacy-check.mjs` are a backstop only;
hand-maintained patterns rot, which is how an earlier version of that script
came to be blind to the one credential format this project actually uses.

Hooks live in `.githooks/` (tracked, unlike `.git/hooks/`) and are wired by
`npm install` via the `prepare` script. A fresh clone therefore arrives with
its gates already installed.

## Commands

    npm run privacy         # tracked tree
    npm run audit:history   # every revision of HEAD
    npm run check           # syntax + privacy + tests

## Before publishing

Run `npm run audit:history` against the exact ref being published, clear the
`docs/PUBLICATION.md` gates, and use a **fresh** repository for the initial public release. Subsequent releases retain that public history and import only reviewed source exports. The
development repository has a pre-rewrite commit on GitHub, so its visibility
must stay private. A public release contains only reviewed source files and public release history.
