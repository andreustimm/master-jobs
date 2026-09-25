#!/usr/bin/env python3
"""Deep-review level classifier (PATCH LOCAL master-jobs; ver PATCHES.md).

Classifies a diff by the risk of the paths it touches, so the review costs what
the risk asks for (G53 in docs/engineering/rules/delivery.md):

  L0  only Markdown — no deep-review; structural validators only.
  L1  default — one inline defect pass, no subagent fan-out, no polish lane.
  L2  auth/session, public profile (/p/), schema/migrations, promotion/deploy,
      scorer, security/secrets — the full pipeline.

The level is the maximum over every changed path, INCLUDING paths the manifest
ignores by filter (a drizzle snapshot is filtered from review but still means
the diff touches schema). Unknown paths fall to L1, never to L0: only an
explicit Markdown match skips the review.

Usage:
  review_level.py --out <out>          # classify <out>/manifest.json, write <out>/level.json
  review_level.py --paths a.ts b.md    # classify the given paths, print JSON

Exit codes: 0 ok, 1 missing/invalid manifest.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.dont_write_bytecode = True  # keep the tracked skill tree free of __pycache__

from _common import glob_to_regex, read_json, write_json

# Each L2 entry names the reason a reviewer would give; the reason is printed
# so a surprising L2 is explainable instead of silently expensive.
L2_GLOBS: tuple[tuple[str, str], ...] = (
    ("src/contexts/auth/**", "autenticação/sessão"),
    ("app/login/**", "autenticação/sessão"),
    ("app/api/**", "rota sem página: autenticação por omissão"),
    ("app/**/route.ts", "rota sem página: autenticação por omissão"),
    # Regra 15: toda Server Action chama guard() antes do efeito. Os arquivos
    # "use server" se chamam actions.ts, analysis-actions.ts, locale-action.ts…
    ("app/**/*action*.ts", "autorização: Server Action"),
    ("proxy.ts", "autenticação/sessão"),
    ("tests/support/entry-inventory.ts", "exceções de guarda"),
    ("tests/entry-denial.test.ts", "prova de negação antes do efeito"),
    ("tests/architecture.test.ts", "exceções de guarda de página e rota"),
    ("app/p/**", "perfil público /p/"),
    ("src/core/candidate-public.ts", "perfil público /p/"),
    ("src/core/public-cv.ts", "perfil público /p/"),
    ("drizzle/**", "schema/migration"),
    ("src/core/db/schema.ts", "schema/migration"),
    ("src/core/db/migrate.ts", "schema/migration"),
    ("src/core/db/migration-review.ts", "schema/migration"),
    ("tests/fixtures/migration-verdicts/**", "schema/migration"),
    (".github/workflows/**", "promoção/deploy"),
    ("scripts/release/**", "promoção/deploy"),
    ("scripts/github/**", "promoção/deploy"),
    ("scripts/vercel-ignore-build.sh", "promoção/deploy"),
    ("vercel.json", "promoção/deploy"),
    ("next.config.ts", "promoção/deploy (cabeçalhos e CSP)"),
    (".githooks/**", "promoção/deploy"),
    ("src/core/scoring/**", "scorer"),
    ("profile/**", "scorer"),
    ("src/core/security.ts", "segurança/segredos"),
    ("scripts/sw-template.js", "segurança: cache do service worker"),
    ("src/core/llm/providers.ts", "segurança/segredos: chave BYOK"),
    ("src/core/llm/registry.ts", "segurança/segredos: chave BYOK"),
    ("src/core/db/config.ts", "segurança/segredos: guarda de conexão"),
    ("src/core/db/client.ts", "segurança/segredos: guarda de conexão"),
    ("**/.env*", "segurança/segredos"),
)
# A path word, anywhere in the path, that means security even where the table
# has no glob yet: a new `session-*.ts` or a test that guards passwords.
L2_WORDS = re.compile(r"(?:^|[/_.-])(auth|oauth|session|sessions|password|secret|secrets|security|impersonat\w*)(?:$|[/_.-])", re.I)
L0_GLOBS: tuple[str, ...] = ("**/*.md",)

_L2 = [(glob_to_regex(glob), glob, why) for glob, why in L2_GLOBS]
_L0 = [glob_to_regex(glob) for glob in L0_GLOBS]


def classify_path(path: str) -> tuple[str, str]:
    for regex, glob, why in _L2:
        if regex.match(path):
            return "L2", f"{why} ({glob})"
    word = L2_WORDS.search(path)
    if word:
        return "L2", f"segurança: palavra '{word.group(1)}' no caminho"
    if any(regex.match(path) for regex in _L0):
        return "L0", "Markdown"
    return "L1", "padrão"


def classify(paths: list[str]) -> dict:
    rows = []
    for path in sorted(set(paths)):
        level, why = classify_path(path)
        rows.append({"path": path, "level": level, "why": why})
    level = max((row["level"] for row in rows), default="L0")
    return {"level": level, "paths": rows}


def manifest_paths(manifest: dict) -> list[str]:
    paths = []
    for file in manifest.get("files", []):
        paths.append(file["path"])
        if file.get("old_path"):
            paths.append(file["old_path"])  # a rename out of drizzle/ still touches schema
    return paths


def prior_level(out: Path) -> str:
    levels = [
        read_json(path).get("level", "L0")
        for path in [out / "level.json", *sorted(out.glob("rounds/*/level.json"))]
        if path.is_file()
    ]
    return max(levels, default="L0")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--out", help="artifact dir holding manifest.json; writes level.json")
    source.add_argument("--paths", nargs="+", help="classify these repo-relative paths")
    args = parser.parse_args()
    if args.paths:
        print(json.dumps(classify(args.paths), ensure_ascii=False, indent=2))
        return 0
    out = Path(args.out).resolve()
    try:
        result = classify(manifest_paths(read_json(out / "manifest.json")))
        prior = prior_level(out)
    except (OSError, KeyError, RuntimeError, ValueError) as error:
        sys.stderr.write(f"level: cannot classify {out / 'manifest.json'}: {error}\n")
        return 1
    if prior > result["level"]:
        # Round 2+ sees only the delta; a docs-only fix to an L2 diff is still
        # the L2 diff. The level of a target never goes down between rounds.
        result = {**result, "level": prior, "pinned_by_prior_round": True}
    write_json(out / "level.json", result)
    raised = [row for row in result["paths"] if row["level"] == result["level"]]
    print(f"level: {result['level']} ({len(result['paths'])} paths)")
    for row in raised[:10]:
        print(f"  {row['path']}: {row['why']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
