---
name: dotplanning
description: Plan a release milestone BEFORE any development starts. Resolves the milestone scope, asks the kickoff questions that decide the release's shape (charter, date-vs-scope, capacity, reserve, maturity, freeze), builds a feature→asset map, flags every missing screen/flow/endpoint/model/doc that has no issue or design, surfaces the decisions that must be answered before coding, sequences the work into gated workstreams, runs a first grooming pass proposing a release:committed / reserve / stretch label for every milestone issue against stated capacity, and drops a self-contained HTML report. The begin-gate bookend to /pre-release (the end-gate). Run once at milestone kickoff — not per feature.
disable-model-invocation: true
argument-hint: "[version] [--no-file]"
---

# Release Planning — Kickoff Gate

Turn a loose milestone (a spec section plus a pile of issues) into a full, sequenced,
gap-checked plan **before the first feature branch exists**. `/pre-release` is the
**end-gate** that audits what shipped; `/dotplanning` is the **begin-gate** that
plans what's about to be built.

**One-time gate, not a loop.** Run this **once** at the start of a milestone. It
produces a plan; it does not write code, run per-feature gates, or re-run after every
decision. Re-run only on a deliberate, material change of scope.

---

## Arguments

- `[version]` — optional explicit milestone/version to plan (e.g. `0.1`, `1.2`, `v2`).
  If omitted, resolve the next unstarted milestone automatically (Step 0).
- `--no-file` — skip the "offer to file gap issues" step (Step 9). The report is still written.
- `--no-apply` — run the grooming pass (Step 6) and report the proposed commitment
  ledger, but write no labels to the tracker.

---

## Tracker access (GitHub)

The tracker is GitHub Issues, reached through `gh`. Every `gh api` path below uses the
`{owner}/{repo}` placeholders, which `gh` fills in from the **origin** remote at run time
(`gh repo view --json nameWithOwner -q .nameWithOwner` shows what it resolved to) — never
hardcode the repository. With no origin remote, or an origin that is not a GitHub repo,
`gh` exits non-zero with `unable to expand placeholder in path`. That is the **no-tracker**
case: follow each step's no-tracker path and say so in the report. Never guess a repo.

Three helpers, used by Steps 0, 1b and 6d. Sub-agents run in their own shell, so paste
these into any sub-agent brief that queries the tracker.

```bash
# `gh api --paginate` prints one JSON array PER PAGE, concatenated (`[...][...]`), which a
# bare json.load rejects as soon as there is a second page. This reader merges them.
read_pages() { python3 -c "
import json,sys
raw=sys.stdin.read(); dec=json.JSONDecoder(); i=0; out=[]
while i<len(raw):
    while i<len(raw) and raw[i].isspace(): i+=1
    if i>=len(raw): break
    o,i=dec.raw_decode(raw,i); out+=o
json.dump(out,sys.stdout)"; }

# GitHub's issues endpoint filters by milestone NUMBER, not title: a title there is
# rejected or matches nothing, never the milestone you meant. Prints nothing if absent.
milestone_number() {  # milestone_number <title>
  gh api --paginate "repos/{owner}/{repo}/milestones?state=all&per_page=100" | read_pages \
    | python3 -c "import json,sys; t=sys.argv[1]; print(next((str(m['number']) for m in json.load(sys.stdin) if m['title']==t), ''))" "$1"
}

# milestone_issues <number> [open|closed|all] — one flat JSON array. The issues endpoint
# also returns pull requests; they are dropped here. Labels are flattened to names.
milestone_issues() {
  gh api --paginate "repos/{owner}/{repo}/issues?milestone=$1&state=${2:-open}&per_page=100" \
    | read_pages | python3 -c "
import json,sys
json.dump([{'number': i['number'], 'title': i['title'],
            'labels': [l['name'] for l in i['labels']],
            'updated_at': i['updated_at'], 'closed_at': i.get('closed_at')}
           for i in json.load(sys.stdin) if 'pull_request' not in i], sys.stdout)"
}
```

**GitHub labels are not exclusive.** GitLab's scoped labels (`key::value`) make the
tracker drop the old value when a new one is applied; GitHub has no equivalent. This
project emulates it with plain labels — `release:committed`, `release:reserve`,
`release:stretch` — and one rule: **whenever one `release:*` label is applied, the other two
are removed in the same `gh issue edit` call** (Step 6d's `apply_release`). Nothing else
enforces exclusivity, so every write is read back.

---

## Step 0 — Resolve the target milestone

The target is the milestone **about to be built** — the next unstarted release, not
the one that just shipped. Never hardcode a version.

1. If `[version]` was given, use it.
2. Otherwise, determine the current shipped version and the next planned one:
   - Read the project's version source (e.g. `package.json`, `pyproject.toml`,
     `VERSION`, or the latest `git tag`) for the **last shipped** version.
   - List open milestones from the tracker and pick the smallest one strictly greater
     than the shipped version:
     ```bash
     gh api --paginate "repos/{owner}/{repo}/milestones?state=open&per_page=100" | read_pages \
       | python3 -c "import json,sys; [print(m['number'], m['title'], m.get('due_on') or 'undated') for m in json.load(sys.stdin)]"
     ```
     (If there is no tracker — see *Tracker access* — ask the user which version they
     are planning.)
3. Confirm before proceeding:
   > "Planning the **<VERSION>** milestone (last shipped: <SHIPPED>). Proceed?"
4. Every issue this plan places in `$VERSION` carries exactly one
   `release:committed` / `release:reserve` / `release:stretch` label (see
   *Milestone commitment* in `CLAUDE.md`; on GitHub these are plain labels whose
   exclusivity this skill maintains — see *Tracker access*). Step 6 **proposes** a value per issue and
   the **user confirms** before any label is applied. Only the committed set becomes
   roadmap bullets, and the reserve is stated as a number in the report.

Export `$VERSION` and `$SHIPPED`, and resolve `MS="$(milestone_number "$VERSION")"` — the
GitHub milestone number every issues query needs. An empty `$MS` means no milestone has
that title yet: say so, and offer to create it with the user's due date before Step 1
(`gh api -X POST "repos/{owner}/{repo}/milestones" -f title="$VERSION" -f due_on="<YYYY-MM-DD>T00:00:00Z"`).
Every query, the report, and any filed issue must
reference `$VERSION` — never a hardcoded string. If the project is pre-1.0, note it:
between minor releases the public API, schema, and settings can still change, so an
open question that crosses a **trust boundary** (auth, tenancy, data integrity) or a
**public contract** (API, plugin interface) is high-stakes even pre-1.0.

---

## Step 1 — Gather scope inputs (run in parallel)

Launch these as parallel sub-agents (`model: "sonnet"`) and wait for all. Each returns
a structured summary, not raw dumps.

### 1a. Spec / roadmap intent — the source of truth for *why*
> Read the milestone's intent from wherever the project records it: a spec/PRD file,
> a roadmap doc, or the milestone description in the tracker. Extract the themes and
> goals attributed to `$VERSION`. Return the themes verbatim and their classification
> (planned / stretch). Everything in this plan stays **future-tense** in any doc
> reference — `$VERSION` has not shipped.

### 1b. Tracked issues — what's already captured
> List the issues assigned to `$VERSION`, **with their current `release:*` label(s)**.
> A milestone can hold more than one page of issues, and `per_page=100` without
> `--paginate` truncates at the first page silently — which on the milestone you are
> planning is the worst possible place to lose rows. `gh issue list --limit` truncates the
> same way. Use the `milestone_issues` helper from *Tracker access*: it paginates, merges
> the pages with `read_pages`, and drops pull requests.
>
> ```bash
> milestone_issues "$MS" > "$ISSUES"
> ```
>
> Return title, number, labels, and one-line intent for each. If there is no tracker,
> return "no tracked issues — plan from the spec."

### 1c. Deferred findings inherited from the last cycle
> Find work explicitly deferred *into* this milestone: issues labeled for `$VERSION`
> that were opened during the previous cycle, plus any `TODO(#…)`, "deferred", or
> "next release" markers in code and docs. Return the list so nothing silently drops.

### 1d. Personas — who each theme serves
> Read `.claude/personas.md` (or the Personas section of `CLAUDE.md`). Return each
> persona's name, primary goal, and top pain point, so features can be sequenced by
> which persona's journey they unblock.

### 1e. Existing surface — what already exists to build on
> Survey the codebase for what the milestone's themes will touch: existing screens,
> endpoints, models, and docs in the relevant areas. Return a short "already exists"
> inventory with file paths, so the asset map can distinguish *extend* from *build new*.

### 1f. Throughput of the previous cycle — the capacity baseline
> Count the issues closed between the previous two releases, and the calendar weeks
> between them, to get issues-closed-per-week. Split it by kind (feature vs bug vs
> hardening) if the labels support it. This is the only *measured* number in the
> kickoff questions; without it "how much fits" is a feeling, and a milestone sized on
> a feeling is how a few hundred issues end up against one date.

### 1g. Carry-over — what is still open in the previous milestone
> List the issues still open in `$SHIPPED`'s milestone. They do not silently become
> this milestone's problem: Step 2 asks the user whether they move, and anything that
> moves is groomed with everything else. A `release:committed` inherited from the
> previous milestone is a promise sized against a different capacity.

---

## Step 2 — Kickoff questions (ask before mapping or grooming)

These decide the **shape** of the release, and every later step depends on them: the
asset map needs the charter, sequencing needs the date-versus-scope rule, and the
grooming pass needs the capacity and the reserve. They are distinct from Step 5's
questions, which are per-feature design decisions.

Ask with `AskUserQuestion`, **four questions per call, three calls**. Fill every option
from the Step 1 inputs — put the value the evidence supports first, marked
`(Recommended)`, and name in its description which input it came from. A question whose
answer is a number (capacity, reserve) still gets computed options; the user can always
pick "Other". Skip any question the user's invocation already answered.

The twelve questions themselves, grouped into the three calls, are reference material —
read `.claude/skills/dotplanning/kickoff-questions.md` now and ask them exactly as
written there.

Record every answer. They go verbatim into the report and feed Steps 5 and 6. If the user
declines a question, record it as unanswered and state the assumption you proceeded on —
an unanswered question that silently acquires an answer is how a release acquires a
promise nobody made.

---

## Step 3 — Build the feature → asset map

This is the centerpiece. For each feature/theme in scope, assess every **asset class**
it needs and mark whether that asset already exists, is planned (has an issue/design),
or is missing (no issue, no design, no decision).

Asset classes (generic — adapt to the stack):

| Asset class | What "ready" means |
|---|---|
| **Screen / UI** | The view or component exists or has a `ux-design` proposal |
| **Flow / interaction** | The end-to-end user path is designed (states, empty, error) |
| **API / endpoint** | The endpoint exists or has an `architect` / `api` design |
| **Data model / schema** | The model/table and migration path are defined |
| **Background work** | Jobs/queues/schedules the feature needs are identified |
| **Docs** | The user- or admin-facing doc page is planned |
| **Tests** | The test layers (unit / integration / e2e) are named |

<!-- CUSTOMIZE: add asset classes your stack needs (e.g. WebSocket/event schema,
     real-time broadcast, offline-sync delta, RBAC role rows, feature flag). Remove
     rows that don't apply. -->

Mark each cell:
- 🟢 **exists / ready** — build on what's there
- 🟡 **planned** — an issue or design covers it, but it isn't built
- 🔴 **missing** — no issue, no design, no decision; this is a gap that will block the feature

Rank the 🔴 gaps, **screens and flows first** (they take longest and block everything
downstream), each with what's missing and the cheapest way to close it.

---

## Step 4 — Sequence the plan into gated workstreams

Turn the asset map into an **ordered** plan. Sequence by:

1. **Dependency** — models/endpoints before the screens that consume them; shared
   infrastructure before the features that build on it.
2. **Architecture / boundary risk** — features needing an `architect` or `threat-model`
   decision go first, because the outcome reshapes downstream work.
3. **Persona value** — within a tier, sequence by which target persona's journey the
   work unblocks (per `personas.md` priorities).

For each workstream, name the **gate chain it will trigger** — quote the matching row
from `CLAUDE.md`'s *Fast paths by change class* table so the user sees the real cost up
front. Examples:
- New full-stack feature → `/voc` → `architect` → `ux-design` → implement → pre-MR gate batch → `ux-review` + `accessibility` → `test-scaffold` → `completeness-check` → `changelog` → `/mr`
- Core-logic-only change → `architect` → pre-MR gate batch → `test-scaffold` → `completeness-check` → `changelog` → `/mr`
- Trust-boundary subsystem → `threat-model` → `architect` → implement → pre-MR gate batch (incl. `security-review`) → `test-scaffold` → `completeness-check` → `changelog` → `/mr`

(In this repository `/mr` opens a GitHub pull request.)

Do **not** run any of those gates here — `dotplanning` only *names* the chain each
workstream will need. Running them is the development that follows this plan.

---

## Step 5 — Open questions to answer before coding

List the decisions that must be settled before the affected workstream starts — the
high-cost, hard-to-reverse ones first. For each: phrase it as a decision, give the
realistic options, and give a recommendation. Prioritize questions that cross a trust
boundary, a public API/plugin contract, or a data-migration path — those are the
expensive ones to get wrong.

---

## Step 6 — First grooming pass: propose a `release:*` label for every issue

Build the **commitment ledger**: one row per issue that will sit in `$VERSION` — the open
issues from 1b, the carry-over the user chose to move in (Q9), and the gap issues Step 9
will file. Each row carries the issue, its current value (or *unlabeled*), the
**proposed** value, and a one-line reason naming the rule that fired.

### 6a. Seed each proposal

Apply the first rule that matches:

| Rule | Proposed |
|---|---|
| Out of charter, not a prerequisite, and the user chose to defer it | **No label** — it moves to the next milestone |
| Implements a charter theme (Q1), or is a credibility prerequisite (Q10) | `release:committed` |
| Hardening inside the share the user set (Q8) | `release:committed` |
| A known bug a real user is likely to hit | `release:reserve` |
| Blocked by an unanswered Step 5 question with no answer date before its workstream starts | `release:stretch` — flagged "committed once #N is decided" |
| Its workstream ends after feature freeze (Q7) | `release:stretch` |
| Builds on an unvalidated foundation (Q11) | `release:stretch` unless the user says otherwise |
| Polish, hygiene, design exploration, unclaimed feature | `release:stretch` |

An issue that **already** carries a value keeps it unless a rule above contradicts it.
Show those as `current → proposed` and list the changes separately from the
confirmations: a kickoff pass that silently reshuffles a prior triage throws away a
decision the user already made. Any issue holding two values is proposed down to one —
on GitHub that state is common, not exotic, because nothing in the tracker prevents it.

### 6b. Fit the ledger to the answers

Check each of these and **report it as a number**:

- **Committed fit:** `count(committed) ≤ capacity (Q5) − reserve (Q6)`. If it does not
  fit, the plan is not finished. Present the overflow ranked lowest-persona-value first
  and ask whether to demote those issues or apply the Q3 rule and move the date. Never
  trim the committed set quietly to make the number work.
- **Reserve:** `count(reserve)` against the reserve number — slots already spent on known
  bugs, slots still free. Reserve over its number is the same problem as overflow.
- **Hardening share:** committed hardening ÷ committed, against Q8.
- **Roadmap reconciliation:** every public roadmap bullet for `$VERSION` has at least one
  committed issue, and every committed feature issue maps to a bullet (hardening and
  prerequisites are exempt). A bullet with no committed issue means either an issue gets
  committed or the bullet comes off the roadmap — **only committed work is a roadmap
  bullet**. Report both directions; editing the roadmap is development, not this skill.

### 6c. Confirm with the user

The label is the user's call on every issue. At kickoff scale, confirmation is **grouped**,
not one question per issue:

1. Show the fit numbers from 6b first.
2. Present the ledger grouped by proposed value, with changes to existing labels as their
   own group, each with its count and the reasons that produced it. The row-by-row ledger
   goes in the report.
3. Ask per group: accept, or accept with the overrides the user names. A group the user
   reviewed and accepted is the user's decision; a label nobody reviewed is not.
4. Anything the user leaves undecided stays **unlabeled**, and the report lists it by
   number. An unlabeled issue in a dated milestone is a visible gap; a guessed label is an
   invisible one.

### 6d. Apply (skip if `--no-apply`)

Only after 6c. Apply each confirmed value **and drop the other two in the same command**.
GitHub labels are not scoped: `gh issue edit --add-label` *adds* a label and leaves every
other one in place, so an issue can silently end up holding both `committed` and
`stretch`.

`gh issue edit` rejects a label name the repository does not have — in `--remove-label`
as well as `--add-label` — so first confirm all three exist (`/kickoff` creates them):

```bash
gh label list --limit 500 --json name -q '.[].name' \
  | grep -cxE 'release:(committed|reserve|stretch)'     # must print 3
```

If it prints less than 3, stop and ask before creating the missing ones
(`gh label create "release:<value>" --description "<meaning from CLAUDE.md>"`) — a label
is outward-facing, like every other tracker write here.

```bash
apply_release() {  # apply_release <issue-number> <committed|reserve|stretch>
  local keep="release:$2" drop="" v
  for v in committed reserve stretch; do
    [ "$v" != "$2" ] && drop="${drop:+$drop,}release:$v"
  done
  gh issue edit "$1" --add-label "$keep" --remove-label "$drop"
}
```

Then read every touched issue back and assert **exactly one** `release:*` value. The exit
code is not evidence that the old value dropped:

```bash
milestone_issues "$MS" | python3 -c "
import json,sys
bad=[i['number'] for i in json.load(sys.stdin) if sum(l.startswith('release:') for l in i['labels'])!=1]
print('rows not holding exactly one release:* label:', bad or 'none')"
```

The issues the user left undecided will appear in that list — compare it against the 6c
undecided set. Anything else in it is a failed apply, not a decision.

Finally, with the user's approval (it is outward-facing), write the release's shape onto
the milestone description, one fact per line so a script can read it later:

```
Reserve: <N>
Feature freeze: <YYYY-MM-DD>
Maturity: <alpha|beta|rc|stable>
```

GitHub's milestone `PATCH` **replaces** the description, so read it first
(`gh api "repos/{owner}/{repo}/milestones/$MS" -q .description`), keep what is there, and
write the combined text back:

```bash
gh api -X PATCH "repos/{owner}/{repo}/milestones/$MS" -f description="$(cat <<'EOF'
<existing description, unchanged>

Reserve: <N>
Feature freeze: <YYYY-MM-DD>
Maturity: <alpha|beta|rc|stable>
EOF
)"
```

Do not move carry-over or deferred issues between milestones here unless the user asked
for it in Q9 or 6c — and anything moved **into** `$VERSION` goes through 6c like the rest.

---

## Step 7 — Delight wedge (one, optional)

Optionally propose **one** small, high-delight addition that would disproportionately
win over the milestone's primary persona — scoped to fit, not a new epic. If nothing
fits the cycle honestly, say "none in scope this cycle." Do not pad.

---

## Step 8 — Emit the HTML report

Produce a **self-contained** HTML file (inline CSS, no external assets) at:

```
$HOME/Downloads/dotplanning-<VERSION>-<YYYYMMDD>.html
```

Get the date with `date +%Y%m%d` (never assume it). Write it with the `Write` tool.
The report is the deliverable the user keeps — make it complete and standalone,
mirroring the on-screen plan. Its required sections, the severity palette, and the
CSS guidance are reference material — read
`.claude/skills/dotplanning/html-output-spec.md` now and follow it exactly.

After writing it, print the absolute path and a 6-line summary to the chat (milestone,
# features planned, # 🔴 missing assets, # open questions, committed/reserve/stretch
counts against capacity, the delight wedge in one phrase).

---

## Step 9 — Offer to file gap issues (skip if `--no-file`)

For each 🔴 missing asset and each unresolved open question that has no tracker issue,
offer to file one — **with confirmation, one at a time**, using the project's tracker:

```bash
gh issue create --title "<title>" --milestone "$VERSION" \
  --body "$(cat <<'EOF'
## Gap identified by /dotplanning
<what's missing and why it blocks the milestone>

## Acceptance criteria
- [ ] <criterion>
EOF
)" --label "task"
```

`gh issue create --milestone` takes the milestone **title**. `--label` must name a label
that already exists — GitHub does not create labels on the fly, and an unknown one fails
the whole create. Use `feature` instead of `task` when the gap is a missing user-facing
capability. The `## Gap identified by /dotplanning` heading is what finds these issues
later: `gh issue list --state all --search '"Gap identified by /dotplanning" in:body'`.
Before filing each one, search open and closed issues for a duplicate
(`gh issue list --state all --search "<key terms>"`).

Never file without showing the list and getting a yes. This closes the loop: the plan's
gaps become tracked work before development starts.

**Filing into a dated milestone also sets a commitment.** Show the proposed
`release:*` label beside each issue in the same confirmation, and apply the label
in the same call (`--label "task,release:<value>"` — a new issue holds no other
`release:*` value, so there is nothing to remove). If the user confirms the issue but not the label, file it
**unlabeled** and list it in the report as an open commitment decision — an
unlabeled issue in a dated milestone is a visible gap; a guessed label is an
invisible one.

---

## What dotplanning does NOT do

- It does not write feature code or run per-feature gates (`architect`, `ux-design`,
  `security-review`, …). It *names* which chain each workstream will trigger.
- It does not loop or re-audit after each fix — it is a one-time begin-gate.
- It does not invent scope. Everything traces to the spec, a tracked issue, an inherited
  deferred finding, or a persona need — the appendix proves it.
- It does not decide a commitment value on the user's behalf. Step 6 proposes and the
  user confirms; a group nobody reviewed is left unlabeled and reported as such.
- It does not watch the tracker for the rest of the cycle. Between kickoffs that is
  `/tracker-hygiene`, which is cheap enough to run repeatedly — re-running this skill
  mid-cycle rediscovers the same gaps and becomes whack-a-mole.

---

## Anti-patterns to refuse

- Planning a version that wasn't confirmed in Step 0 (never assume the milestone).
- Past/present-tense claims about `$VERSION` in any doc-facing text — it is unshipped,
  so future-tense only.
- A feature→asset map with no 🔴 cells on a greenfield milestone — that means the audit
  was too shallow, not that nothing is missing. Look harder at screens, flows, and docs.
- Filing gap issues without confirmation, or filing duplicates of issues that already
  exist for `$VERSION`.
- Proceeding to the asset map before the Step 2 answers exist. Every later step consumes
  them, and inventing a capacity to get moving is how the milestone acquires a number
  nobody agreed to.
- Applying a `release:*` label from 6a's proposal without the 6c confirmation, or
  trimming the committed set quietly so the 6b fit numbers come out right.
