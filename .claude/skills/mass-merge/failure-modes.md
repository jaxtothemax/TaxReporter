# Mass Merge — Failure Modes and Recovery

A lookup table, consulted when one of these fires during a run — not procedure to
read top to bottom on every invocation. `SKILL.md` points here from Step 0, Step 2,
and Step 3 at the point each risk applies.

---

### A competing session can land the batch out from under you

Step 0's validation is a **snapshot, not a lock**. Another session or a human can
merge part of the batch mid-run — upstream, eight MRs were landed by a competing
session during Phase A, bypassing every Phase B safeguard.

**Re-read each PR's state immediately before updating it, and again immediately
before merging it** (`gh pr view <N> --json state -q .state`). If it is no longer
`OPEN`, skip it and re-plan. If a
competing session lands any part of the batch, **stop and report**: the
simulation is void, because the base it was computed against no longer exists.

---

### Phase A being clean does not predict Phase B

**Phase A answers "does this combined tree pass the gates". It never answers
"will Phase B update cleanly".** Two different questions, and only the first one
is what the simulation measures.

Phase A stacks the batch in one order against one tip. Phase B updates each
branch individually against a tip that moves after every merge, so a batch that
stacks cleanly in Phase A can still hit conflicts in Phase B. The gap is widest
when the two use *different operations* — on a `rebase` repository Phase A
merges and Phase B rebases, and upstream a run that predicted one conflict hit
three more. Aligning Phase B to `MERGE_METHOD` narrows the gap; it does not
close it. Treat Phase A as a gate-composition check, not a conflict oracle.

---

### The `--force-with-lease` ref:sha form silently drops the lease

> **Never write `--force-with-lease="$BR:<sha>"`.** The explicit ref form
> silently drops the lease on git 2.50.1 and degrades to a plain non-forced
> push, which is then rejected — with no "stale info" in the message to tell
> you the lease was never applied. Verify the sha by hand with `rev-parse`,
> then push bare.

---

### Non-negotiables in Phase B

- **Gate on the default-branch runs after every merge — at most one merge
  lands on a red default branch.** The PR's `pull_request` runs prove the branch
  merged into `main` as it stood when they ran, not the merge commit that actually
  landed. `push`-only jobs, combined-tree ratchet overflows, and advisories published
  since the last run appear *only* there. The first red is a hard stop for the whole
  run.
- **Merges are serial; the next update+push may overlap.** A push lands nothing
  on the default branch, so it cannot redden it — only a merge can. Merge N+1
  once **both** PR(N+1)'s checks and the default-branch runs for merge N
  are green.
- **Triage a `failed` before stopping.** An updated branch re-runs the whole
  suite. If the only failures are known flakes and the rest passed, retry that
  job **once** (`gh run rerun <run-id> --failed`) and keep polling. A real
  test/type/lint/build failure — or any failure on this PR's own diff — is a hard
  stop. Never blanket-retry to force green.
- **A run that tested nothing is capacity or config, not code.** On GitHub
  Actions it has three shapes. A `startup_failure` with no jobs failed at *creation*
  (invalid workflow YAML, or an action that is not allowed or pinned to a missing
  SHA). Runs that sit `queued` are waiting on the account's concurrent-job limit. A
  `cancelled` run was superseded through a `concurrency:` group. **None of them
  tested anything.** Wait for queued runs to drain, fix or re-trigger, and gate on a
  run that actually ran its jobs. Merging fast is what fills the queue, so never
  batch-merge to catch up, and space merges out.
- **A merge command can fail *after* writing the merge.** If `gh pr merge` errors,
  check `gh pr view <N> --json state,mergeCommit` before retrying. If the PR is already
  `MERGED`, the merge landed: go on to the default-branch poll. A blind retry only
  errors because the PR is already merged, and reading that error as a failed merge
  stops the run for nothing.
- **An advisory published mid-batch makes every earlier green a lie.** Scanners
  resolve at *run* time, so a run that was green an hour ago says nothing now. If the
  batch contains a lockfile bump, land it **first**.
- **Never resolve a rebase or merge conflict by guessing.** Stop and hand it back.
