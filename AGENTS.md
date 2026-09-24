# YourSet Insights

This is the separate analytics workspace. Do not modify the existing production YourSet repository, app, database or deployment. It is a visual reference only when the user authorizes inspection.

Keep private planning packages, owner configuration, real health data, auth stores, diagnostic captures and operational reports outside Git and outside this source tree. Never read credentials into a tool transcript. Garmin sign-in runs in an ordinary user Terminal with hidden prompts. Treat normalized health measurements as private data too.

The public/demo build is synthetic only. The same core metrics power every view; never hardcode a second set of narrative numbers. Preserve explicit completeness, source lineage, revisions, dated targets and comparability boundaries. No global readiness score, numerical prescription engine or photo body-fat estimation.

Routine local work, dedicated private setup and approved public releases may proceed within the owner's authorization. The public source and synthetic demo are published; update them only within an authorized release scope using the reviewed source export and publication checks. Never publish private development history or personal records. Changes to licensing, paid services or live ingestion require explicit owner authorization. Passing synthetic tests is not account validation or an operational trial.

Checks: `npm run check`, `npm run build`, `.venv/bin/python -m pytest tests/test_collector.py tests/test_delivery.py -q`, `.venv/bin/ruff check collectors tests`. Record actual evidence and limitations.
