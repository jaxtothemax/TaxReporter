---
title: Issues are the unit of work
description: Why every change starts from a tracked issue, and how to write issues the harness can use.
---

**The big picture:** Nothing starts from a prompt. **Every change starts from a tracked
issue.**

**Why it matters:** An issue is the written agreement about what "done" means. Without
one, nobody — human or agent — can later check whether a change did what was asked. And
three separate mechanisms in this harness key off the issue number.

- `scripts/wt new 1234` looks up the issue title and derives the branch name
  (`feat/1234-<title>`) and worktree path from it.
- `scripts/check-issue-collision.sh` reads the issue number back out of the branch name
  on every push, and blocks the push if that issue already has an open MR from another
  branch. It works however the branch was created, including a plain `git checkout -b`.
- `Closes #1234` in the MR description is what actually closes it on merge. Without the
  keyword the issue stays open and the tracker silently drifts from reality.

## The loop

```bash
glab issue list --assignee @me                # what is mine
glab issue view 1234                          # read it — including the COMMENTS
scripts/wt new 1234                           # branch + worktree; labels it status::wip
cd ../<repo>-wt/1234-short-slug && source .envrc
#   ... work, with the gate chain from the fast-path table ...
/mr                                           # opens the MR with Closes #1234
#   ... merge when green ...
scripts/wt prune                              # from the main checkout
```

**Read the comments before starting, not just the description.** A stale branch or a
half-done attempt is usually recorded there and nowhere else.

## Writing issues the harness can use

- **One issue, one acceptance criterion set.** If a discussion surfaces a second problem,
  file it. **A facet recorded as a comment on an open issue is not tracked** — it dies
  the moment the host issue closes on a different facet. The test is simple: does it need
  its own acceptance criteria? Then it needs its own issue.
- **Labels are load-bearing, not decoration.** The claim label (`status::wip` by default)
  is applied by `scripts/wt new` / `wt claim` and cleared by `wt prune`, `wt remove` (once
  the issue is closed) and `wt release`; `/batch` skips issues that carry it. The
  collision gate (`WIP_LABEL`) and `wt` (`WT_LOCK_LABEL`) read the same default — if you
  rename it, set both. The gate warns when a pushed branch's issue carries it but has
  no MR yet.
  Priority labels are read by `/voc-audit` when it decides between "file new" and "boost
  priority".
- **Beware label gates that read the tracker rather than the repo.** If you add a CI job
  that fails on a forbidden label, remember its input is *not* your diff — someone else's
  label edit can redden the default branch, in a job log the next person to push has no
  reason to read. Scope such gates narrowly and say so in the job comment.
- **Milestones drive `/dotplanning`.** It resolves a milestone's scope into a
  feature→asset map and flags every screen, endpoint, or decision with no issue behind
  it. An empty milestone gives you an empty plan.
- **A dated milestone is a promise, so every issue in one states its share of it.**
  One scoped label per issue — `release::committed` (ships or the release slips, and
  the only issues that become roadmap bullets), `release::reserve` (a slot held for
  inbound work from real users), `release::stretch` (ships if there is time, moves at
  feature freeze). Scoped labels are mutually exclusive, so the tracker enforces the
  "exactly one" part. **An agent asks which applies on every move into the milestone
  and never infers it**: a guessed `committed` is a promise nobody made, and a guessed
  `stretch` quietly drops work someone meant to ship. Unanswered means unlabeled and
  said out loud — an unlabeled issue in a dated milestone is a visible gap, a guessed
  label is an invisible one.

## Feedback from outside the team

People who use Blueprint, and are not in your tracker's daily flow, can file a **Feedback**
issue from the template in `.gitlab/issue_templates/Feedback.md`. The
[Giving feedback](/guides/giving-feedback/) guide shows them the steps.
