## Description

<!-- Describe your changes and the motivation behind them. -->

## Related issues

<!-- Link the issue this PR resolves, e.g. "Closes #123" on its own line — GitHub
     closes it when the PR merges into main. -->

## Requirements

<!-- One row per acceptance criterion and test-plan line of each closed issue, including
     scope changes made in its comments. Status is MET with evidence (file:line or test
     name), or DEFERRED with an OPEN issue that this PR does not close, on the same row.
     The completeness-check agent produces this table before the push (see /mr).
     Omit the section only for a chore with no issue. followup-ok -->
| Requirement (quoted from the issue, its comments, or its test plan) | Status |
|---|---|
| | |

## Test plan

- [ ] Confirm every required check is green (`gh pr checks`)

## Gates

<!-- machine-readable; one line per gate. Format: `gate: <name> — <outcome>`
     Outcomes: `<N> findings`, `0 findings`, `n/a (<why the gate does not apply>)`,
     `skipped (<user's reason>)`. 0 findings is a real outcome: never omit it.
     /kaizen parses these lines across recent PRs. -->

## Checklist

- [ ] Changelog fragment added to `changelog.d/` (e.g. `42.fixed.md`), or the PR carries the `no-changelog` label
- [ ] Tests pass locally (`make test`)
- [ ] Lint passes locally (`make lint`)
- [ ] `make pre-push-checks` passes locally
- [ ] Documentation updated if applicable
