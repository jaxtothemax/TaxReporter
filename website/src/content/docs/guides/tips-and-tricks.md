---
title: Tips & tricks
description: Small mechanics worth knowing on purpose, plus where to go deeper than this site can.
---

**The big picture:** A handful of Claude Code mechanics worth knowing on purpose —
permission modes, Plan mode — plus vetted links for going deeper than this site can.

**Why it matters:** These are the controls you'll touch dozens of times a day. Knowing
them well is the difference between babysitting a session and supervising one.

## Toggling permission modes

`Shift+Tab` is identical on macOS and Windows/Linux — there's no platform-specific
bind — but it *cycles* permission modes rather than toggling a single switch: `Manual →
Accept Edits → Plan → Auto → back to Manual`. Auto sits **last** in the cycle, so
reaching it from Manual takes three presses, not one. (On a Pro, Max, or Team plan, a
new terminal session already starts in auto mode as of August 2026 — check
`permissions.defaultMode` in `.claude/settings.json` if a session isn't starting where
you expect.) That's also why the [day-in-the-life](/guides/day-in-the-life/) setup passes
`claude --permission-mode auto` at startup rather than relying on the toggle: one flag
beats three keystrokes per new worktree terminal, and it's the only way in on plans —
Enterprise, API-key accounts — whose built-in default is still Manual.

This is worth reaching for, not just a convenience: Anthropic's own numbers are why.
Their classifier caught more dangerous actions than developers did approving prompts by
hand, held up under third-party red-teaming, and cut serious unintended harm from 6.3%
of manually-approved sessions to 2.4% of auto-mode sessions at production severity
([Auto mode is now the default](https://claude.com/blog/auto-mode-default-in-claude-code),
[Running auto mode in production](https://claude.com/blog/auto-mode-in-production)).
Internally it's the same shift this template's worktree setup is built around — less
turn-by-turn approval, more monitoring: max consecutive tool calls per session rose 116%
and human turns per transcript fell 33% in one internal study
([How AI is transforming work at Anthropic](https://www.anthropic.com/research/how-ai-is-transforming-work-at-anthropic)),
and session length before stopping nearly doubled in three months in another
([Measuring AI agent autonomy in practice](https://www.anthropic.com/research/measuring-agent-autonomy)).
If the classifier blocks something routine over and over, that's usually missing context
about your infrastructure, not a wrong call — `/feedback` reports it, and an admin can
add trusted repos/hosts via `autoMode.environment`.

## Plan mode

Enter it with `Shift+Tab` or by prefixing a single prompt with `/plan`. Claude reads and
explores but won't edit until you approve. When the plan is ready:

- **"Yes, and use auto mode"** approves it and goes straight into auto-mode execution
  (see above) — the fastest path from design gate to implementation.
- **`Ctrl+G`** opens the proposed plan in your default text editor so you can rewrite it
  by hand before Claude proceeds, rather than only approving or asking for changes
  in-chat.

This is the mechanism behind the "plan before code" row in the
[best-practices table](/about/why-blueprint/#built-on-claude-code-best-practices), and
behind the `/architect` → `/ux-design` gates in the fast-path table in `CLAUDE.md` —
those skills produce the plan; Plan mode is how you review it before anything gets
edited.

## Learning resources

Nobody should have to reverse-engineer this template's conventions from the diff of a
generated migration. These are the primary sources this site's own conventions are drawn
from.

**Claude Code**

| Resource | What it's for |
|---|---|
| [Claude Academy](https://academy.claude.com/) — [Claude Code 101](https://academy.claude.com/courses/claude-code-101), [Claude Code in Action](https://academy.claude.com/courses/claude-code-in-action) | Anthropic's own free, self-paced courses (Skilljar-hosted). 101 covers the agentic loop, context, and the explore → plan → code → commit workflow; *in Action* covers steering long hands-off sessions, hooks, headless mode, and packaging skills for a team — the material this template's harness assumes |
| [Full course catalog](https://anthropic.skilljar.com/) | The broader Anthropic Academy catalog beyond Claude Code — AI Fluency, MCP, API fundamentals, cloud-platform tracks |
| [Claude Code docs](https://code.claude.com/docs) | Reference for everything this site only summarizes: permission modes, hooks, skills, subagents, settings |
| [Claude Code best practices](https://www.anthropic.com/engineering/claude-code-best-practices) | Anthropic's own engineering write-up — the source for most of the [best-practices table](/about/why-blueprint/#built-on-claude-code-best-practices) |
| [Claude Cookbooks](https://github.com/anthropics/claude-cookbooks) | Copy-able recipes for building with Claude beyond Claude Code itself (tool use, RAG, evals, prompt caching) — useful once a project's own product also calls the API |

**Git & GitLab** — this template assumes comfort with both; neither is optional once
you're past `/kickoff`

| Resource | What it's for |
|---|---|
| [Pro Git](https://git-scm.com/book/en/v2) | The free, official Git book — start here for branching, merging, and rebasing if `scripts/wt`'s worktree model feels unfamiliar |
| [git-scm.com/docs](https://git-scm.com/docs) and [gittutorial](https://git-scm.com/docs/gittutorial) | Git's own command reference and shortest official tutorial |
| [Learn Git — GitLab Docs](https://docs.gitlab.com/tutorials/learn_git/) | GitLab's guided tutorials (first commit, rebase, rewriting commit messages, remotes) using the same `glab`-flavored workflow this template's Git conventions assume |

:::note
Every link above was fetched and checked against its live content before being added to
this page — not taken on an AI assistant's word, including Claude's own. If you're using
an AI assistant to extend this site or any other doc in this template, treat that as the
standard, not the exception: a fluent, well-formatted citation list is not evidence it
was verified, and a model asked to find supporting sources for a claim it's already
committed to will often find some — real ones, misapplied, as easily as invented ones.
:::
