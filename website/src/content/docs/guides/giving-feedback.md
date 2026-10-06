---
title: Giving feedback
description: How to tell the Blueprint maintainers what worked and what did not, including a step-by-step for filing an issue on GitLab.
---

**The big picture:** Blueprint is built from real projects, and it improves when people
who use it say what worked and what did not. Feedback goes in as a GitLab issue, using a
short form that asks the right questions for you.

**Why it matters:** A thought in a chat window never reaches the tracker. An issue is
searchable, can be linked from a fix, and closes when the fix ships.

## File feedback in four steps

You need a free GitLab account. Sign up at [gitlab.com](https://gitlab.com/users/sign_up)
if you do not have one.

1. **Open the form.** Go to
   [New issue with the Feedback form](https://gitlab.com/macrodream/blueprint/-/issues/new?issuable_template=Feedback).
   The Feedback template loads automatically. If you open *Issues → New issue* by hand,
   pick **Feedback** from the *Description* template dropdown.
2. **Add a title.** One line that names the thing: "Setup step 3 was unclear" beats
   "Feedback".
3. **Fill in the prompts.** Answer what you were trying to do, what worked, what got in
   your way, and your setup. Short answers are fine, and you can delete prompts that do
   not apply. Paste screenshots or terminal output straight into the box.
4. **Select *Create issue*.** You get the issue's URL. Anyone with the link, including
   you later, can follow the discussion there.

Before you file, search the
[open issues](https://gitlab.com/macrodream/blueprint/-/issues) for the same topic. If
one exists, add a comment there instead of opening a second one.

## Other kinds of report

| You have | Use |
|---|---|
| A broken command, gate, or doc | The **Bug** template |
| An idea for something new | The **Feature** template |
| General thoughts, a first-run experience, or a rough edge | The **Feedback** template |

## Prefer the command line?

With [`glab`](https://gitlab.com/gitlab-org/cli) installed and signed in:

```bash
glab issue create --repo macrodream/blueprint --label feedback,external \
  --title "Setup step 3 was unclear" --description "What I tried, what happened, my setup"
```

## Found it through the GitHub mirror?

The GitHub copy is a read-only mirror, and its issues and pull requests point back to
GitLab. File feedback on GitLab using the steps above. See
[Publishing to GitHub](/guides/publishing-to-github/).
