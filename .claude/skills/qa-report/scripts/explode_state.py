#!/usr/bin/env python3
"""Explode a legacy state.csv into scenario files: one <qa-docs-path>/scenarios/<id>.md per row.

Adoption helper (one-time): reads the CSV, writes scenario files, touches nothing else.
Ids are grandfathered verbatim (id = filename); '||'-packed notes unfold into body paragraphs.
Validate the round trip afterwards with materialize_state.py (same row count, zero parse errors).
Usage: rtk python3 explode_state.py <state-csv-path> <qa-docs-path>
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


def validate_row(row: dict[str | None, str | None], line: int, rid: str) -> list[str]:
    errors = []
    missing = sorted(field for field in REQUIRED_PLANNING if not (row[field] or "").strip())
    if missing:
        errors.append(f"line {line} ({rid}): blank required fields {missing}")
    for field, allowed in ENUMS.items():
        value = (row[field] or "").strip()
        if value not in allowed:
            errors.append(f"line {line} ({rid}): invalid {field} {value!r}")
    qa_status = (row["qa_status"] or "").strip()
    bug_ids = (row["bug_ids"] or "").strip()
    fix_status = (row["fix_status"] or "").strip()
    retest_status = (row["retest_status"] or "").strip()
    if qa_status == "fail" and not bug_ids:
        errors.append(f"line {line} ({rid}): qa_status 'fail' requires bug_ids")
    if fix_status and not bug_ids:
        errors.append(f"line {line} ({rid}): fix_status requires bug_ids")
    if qa_status in SETTLED_WITH_EVIDENCE and not (row["evidence"] or "").strip():
        errors.append(f"line {line} ({rid}): qa_status {qa_status!r} requires evidence")
    if qa_status in SETTLED_WITH_REPORT and not (row["last_report"] or "").strip():
        errors.append(f"line {line} ({rid}): qa_status {qa_status!r} requires last_report")
    if fix_status == "fixed" and not (row["fix_commits"] or "").strip():
        errors.append(f"line {line} ({rid}): fix_status 'fixed' requires fix_commits")
    if retest_status and fix_status != "fixed":
        errors.append(f"line {line} ({rid}): retest_status requires fix_status 'fixed'")
    if retest_status == "pass" and qa_status != "pass":
        errors.append(f"line {line} ({rid}): retest_status 'pass' requires qa_status 'pass'")
    if retest_status == "fail" and qa_status != "fail":
        errors.append(f"line {line} ({rid}): retest_status 'fail' requires qa_status 'fail'")
    notes = (row["notes"] or "").strip()
    if qa_status == "skipped" and not notes:
        errors.append(f"line {line} ({rid}): qa_status 'skipped' requires reasoning in notes")
    if fix_status == "deferred" and not notes:
        errors.append(f"line {line} ({rid}): fix_status 'deferred' requires reasoning in notes")
    return errors


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    csv_path, root = Path(sys.argv[1]), Path(sys.argv[2])
    with csv_path.open(newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        if reader.fieldnames != FIELDS:
            print(f"error: {csv_path}: header is {reader.fieldnames}, expected {FIELDS}", file=sys.stderr)
            return 1
        rows = list(reader)
    errors, seen, seen_casefold = [], set(), set()
    for i, row in enumerate(rows, start=2):
        rid = (row["id"] or "").strip()
        if not rid:
            errors.append(f"line {i}: empty id")
        elif not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]*", rid):
            errors.append(f"line {i}: unsafe id {rid!r}; expected letters, digits, _ or -")
        elif rid in seen:
            errors.append(f"line {i}: duplicate id {rid!r}")
        elif rid.casefold() in seen_casefold:
            errors.append(f"line {i}: case-insensitive duplicate id {rid!r}")
        elif None in row or any(v is None for v in row.values()):
            errors.append(f"line {i} ({rid}): wrong column count")
        else:
            errors.extend(validate_row(row, i, rid))
        seen.add(rid)
        seen_casefold.add(rid.casefold())
    for err in errors:
        print(f"error: {err}", file=sys.stderr)
    if errors:
        return 1
    out_dir = root / "scenarios"
    out_dir.mkdir(parents=True, exist_ok=True)
    destinations = [out_dir / f"{row['id'].strip()}.md" for row in rows]
    collisions = [path for path in destinations if path.exists()]
    existing_casefold = {path.stem.casefold(): path for path in out_dir.glob("*.md")}
    for row, path in zip(rows, destinations, strict=True):
        existing = existing_casefold.get(row["id"].strip().casefold())
        if existing is not None and existing != path and path not in collisions:
            collisions.append(existing)
    if collisions:
        for path in sorted(set(collisions)):
            print(f"error: {path} already exists — refusing to overwrite", file=sys.stderr)
        return 1
    for row, path in zip(rows, destinations, strict=True):
        front = "\n".join(
            f"{f}: {' '.join((row[f] or '').split())}".rstrip() for f in FRONT_FIELDS
        )
        body = "\n\n".join(p.strip() for p in (row["notes"] or "").split("||") if p.strip())
        path.write_text(f"---\n{front}\n---\n\n{body}\n", encoding="utf-8")
    print(f"{out_dir}: {len(rows)} scenario files written")
    return 0


if __name__ == "__main__":
    sys.exit(main())
