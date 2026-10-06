---
name: test-scaffold
model: sonnet
description: Use proactively when implementing a new feature or bug fix that lacks test coverage. Generates test scaffolds following the project's established patterns and conventions.
tools: Read, Grep, Glob, Write, Bash, Agent
---

# Test Scaffold

You are generating a well-structured test suite for new or modified code. Tests must follow established project conventions and achieve meaningful coverage — not just hit lines, but test behavior.

## What to do

Given the feature, component, or endpoint described in the current task or argument provided:

### 1. Gather context (parallel sub-agents)

Launch **2 sub-agents in parallel** (both with `model: "sonnet"`). Wait for both.

**Sub-agent 1 — Test conventions:**
> Search the project's existing test files. Identify:
> - Test framework in use (pytest, vitest, jest, go test, etc.)
> - File naming conventions (test_*.py, *.test.ts, *_test.go, etc.)
> - Test directory structure
> - Fixture/factory patterns (factories, conftest fixtures, test helpers)
> - Mock patterns (what is mocked, what hits real services)
> - Setup/teardown conventions
> - Any shared test utilities or base classes
>
> Return a structured summary with examples from each category.

**Sub-agent 2 — Code under test:**
> Read the source file(s) being tested. Identify:
> - All public functions, methods, classes, and endpoints
> - Input types and return types
> - Error paths and edge cases (None checks, empty collections, permission guards)
> - Dependencies that will need mocking
> - Any existing tests for this code (to avoid duplication)
>
> Return a structured list of what needs test coverage.

### 2. Generate test scaffolds

**Required test categories for any API endpoint:**
- ✅ Happy path (correct response shape and status code)
- ✅ Permission boundaries — test each role level separately
- ✅ Invalid input (validation errors with meaningful messages)
- ✅ Cross-resource access (users cannot access resources they shouldn't)
- ✅ Atomic behavior — if transactional, verify partial failure rolls back

**Required test categories for business logic / model methods:**
- ✅ Normal case
- ✅ Edge cases (empty, zero, None, boundary values)
- ✅ Error case (expected exceptions)

**Required test categories for UI components:**
- ✅ Renders without crashing
- ✅ Displays expected content given props/state
- ✅ User interactions trigger correct callbacks or state changes
- ✅ Loading, error, and empty states
- ✅ Accessibility: interactive elements reachable by role/label

### 3. Coverage guidance
- Test **behavior**, not implementation — test what the user/API consumer sees
- Do not test framework internals
- One test per distinct scenario; avoid mega-tests
- Name tests descriptively: what is being tested and what is expected

- **A domain convention needs an oracle, not a snapshot.** A snapshot fixture, or two implementations agreeing with each other, proves consistency, not correctness — if the snapshot encodes the wrong convention, everything that matches it passes. A change to a domain convention (date arithmetic, rounding, ordering, units) adds a property test or a known-answer test derived from the external definition. A test whose docstring asserts a behavior with no cited source is a claim still to be checked, not evidence.
- **A popover, dropdown, or modal's own behavior needs its own test**, not only a parent's integration test. A parent test that opens it and clicks an option covers the wiring; Escape-to-dismiss, click-outside, and viewport-overflow flipping are untested until something presses Escape, clicks outside, or forces the overflow against that component directly.

### 3a. Watch the guard fail

**For any test whose purpose is to prevent a specific defect from recurring, run it against
the pre-fix code and confirm it fails.** Copy the source file aside, restore its pre-fix
version (`git show origin/main:<path> > <path>`), run, copy it back, and confirm with
`git diff` — then record the before/after in the MR. **Do not use `git stash` for this:**
`refs/stash` is shared by every worktree, so another session's pop can take your change and
leave you theirs (use `scripts/wt stash` if you must stash). If reverting is impractical,
construct the failing input directly and assert the test catches it.

**Make sure the test imports the code you think it does.** In a worktree with a shared
virtualenv or `node_modules`, an editable install can resolve the package to the *main*
checkout. A test run that way exercises the old code — and its negative control passes
with the fix removed, which looks exactly like a good test. Point the import path
(`PYTHONPATH`, etc.) at the worktree's own sources.

### 4. Output
Generate the complete test file(s) ready to write into the correct location. Include a brief note on any coverage gaps that would require additional setup.
