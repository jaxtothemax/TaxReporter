---
title: Start a project
description: From an empty directory to your first merged MR — the full setup walkthrough, with why each step matters.
---

**The big picture:** Eleven steps take you from an empty folder to your first merged MR
and a planned first milestone. Most are one or two commands.

**Why it matters:** Each step wires one piece of the safety net. Skip one and a later
step quietly does less than you think — so every step ends with a **Check** that proves
it worked.

**How to read it:**
- `bash` blocks run in a terminal. Commands starting with `/` run inside Claude Code,
  opened at the project root (`claude`).
- If a **Check** fails, fix that step before moving on.
- Just want to see the workflow first? Try the [15-minute quickstart](/getting-started/quickstart/).

## What you need installed

This covers the **harness**, not your application — Blueprint doesn't know your stack.
`make doctor` checks all of it and tells you what each missing tool costs you.

| Tool | Needed for | Without it |
|---|---|---|
| `git`, `make`, `python3` | Everything: scripts, checks, and hooks | **Required.** `make doctor` fails. |
| **`claude`** ([Claude Code](https://claude.com/claude-code)) | Every skill and agent | Git, CI, changelog, and release tooling still work, but there are no review agents. |
| **`glab`** (GitLab) *or* `gh` (GitHub), logged in | The duplicate-MR check, naming branches from issues, stale-reference checks, and every skill that reads or writes the tracker | Those checks can't see your tracker; `wt new <issue>` needs a full branch name instead; the stale-reference check fails closed. Scripts pick the CLI from your `origin` remote. |
| `jq` | Reading tracker responses in the duplicate-MR check and the pre-MR security hook | Those two checks degrade. |
| `direnv` | Loading each worktree's `.envrc` automatically | Optional — run `source .envrc` yourself. |

Docker, Node, or a language toolchain are **your project's** dependencies. Add checks
for them to the "Project-specific checks" section of `scripts/doctor.sh`.

## 1. Create the repository

```bash
git clone https://gitlab.com/macrodream/blueprint.git my-project
cd my-project
rm -rf .git
git init -b main
git add -A
git commit -m "chore: scaffold from blueprint"
```

**Why:** removing `.git` starts your project with one commit and none of Blueprint's
history. From here on, the files are yours.

**Check:** `git log --oneline` shows exactly one commit.

## 2. Connect it to GitLab

Create an **empty** project in GitLab (don't let it add a README, or your first push is
rejected). Then:

```bash
glab auth login                                   # once per machine
git remote add origin git@gitlab.com:<group>/<project>.git
git push -u origin main
```

**Why:** `glab`, `scripts/wt`, the duplicate-MR check, and the `/kickoff`,
`/import-spec`, and `/mr` skills all find your project through `origin`.

**Check:** `glab repo view` prints your project, and `glab issue list` runs without an
error (an empty list is fine).

## 3. Set the GitLab project settings

These live in the GitLab UI; nothing in the repo can set them, and `make customize` can
only remind you.

- **Settings → Merge requests:** turn on *Pipelines must succeed* and *Delete source
  branch* by default. Pick a merge method, and record the same choice as `MERGE_METHOD`
  in `.claude/skills/mass-merge/SKILL.md`.
- **Settings → Repository → Protected branches:** protect `main` — *Allowed to push*:
  nobody; *Allowed to merge*: Maintainers.
- **Settings → Repository → Branch defaults:** default branch `main`.
- **Settings → Repository → Protected tags:** protect `v*` — *Allowed to create*:
  Maintainers.
- **Manage → Labels:** create `no-changelog` (the `changelog-check` job skips MRs that
  carry it).
- **Settings → CI/CD → Variables:** whatever your runners need. Releasing needs none of
  its own — tagging is done by hand (see [Release workflow](/guides/release-workflow/)).

**Why:** a protected `main` plus *Pipelines must succeed* is what turns every review in
this system from advice into a requirement. Nobody — human or agent — can skip it.

**Check:** **Protected branches** lists `main` with nobody allowed to push.

## 4. Describe the project with `/kickoff`

Run `/kickoff` in Claude Code. It asks five questions, one at a time:

1. What you're building — a name and one sentence.
2. Who uses it — three to five user types, each with a goal and their biggest frustration
   with today's tools.
3. The stack — language, framework, database, deployment.
4. What version one does — four to eight user-facing capabilities.
5. Your GitLab project path (such as `mygroup/my-project`) — optional, but without it no
   issues are created.

It writes `CLAUDE.md` (name, stack, persona summaries) and `.claude/personas.md` (full
personas), and creates one `feat:` issue per capability if you gave a path.

**Why:** every agent reads `CLAUDE.md`, so this is how they learn your project once
instead of every session. **Take question 2 seriously** — vague personas make `/voc`
give vague feedback. (`/voc` is a design aid, never a substitute for real users.)

**By hand instead:** replace `[PROJECT NAME]` and every `[FILL IN …]` in `CLAUDE.md` and
`CONTRIBUTING.md`, replace the example personas (Alex, Jordan, Sam, Maya) in
`.claude/personas.md`, and delete the `SETUP CHECKLIST` comment at the top of
`CLAUDE.md`.

**Check:** `grep -n "PROJECT NAME" CLAUDE.md` prints nothing.

## 5. Configure your stack

`/kickoff` records your stack; it doesn't set up the build. Do this **before** step 6:
the Makefile's `lint` and `typecheck` targets ship as stubs that fail, and the
pre-commit hook runs both — install the hooks first and every commit is blocked.

| What | Where | Why |
|---|---|---|
| `lint`, `typecheck`, `test`, `build` (optionally `format-check`) | `Makefile` — uncomment your stack's block, or write your own | Hooks, CI, and agents all call these same targets, so "passes" means the same thing everywhere |
| Stack CI jobs | `.gitlab-ci.yml` — uncomment the matching `ci/*.yml` include and set its variables | Without one, CI runs only the governance jobs |
| Files that hold the version | `scripts/release.sh` | `/release` bumps exactly these, and `version-lockstep` checks they agree |
| Edit-time reminders and guards | `.claude/hooks/post-edit-checks.sh`, `.claude/hooks/pre-tool-safety.sh` | Point them at your stack's real paths |
| Dependency updates | Keep `renovate.json` (GitLab) *or* `.github/dependabot.yml` (GitHub); delete the other | Only one should run |

**CI includes** (see [CI pipeline](/guides/ci-pipeline/#stack-templates) for every job):

```yaml
include:
  - local: ci/python.yml    # ruff, pytest + coverage, license check, optional fuzz + load test
  - local: ci/node.yml      # eslint, vitest + coverage, license check
  - local: ci/docker.yml    # kaniko build verification
  - local: ci/go.yml        # golangci-lint, go test, govulncheck
```

**Version files in `scripts/release.sh`:**

```bash
# package.json:
sed -i '' "s/\"version\": \".*\"/\"version\": \"${VERSION}\"/" package.json

# pyproject.toml:
sed -i '' "s/^version = \".*\"/version = \"${VERSION}\"/" pyproject.toml
```

**Hook patterns.** `post-edit-checks.sh` prints a reminder when Claude edits a matching
file:

```python
# Django models → remind to check migrations
if re.search(r"models\.py$", file_path):
    messages.append("models.py modified — run the schema-check agent")
```

`pre-tool-safety.sh` blocks edits to lock files and existing migrations and warns on CI
config and `.env` files. It blocks with exit code 2 and allows with 0.

Then run the checklist:

```bash
make customize
```

It marks each item `[✓]` done, `[ ]` to do, or `[!]` warning. It only reports — it never
edits — so run it as often as you like. If your stack has no type checker, make
`typecheck` a no-op (`@echo "no type checker"`) rather than leaving the failing stub.

**Check:** `make lint` and `make typecheck` exit 0, and `make customize` shows `[ ]`
only for items you've decided to skip.

## 6. Install the hooks and check your machine

```bash
make setup     # installs the pre-commit and pre-push Git hooks
make doctor    # checks git, make, python3, claude, glab/gh, jq, direnv
```

From now on:
- `git commit` scans staged changes for secrets and runs `format-check`, `lint`, and
  `typecheck` (each only if the Makefile defines it);
- `git push` runs `make pre-push-checks` — the duplicate-MR check and the rest of the
  local gate suite.

**Why:** a problem caught on your machine costs seconds. The same problem caught in CI
costs a pipeline and a context switch.

`make setup` installs into Git's shared hooks folder, so one run covers every
[worktree](/guides/parallel-work/) you create later, too.

**Check:** `make doctor` reports no failures.

## 7. Turn on the agent workflow

`CLAUDE.md` in the repo tells Claude about *this project*. `global-claude-md.example`
holds the rules that make Claude *run* the review agents at the right moments instead of
treating them as optional. They belong in your personal `~/.claude/CLAUDE.md`, which
applies to every repository you open.

```bash
mkdir -p ~/.claude

# No global file yet:
cp global-claude-md.example ~/.claude/CLAUDE.md

# Already have one? Don't overwrite it — append, then read the result:
cat global-claude-md.example >> ~/.claude/CLAUDE.md
```

If you append, remove any rule that conflicts with your existing ones — this file
affects every project.

**Why:** without it, a review runs only when Claude happens to think of it. With it,
Claude follows the *Fast paths by change class* table on every change.

**Check:** in a new Claude Code session, ask *"Which reviews does a bug fix need?"* The
answer should match the bug-fix row of the fast-path table.

## 8. Open your first MR

`main` is protected, so the setup work lands the way every later change will:

```bash
git checkout -b chore/project-setup
git add -A
git commit -m "chore: configure project from blueprint"
git push -u origin chore/project-setup
```

Then run `/mr` in Claude Code. It checks the branch, writes the description, and opens
the MR. It never merges — you do.

**Why:** proving the whole loop on a harmless change means the first real feature won't
also be the first test of your pipeline.

**Check:** the MR pipeline is green. Expect the governance jobs listed in
[CI pipeline](/guides/ci-pipeline/#what-runs-out-of-the-box) plus your stack's jobs.
Then merge it.

## 9. Load your spec and design (optional)

```
/import-spec path/to/spec.md        # PRD, spec, or feature list → tracker issues
/import-design path/to/guide.md     # design guide or token export → frontend/CLAUDE.md
```

`/import-spec` shows what it parsed and creates issues only after you confirm — plus a
milestone per phase if the spec has phases. Skip it if `/kickoff` already made the
issues you need. `/import-design` lets `ux-design` and `ux-review` check against *your*
design system rather than generic advice.

**Check:** `glab issue list` shows the issues you expect.

## 10. Plan the first milestone

`/dotplanning` needs a milestone. It comes from `/import-spec` if your spec had phases;
otherwise create one in GitLab (**Plan → Milestones**) and assign the issues. Then:

```
/dotplanning 0.1
```

It maps every feature to the screens, endpoints, models, and docs it needs, flags
anything with no issue or design behind it, lists decisions to make before coding, and
orders the work into workstreams. It asks you whether each issue is
`release::committed`, `release::reserve`, or `release::stretch` — it never guesses. The
report lands in `~/Downloads/dotplanning-<version>-<date>.html`, and it offers to file
issues for the gaps (skip with `--no-file`).

**Why:** the cheapest moment to find a missing screen or an undecided question is before
anyone writes code for it.

Run it **once per milestone**, before the first feature branch. Re-run only if the scope
changes materially.

**Check:** the report opens, and every 🔴 gap or open question is filed as an issue or
answered.

## 11. Build

From here on, work repeats one loop per issue:

```bash
scripts/wt new 12                  # branch feat/12-<title>, worktree ../my-project-wt/12-<title>
cd ../my-project-wt/12-<title>
source .envrc
claude                             # work the issue; Claude runs the reviews for its change class
#   inside Claude Code: /mr        → opens the MR, records the reviews, adds "Closes #12"
#   merge on a green pipeline, then from the main checkout:
scripts/wt prune                   # removes worktrees whose branches have merged
```

Which reviews run depends on the change — see [Development workflow](/guides/development-workflow/#pick-your-path).
When the milestone's work has merged, run `/pre-release full`, fix what it blocks on, and
cut the release with `/release` (see [Release workflow](/guides/release-workflow/)).

## Go deeper

- [Issues are the unit of work](/guides/issues-and-the-tracker/) — why every change
  starts from an issue.
- [A day in the life](/guides/day-in-the-life/) — running several sessions at once.
- [Flows](/guides/flows/) — one diagram per lifecycle flow, from kickoff to release.
- Once a few MRs have landed, `/kaizen` audits the loop itself for friction.
