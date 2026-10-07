---
name: tracker-hygiene
description: On-demand hygiene sweep of the GitHub issue tracker. Flags release:* label exclusivity violations (GitHub labels are not scoped, so nothing else enforces it), unlabeled issues in a dated milestone, likely-duplicate issues, and stale intended-but-unmilestoned issues. Reports only — it never relabels or closes anything. Lighter and far more frequent than /dotplanning's one-time kickoff grooming pass; run it between kickoffs to catch drift before it becomes a rescue triage.
argument-hint: "[--milestone <X.Y>] [--silent]"
---

# Tracker Hygiene — Issue Tracker Drift Sweep

You are sweeping the tracker for the drift that accumulates **between** `/dotplanning`
runs.

`/dotplanning` is deliberately a one-time kickoff gate: re-running it mid-cycle
rediscovers the same gaps and turns into whack-a-mole. That leaves nothing watching the
tracker for the rest of the cycle, and drift is not hypothetical — a milestone reaches a
few hundred issues against one date one issue at a time, and `release:*` labels end up
doubled on a single issue because GitHub labels are not scoped: nothing in the tracker —
web UI, `gh`, or API — drops `release:stretch` when `release:committed` is added. The
project emulates exclusivity by convention (remove the other two in the same
`gh issue edit` call), and a convention is exactly what drifts. This skill is the cheap,
repeatable check that finds that early instead of at the next rescue triage.

**Report only.** Every finding is a candidate for the user to act on. This skill never
calls `gh issue edit`, `gh api -X PATCH`/`POST`/`DELETE`, or anything else that mutates
the tracker. Applying a `release:*` label in particular is the user's call every time per
`CLAUDE.md`'s milestone-commitment rule — ask, never infer, even when the "obvious" value
seems clear — and this skill's job stops at naming which issues need that call made.

---

## Scope discipline

In scope:

- `release:*` label exclusivity violations (two or more values on one issue)
- Issues in a dated milestone carrying **no** `release:*` value
- Likely-duplicate issues (title overlap)
- Stale intended-but-unmilestoned issues

Out of scope:

- Deciding *which* `release:*` value an issue should carry — that is `/dotplanning`'s
  grooming pass at kickoff, or a direct user decision mid-cycle. This skill finds issues
  missing a decision; it never makes one.
- The feature→asset gap map, kickoff questions, and workstream sequencing — that is
  `/dotplanning`, run once at the start of a milestone.
- Anything a CI gate already enforces. Do not duplicate a check that reds CI.

## When to run

- On demand, whenever the tracker feels like it is drifting
- On a light recurring cadence between milestone kickoffs — this is cheap enough to run
  far more often than `/dotplanning`
- **Not** as a substitute for `/dotplanning` at kickoff, and not as a loop within one
  session: one sweep, one report, per invocation

## Arguments

- `--milestone <X.Y>` — target a specific milestone. Defaults to the active dated
  milestone with the nearest due date.
- `--silent` — report only; skip the offer at the end of Step 6.

---

## Tracker access (GitHub)

Every `gh api` path below uses the `{owner}/{repo}` placeholders, which `gh` fills in from
the **origin** remote at run time — never hardcode the repository. With no origin remote
(or an origin that is not on GitHub) `gh` exits non-zero with
`unable to expand placeholder in path`: report "no tracker — nothing to sweep" and stop.
There is nothing to infer a repository from, and guessing one sweeps someone else's.

**`gh api --paginate` prints one JSON array per page, concatenated** (`[...][...]`), which a
bare `json.load` rejects as soon as there is more than one page — and `per_page=100`
without `--paginate` silently truncates at a hundred (so does `gh issue list --limit`),
which on a drifting tracker is exactly the part you are sweeping for. Use this reader for
every paginated query below:

```bash
read_pages() { python3 -c "
import json,sys
raw=sys.stdin.read(); dec=json.JSONDecoder(); i=0; out=[]
while i<len(raw):
    while i<len(raw) and raw[i].isspace(): i+=1
    if i>=len(raw): break
    o,i=dec.raw_decode(raw,i); out+=o
json.dump(out,sys.stdout)"; }

# GitHub's /issues endpoint also returns pull requests, and its labels are objects.
# Drop the PRs and flatten labels to names so every step below reads one shape.
issues_only() { python3 -c "
import json,sys
json.dump([{'number': i['number'], 'title': i['title'],
            'labels': [l['name'] for l in i['labels']],
            'updated_at': i['updated_at'], 'milestone': i.get('milestone')}
           for i in json.load(sys.stdin) if 'pull_request' not in i], sys.stdout)"; }
```

## Step 0 — Resolve the target milestone

```bash
gh api --paginate "repos/{owner}/{repo}/milestones?state=open&per_page=100" \
  | read_pages | python3 -c "
import json,sys
ms=[m for m in json.load(sys.stdin) if m.get('due_on')]
ms.sort(key=lambda m: m['due_on'])
for m in ms: print(m['number'], m['title'], m['due_on'][:10])
"
```

Take the nearest-due dated milestone unless `--milestone` was passed; export its title as
`$MILESTONE` and its **number** as `$MS` — GitHub's issues endpoint filters by milestone
number, not title (with `--milestone`, look the number up in the same listing, using
`state=all`). This is deliberately simpler than `/dotplanning`'s resolution — hygiene
sweeps whatever milestone is in flight, not the one about to open.

## Step 1 — Pull the milestone's issues

```bash
ISSUES="$(mktemp -t tracker-hygiene.XXXXXX)"; export ISSUES
gh api --paginate "repos/{owner}/{repo}/issues?milestone=$MS&state=open&per_page=100" \
  | read_pages | issues_only > "$ISSUES"
python3 -c "import json,os; print(len(json.load(open(os.environ['ISSUES']))), 'open issues')"
```

## Step 2 — Scoped-label exclusivity violations

```bash
python3 -c "
import json, os
for i in json.load(open(os.environ['ISSUES'])):
    rel = [l for l in i['labels'] if l.startswith('release:')]
    if len(rel) >= 2:
        print(f\"#{i['number']:>4}  {'+'.join(rel)}  {i['title'][:80]}\")
"
```

A hit here is a data-integrity finding, not a judgment call: GitHub enforces no
exclusivity anywhere, so a single `--add-label` that forgot its `--remove-label` leaves
two values, and this state exists in practice. Report each one — do not silently pick a
value to keep. (`startswith('release:')` also catches a misspelled `release:` label sitting beside a
real one.)

## Step 3 — Unlabeled issues in a dated milestone

```bash
python3 -c "
import json, os
for i in json.load(open(os.environ['ISSUES'])):
    if not any(l.startswith('release:') for l in i['labels']):
        print(f\"#{i['number']:>4}  {i['title'][:90]}\")
"
```

Per `CLAUDE.md`'s milestone-commitment rule, every issue in a dated milestone carries
exactly one of `release:committed` / `release:reserve` / `release:stretch`. An
unlabeled issue is a gap the milestone is currently hiding — which is the whole reason
the rule prefers a visible gap to a guessed label.

## Step 4 — Likely-duplicate issues

Inherently fuzzy. Present candidates, not certainties, and say so in the report.

```bash
python3 -c "
import json, os, re
from itertools import combinations
issues = json.load(open(os.environ['ISSUES']))
def norm(t): return set(re.sub(r'[^a-z0-9 ]',' ',t.lower()).split()) - {'the','a','an','to','for','on','in','of','and'}
pairs = []
for a, b in combinations(issues, 2):
    wa, wb = norm(a['title']), norm(b['title'])
    if not wa or not wb: continue
    overlap = len(wa & wb) / min(len(wa), len(wb))
    if overlap >= 0.6:
        pairs.append((overlap, a['number'], b['number'], a['title'][:60], b['title'][:60]))
for o, ia, ib, ta, tb in sorted(pairs, reverse=True)[:15]:
    print(f'{o:.0%}  #{ia} {ta!r}  <->  #{ib} {tb!r}')
"
```

**Read both issues before reporting a pair.** A 60% token overlap on short titles produces
false positives — two unrelated bugs can both be titled around "fix the schedule view".
Drop the pairs that reading disproves; keep the rest as candidates for the user.

## Step 5 — Stale intended-but-unmilestoned issues

Whatever label the project uses for work it intends to do but has not scheduled
(`direction`, `someday`, `backlog` — check the label list; if the project has none, record
this step as `n/a` and move on). That label is not supposed to be where issues go to be
forgotten.

```bash
gh api --paginate "repos/{owner}/{repo}/issues?labels=direction&state=open&per_page=100" \
  | read_pages | issues_only | python3 -c "
import json, sys
from datetime import datetime, timezone
now = datetime.now(timezone.utc)
for i in json.load(sys.stdin):
    if i.get('milestone'): continue
    updated = datetime.fromisoformat(i['updated_at'].replace('Z','+00:00'))
    age = (now - updated).days
    if age >= 90:
        print(f\"#{i['number']:>4}  {age:>4}d idle  {i['title'][:80]}\")
"
```

Ninety days idle and unmilestoned is a candidate to pull into a milestone or close as no
longer intended. This skill surfaces the candidate and stops.

## Step 6 — Report

```
## Tracker Hygiene — $MILESTONE — <date>

### release:* exclusivity violations (Step 2)
<issue list, or "none">

### Unlabeled in $MILESTONE (Step 3)
<issue list with count, or "none">

### Likely duplicates (Step 4)
<candidate pairs with overlap %, or "none above threshold">

### Stale unmilestoned intent (Step 5)
<issue list with idle days, or "none" / "n/a — no such label">

### Recommended next step
<one sentence>
```

Unless `--silent` was passed and if anything was found, offer **once**: "Want the
`release:*` questions drafted as a single message so you can answer them in one pass?"
Do not apply a label even if the user answers inline — state the values back and let them
confirm before anything is written, the same posture as `/dotplanning`'s grooming pass —
and when they do, apply each value with its two siblings removed in the same call
(`gh issue edit <N> --add-label release:<value> --remove-label release:<x>,release:<y>`;
`/dotplanning` Step 6d's `apply_release`). That write is the user's follow-up, not part of
this sweep.

---

## What this does not do

- Apply, remove, or change a label
- Close, reopen, or edit an issue
- Decide a `release:*` value — it only finds where that decision is missing
- Replace `/dotplanning`'s kickoff pass (asset gaps, open questions, sequencing, capacity)

## Anti-patterns to refuse

- Auto-applying a `release:*` label to clear a Step 3 finding
- Reporting a title-overlap match as a confirmed duplicate without reading both issues
- Re-running the sweep in place of acting on it — one sweep, one report, then act
- Widening into a full asset/gap audit mid-cycle. That creep is precisely what
  `/dotplanning`'s one-time-gate discipline exists to prevent.
