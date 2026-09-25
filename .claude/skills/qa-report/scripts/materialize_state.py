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


def split_list(value: str) -> list[str]:
    return [item.strip() for item in value.split(";") if item.strip()]


def within(path: Path, parent: Path) -> bool:
    try:
        path.resolve().relative_to(parent.resolve())
        return True
    except ValueError:
        return False


def repo_bases(root: Path) -> list[Path]:
    """The QA root and its ancestors up to the repository root, inclusive.

    Stops at the first directory holding `.git` (a directory in a clone, a file
    in a worktree): going higher would find the main checkout's copy of a file
    this branch deleted, and the local gate would pass what CI rejects.
    """
    bases = []
    for base in [root.resolve(), *root.resolve().parents]:
        bases.append(base)
        if (base / ".git").exists():
            break
    return bases


def reference_errors(root: Path, path: Path, row: dict[str, str]) -> list[str]:
    """Files the scenario cites must exist; a dangling citation is an unproved claim.

    A reference may be written relative to the QA root (`reports/x.md`) or to
    the repo root (`docs/qa/reports/x.md`, `tests/e2e/ui.mjs`). The repo root is
    found as an ancestor of the QA root, never taken from the working directory,
    so the verdict does not depend on where the script is launched. A report may
    also be named by its bare slug.

    `evidence/` is the one exception: it is gitignored by contract — screenshots
    live on disk or as a CI artifact, and the versioned report records where —
    so a clean checkout cannot see it, and demanding it would fail every CI run.
    """
    errors: list[str] = []
    evidence_dir = root / "evidence"
    bases = repo_bases(root)

    def exists(value: str) -> bool:
        return any((base / value).is_file() for base in bases)

    journey = row["journey"]
    if journey and not (root / "journeys" / f"{journey}.md").is_file():
        errors.append(f"{path}: journey {journey!r} has no journeys/{journey}.md")
    for bug in split_list(row["bug_ids"]):
        if not (root / "bugs" / f"{bug}.md").is_file():
            errors.append(f"{path}: bug {bug!r} has no bugs/{bug}.md")
    report = row["last_report"]
    if report and not (exists(report) or (root / "reports" / f"{report}.md").is_file()):
        errors.append(f"{path}: last_report {report!r} does not exist")
    for item in split_list(row["evidence"]):
        if any(within(base / item, evidence_dir) for base in bases):
            continue
        if not exists(item):
            errors.append(f"{path}: evidence {item!r} does not exist")
    return errors


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
            errors.extend(reference_errors(root, path, row))
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
