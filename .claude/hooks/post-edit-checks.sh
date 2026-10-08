#!/bin/bash
# Post-edit hook: emit reminders to run relevant agents when sensitive files
# are modified. Receives the tool call JSON on stdin.
#
# CUSTOMIZE: Add patterns for your project's sensitive file types.
# Exit 0 = informational; exit 2 = block.

# The event JSON arrives on stdin, but `python3 -` reads its program from
# stdin too (the heredoc below), so the event must be captured first and
# handed over in an env var. Reading sys.stdin inside the heredoc program
# finds EOF, the except branch exits 0, and the hook silently checks nothing.
HOOK_EVENT_JSON="$(cat)"
export HOOK_EVENT_JSON

python3 - <<'PYEOF'
import os, sys, json, re

try:
    data = json.loads(os.environ.get("HOOK_EVENT_JSON") or "{}")
    file_path = data.get("tool_input", {}).get("file_path", "")
except Exception:
    sys.exit(0)

messages = []

# ── Agent reminders for this repo's sensitive paths ──────────────────────────

# Untrusted input: broker adapters parse hostile files, the rate-snapshot
# builder parses XML downloaded from Banka Slovenije, the CLI reads any
# path it is given, and the pipeline and the web app's worker run every
# file a user adds (ADR 0013).
if re.search(r"packages/(brokers|pipeline)/src/|packages/fx/(src|scripts)/|apps/cli/src/|apps/web/src/engine/", file_path):
    messages.append(
        "untrusted-input handling modified — run the security-review agent\n"
        "   (size limits, no DTD/external entities, no eval, ReDoS-safe regexes)"
    )

# Generated output that FURS ingests.
if re.search(r"packages/furs/src/", file_path):
    messages.append(
        "FURS XML generation modified — update the golden files, validate them against\n"
        "   packages/furs/schemas/, and run the security-review agent"
    )

# Vendored FURS schemas: FURS edits them in place, so a schema change is a
# tax-rule change, and the bytes must stay exactly what FURS published.
if re.search(r"packages/furs/schemas/", file_path):
    messages.append(
        "vendored FURS schema modified — re-vendor it byte for byte, update the SHA-256\n"
        "   table in packages/furs/schemas/README.md, and treat it as a tax-rule change"
    )

# Tax, rate and lot logic: a changed rule changes people's returns.
if re.search(r"packages/(core|fx|furs)/src/", file_path) and not re.search(r"\.test\.tsx?$", file_path):
    messages.append(
        "tax/rate/lot logic modified — cite the primary source in docs/research/, and if any\n"
        "   figure can change, add a `changed` changelog fragment naming the affected returns"
    )

# UI surface changed → remind about VoC (before design) and accessibility (after)
if re.search(r"apps/web/src/.*\.(tsx|jsx)$", file_path) and not re.search(r"\.test\.tsx?$", file_path):
    messages.append(
        "🎤 UI surface changed — for a new user-facing flow, run /voc before design;\n"
        "   after implementing, run the ux-review and accessibility agents."
    )

# ── Same-commit test reminder ─────────────────────────────────────────────────
# When production source is edited (not tests/fixtures), remind to update
# the corresponding test file in the same commit.
#
# CUSTOMIZE: Adjust path patterns for your project's source layout.
# Examples:
#   Django:  backend source excluding tests/ and migrations/
#   Rails:   app/(models|controllers|services)/
#   Go:      internal/|cmd/ excluding _test.go
#   Node.js: src/ excluding __tests__/ or *.test.ts

def is_production_source(path):
    if not re.search(r"\.(py|ts|tsx|go|rb|java|rs|js|jsx)$", path):
        return False
    if re.search(r"/(tests?|__tests?__|spec|migrations?|fixtures?|mocks?|stubs?)/", path):
        return False
    if re.search(r"(\.test\.|\.spec\.|_test\.)", path):
        return False
    return True

if is_production_source(file_path):
    messages.append(
        "📋 Production source edited — update the corresponding test file in the SAME commit.\n"
        "   Run: make test (or the scoped test command for this file) before committing."
    )

# ── Type checker reminder ─────────────────────────────────────────────────────
# After any TypeScript source change, remind to run the type checker so
# fixture and interface drift is caught before commit.
#
# CUSTOMIZE: Adjust to match your stack (tsc, mypy, go vet, etc.).

if re.search(r"\.(ts|tsx)$", file_path) and not re.search(r"/(tests?|__tests?__|spec)/", file_path):
    messages.append(
        "📋 TypeScript source edited — run `make typecheck` before committing\n"
        "   to catch stale test fixtures and interface drift."
    )

# ── Env var / settings rename guard ──────────────────────────────────────────
# When settings or config files are modified, remind to grep for any renamed
# vars across the full repo (CI config, docs, test fixtures).
#
# CUSTOMIZE: Add your project's settings/config file patterns.

if re.search(r"settings\.py$|config\.(py|ts|js|yml|yaml|toml)$|\.env\.example$", file_path):
    messages.append(
        "📋 Settings/config modified — if any env var or key was renamed, grep for the old name:\n"
        "   grep -r 'OLD_NAME' . --include='*.yml' --include='*.py' --include='*.ts' --include='*.md'"
    )

# ─────────────────────────────────────────────────────────────────────────────

if messages:
    print("\n".join(messages))

PYEOF
