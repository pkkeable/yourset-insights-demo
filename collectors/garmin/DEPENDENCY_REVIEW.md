# Dependency review — 2026-09-12

Selected garminconnect 0.3.15, Python 3.12.14. Registry wheel SHA-256: `aa57cb5635eb2ad8f2ba9899043b644125289fd7169cd29d74b3207df4246c0d`. PyPI and GitHub tag `0.3.15` agree; tag commit `54079fbca3cafaa371b5d0cd1aa9cfb0ae62c7a5`. The wheel's client.py matches that tag byte-for-byte (`9f0d3bdc5389cfef2a8cac33bddb121b80e083f86c9023906c05c709c749fc90`). This resolves the older handoff's registry/tag discrepancy for the chosen artifact.

Inspected __init__.py, client.py, typed.py and activity_details.py. `artifact-hashes.json` permits local doctor to detect changes to these reviewed files. `requirements.lock` pins transitive packages with hashes. Install into an isolated venv, using `pip install --require-hashes -r collectors/garmin/requirements.lock`. No automatic upgrades.

GHSA-wjhr-76vg-2hvc affected token storage through 0.3.4; the selected version includes later token-path hardening. Inspected token implementation uses ancestry symlink rejection, 0700 directories, 0600 exclusive temporary files and atomic replacement. Our wrapper also verifies ownership, private modes, and process locking. FileVault is checked, not changed. This is not a security guarantee against another process running as the user.

The new default upstream login uses five strategies, including TLS impersonation and alternate portal attempts. Our wrapper permits only mobile+requests, disables HAS_CFFI for the guarded scope, rejects unreviewed endpoints and stops 401/403/429 and HTML challenges at the actual HTTP send layer. AccessStopped derives from BaseException so broad upstream fallback handlers cannot swallow access stops. Auth POST is allowed; API mutation verbs are not. Counting at send includes pagination and redirects. No transport retry layer is added. Automatic proactive DI token refresh is supported; a persistent 401 stops for user attention. Real refresh remains pending observation.

The requested library login necessarily fetches social profile/settings. Those response payloads remain in process memory and are never persisted or printed. Health collection uses a nine-date validation sample and at most five detailed activities, 100 actual HTTP requests, one second minimum spacing and a 15-minute budget. Transport challenges stop validation rather than trying alternate auth endpoints.

Optional readiness/load/Body Battery/VO2max methods are not requested in this first candidate. RHR response path and channel units remain candidate mappings pending account comparison. Unknown keys are dropped, missing values remain null, chart data are not represented as native resolution, and route geometry is excluded.

This is unofficial personal access. The Garmin business developer program is not an entitlement for this application. Account login, source permission applicability, manual field comparisons, token resume and refresh must be evaluated separately. No commercial integration or redistribution claim is made.

Primary references: [PyPI artifact](https://pypi.org/project/garminconnect/0.3.15/), [pinned source](https://github.com/cyberjunky/python-garminconnect/tree/54079fbca3cafaa371b5d0cd1aa9cfb0ae62c7a5), [token advisory](https://github.com/cyberjunky/python-garminconnect/security/advisories/GHSA-wjhr-76vg-2hvc), [Garmin program FAQ](https://developer.garmin.com/gc-developer-program/program-faq/).

## September 23 release check

The public release audit found CVE-2025-71176 in the development-only pytest 9.0.2 pin. Updated only pytest to 9.0.3, using both SHA-256 hashes from the exact PyPI release; the other dependency pins remain unchanged. The hash-required installation and all 23 Python tests plus ruff passed. This does not change the Garmin account-validation status above. [Upstream fix](https://github.com/pytest-dev/pytest/releases/tag/9.0.3).
