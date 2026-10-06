---
title: Agent architecture
description: The opus/sonnet model split, skills vs. agents, and how to add your own.
---

**The big picture:** Blueprint splits AI work two ways. **Skills** are workflows
started with `/name` (some only by you); **agents** are specialists Claude starts when a change needs them.
And each job goes to the cheapest model that can do it well — **Opus** for judgment,
**Sonnet** for checklists.

**Why it matters:** The right split keeps quality high where it counts and cost low
everywhere else. Most of the bill in agent-heavy work is re-reading context, not writing
code, so how many agents run — and on which model — decides what a feature costs.

**How it works:**
- **Opus agents** (architecture, security, design, regressions) make the judgment calls.
  They hand mechanical scanning to a few parallel Sonnet sub-agents, then synthesize.
- **Sonnet agents** (permissions, performance, UX, tests, changelog) follow a checklist.
- **Delegation stops at one level.** A sub-agent never starts more agents — see
  [Fan-out ceiling](#fan-out-ceiling).
- Every agent's `tools:` line limits what it can do. A reviewer with only
  `Read, Grep, Glob` can't edit anything.

The full roster is on the [Agents](/reference/agents/) and [Skills](/reference/commands/)
pages. This page is how they're built, and how to add your own.

## Model selection guide

| Use **opus** when the agent needs to... | Use **sonnet** when the agent needs to... |
|---|---|
| Synthesize findings across multiple files | Scan for patterns in code |
| Make judgment calls or trade-off decisions | Follow a checklist or ruleset |
| Reason about attack scenarios or edge cases | Generate code from templates |
| Inhabit a persona or produce empathetic analysis | Execute mechanical transformations |

## Skills vs agents

The template uses two extension points:

- **Skills** (`.claude/skills/<name>/SKILL.md`) — user-invocable workflows triggered
  by `/name`. Used for multi-step operations like opening MRs, running releases, or
  importing specs. Skills with `disable-model-invocation: true` can only be triggered
  by the user (not auto-invoked by Claude) — use this for actions with external side
  effects.
- **Agents** (`.claude/agents/<name>.md`) — proactively invoked by Claude when their
  trigger conditions are met. Used for review, analysis, and generation tasks that
  should run automatically as part of the development workflow.

| Feature | Skills | Agents |
|---|---|---|
| Invocation | You type `/name`; Claude may also start one unless it's marked ⛔ | Claude invokes proactively, or you ask by name |
| Side effects | Can have external effects (GitLab, git push) | Typically read/analyze/generate |
| `disable-model-invocation` | Supported | N/A (agents are always model-invokable) |
| Frontmatter | Full schema (model, effort, argument-hint, etc.) | Limited (name, model, description, tools) |
| Supporting files | Can include templates/scripts in the skill directory | Single file only |

Skills marked ⛔ on the [Skills](/reference/commands/) page have
`disable-model-invocation: true`.

## Adding a project-specific agent

Create a file in `.claude/agents/`:

```markdown
---
name: my-agent
model: opus    # or sonnet — see model selection above
description: When to use this agent (be specific so Claude invokes it proactively).
tools: Read, Grep, Glob, Bash, Agent
---

# My Agent

[instructions — include sub-agent delegation if the agent does Phase 1 scanning]
```

If the agent delegates scanning work to sub-agents, include `Agent` in the tools list
and structure the instructions with parallel sub-agent launches. Cap the launch at a
handful (2–3 is typical; `/batch`'s own wave default is 5) and never give the sonnet
sub-agent `Agent` in *its* tools — one level of delegation is the pattern, not a
precedent for the sub-agent to delegate again. See [Fan-out ceiling](#fan-out-ceiling)
below for the project-wide default this pattern has to fit inside.

```markdown
### Step 1 — Gather context (parallel sub-agents)

Launch **2 sub-agents in parallel** (both with `model: "sonnet"`). Wait for both.

**Sub-agent 1 — [scanning task]:**
> [instructions]

**Sub-agent 2 — [scanning task]:**
> [instructions]

### Step 2 — Synthesize (you do this — do NOT delegate)

[synthesis instructions using sub-agent results]
```

## Fan-out ceiling

`.claude/settings.json`'s `deny` list guards what agent work *does* — force-push,
auto-merge, reading secrets. It has no lever for how much agent work one task spawns, and
runaway fan-out (agents spawning agents spawning agents on a task that didn't need it) is
its own failure mode: upstream, a wave of delegated agents ran ~122M tokens per merged
MR, 95.9% of it cache reads rather than generation, and spend was concentrated — the
top 10 of 169 subagents were 44% of the total, one subagent alone at 166M against a 6M
median.

The project's own `CLAUDE.md` documents the default this pattern has to respect (see
*Subagent fan-out ceiling* in its *Agent workflow* section, and the *cost rules*
section of `.claude/skills/batch/SKILL.md`): cap concurrent delegated agents at 5 per
task unless the user asks for more, never let a delegated agent re-delegate beyond the
one Phase-1 level shown above, default read-only gates to the cheaper model, and state
an explicit reason when a task needs to exceed the default.

This is enforced by two things, not one: the `tools:` restriction on each agent
definition (a real, load-bearing cap — an agent with no `Agent` in its `tools:` cannot
spawn sub-agents at all), and review discipline for everything `tools:` can't reach —
verifying what a delegated agent actually committed rather than trusting its summary. A
`settings.json` hook was considered for the harder cap (blocking a spawn outright, or
counting fan-out across a wave) and rejected: the lifecycle events for a subagent spawn
(`SubagentStart`/`SubagentStop`) don't support blocking, and the tool name a `PreToolUse`
hook would need to match on isn't stable across Claude Code versions.

## Adding a project-specific skill

Create a directory in `.claude/skills/`:

```markdown
---
name: my-skill
description: What this does and when to use it.
disable-model-invocation: true    # only if it has external side effects
argument-hint: "[arg description]"
---

# My Skill

[instructions — same format as agents, with $ARGUMENTS for user input]
```

## Global `CLAUDE.md` — enforce agent workflow

The template ships `global-claude-md.example`, a file that makes the agent workflow
mandatory rather than suggested. It goes in your personal `~/.claude/CLAUDE.md`, so it
applies to every project you open. Copy it if you have no global file; append it if you
do (see [Start a project, step 7](/getting-started/start-a-project/#7-turn-on-the-agent-workflow)).
Never copy over an existing file.

Without it, agents run only when Claude decides to invoke them. With it, Claude follows
the *Fast paths by change class* table for every change. Its *Gate reference* table says
when each gate applies and when it doesn't, so backend-only changes skip the UX agents and
bug fixes skip the design phases. That table records only what each agent's own
`description:` does not already say, because the harness injects those descriptions
anyway.

## Package-level `CLAUDE.md` for monorepos

For monorepos with distinct frontend/backend/worker packages, create package-level
`CLAUDE.md` files to give agents stack-specific context:

```
my-project/
├── CLAUDE.md                # Project-wide conventions
├── frontend/CLAUDE.md       # React patterns, design tokens, component rules
├── backend/CLAUDE.md        # Django patterns, model conventions, API rules
└── worker/CLAUDE.md         # Queue patterns, retry policies, idempotency rules
```

Claude reads the nearest `CLAUDE.md` in the directory tree, so package-level rules
supplement the project-level rules for files in that subtree. Use `/import-design`
to generate `frontend/CLAUDE.md` from a design guide.
