---
title: Publishing to GitHub
description: Keep GitLab as the source of truth and mirror a public project to GitHub so people can find it, plus a checklist of what a public repo needs.
---

**The big picture:** your workflow stays on GitLab. A one-way **push mirror** copies
every protected branch and tag to a GitHub repository, so the project shows up where
people actually search.

**Why it matters:** new public projects are found on GitHub: search, topics, stars, the
trending page. If you want users or contributors, a GitLab-only repo is hard to stumble
on. Mirroring buys that exposure without moving issues, MRs, or CI.

**How it works:**
- GitLab pushes to GitHub on every change. Nothing flows back.
- The GitHub repo is labeled a read-only mirror, with issues and PRs pointed at GitLab.
- This is about being *found*. Running Blueprint's CI on GitHub Actions is a separate
  question, tracked in [issue #46](https://gitlab.com/macrodream/blueprint/-/issues/46).

## Set up the mirror

1. **Create an empty GitHub repository.** No README, no license file; the mirror
   supplies them.
2. **Create a fine-grained GitHub token** scoped to that one repository, with
   *Contents: read and write*. Set an expiry and put the date in your calendar.
3. **In GitLab:** *Settings → Repository → Mirroring repositories.* Enter
   `https://github.com/<owner>/<repo>.git`, choose **Push**, enter your GitHub username,
   and paste the token as the password. GitLab's mirroring docs list the token types it
   supports; if a fine-grained token is rejected, use a classic token with `repo` scope.
4. **Tick "Mirror only protected branches"** so feature branches and WIP never leave
   GitLab. Make sure `main` and your release tags are protected.
5. **Check the first sync** (the *Update now* button, then the mirror's status line).
   A failed mirror shows an error there; it won't fail your pipeline.

**Before the first push, sweep for things you can't take back.** A public mirror
exposes the whole history of every protected branch, not just the latest commit.
Search it for secrets, internal hostnames, private issue links, and code that belongs to
a paid edition. Run `gitleaks` over the full history, not just the working tree.

## Say it's a mirror

Contributors will open issues and PRs on GitHub unless told not to. TruePPM puts this
at the top of its README ([TruePPM](https://gitlab.com/trueppm/trueppm) is the worked
example for this whole guide):

> **Canonical source: gitlab.com/trueppm/trueppm** — issues and merge requests are
> handled there. The GitHub repository is a read-only mirror for discovery; it does not
> accept issues or pull requests.

Also turn off GitHub Issues in the repo settings, and keep `.github/` issue and PR
templates that point back to GitLab.

## GitHub-side polish

- A one-line **description** and **topics**, since GitHub search ranks on them
- A **social preview image**
- The license detected correctly (GitHub shows it in the sidebar)
- A short, honest README: what it is, who it's for, how to run it in under five minutes

## Public-project readiness checklist

A visitor decides in about a minute whether a project looks maintained and safe to
depend on. These are the files and signals they look for. TruePPM has every one in its
repository root.

| Item | Why | Blueprint provides |
|---|---|---|
| `LICENSE` (and `NOTICE` if you bundle third-party code) | Without one, nobody can legally use it | `LICENSE` |
| `README` stating what it is and how to start | The first thing read | `README.md` (describes Blueprint; replace it with yours) |
| `CONTRIBUTING` | Says how to help and what gets reviewed | `CONTRIBUTING.md` |
| `SECURITY.md` | A private route for vulnerability reports | Not provided; add one |
| `CODE_OF_CONDUCT` | Signals a safe place to contribute | Not provided; add one |
| `GOVERNANCE` (if there's a team or an open-core split) | Who decides, and what stays closed | Not provided |
| Issue and PR templates | Keep reports useful | GitLab templates in `.gitlab/`; add `.github/` ones that point back to GitLab |
| Badges: license, quality gate, pipeline | Quick trust signals | Not provided |

**Bottom line:** keep working on GitLab, mirror to GitHub so people can find you, and
make the mirror look like a project someone would trust before you press the button.
