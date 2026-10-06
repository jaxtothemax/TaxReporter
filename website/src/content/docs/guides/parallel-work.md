---
title: Parallel work — scripts/wt
description: One worktree per issue, safe by construction when several sessions run at once.
---

**The big picture:** `scripts/wt new <issue>` gives each issue its own folder (a git
worktree) and branch, so several Claude sessions can work at once without stepping on
each other.

**Why it matters:** Two sessions in one checkout fight: one runs `git checkout` and the
other's files change underneath it. Separate worktrees make that impossible, and the
guards below make the shared parts (stash, test database, ports) safe too.

**The commands:**

```bash
scripts/wt new 1234        # worktree + branch off origin/<default>
scripts/wt list            # branch, age, pushed-state, path
scripts/wt remove 1234     # refuses if there is uncommitted work
scripts/wt claim 1234      # check out an issue without a worktree yet
scripts/wt release 1234    # clear a check-out (stale lock, or a claim you dropped)
scripts/wt prune           # remove merged-and-deleted worktrees — run after every merge
scripts/wt stash           # worktree-PRIVATE stash (see guard 4 below)
scripts/wt doctor          # verify symlinks and shared stack reuse
```

Worktrees live at `../<repo>-wt/<branch-leaf>/`, with heavy dependency folders
(`node_modules`, `.venv`, …) linked back to the main checkout so nothing is installed
twice.

`wt` **warns at 8 active worktrees and refuses at 10** — a WIP guard, not a resource limit.
Worktrees are cheap here (dependencies symlinked, dev stack shared); what the cap
protects is your ability to finish things. Raise it per-invocation for a deliberate burst
(`WT_CAP=16 scripts/wt new 1234`) — see
[Working the harness — a day in the life](/guides/day-in-the-life/#wip-cap-10-and-when-to-raise-it).

**Claiming the issue.** Every session shares one forge identity, so an assignee or a
comment cannot tell two sessions apart. `wt new` (and `wt claim`) therefore **check the
issue out**: they apply the `status::wip` label and post a `🔒 checked out` comment naming
the branch and worktree. A second `wt new` on the same issue is refused and quotes that
comment; `--force` takes the issue over deliberately. The label is cleared when
`wt prune` reaps the branch, and by `wt remove` once the issue is closed — removing
unmerged work leaves it on an open issue, because then the label is the only signal that
the issue is spoken for. [`/batch`](/reference/commands/#batch-) skips issues that carry
it, and the push-time collision gate warns when a branch's issue is labelled but has no
MR yet. The lock is advisory and best-effort: with no `glab`/`gh`, or on an API error,
`wt` warns and still creates the worktree. Use another label with `WT_LOCK_LABEL`. A
`wt claim` holds the label too, so starting the worktree later needs `wt new <issue> --force`
(or `wt release <issue>` first) — you are taking over your own claim.

## Go deeper: why it's safe with many sessions

**Concurrent `wt` use is safe by construction, not by coordination.** Five structural
guards keep sessions from damaging each other's work:

1. **`--no-track` on branch creation.** Without it a fresh branch inherits
   `origin/<default>` as its upstream, and all three of `prune`'s conditions then line up
   for a never-pushed worktree — an upstream exists, `origin/<branch>` does not, and the
   branch is trivially an ancestor of the default. The worktree gets reaped while
   someone is working in it. `--no-track` leaves no upstream, so the never-pushed check
   correctly skips it.
2. **A `.wt-owner` marker and a freshness grace window.** `prune` never removes a
   worktree younger than `WT_GRACE_MIN` (default 30 minutes) unless `--force` is passed,
   protecting one that another session created moments ago and has not pushed yet.
3. **A per-worktree `WT_TEST_DB`.** Each generated `.envrc` exports a unique test
   database name, so parallel test runs in sibling worktrees get isolated databases and
   no external lock file is needed. Have the project's test settings read it, and
   `source .envrc` before running the suite.
4. **`scripts/wt stash` instead of `git stash`.** `refs/stash` lives in the git
   **common** dir, so it is *not* worktree-scoped: every worktree of a repo shares one
   stack. Worktree A pushes, B pushes, A pops — and A gets **B's** work. Because a clean
   apply also *drops* the entry, B's uncommitted work is now gone from the stash and
   mixed into an unrelated tree, with nothing in either session's output naming it. (A
   *conflicting* apply keeps the entry — that is the lucky branch of the same bug.)
   There is no `pre-stash` hook, so nothing can catch it where it happens; it has to be
   replaced. `wt stash [push|pop|apply|list|show|drop]` keeps entries under
   `refs/wt-stash/<worktree>` and never reads or writes `refs/stash`. `wt doctor` warns
   when `refs/stash` is non-empty while worktrees are active. Untracked files are not
   captured (`git stash create` cannot) and the command says so rather than letting you
   assume otherwise — for a one-file detour, `cp` aside and back is still simplest.
5. **Per-worktree E2E ports.** Each `.envrc` also exports `WT_E2E_PORT` and
   `WT_E2E_DEV_PORT`, derived from the worktree's slug and probed forward past any port a
   sibling worktree has claimed or a live process holds. Playwright's
   `reuseExistingServer` identifies a running server by **port alone**, so with one
   hardcoded port every worktree shares one preview server and a local run can pass
   against another branch's bundle. Read the variables in your E2E config (see
   `tests/CLAUDE.md.example`); unset — the main checkout and CI — your defaults apply.

**`prune` recognizes every way a branch lands.** A branch counts as merged when its tip
is an ancestor of the default branch (a merge commit), when `git cherry` finds every one
of its patches already there (a tip amended or rebased after its last push), or when the
forge has a merged MR/PR whose head is exactly the local tip (a squash merge). If none
can be shown — including when the forge cannot be reached — the worktree is kept. A
tracked `.envrc` or `.wt-owner` does not count as local work. **Nothing reaps a worktree
after a forge merge**, so run `scripts/wt prune` from the main checkout after merging;
`/mr` reminds you, and `/mass-merge` removes each worktree as its MR lands. `/mass-merge`
only lands MRs if your session may run `glab mr merge`, which the template denies by
default; see [`/mass-merge`](/reference/commands/#mass-merge-).

`wt list` shows age and pushed-state per worktree so it is obvious at a glance whose
worktree is whose.

**Git hooks are shared, not per-worktree.** `.git` inside a worktree is a file pointing at
the main checkout's real git dir, not a directory — `make setup` resolves the actual hooks
directory with `git rev-parse --git-common-dir` rather than assuming a literal `.git/hooks`
path, and that resolved directory is the same one the main checkout uses. Run `make setup`
once, from anywhere — the main checkout or any worktree — and every worktree you create
afterward already has the hooks installed; you never need to re-run it per worktree.

## Working across multiple terminals

`scripts/wt` is the mechanics — one worktree, one branch, one safe place to stand. This
section is the human layer on top of it: what to actually run in each of those terminal
panes once you have several of them open. The organizing unit is the editor window — one
window per project, as in the [VS Code setup](/guides/day-in-the-life/#the-vs-code-setup)
— and inside that window it is normal to have somewhere around **six to eight terminal
panes** open at once, each running its own Claude Code session against the same
checkout. They are not all doing the same kind of work.

[![Two panes mid-task in the same window, each working through its own batch of independent changes](https://gitlab.com/macrodream/blueprint/uploads/a93d924123c0584767601e665da4b862/parallel-windows-screenshot.webp)](https://gitlab.com/macrodream/blueprint/uploads/a93d924123c0584767601e665da4b862/parallel-windows-screenshot.webp)

**1. Parallel execution — most panes, most of the time.** Each pane owns a discrete unit
of work — a worktree, an issue, a gate run, a `/mass-merge` batch — and runs it to
completion independently of the others. Running `/batch` for a wave of issues keeps this
cheap: each agent defaults to Sonnet, and `/batch` escalates an issue to Opus only for a
named reason (see [`/batch`](/reference/commands/#batch-)). Because each pane checked out its own worktree
with `scripts/wt new`, one session's `git checkout` never swaps the working tree under
another (see the structural guards above). At six to eight terminals deep, most of them
are this: grinding through a backlog of independent, mechanically similar tasks in
parallel rather than one at a time.

**2. A research / triage pane.** One pane whose job is investigation, not execution —
reading a CI log, checking whether something is already tracked, confirming a change is
safe before another pane acts on it. It is rarely "done" in the sense of producing a
diff; its output is a conclusion, and that conclusion has to be written down — an issue,
a scratch note, a memory entry — before the pane is cleared or closed, or it is gone.

**3. An "actioned but not forgotten" pane.** Distinct from research: this is where
things go that you have identified as necessary but that are not the next thing to do —
a follow-up issue to file, a finding that needs a fix, a flaky test worth a look later.
The discipline is externalizing immediately rather than letting it sit in one pane's
scrollback: file the issue, add a `TODO(#NNN)` reference, drop a note. With six to eight
terminals open, this pane is what stops "I noticed that earlier" from meaning "and now
it's lost in pane 5's history."

### Keep it running: `/compact` and `/clear`

Running this many sessions concurrently makes context hygiene a survival trait, not a
nicety — a window kept alive across a full day of parallel work needs deliberate upkeep,
or it gets slow and expensive to reason in long before it gets useless.

- **`/clear` between units of work.** A pane that just finished one issue, worktree, or
  gate run should `/clear` before starting the next rather than carry the finished
  task's context forward. With eight panes cycling through a backlog, this is the
  difference between each pane staying cheap and fast indefinitely, versus every one of
  them creeping toward the same bloated-context wall at the same time.
- **`/compact` mid-task, not after.** For the research/triage pane and any long-running
  job that cannot just `/clear` — it is still mid-investigation, or the worktree's work
  is not done — compact before the transcript gets unwieldy. Long tool output and file
  reads accumulate fast, and recall degrades before you would expect.

:::tip
Rule of thumb at this scale: parallel-execution panes `/clear` on every task boundary —
they are stateless by design. The research and actioned-queue panes live longer, so they
lean on `/compact` to stay usable across the session instead.
:::
