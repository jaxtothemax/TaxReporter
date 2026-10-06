# Blueprint

**A ready-made delivery system for a new software project, for teams that build with
GitLab and Claude Code.**

Blueprint is a repository you clone as the first commit of a new project. It contains no
application code and does not pick a language or framework. What it gives you is the
process around the code — the branch, review, and release discipline most projects only
add months in, after the incidents that make it necessary.

**Blueprint does not build your product for you.** It provides the structure, workflows,
instructions, automation, and agent configuration that help Claude Code build and maintain
your product more consistently.

📖 **[Read the full documentation →](https://docs.blueprint.macrodream.co/)**

---

## The harness behind Visiban and TruePPM

**The harness that runs Visiban and TruePPM**, plus the lessons learned building both
projects, collected here. Blueprint was extracted from Visiban and is kept current by TruePPM's parallel harness, and fixes flow back into both.

| Project | What it is | Repo | Docs |
|---|---|---|---|
| Visiban | Open-source Kanban board where every row is an entity and every move is on the record | [gitlab.com/visiban/visiban](https://gitlab.com/visiban/visiban) | [docs.visiban.com](https://docs.visiban.com) |
| TruePPM | Open-core project, program, and portfolio management for waterfall, agile, and hybrid | [gitlab.com/trueppm/trueppm](https://gitlab.com/trueppm/trueppm) | [docs.trueppm.com](https://docs.trueppm.com) |

How the three projects relate, and the scale they have run at, is in
[Credits](https://docs.blueprint.macrodream.co/about/why-blueprint/#credits).

---

## Without Blueprint, versus with it

**Without Blueprint** — you ask for a change. The agent writes code, maybe writes tests,
maybe touches something you didn't ask about, and you're left to reconstruct what happened
from the diff.

**With Blueprint** — you describe what you want. The workflow supplies project context,
routes the change through review gates sized to how big the change actually is, and the
result lands as a reviewed merge request with tests and a changelog entry already in
place.

## Is this for you?

| You are... | Fit |
|---|---|
| Curious about AI coding but haven't built anything yet | Probably too early |
| Have built a small app with Claude Code | Good next step |
| Moderately technical and comfortable with Git | Good fit |
| Building a serious personal project you'll maintain | Very good fit |
| Professional developer using AI agents, or a team using Claude Code + GitLab together | Strong fit |
| Looking for a no-code tool, or just want Claude to make a quick prototype | Not the right tool |

If you've successfully built a small application with Claude Code and want to move from
*"Claude helped me make this"* to *"I have a repeatable process for building and
maintaining this,"* Blueprint is designed for that transition. **You don't need it to
start** — see the [maturity ladder in the docs](https://docs.blueprint.macrodream.co/#you-dont-need-blueprint-to-start)
if you're not there yet.

## What you get

- **A merge-request-only workflow** with branch, commit, and MR conventions already written
  down
- **A CI pipeline** with governance jobs, plus ready-made add-ins for Python, Node.js, Go,
  and Docker
- **Git hooks** that run the same checks on your machine before a commit or push
- **A changelog built from one-line fragment files**, and a release script that assembles
  them
- **A Claude Code harness**: a roster of specialized agents, slash-command skills,
  safety hooks, and a table that decides which reviews each kind of change needs

You supply only what nobody else knows: the project's name, its users, its stack, and what
the first version must do. `/kickoff` asks you for those and writes them in. Everything
else is already wired together.

## What Blueprint does NOT do

Blueprint is **not** an AI coding model, a replacement for Claude Code, a no-code
application builder, a software project generator, a replacement for GitLab or for
automated tests, a guarantee that AI-generated code is correct, a way to build software
without understanding what you're building, an autonomous company-in-a-box, or a magic
prompt library.

It's also not an application scaffold (no `src/`, no framework, no Dockerfile — add those
the way you normally would), not a dependency (once you clone it, the files are yours;
nothing pulls updates from Blueprint), and not GitHub-first (CI, issue templates, and MR
templates target GitLab — the scripts also work with `gh`, but moving CI to GitHub Actions
is manual).

## Getting started

- **New to Blueprint?** See it work on a throwaway example first: the
  **[15-minute quickstart](https://docs.blueprint.macrodream.co/getting-started/quickstart/)**.
- **Ready to set up a real project?** Go straight to
  **[Start a project](https://docs.blueprint.macrodream.co/getting-started/start-a-project/)**
  — an 11-step walkthrough from an empty directory to your first merged MR, with a check
  after every step.

Minimum you need installed: `git`, `make`, `python3`, and [Claude Code](https://claude.com/claude-code).
`glab` (or `gh`) is needed for anything that talks to the tracker. `make doctor` verifies
all of it and tells you what each missing tool costs — see the full
[prerequisites table](https://docs.blueprint.macrodream.co/getting-started/start-a-project/#what-you-need-installed)
in the docs.

## The day-to-day loop, once set up

```bash
scripts/wt new 1234                # branch + worktree for issue 1234
cd ../my-project-wt/1234-<title>
source .envrc
claude                             # work the issue; Claude runs the reviews for its change class
#   inside Claude Code: /mr        → opens the MR, records which reviews ran, adds "Closes #1234"
#   merge on a green pipeline, then from the main checkout:
scripts/wt prune                   # removes worktrees whose branches have merged
```

Which reviews run depends on the kind of change — a bug fix runs three gates, a full-stack
feature runs the full chain. The *Fast paths by change class* table in `CLAUDE.md` is the
authority; the docs site walks through it in
[Development workflow](https://docs.blueprint.macrodream.co/guides/development-workflow/).

## Everything else

The full documentation site covers the rest — day-to-day workflow, parallel work with
`scripts/wt`, the changelog system, CI pipeline stages, the harness gates and why each one
exists, the full command reference, agent architecture, what's included and what to remove
if you don't need it, and the complete file tree:

📖 **[Read the full documentation →](https://docs.blueprint.macrodream.co/)**

💬 **Tried it? Tell us what worked and what did not** with the
[Feedback form](https://gitlab.com/macrodream/blueprint/-/issues/new?issuable_template=Feedback).
[Giving feedback](https://docs.blueprint.macrodream.co/guides/giving-feedback/) walks
through filing an issue on GitLab.

(Building the site yourself: `cd website && npm install && npm run build`. It's an
[Astro Starlight](https://starlight.astro.build/) site published to GitLab Pages by the
`website:build` / `pages` jobs in `.gitlab-ci.yml` — see
[Adding a docs site](https://docs.blueprint.macrodream.co/guides/adding-a-docs-site/) if
you want to reuse that pattern in a project you scaffold from Blueprint.)

---

## Removing what you don't need

- **No frontend?** Delete `ci/node.yml`, remove node sections from `Makefile`, delete
  the `ux-design.md`, `ux-review.md`, and `accessibility.md` agents
- **Not a web service (no HTTP endpoints)?** Delete the `rbac-check.md` agent and the
  `pre-mr-security-gate.sh` hook (and its `PreToolUse` entry in `settings.json`)
- **No CI?** Delete `.gitlab-ci.yml` and `ci/` — the changelog workflow works locally
  without CI
- **No Claude Code?** Delete `.claude/` and `global-claude-md.example` — everything
  else works independently
- **No docs site?** Delete `website/` and the `website:build` / `pages` jobs in
  `.gitlab-ci.yml`
- **Different license?** Replace `LICENSE` with your preferred license text
- **GitHub instead of GitLab?** Replace `.gitlab-ci.yml` → `.github/workflows/`,
  `.gitlab/` → `.github/`, `glab` → `gh`; delete `renovate.json` (use
  `.github/dependabot.yml` instead)
- **GitLab instead of GitHub?** Delete `.github/` directory; keep `renovate.json`
  (or use GitLab's built-in dependency scanning)

Full list, with what each removal affects, in
[What's included](https://docs.blueprint.macrodream.co/reference/whats-included/).

## Credits

Extracted from the [Visiban](https://gitlab.com/visiban/visiban) project governance and
kept current with the parallel harness built for [TruePPM](https://gitlab.com/trueppm/trueppm)
— gate and workflow improvements flow in both directions between the three projects.
See [the harness behind Visiban and TruePPM](#the-harness-behind-visiban-and-trueppm) and
the [full credits](https://docs.blueprint.macrodream.co/about/why-blueprint/#credits),
which hold the pipeline and merge request counts.
