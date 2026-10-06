# User Personas

Define your project's user personas here. The `/voc` command reads this file to
run a Voice of the Customer panel before feature design.

Each persona should represent a distinct user archetype with different needs,
technical skill levels, and priorities.

## Template

```markdown
## <Name> — <Role/Archetype>

**Background:** <1-2 sentences about who they are>
**Technical level:** <Beginner / Intermediate / Advanced>
**Primary goal:** <What they're trying to accomplish with your product>
**Pain points:** <What frustrates them about existing solutions>
**Values:** <What matters most: speed? reliability? simplicity? power?>
```

## Example personas (replace with your own)

## Alex — Solo Developer

**Background:** Freelance developer building side projects. Works alone, values
speed and simplicity over team features.
**Technical level:** Advanced
**Primary goal:** Ship features fast without ceremony
**Pain points:** Over-engineered tools that assume a team of 10; too many config
options; slow UIs
**Values:** Speed, simplicity, keyboard-first workflows

## Jordan — Team Lead

**Background:** Leads a team of 5-8 engineers. Responsible for delivery cadence
and code quality. Cares about visibility and process.
**Technical level:** Intermediate
**Primary goal:** Keep the team productive and shipping predictably
**Pain points:** Lack of visibility into what's in progress; inconsistent
processes across team members; tools that don't integrate
**Values:** Visibility, consistency, low friction for the team

## Sam — New Team Member

**Background:** Junior developer who just joined the team. Learning the codebase
and the team's workflows. Needs guardrails and guidance.
**Technical level:** Beginner
**Primary goal:** Contribute without breaking things
**Pain points:** Unclear documentation; too many unwritten conventions; fear of
making mistakes
**Values:** Clear documentation, safe defaults, helpful error messages

## Maya — Product Manager

**Background:** Non-technical stakeholder who needs to understand progress and
priorities. Uses the tool for planning and status, not implementation.
**Technical level:** Beginner
**Primary goal:** Understand what's happening and communicate status to stakeholders
**Pain points:** Developer tools that require technical knowledge to read;
information buried in technical jargon; no high-level view
**Values:** Clarity, high-level summaries, visual indicators
