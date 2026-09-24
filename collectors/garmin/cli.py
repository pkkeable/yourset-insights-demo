import argparse
import hashlib
import importlib.metadata
import json
import logging
import os
import subprocess
import sys
from datetime import date, datetime, timedelta, timezone
from uuid import uuid4
from zoneinfo import ZoneInfo
from . import normalize
from .models import Envelope
from .security import runtime, prepare, process_lock, verify_path, atomic_json
from .store import Store
from .provider import Reader, Budget, guarded_transport, AccessStopped
from .export import export_bundle

TZ = "America/Los_Angeles"


def day_window(today, recent=7, offsets=(30, 90)):
    return sorted(
        {today - timedelta(days=i) for i in range(1, recent + 1)}
        | {today - timedelta(days=i) for i in offsets}
    )


def digest_status():
    # Inspect installed public code, never authentication artifacts.
    from pathlib import Path
    import garminconnect

    root = Path(garminconnect.__file__).parent
    expected = json.loads((Path(__file__).parent / "artifact-hashes.json").read_text())
    return all(
        hashlib.sha256((root / name).read_bytes()).hexdigest() == value
        for name, value in expected.items()
    )


def doctor(root):
    result = {
        "python": sys.version.split()[0],
        "upstream": importlib.metadata.version("garminconnect"),
        "dependency_integrity": digest_status(),
        "runtime_exists": root.exists(),
        "token_exists": (root / "auth" / "garmin_tokens.json").exists(),
        "live_auth": "not_tested",
        "cloud_delivery": "disabled",
        "schedule": "disabled",
    }
    verify_path(root, True)
    if root.exists():
        for n in ["auth", "auth/garmin_tokens.json", "state.sqlite"]:
            verify_path(root / n, True)
    p = (
        subprocess.run(["/usr/bin/fdesetup", "status"], capture_output=True, text=True)
        if sys.platform == "darwin"
        else None
    )
    result["filevault"] = (
        "enabled" if p and "FileVault is On" in p.stdout else "not_confirmed"
    )
    print(json.dumps(result, indent=2))


def validate(root, args):
    today = datetime.now(ZoneInfo(args.timezone)).date()
    days = day_window(today)
    reader = Reader()
    budget = Budget()
    store = Store(verify_path(root / "state.sqlite", True))
    coverage = []
    count = 0
    row = store.db.execute('SELECT value FROM meta WHERE key="collector_id"').fetchone()
    collector = row[0] if row else str(uuid4())
    with store.db:
        store.db.execute(
            'INSERT OR IGNORE INTO meta VALUES("collector_id",?)', (collector,)
        )

    def accept(items):
        nonlocal count
        for r in items:
            if r is not None:
                store.put(r)
                count += 1

    try:
        with guarded_transport(budget):
            reader.login(root / "auth")
            for day in days:
                for family, fetch, mapper in [
                    ("sleep", reader.sleep, normalize.sleep),
                    ("hrv", reader.hrv, normalize.hrv),
                    ("rhr", reader.rhr, normalize.rhr),
                ]:
                    try:
                        records = mapper(
                            fetch(str(day)), str(day), collector, args.timezone
                        )
                        accept(records)
                        status = "available" if records else "valid_empty"
                        store.status(
                            family,
                            status,
                            str(day),
                            datetime.now(timezone.utc).isoformat(),
                        )
                    except (ValueError, TypeError, KeyError):
                        status = "schema_mismatch"
                        store.status(family, status)
                    except Exception:
                        status = "fetch_error"
                        store.status(family, status)
                    coverage.append(
                        {"family": family, "date": str(day), "status": status}
                    )
            start = str(today - timedelta(days=7))
            end = str(today - timedelta(days=1))
            inventory = reader.inventory(start, end)
            unique = {
                str(d["activityId"]): d
                for d in inventory
                if isinstance(d, dict) and "activityId" in d
            }
            selected = list(unique.values())
            # Round-robin distinct sports before filling remaining slots.
            chosen = []
            sports = set()
            for d in selected:
                sport = (d.get("activityType") or {}).get("typeKey", "unknown")
                if sport not in sports and len(chosen) < 5:
                    chosen.append(d)
                    sports.add(sport)
            for d in selected:
                if len(chosen) < 5 and d not in chosen:
                    chosen.append(d)
            for d in selected:
                try:
                    accept([normalize.activity(d, collector, args.timezone)])
                except (ValueError, TypeError, KeyError):
                    coverage.append({"family": "activity", "status": "schema_mismatch"})
            for d in chosen:
                for family, fetch, mapper in [
                    (
                        "activity",
                        reader.activity,
                        lambda raw: normalize.activity(raw, collector, args.timezone),
                    ),
                    (
                        "series",
                        reader.series,
                        lambda raw: normalize.series(
                            raw, d["activityId"], None, collector, args.timezone
                        ),
                    ),
                ]:
                    try:
                        accept([mapper(fetch(d["activityId"]))])
                        coverage.append({"family": family, "status": "available"})
                    except (ValueError, TypeError, KeyError):
                        coverage.append({"family": family, "status": "schema_mismatch"})
                    except Exception:
                        coverage.append({"family": family, "status": "fetch_error"})
    except AccessStopped as exc:
        coverage.append({"family": "transport", "status": str(exc)})
    except Exception:
        coverage.append({"family": "authentication", "status": "reauth_required"})
    finally:
        report = {
            "gate": "blocked"
            if any(x["status"] not in ["available", "valid_empty"] for x in coverage)
            else "proceed_with_named_gaps",
            "private_records_normalized": count,
            "requests": budget.count,
            "coverage": coverage,
            "token_resume": "observed" if count else "not_confirmed",
            "automatic_refresh": "observed"
            if budget.refresh_observed
            else "pending_observation",
            "manual_comparisons": "pending",
            "raw_responses_retained": False,
            "cloud_uploads": 0,
            "operational_trial": "not_started",
        }
        atomic_json(root / "validation-summary.json", report)
        atomic_json(root / "coverage.json", coverage)
        verify_path(root / "validation_report.md", True).write_text(
            "# Gate 1\n\n"
            + json.dumps(report, indent=2)
            + "\n\nManual Garmin Connect field comparisons remain pending. Success does not prove unattended reliability.\n"
        )
        verify_path(root / "validation_checks.csv", True).write_text(
            "check,status\nsleep_duration,pending_user_comparison\nhrv_dates_values,pending_user_comparison\nrhr,pending_user_comparison\nactivity_count_sport_duration,pending_user_comparison\nchart_units_resolution,pending_user_comparison\n"
        )
        store.close()
        print(json.dumps(report, indent=2))


def main():
    logging.disable(logging.CRITICAL)
    os.umask(0o077)
    parser = argparse.ArgumentParser(prog="garmin-collector")
    parser.add_argument("--timezone", default=TZ)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("doctor")
    sub.add_parser("status")
    auth = sub.add_parser("auth")
    auth.add_argument("action", choices=["login"])
    val = sub.add_parser("validate")
    val.add_argument("--recent-days", type=int, choices=[7], default=7)
    val.add_argument("--historical-offsets", choices=["30,90"], default="30,90")
    val.add_argument("--max-activities", type=int, choices=[5], default=5)
    exp = sub.add_parser("export")
    exp.add_argument("--from", dest="start", required=True)
    exp.add_argument("--to", dest="end", required=True)
    exp.add_argument("--profile", choices=["analysis"], required=True)
    sub.add_parser("schema")
    args = parser.parse_args()
    root = runtime()
    ZoneInfo(args.timezone)
    if args.command == "schema":
        print(json.dumps(Envelope.model_json_schema(), indent=2))
        return
    if args.command == "doctor":
        doctor(root)
        return
    if args.command == "status":
        report = verify_path(root / "validation-summary.json", True)
        print(
            report.read_text()
            if report.exists()
            else '{"gate":"not_tested","schedule":"disabled"}'
        )
        return
    if not digest_status():
        raise RuntimeError("dependency_integrity_failed")
    prepare(root)
    with process_lock(root):
        if args.command == "auth":
            if not sys.stdin.isatty() or not sys.stdout.isatty():
                raise RuntimeError("ordinary_user_terminal_required")
            from getpass import getpass

            print(
                "User-run login only. Credentials/MFA go to Garmin over TLS; profile/settings are read for authentication. No health reads until validate. No fallback transport or CAPTCHA bypass."
            )
            email = getpass("Garmin email (hidden): ")
            password = getpass("Garmin password (hidden): ")
            budget = Budget()
            try:
                with guarded_transport(budget):
                    Reader().login(
                        root / "auth",
                        email,
                        password,
                        lambda: getpass("Garmin MFA (hidden): "),
                    )
            finally:
                email = password = None
            verify_path(root / "auth" / "garmin_tokens.json", True)
            print("Login completed. Run validate in a new process to test token reuse.")
        elif args.command == "validate":
            validate(root, args)
        elif args.command == "export":
            start = date.fromisoformat(args.start)
            end = date.fromisoformat(args.end)
            if end < start:
                raise ValueError("invalid_window")
            store = Store(verify_path(root / "state.sqlite", True))
            try:
                count = export_bundle(
                    store, root / "exports", str(start), str(end), args.timezone
                )
            finally:
                store.close()
            print(
                json.dumps(
                    {
                        "exported_records": count,
                        "local_only": True,
                        "handoff": "HANDOFF_PENDING_EXTERNAL_READ",
                    }
                )
            )


if __name__ == "__main__":
    try:
        main()
    except AccessStopped as exc:
        print(json.dumps({"status": str(exc)}))
        sys.exit(2)
    except (Exception, KeyboardInterrupt):
        print(
            '{"status":"blocked","detail":"Operation failed; no private exception text logged."}'
        )
        sys.exit(2)
