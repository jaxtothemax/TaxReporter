---
title: External validation
description: Independent checks the author can't tune. SonarQube Cloud (free whole-project scans for public projects), secret and dependency scanning, and OpenSSF Scorecard.
---

**The big picture:** every gate the harness runs is configured by the same people, and
the same agent, that wrote the code. External validators are tools you don't control.
They give a second opinion, and for a public project they give visitors a score they can
check themselves.

**Why it matters:** an AI-assisted project can look clean to its own gates. A scanner
with its own rules, its own history of your code, and a public dashboard is much harder
to quietly argue with.

**How it works:**
- **SonarQube Cloud** scans the *whole project* for bugs, vulnerabilities, code smells,
  duplication, and coverage, not just the lines in an MR.
- **Secret, dependency, and static-analysis scanners** each catch something the others
  can't.
- **OpenSSF Scorecard** grades supply-chain hygiene once the project is on GitHub.

## SonarQube Cloud

SonarQube Cloud (formerly SonarCloud) is SonarSource's hosted service. Its plans are
priced by lines of code (LOC) in **private** projects:

- **Private projects, free tier:** up to **50,000 LOC**. Beyond that you pay (Team plan
  from $34/month for 100k LOC at the time of writing).
- **Public open-source projects:** SonarSource's pricing page says only private-project
  LOC count toward the limit, and lists no cap for public ones. The whole codebase is
  analyzed, with the history of findings and a quality gate you can show as a badge.

*Checked against [sonarsource.com/plans-and-pricing](https://www.sonarsource.com/plans-and-pricing/)
on 2026-10-05. Plan terms change, so recheck before relying on them.*

**Set it up on GitLab:**
1. Sign in to SonarQube Cloud with your GitLab account and import the project. This
   creates the project key and organization.
2. Add `sonar-project.properties` at the repo root with `sonar.projectKey`,
   `sonar.organization`, and your source folders.
3. Store a token as the masked CI variable `SONAR_TOKEN`.
4. Add a CI job that runs the `sonar-scanner-cli` image. GitLab projects need this job;
   the hosted "automatic analysis" shortcut is GitHub-only.

**Sonar doesn't run your tests.** It imports coverage reports your test jobs already
produce. Point `sonar.python.coverage.reportPaths` (or the JavaScript equivalent) at them,
and make the scan job `needs:` the test jobs so the reports exist.

**Run it nightly, not on every push.** TruePPM scans on a schedule with
`allow_failure`, so a Sonar or network hiccup never turns the pipeline red and MR
latency doesn't change. Sonar keeps one analysis per project, so the nightly result *is*
the dashboard. TruePPM's `lint:sonar-exclusions` check also fails when an excluded
false-positive rule points at a path that no longer exists, so the exclusion list can't
rot.

**Not the same thing:** Blueprint's `ci/sonar-complexity.yml` approximates one Sonar
rule (cognitive complexity) with a local script. It does not contact SonarQube Cloud.

## Using a scanner to keep AI slop out

AI-written code fails in quiet ways: duplicated blocks, dead branches, swallowed errors,
needless complexity, and copy-pasted insecure patterns. A scanner with a **quality gate
on new code** turns these from review nitpicks into a failing check.

- Gate on **new code** (what this MR or this week added), not the whole backlog, so the
  bar rises without a cleanup project first.
- Watch **duplication** and **cognitive complexity**; they climb fastest when an agent
  adds code instead of reusing it.
- SonarSource also offers an MCP server and CLI so a coding agent can run the same
  analysis while it writes. Treat that as optional; the nightly scan is the independent
  check.
- Scanners are not the only option. Semgrep (custom rules for your own repeated
  mistakes) and CodeQL (free on public GitHub repositories) cover overlapping ground.
  Pick one or two, and read the findings, not the badge.

## The rest of the scanner stack

| Layer | Catches | Blueprint ships | TruePPM adds |
|---|---|---|---|
| Secret scanning (pre-commit and CI) | Keys and tokens committed by mistake | GitLab secret-detection component, `gitleaks-scan`, `.gitleaks.toml` | `security:gitleaks` |
| Static analysis (SAST) | Insecure code patterns | GitLab SAST component | `security:semgrep` with project rules |
| Dependency CVEs | Known-vulnerable packages | `osv-scan` | `security:osv`, `security:trivy:config` |
| Licenses | A dependency whose license you can't ship | `python-license-check`, `node-license-check` in `ci/` | `license:check:*` per package |

**Blueprint ships the scanners in the table's "Blueprint ships" column. SonarQube Cloud and Scorecard are described here but not wired in.** Which scanners block an MR is set per job; check each job's `allow_failure` and `rules` in your pipeline. TruePPM runs Sonar on a schedule and the others in the `security` stage.

Each layer misses what the others see, which is why they stack rather than replace each
other. Secret scanning ignores bad code; SAST ignores a leaked key.

## OpenSSF Scorecard

[Scorecard](https://securityscorecards.dev/) grades a **GitHub** repository's hygiene:
branch protection, pinned dependencies, signed releases, a security policy, and more. It
needs the project on GitHub, so it comes after you publish a GitHub mirror. The score is public, so what it
checks is worth fixing before you go public.

**Bottom line:** let tools you don't control grade the project. Start with
SonarQube Cloud, since public projects get the whole-project scan for free.
