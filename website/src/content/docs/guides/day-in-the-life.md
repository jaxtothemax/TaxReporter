---
title: Working the harness — a day in the life
description: Running several Claude Code sessions at once without them colliding.
---

**The big picture:** One editor window on the main checkout, one terminal per active
issue, each running its own Claude Code session in its own worktree — usually in auto
mode, so it can make progress without a permission prompt on every command.

**Why it matters:** Parallel sessions are where the time savings are. Without a few
habits, they're also where work gets lost: a stash popped into the wrong tree, a session
that stalled unnoticed, two sessions on one issue.

**The habits that matter most:**
- Never run a feature session in the main checkout.
- `source .envrc` first in every worktree terminal.
- `scripts/wt stash`, never `git stash`.
- Check `scripts/wt list` to spot stalled sessions.

## The VS Code setup

One window on the main checkout, and **one terminal per active worktree**, each running
its own Claude Code session with **auto mode on**. Auto mode is what makes the parallel
setup worth having: the agent reads, greps, edits, and runs the gates through Bash
without a permission prompt per call, so a session left alone actually progresses.

```
VS Code window: ~/repos/<repo>            ← main checkout: review, merge, wt admin
├── Terminal 1  ~/repos/<repo>            ← main: glab, wt list, wt remove, merges
├── Terminal 2  ~/repos/<repo>-wt/1234-…  ← claude --permission-mode auto   (issue 1234)
├── Terminal 3  ~/repos/<repo>-wt/1240-…  ← claude --permission-mode auto   (issue 1240)
└── Terminal 4  ~/repos/<repo>-wt/1251-…  ← claude --permission-mode auto   (issue 1251)
```

Rules that make this work rather than collide:

- **The main checkout never runs a feature session.** It is where you read MRs, merge,
  and run `wt` admin. A session there will `git checkout` the tree out from under nobody
  — which is exactly why it is the safe place to stand.
- **`source .envrc` in each worktree terminal**, first thing. It exports the shared
  compose project name (so all worktrees reuse one running dev stack rather than each
  starting its own) and a per-worktree test database name (so parallel test runs do not
  fight over one database).
- **`scripts/wt stash`, never `git stash`.** `refs/stash` is shared across every
  worktree — see [Parallel work](/guides/parallel-work/). This is the single
  easiest way to lose another terminal's uncommitted work.
- **Terminal 1 is where you notice things.** `scripts/wt list` shows issue, age, and
  pushed-state per worktree, which is how you tell a session that finished from one that
  stalled.

## What "auto mode on" does and does not change

It removes the prompt, not the rules. The gate chain, the pre-push hook, and the deny
list in `.claude/settings.json` all still apply — and they matter *more* in auto mode,
because nobody is reading each call. Three things worth knowing before you leave a
session running:

- **A quiet session is usually stalled, not finished.** Send it a message; it resumes
  with its context intact. Re-spawning loses everything it had loaded.
- **A worktree is not private.** Another session can commit, push, and open an MR from
  it mid-edit. Before merging, check that your local HEAD, the MR's sha, and the
  pipeline's sha are the same commit.
- **A stated boundary is a block signal, not a suggestion the classifier talks itself
  out of.** Telling a running session "don't push" or "wait for me to review before
  deploying" makes auto mode's classifier refuse matching actions even when its default
  rules would allow them, until you lift it in a later message. It's re-read from the
  transcript on each check, so context compaction can lose it — for a hard guarantee,
  add a `permissions.deny` rule instead of relying on the sentence.

For the exact keybinding, why it takes three presses to get there, and why it's worth
reaching for at all, see [Toggling permission modes](/guides/tips-and-tricks/#toggling-permission-modes)
in Tips & tricks.

## WIP cap: 10, and when to raise it

`scripts/wt` warns at 8 active worktrees and refuses at 10. That default is a **WIP
guard, not a resource limit** — worktrees are cheap (dependencies are symlinked, the
Docker stack is shared), so what the cap actually protects is your ability to finish
things. Ten open branches is already more than most people can hold.

For a deliberate burst — a batch of small mechanical issues, a wave of audit findings —
raise it for that command rather than editing the default:

```bash
WT_CAP=16 scripts/wt new 1234     # this invocation only
scripts/wt list                   # see the count against the cap
scripts/wt prune                  # reap merged-and-deleted worktrees
```

Raise it for a burst you intend to land in one sitting (`/mass-merge` is the other half
of that plan). Do not raise it to avoid finishing things — the cap is doing its job at
exactly the moment it annoys you.
