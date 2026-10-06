---
title: Quickstart
description: Experience the Blueprint workflow on a throwaway example in about 15 minutes, before committing to a full setup.
---

**The big picture:** A 15-minute demo on a throwaway copy, so you can watch the workflow
handle one small change before committing to a real setup.

**Why it matters:** It's easier to judge a process by seeing it than by reading about
it. You'll see Claude read the project rules, work on a branch, pick a review path
sized to the change, and produce a small, conventional commit.

**Yes, but:** nothing here is worth keeping. When you're ready for real, go to
[Start a project](/getting-started/start-a-project/).

## 1. Clone Blueprint into a scratch directory

```bash
git clone https://gitlab.com/macrodream/blueprint.git blueprint-demo
cd blueprint-demo
```

Leave the `.git` history in place for this demo — you're not starting a real project yet,
just poking at the workflow.

## 2. Start Claude Code

```bash
claude
```

## 3. Give it one simple, self-contained change

Something small and low-stakes — for example:

```
Add a one-line CONTRIBUTORS.md file listing yourself as a contributor, and open it as a
change following this repo's own conventions.
```

## 4. Watch the workflow activate

Notice what happens without you asking for it:

- Claude reads `CLAUDE.md` and `CONTRIBUTING.md` for the branch-naming and commit
  conventions before writing anything
- It works on a branch, not directly against your checkout
- Because this is a docs-only change, it recognizes the fast path for it (see the
  *Fast paths by change class* table in `CLAUDE.md`) rather than running every review gate
  it has available

Ask it directly: *"Which reviews are you running for this change, and why those and not
others?"* The answer should name the specific fast-path row it matched.

## 5. See the verification

Run:

```bash
make lint
```

on the branch it created. This is the same check the pre-commit hook and CI would run — it
exists so a passing check means the same thing everywhere, not just in the agent's own
judgment.

## 6. Inspect what it produced

```bash
git log --oneline -3
git diff main
```

You should see a small, scoped commit with a conventional-commit message — not a sprawling
diff touching files you didn't mention.

## If this makes sense, keep going

The quickstart shows you the shape of the workflow on a trivial change. A real project
needs the full setup — a GitLab remote, branch protection, your actual stack wired into the
Makefile and CI, and the agent harness turned on globally. That's
**[Start a project](/getting-started/start-a-project/)**, and it takes longer
than 15 minutes because it's setting up something you'll actually keep.

When you're done experimenting, delete `blueprint-demo/` — nothing in it is meant to be
kept.
