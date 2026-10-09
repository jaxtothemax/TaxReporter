# shellcheck shell=bash
#
# Shared "which GitHub repository is this?" resolver.
#
# Why this exists
# ---------------
# The harness never hardcodes owner/repo: a fork, a rename or a transfer must
# keep working without an edit. Left alone, `gh` infers the repository from the
# git remotes — but with more than one remote (an `upstream` next to `origin`,
# which is exactly what a fork has) it either picks one by its own precedence or
# refuses non-interactively until someone runs `gh repo set-default`. For the
# scripts that WRITE to the tracker (`scripts/wt` labels and comments on issues)
# a wrong pick is worse than a refusal: the check-out lock lands on the upstream
# project's issue of the same number.
#
# So the scripts derive the repository from `origin` — the remote this
# checkout pushes to — and hand it to gh through GH_REPO, which every gh
# command (and `gh api`'s `{owner}/{repo}` placeholders) honors. An explicit
# GH_REPO in the caller's environment always wins.
#
# Source it, then call:
#
#     . "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/gh-repo.sh"
#     gh_repo_from_url "<remote url>"   # prints [HOST/]OWNER/REPO, or nothing
#     gh_export_repo "<repo dir>"       # exports GH_REPO from that repo's origin
#
# A non-GitHub URL (no "github" in the host), a local path, or no origin at all
# yields nothing — callers keep their own no-origin behavior.

# gh_repo_from_url <url> — print `OWNER/REPO` for github.com, `HOST/OWNER/REPO`
# for any other host whose name contains "github" (GitHub Enterprise), or
# nothing. Accepts scp-style (`git@host:owner/repo.git`), ssh:// and http(s)://.
gh_repo_from_url() {
  local url="$1" host path rest
  url="${url%/}"
  url="${url%.git}"
  case "$url" in
    *://*)
      rest="${url#*://}"
      rest="${rest#*@}"
      host="${rest%%/*}"
      path="${rest#*/}"
      [[ "$path" != "$rest" ]] || return 0
      ;;
    *@*:*)
      rest="${url#*@}"
      host="${rest%%:*}"
      path="${rest#*:}"
      ;;
    *) return 0 ;;
  esac
  host="${host%%:*}"   # drop an ssh:// port
  case "$host" in *github*) ;; *) return 0 ;; esac
  # Exactly OWNER/REPO — anything else is not a repository URL we understand.
  [[ "$path" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || return 0
  if [[ "$host" == "github.com" || "$host" == "www.github.com" ]]; then
    printf '%s\n' "$path"
  else
    printf '%s/%s\n' "$host" "$path"
  fi
}

# gh_export_repo <repo dir> — export GH_REPO from <repo dir>'s origin unless the
# caller already set it. Silent no-op when there is no GitHub origin.
gh_export_repo() {
  [[ -n "${GH_REPO:-}" ]] && return 0
  local url repo
  url="$(git -C "$1" remote get-url origin 2>/dev/null || true)"
  [[ -n "$url" ]] || return 0
  repo="$(gh_repo_from_url "$url")"
  if [[ -n "$repo" ]]; then
    export GH_REPO="$repo"
  fi
  return 0
}
