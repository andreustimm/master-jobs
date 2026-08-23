#!/usr/bin/env python3
"""Materialize the tracker view: <qa-docs-path>/scenarios/*.md -> <qa-docs-path>/state.csv.

The CSV is generated output (gitignored) — the scenario files are the source of truth.
Usage: rtk python3 materialize_state.py <qa-docs-path>
"""
import csv
import re
import sys
from pathlib import Path

FRONT_FIELDS = [
    "id", "area", "title", "persona", "journey", "expected", "entry_points",
    "qa_status", "bug_ids", "fix_status", "retest_status", "fix_commits",
    "evidence", "last_report", "overlaps",
]
FIELDS = FRONT_FIELDS + ["notes"]
ENUMS = {
    "qa_status": {"untested", "pass", "fail", "blocked-verify", "blocked-decision", "skipped"},
    "fix_status": {"", "pending", "fixed", "deferred"},
    "retest_status": {"", "pending", "pass", "fail"},
}
REQUIRED_PLANNING = {"id", "area", "title", "persona", "journey", "expected", "entry_points"}
SETTLED_WITH_EVIDENCE = {"pass", "fail"}
SETTLED_WITH_REPORT = {"pass", "fail", "blocked-verify", "blocked-decision"}


def parse_scenario(path: Path) -> dict[str, str]:
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        raise ValueError(f"{path}: missing frontmatter delimiter")
    try:
        front, body = text.removeprefix("---\n").split("\n---\n", 1)
    except ValueError:
        raise ValueError(f"{path}: unterminated frontmatter") from None
    row = {f: "" for f in FIELDS}
    keys = []
    for line in front.splitlines():
        if not line.strip():
            continue
        if ":" not in line or line.startswith((" ", "\t")):
            raise ValueError(f"{path}: not flat frontmatter: {line!r}")
        key, value = line.split(":", 1)
        key = key.strip()
        if key not in FRONT_FIELDS:
            raise ValueError(f"{path}: unknown field {key!r}")
        if key in keys:
            raise ValueError(f"{path}: duplicate field {key!r}")
        keys.append(key)
        row[key] = value.strip()
    if keys != FRONT_FIELDS:
        raise ValueError(f"{path}: fields are {keys}, expected {FRONT_FIELDS}")
    row["notes"] = " ".join(body.split())
    if not row["id"]:
        raise ValueError(f"{path}: missing id")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]*", row["id"]):
        raise ValueError(f"{path}: unsafe id {row['id']!r}; expected letters, digits, _ or -")
    if row["id"] != path.stem:
        raise ValueError(f"{path}: id {row['id']!r} != filename")
    missing = sorted(field for field in REQUIRED_PLANNING if not row[field])
    if missing:
        raise ValueError(f"{path}: blank required fields {missing}")
    for field, allowed in ENUMS.items():
        if row[field] not in allowed:
            raise ValueError(f"{path}: invalid {field} {row[field]!r}; expected {sorted(allowed)}")
    if row["qa_status"] == "fail" and not row["bug_ids"]:
        raise ValueError(f"{path}: qa_status 'fail' requires bug_ids")
    if row["fix_status"] and not row["bug_ids"]:
        raise ValueError(f"{path}: fix_status requires bug_ids")
    if row["qa_status"] in SETTLED_WITH_EVIDENCE and not row["evidence"]:
        raise ValueError(f"{path}: qa_status {row['qa_status']!r} requires evidence")
    if row["qa_status"] in SETTLED_WITH_REPORT and not row["last_report"]:
        raise ValueError(f"{path}: qa_status {row['qa_status']!r} requires last_report")
    if row["fix_status"] == "fixed" and not row["fix_commits"]:
        raise ValueError(f"{path}: fix_status 'fixed' requires fix_commits")
    if row["retest_status"] and row["fix_status"] != "fixed":
        raise ValueError(f"{path}: retest_status requires fix_status 'fixed'")
    if row["retest_status"] == "pass" and row["qa_status"] != "pass":
        raise ValueError(f"{path}: retest_status 'pass' requires qa_status 'pass'")
    if row["retest_status"] == "fail" and row["qa_status"] != "fail":
        raise ValueError(f"{path}: retest_status 'fail' requires qa_status 'fail'")
    if row["qa_status"] == "skipped" and not row["notes"]:
        raise ValueError(f"{path}: qa_status 'skipped' requires reasoning in the body")
    if row["fix_status"] == "deferred" and not row["notes"]:
        raise ValueError(f"{path}: fix_status 'deferred' requires reasoning in the body")
    return row


def casefold_duplicate_errors(entries: list[tuple[Path, dict[str, str]]]) -> list[str]:
    errors, ids_by_casefold = [], {}
    for path, row in entries:
        folded = row["id"].casefold()
        if folded in ids_by_casefold:
            errors.append(
                f"{path}: case-insensitive duplicate id {row['id']!r}; "
                f"already used by {ids_by_casefold[folded]}"
            )
        else:
            ids_by_casefold[folded] = path
    return errors


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    root = Path(sys.argv[1])
    scenarios = root / "scenarios"
    if not scenarios.is_dir():
        print(f"error: {scenarios} is not a directory", file=sys.stderr)
        return 1
    entries, errors = [], []
    for path in sorted(scenarios.glob("*.md")):
        try:
            row = parse_scenario(path)
            entries.append((path, row))
        except ValueError as exc:
            errors.append(str(exc))
    errors.extend(casefold_duplicate_errors(entries))
    for err in errors:
        print(f"error: {err}", file=sys.stderr)
    if errors:
        return 1
    rows = [row for _, row in entries]
    out = root / "state.csv"
    with out.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(sorted(rows, key=lambda r: r["id"]))
    print(f"{out}: {len(rows)} scenarios")
    return 0


if __name__ == "__main__":
    sys.exit(main())
