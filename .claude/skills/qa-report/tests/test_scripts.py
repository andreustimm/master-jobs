import csv
import runpy
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SKILL_DIR = Path(__file__).resolve().parents[1]
EXPLODE = SKILL_DIR / "scripts" / "explode_state.py"
MATERIALIZE = SKILL_DIR / "scripts" / "materialize_state.py"
MATERIALIZE_API = runpy.run_path(str(MATERIALIZE))
FRONT_FIELDS = [
    "id", "area", "title", "persona", "journey", "expected", "entry_points",
    "qa_status", "bug_ids", "fix_status", "retest_status", "fix_commits",
    "evidence", "last_report", "overlaps",
]
FIELDS = FRONT_FIELDS + ["notes"]


def csv_row(**overrides: str) -> dict[str, str]:
    row = dict.fromkeys(FIELDS, "")
    row.update({
        "id": "JOBS-rank-visible",
        "area": "JOBS",
        "title": "See ranked jobs",
        "persona": "Andreus em triagem noturna",
        "journey": "J-review-ranked-jobs",
        "expected": "Ranked jobs remain visible after refresh",
        "entry_points": "http://127.0.0.1:3000/jobs",
        "qa_status": "untested",
    })
    row.update(overrides)
    return row


def scenario_text(*, notes: str = "Notes.", **overrides: str) -> str:
    values = {
        "id": "JOBS-rank-visible",
        "area": "JOBS",
        "title": "See ranked jobs",
        "persona": "Andreus em triagem noturna",
        "journey": "J-review-ranked-jobs",
        "expected": "Ranked jobs remain visible after refresh",
        "entry_points": "http://127.0.0.1:3000/jobs",
        "qa_status": "pass",
        "bug_ids": "",
        "fix_status": "",
        "retest_status": "",
        "fix_commits": "",
        "evidence": "evidence/run/checkpoint.png",
        "last_report": "reports/run.md",
        "overlaps": "",
    }
    unknown = overrides.keys() - values.keys()
    if unknown:
        raise ValueError(f"unknown scenario fields: {sorted(unknown)}")
    values.update(overrides)
    front = "\n".join(f"{field}: {values[field]}".rstrip() for field in FRONT_FIELDS)
    return f"---\n{front}\n---\n\n{notes}\n"


class QaReportScriptTests(unittest.TestCase):
    def run_script(self, script: Path, *args: Path) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(script), *(str(arg) for arg in args)],
            capture_output=True,
            text=True,
            check=False,
        )

    def test_explode_rejects_id_that_escapes_scenarios(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            csv_path = root / "legacy.csv"
            row = csv_row(id="../escape")
            with csv_path.open("w", newline="", encoding="utf-8") as handle:
                writer = csv.DictWriter(handle, fieldnames=FIELDS)
                writer.writeheader()
                writer.writerow(row)

            result = self.run_script(EXPLODE, csv_path, root / "qa")

            self.assertEqual(result.returncode, 1)
            self.assertIn("unsafe id", result.stderr)
            self.assertFalse((root / "qa" / "escape.md").exists())

    def test_explode_preflights_all_collisions_before_writing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            qa_root = root / "qa"
            scenarios = qa_root / "scenarios"
            scenarios.mkdir(parents=True)
            (scenarios / "JOBS-existing.md").write_text("existing", encoding="utf-8")
            csv_path = root / "legacy.csv"
            rows = []
            for rid in ("JOBS-new", "JOBS-existing"):
                rows.append(csv_row(id=rid))
            with csv_path.open("w", newline="", encoding="utf-8") as handle:
                writer = csv.DictWriter(handle, fieldnames=FIELDS)
                writer.writeheader()
                writer.writerows(rows)

            result = self.run_script(EXPLODE, csv_path, qa_root)

            self.assertEqual(result.returncode, 1)
            self.assertIn("already exists", result.stderr)
            self.assertFalse((scenarios / "JOBS-new.md").exists())

    def test_explode_rejects_case_insensitive_batch_collision(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            csv_path = root / "legacy.csv"
            with csv_path.open("w", newline="", encoding="utf-8") as handle:
                writer = csv.DictWriter(handle, fieldnames=FIELDS)
                writer.writeheader()
                writer.writerows([
                    csv_row(id="JOBS-Login"),
                    csv_row(id="JOBS-login"),
                ])

            result = self.run_script(EXPLODE, csv_path, root / "qa")

            self.assertEqual(result.returncode, 1)
            self.assertIn("case-insensitive duplicate id", result.stderr)
            self.assertFalse((root / "qa" / "scenarios").exists())

    def test_explode_rejects_case_insensitive_existing_collision(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            scenarios = root / "qa" / "scenarios"
            scenarios.mkdir(parents=True)
            existing = scenarios / "JOBS-Login.md"
            existing.write_text("existing", encoding="utf-8")
            csv_path = root / "legacy.csv"
            with csv_path.open("w", newline="", encoding="utf-8") as handle:
                writer = csv.DictWriter(handle, fieldnames=FIELDS)
                writer.writeheader()
                writer.writerow(csv_row(id="JOBS-login"))

            result = self.run_script(EXPLODE, csv_path, root / "qa")

            self.assertEqual(result.returncode, 1)
            self.assertIn("already exists", result.stderr)
            self.assertEqual(existing.read_text(encoding="utf-8"), "existing")
            self.assertEqual(len(list(scenarios.glob("*.md"))), 1)

    def test_materialize_accepts_the_canonical_schema(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            scenarios = root / "scenarios"
            scenarios.mkdir()
            (scenarios / "JOBS-rank-visible.md").write_text(scenario_text(), encoding="utf-8")

            result = self.run_script(MATERIALIZE, root)

            self.assertEqual(result.returncode, 0, result.stderr)
            with (root / "state.csv").open(newline="", encoding="utf-8") as handle:
                reader = csv.DictReader(handle)
                rows = list(reader)
            self.assertEqual(reader.fieldnames, FIELDS)
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]["id"], "JOBS-rank-visible")
            self.assertEqual(rows[0]["expected"], "Ranked jobs remain visible after refresh")
            self.assertEqual(rows[0]["evidence"], "evidence/run/checkpoint.png")
            self.assertEqual(rows[0]["notes"], "Notes.")

    def test_materialize_rejects_invalid_enum(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            scenarios = root / "scenarios"
            scenarios.mkdir()
            (scenarios / "JOBS-rank-visible.md").write_text(
                scenario_text(qa_status="passed"), encoding="utf-8"
            )

            result = self.run_script(MATERIALIZE, root)

            self.assertEqual(result.returncode, 1)
            self.assertIn("invalid qa_status", result.stderr)

    def test_explode_rejects_invalid_state_before_writing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            csv_path = root / "legacy.csv"
            with csv_path.open("w", newline="", encoding="utf-8") as handle:
                writer = csv.DictWriter(handle, fieldnames=FIELDS)
                writer.writeheader()
                writer.writerow(csv_row(qa_status="passed"))

            result = self.run_script(EXPLODE, csv_path, root / "qa")

            self.assertEqual(result.returncode, 1)
            self.assertIn("invalid qa_status", result.stderr)
            self.assertFalse((root / "qa" / "scenarios").exists())

    def test_explode_requires_reason_for_skips_and_deferrals(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            csv_path = root / "legacy.csv"
            cases = {
                "skipped": (csv_row(qa_status="skipped"), "requires reasoning in notes"),
                "deferred": (
                    csv_row(bug_ids="BUG-1", fix_status="deferred"),
                    "requires reasoning in notes",
                ),
            }
            for name, (row, message) in cases.items():
                with self.subTest(name=name):
                    with csv_path.open("w", newline="", encoding="utf-8") as handle:
                        writer = csv.DictWriter(handle, fieldnames=FIELDS)
                        writer.writeheader()
                        writer.writerow(row)
                    result = self.run_script(EXPLODE, csv_path, root / "qa")
                    self.assertEqual(result.returncode, 1)
                    self.assertIn(message, result.stderr)
                    self.assertFalse((root / "qa" / "scenarios").exists())

    def test_explode_rejects_contradictory_retest_verdict(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            csv_path = root / "legacy.csv"
            row = csv_row(
                qa_status="fail",
                bug_ids="BUG-1",
                fix_status="fixed",
                retest_status="pass",
                fix_commits="abc123",
                evidence="evidence/run/failure.png",
                last_report="reports/run.md",
            )
            with csv_path.open("w", newline="", encoding="utf-8") as handle:
                writer = csv.DictWriter(handle, fieldnames=FIELDS)
                writer.writeheader()
                writer.writerow(row)

            result = self.run_script(EXPLODE, csv_path, root / "qa")

            self.assertEqual(result.returncode, 1)
            self.assertIn("retest_status 'pass' requires qa_status 'pass'", result.stderr)
            self.assertFalse((root / "qa" / "scenarios").exists())

    def test_materialize_rejects_missing_and_reordered_fields(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            scenarios = root / "scenarios"
            scenarios.mkdir()
            cases = {
                "missing": scenario_text().replace("area: JOBS\n", ""),
                "reordered": scenario_text().replace("area: JOBS\n", "").replace(
                    "title: See ranked jobs\n", "title: See ranked jobs\narea: JOBS\n"
                ),
                "malformed closing delimiter": scenario_text().replace("\n---\n\n", "\n---oops\n\n"),
            }
            path = scenarios / "JOBS-rank-visible.md"
            for name, malformed in cases.items():
                with self.subTest(name=name):
                    path.write_text(malformed, encoding="utf-8")
                    result = self.run_script(MATERIALIZE, root)
                    self.assertEqual(result.returncode, 1)
                    expected = "unterminated frontmatter" if name == "malformed closing delimiter" else "fields are"
                    self.assertIn(expected, result.stderr)

    def test_materialize_rejects_unsafe_scenario_id(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            scenarios = root / "scenarios"
            scenarios.mkdir()
            path = scenarios / "JOBS bad id.md"
            path.write_text(
                scenario_text().replace("id: JOBS-rank-visible", "id: JOBS bad id"),
                encoding="utf-8",
            )

            result = self.run_script(MATERIALIZE, root)

            self.assertEqual(result.returncode, 1)
            self.assertIn("unsafe id", result.stderr)

    def test_materialize_rejects_case_insensitive_duplicate_ids(self) -> None:
        validate = MATERIALIZE_API["casefold_duplicate_errors"]
        entries = [
            (Path("scenarios/JOBS-Login.md"), {"id": "JOBS-Login"}),
            (Path("scenarios/JOBS-login.md"), {"id": "JOBS-login"}),
        ]

        errors = validate(entries)

        self.assertEqual(len(errors), 1)
        self.assertIn("case-insensitive duplicate id", errors[0])

    def test_materialize_rejects_blank_planning_and_unproved_pass(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            scenarios = root / "scenarios"
            scenarios.mkdir()
            path = scenarios / "JOBS-rank-visible.md"
            cases = {
                "blank journey": (scenario_text(journey=""), "blank required fields"),
                "pass without evidence": (scenario_text(evidence=""), "requires evidence"),
                "pass without report": (scenario_text(last_report=""), "requires last_report"),
                "fix without bug": (
                    scenario_text(fix_status="fixed", fix_commits="abc123", retest_status="pass"),
                    "fix_status requires bug_ids",
                ),
                "skip without reason": (
                    scenario_text(qa_status="skipped", notes=""),
                    "requires reasoning in the body",
                ),
                "deferral without reason": (
                    scenario_text(bug_ids="BUG-1", fix_status="deferred", notes=""),
                    "requires reasoning in the body",
                ),
                "failed scenario with passing retest": (
                    scenario_text(
                        qa_status="fail",
                        bug_ids="BUG-1",
                        fix_status="fixed",
                        retest_status="pass",
                        fix_commits="abc123",
                    ),
                    "retest_status 'pass' requires qa_status 'pass'",
                ),
            }
            for name, (malformed, message) in cases.items():
                with self.subTest(name=name):
                    path.write_text(malformed, encoding="utf-8")
                    result = self.run_script(MATERIALIZE, root)
                    self.assertEqual(result.returncode, 1)
                    self.assertIn(message, result.stderr)


if __name__ == "__main__":
    unittest.main()
