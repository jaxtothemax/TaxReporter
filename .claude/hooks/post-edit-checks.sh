#!/bin/bash
# Post-edit hook: emit reminders to run relevant agents when sensitive files
# are modified. Receives the tool call JSON on stdin.
#
# CUSTOMIZE: Add patterns for your project's sensitive file types.
# Exit 0 = informational; exit 2 = block.

python3 - <<'PYEOF'
import sys, json, re

try:
    data = json.load(sys.stdin)
    file_path = data.get("tool_input", {}).get("file_path", "")
except Exception:
    sys.exit(0)

messages = []

# ── Agent reminders for sensitive file types ──────────────────────────────────
# CUSTOMIZE: Add patterns for your project's sensitive file types.

# Data models changed → check migrations
# Examples: models.py (Django), schema.prisma, migrations/, *.sql
if re.search(r"models\.py$|schema\.prisma$|\.sql$", file_path):
    messages.append("models/schema modified — verify migration safety")

# Endpoint/handler changed → check auth, RBAC, and security
# Examples: views.py (Django), routes/ (Express), handlers/ (Go)
if re.search(r"views\.py$|routes/|handlers/|controllers/", file_path):
    messages.append("endpoint modified — use the rbac-check and security-review agents (run them as a parallel batch)")

# Auth/permission logic changed → check RBAC
if re.search(r"permissions?\.py$|auth\.|middleware", file_path):
    messages.append("auth/permissions modified — use the rbac-check and security-review agents")

# UI surface changed → remind about VoC (before design) and accessibility (after)
# Examples: components/, pages/, features/ with *.tsx/*.jsx/*.vue/*.svelte
if re.search(r"(components?|pages?|screens?|features?|views?)/.*\.(tsx|jsx|vue|svelte)$", file_path):
    messages.append(
        "🎤 UI surface changed — for a new user-facing flow, run /voc before design;\n"
        "   after implementing, run the ux-review and accessibility agents."
    )

# ── Same-commit test reminder ─────────────────────────────────────────────────
# When production source is edited (not tests/migrations), remind to update
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
