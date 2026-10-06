#!/usr/bin/env bash
# scripts/check-chart-registry.sh — the published Helm chart must be installable
# by the command the docs tell operators to run, and a release must never
# publish a chart that hides its own pre-releases behind a plain stable tag.
#
# ## Why this exists (ported from TruePPM #3914)
#
# Semver ranks a plain `X.Y.Z` ABOVE every `X.Y.Z-beta.N`, and Helm skips
# pre-releases unless asked — so a bare `helm install oci://…`, and even
# `helm install --devel`, resolves to the highest STABLE version forever. If
# that stable chart is ever broken (a bad appVersion, a missing default
# image), operators keep getting it: the fix is not a new commit, it's
# deleting the offending version from the registry.
#
# The property that makes this worth its own gate: **the registry going wrong
# is not a diff event.** No commit introduces it — a chart already published
# can go stale relative to the images it names, or a later push can shadow an
# earlier good one — so no MR pipeline can ever catch it.
# `scripts/check-version-lockstep.py` already covers the repo-internal half of
# this class (every version-bearing manifest in THIS checkout agrees with the
# others); this is the half that lives outside the repo, in a registry no
# commit touches, and it needs a scheduled job instead of an MR job.
#
# ## Two modes, one script
#
#   check-chart-registry.sh
#       DEFAULT-RESOLUTION check (run on a schedule — see ci/helm.yml).
#       Resolves what a bare `helm install` gets — the highest STABLE
#       version, because Helm skips pre-releases — reads its appVersion, and
#       requires the image tag the chart would pull by default (`v<appVersion>`)
#       to exist for every image named in CHART_DEFAULT_IMAGES. It asserts the
#       property operators actually depend on, not a proxy for it: "a stable
#       and some betas coexist" is the NORMAL, healthy state once a project's
#       chart flow is working, so a rule that only checked that would go
#       permanently red (or permanently meaningless) the day it started
#       passing for real.
#
#   check-chart-registry.sh --candidate <version>
#       PUBLISH guard (wire into a chart-publish job before `helm push`, once
#       your project has one). Refuses to push a pre-release `X.Y.Z-*` when a
#       stable `X.Y.Z` is already published: the new chart could never
#       outrank it. Publishing a pre-release AFTER its stable is shadowing by
#       definition; the reverse order (betas, then the stable) is the
#       ordinary release path and is accepted.
#
#   check-chart-registry.sh --self-test
#       Proves both modes can still fail, with the registry call replaced by
#       a fixture (CHART_TAGS / CHART_APPVERSION_OF / CHART_IMAGE_PROBE
#       below) — hermetic, no network.
#
# ## Configuration
#
# This template ships with NO chart and NO registry configured — most clones
# never publish a Helm chart at all. `CHART_REPO` is the switch: empty (the
# default) means "not configured", and the default-resolution check exits 0
# with an informational message rather than trying to reach a registry that
# was never set up. That is a DIFFERENT outcome from "CHART_REPO IS set and
# the registry could not be read" — the second case is this gate's actual
# job (scripts/CLAUDE.md: "a gate that cannot reach its oracle must go RED")
# and exits 2, not 0. Collapsing those two into one branch is the easiest way
# to get this gate wrong: it would either nag every unconfigured clone
# forever, or — worse — go quiet the day a configured registry stops
# answering.
#
#   CHART_REPO             OCI repository path, e.g. "myorg/charts/myapp".
#                           Empty = chart registry not configured (skip).
#   CHART_GHCR_HOST         registry host                          (ghcr.io)
#   IMAGE_REGISTRY_HOST     registry the app IMAGES live in   (registry not
#                           necessarily the same host as the chart registry)
#   CHART_DEFAULT_IMAGES    space-separated `<repo>` paths under
#                           IMAGE_REGISTRY_HOST whose `v<appVersion>` tag the
#                           DEFAULT (bare `helm install`) chart must be able
#                           to pull. Must match your chart's
#                           image.repository default(s). Empty = nothing to
#                           gate on images even though a chart registry IS
#                           configured; the run says so explicitly rather
#                           than silently skipping the check (see "say what
#                           the gate did not cover", scripts/CLAUDE.md).
#
# ## Overrides (used by --self-test; also handy for a dry run)
#
# CHART_TAGS           whitespace-separated tag list; skips the network read
# CHART_APPVERSION_OF  command: prints the appVersion of the chart version in $1
# CHART_IMAGE_PROBE    command: exits 0 when the image reference in $1 exists
# ALLOW_UNRESOLVED      "1" downgrades an UNREACHABLE (configured but
#                       unreadable) registry from exit 2 to a logged warning
#                       and exit 0. Named, explicit, and visible in a diff or
#                       a job's variables — never a silent default. This does
#                       NOT cover "not configured", which is already exit 0.
#
# Exit codes:  0 healthy, or nothing configured to check · 1 the registry
# state is wrong · 2 configured but could not be read, or invocation error.
# A read failure is deliberately NOT exit 0 unless ALLOW_UNRESOLVED=1: a gate
# that goes quiet when it cannot see is the failure mode it exists to end.

set -euo pipefail

CHART_REPO="${CHART_REPO:-}"
CHART_GHCR_HOST="${CHART_GHCR_HOST:-ghcr.io}"
IMAGE_REGISTRY_HOST="${IMAGE_REGISTRY_HOST:-registry.gitlab.com}"
CHART_DEFAULT_IMAGES="${CHART_DEFAULT_IMAGES:-}"
ALLOW_UNRESOLVED="${ALLOW_UNRESOLVED:-0}"

STABLE_RE='^[0-9]+\.[0-9]+\.[0-9]+$'
PRE_RE='^([0-9]+\.[0-9]+\.[0-9]+)-[0-9A-Za-z.-]+$'

die() { echo "check-chart-registry: $*" >&2; exit 2; }

# A read failure against the registry. Respects ALLOW_UNRESOLVED (exit 0,
# loudly) instead of dying outright — the one named opt-out scripts/CLAUDE.md
# requires for a gate whose oracle is outside the repository.
unresolved() {
  if [ "$ALLOW_UNRESOLVED" = "1" ]; then
    echo "check-chart-registry: UNRESOLVED (allowed) — $*" >&2
    echo "check-chart-registry: ALLOW_UNRESOLVED=1 is set — treating this as a pass. Unset it to fail closed." >&2
    exit 0
  fi
  echo "check-chart-registry: $*" >&2
  echo "check-chart-registry: set ALLOW_UNRESOLVED=1 to explicitly accept this (visible in the diff/job config) — do not do this routinely." >&2
  exit 2
}

# Not configured at all — a legitimate skip, distinct from "configured but
# unreadable" above. Most template clones take this path forever.
not_configured() {
  echo "check-chart-registry: OK  CHART_REPO is not set — no Helm chart registry configured for this project. Skipping (see the header comment for CHART_REPO)."
  exit 0
}

# The registry's tag list also carries cosign's `sha256-<digest>[.sig|.att]`
# tags; keep only chart versions.
list_versions() {
  local raw
  if [ "${CHART_TAGS+set}" = set ]; then
    # shellcheck disable=SC2086 # deliberate word-splitting of a whitespace-separated tag list
    raw="$(printf '%s\n' $CHART_TAGS)"
  else
    local token body
    token="$(curl -fsS --max-time 30 --retry 3 \
      "https://${CHART_GHCR_HOST}/token?scope=repository:${CHART_REPO}:pull" 2>/dev/null \
      | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')" || true
    [ -n "$token" ] || unresolved "could not get an anonymous pull token from ${CHART_GHCR_HOST} for ${CHART_REPO}"
    body="$(curl -fsS --max-time 30 --retry 3 -H "Authorization: Bearer ${token}" \
      "https://${CHART_GHCR_HOST}/v2/${CHART_REPO}/tags/list?n=1000" 2>/dev/null)" \
      || unresolved "could not read the tag list for ${CHART_GHCR_HOST}/${CHART_REPO}"
    raw="$(printf '%s' "$body" | sed -n 's/.*"tags":\[\([^]]*\)\].*/\1/p' | tr ',' '\n' | tr -d '"')"
  fi
  printf '%s\n' "$raw" | grep -E "${STABLE_RE}|${PRE_RE}" || true
}

remediation() {
  cat <<EOF

Remove the offending version from the registry. A pipeline cannot do it: it
needs someone with delete rights on the package (delete:packages, or the
equivalent on your registry).

  Confirm what a stock install would resolve to:
    helm show chart oci://${CHART_GHCR_HOST}/${CHART_REPO} --devel
EOF
}

# --- publish guard ----------------------------------------------------------
check_candidate() {
  local cand="$1" base versions stable
  if [[ "$cand" =~ $PRE_RE ]]; then
    base="${BASH_REMATCH[1]}"
  elif [[ "$cand" =~ $STABLE_RE ]]; then
    echo "check-chart-registry: OK  $cand is a stable version; nothing can shadow it."
    return 0
  else
    die "candidate '$cand' is not a valid chart version"
  fi
  [ -n "$CHART_REPO" ] || not_configured
  # Plain assignment, not `local x=$(…)` and not `list_versions | grep … ||
  # true`: either would swallow list_versions' exit, and an unreadable
  # registry would read as "no stable version to shadow" — the gate failing
  # open. list_versions itself already fails closed via unresolved().
  versions="$(list_versions)"
  stable="$(printf '%s\n' "$versions" | grep -Fx "$base" || true)"
  if [ -n "$stable" ]; then
    echo "check-chart-registry: FAIL  refusing to publish $cand: stable $base is already in ${CHART_GHCR_HOST}/${CHART_REPO}." >&2
    echo "Semver ranks $base above $cand, and Helm skips pre-releases unless --version is given, so an" >&2
    echo "operator running \`helm install oci://${CHART_GHCR_HOST}/${CHART_REPO}\` — with or without --devel —" >&2
    echo "would keep getting $base and never this chart." >&2
    remediation >&2
    return 1
  fi
  echo "check-chart-registry: OK  no stable $base in the registry to shadow $cand."
}

# --- default-resolution check -----------------------------------------------
app_version_of() {
  if [ -n "${CHART_APPVERSION_OF:-}" ]; then
    $CHART_APPVERSION_OF "$1"
    return
  fi
  local token manifest cfg
  token="$(curl -fsS --max-time 30 --retry 3 \
    "https://${CHART_GHCR_HOST}/token?scope=repository:${CHART_REPO}:pull" \
    | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')" || unresolved "could not get a pull token to read chart $1"
  manifest="$(curl -fsS --max-time 30 --retry 3 -H "Authorization: Bearer ${token}" \
    -H "Accept: application/vnd.oci.image.manifest.v1+json" \
    "https://${CHART_GHCR_HOST}/v2/${CHART_REPO}/manifests/$1" | tr -d '\n ')" \
    || unresolved "could not read the manifest for chart $1"
  cfg="$(printf '%s' "$manifest" | sed -n 's/.*"config":{[^}]*"digest":"\(sha256:[a-f0-9]*\)".*/\1/p')"
  [ -n "$cfg" ] || unresolved "chart $1 manifest has no config digest"
  curl --proto '=https' --proto-redir '=https' --tlsv1.2 -fsSL --max-time 30 --retry 3 \
    -H "Authorization: Bearer ${token}" \
    "https://${CHART_GHCR_HOST}/v2/${CHART_REPO}/blobs/${cfg}" | tr -d '\n ' \
    | sed -n 's/.*"appVersion":"\([^"]*\)".*/\1/p'
}

image_exists() {
  if [ -n "${CHART_IMAGE_PROBE:-}" ]; then
    $CHART_IMAGE_PROBE "$1"
    return
  fi
  # 0 = exists, 1 = the registry answered and it is not there, 2 = could not ask.
  local repo="${1#"${IMAGE_REGISTRY_HOST}"/}" tag token code
  tag="${repo##*:}"
  repo="${repo%:*}"
  token="$(curl -fsS --max-time 30 --retry 3 \
    "https://${IMAGE_REGISTRY_HOST}/jwt/auth?service=container_registry&scope=repository:${repo}:pull" \
    | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')" || return 2
  code="$(curl -s -o /dev/null -w '%{http_code}' -I --max-time 30 --retry 3 \
    -H "Authorization: Bearer ${token}" \
    -H "Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json" \
    "https://${IMAGE_REGISTRY_HOST}/v2/${repo}/manifests/${tag}")"
  [ "$code" = "200" ]
}

check_default() {
  local versions stables default appv tag ref rc bad=0 covered=0
  [ -n "$CHART_REPO" ] || not_configured
  versions="$(list_versions)"
  [ -n "$versions" ] || unresolved "no chart versions found in ${CHART_GHCR_HOST}/${CHART_REPO} — is the registry readable?"
  stables="$(printf '%s\n' "$versions" | grep -E "${STABLE_RE}" | sort -V || true)"
  if [ -z "$stables" ]; then
    echo "check-chart-registry: OK  no stable chart version is published, so a bare \`helm install\` fails" \
         "loudly (no version to resolve) rather than installing anything. Pre-release only: $(printf '%s' "$versions" | tr '\n' ' ')"
    return 0
  fi
  default="$(printf '%s\n' "$stables" | tail -n 1)"
  appv="$(app_version_of "$default")"
  [ -n "$appv" ] || unresolved "could not read appVersion of chart $default"
  tag="v${appv}"

  if [ -z "$CHART_DEFAULT_IMAGES" ]; then
    echo "check-chart-registry: OK  bare \`helm install\` resolves to chart $default (appVersion $appv);" \
         "CHART_DEFAULT_IMAGES is not set, so no image was checked — this run covers CHART REPO resolution" \
         "only, not image pullability. Set CHART_DEFAULT_IMAGES to close that gap."
    return 0
  fi

  for repo in $CHART_DEFAULT_IMAGES; do
    ref="${IMAGE_REGISTRY_HOST}/${repo}:${tag}"
    rc=0; image_exists "$ref" || rc=$?
    covered=$((covered + 1))
    case "$rc" in
      0) echo "check-chart-registry: ok    $ref exists" ;;
      1) echo "check-chart-registry: MISSING $ref" >&2; bad=1 ;;
      *) unresolved "could not query ${IMAGE_REGISTRY_HOST} for $ref" ;;
    esac
  done
  if [ "$bad" -ne 0 ]; then
    echo "check-chart-registry: FAIL  \`helm install oci://${CHART_GHCR_HOST}/${CHART_REPO}\` resolves to chart $default" \
         "(appVersion $appv), whose default image tag $tag does not exist — a stock install cannot pull it." >&2
    remediation >&2
    return 1
  fi
  echo "check-chart-registry: OK  bare \`helm install\` resolves to chart $default; its default image(s)" \
       "($tag, ${covered} checked) exist."
}

# --- self-test --------------------------------------------------------------
self_test() {
  local fails=0 self
  self="${BASH_SOURCE[0]}"
  run() { # <env assignments…> -- <args…>; sets OUT and RC
    local envs=()
    while [ "$1" != "--" ]; do envs+=("$1"); shift; done; shift
    # `${envs[@]}` on a possibly-EMPTY array trips bash 3.2's (macOS's shipped
    # bash) "unbound variable" under `set -u` when a case passes no env
    # overrides (e.g. the not-configured cases below). `${envs[@]+"${envs[@]}"}`
    # expands to nothing at all when the array is empty instead of expanding
    # an unset one.
    set +e; OUT="$(env ${envs[@]+"${envs[@]}"} bash "$self" "$@" 2>&1)"; RC=$?; set -e
  }
  expect() { # <desc> <expected rc> [fragment]
    local ok=1
    [ "$RC" -eq "$2" ] || ok=0
    if [ -n "${3:-}" ] && ! grep -qF -- "$3" <<<"$OUT"; then ok=0; fi
    if [ "$ok" -eq 1 ]; then
      echo "  ok    $1"
    else
      echo "  FAIL  $1 (rc=$RC, wanted $2${3:+, output containing: $3})"
      while IFS= read -r line; do printf '        %s\n' "$line"; done <<<"$OUT"
      fails=$((fails + 1))
    fi
  }
  local probe_ok="true" probe_beta_only appv_cmd
  probe_beta_only="$(mktemp)"
  cat > "$probe_beta_only" <<'PROBE'
#!/usr/bin/env bash
case "$1" in *:v0.4.0-beta.3) exit 0 ;; *) exit 1 ;; esac
PROBE
  chmod +x "$probe_beta_only"
  appv_cmd="$(mktemp)"
  cat > "$appv_cmd" <<'APPV'
#!/usr/bin/env bash
case "$1" in 0.4.0) echo 0.4.0 ;; 0.4.0-beta.3) echo 0.4.0-beta.3 ;; 0.3.0) echo 0.3.0 ;; esac
APPV
  chmod +x "$appv_cmd"

  echo "not-configured (CHART_REPO unset — the template default):"
  run -- --candidate 0.4.0-beta.4
  expect "publish guard skips cleanly with no CHART_REPO" 0 "not set"
  run --
  expect "default-resolution check skips cleanly with no CHART_REPO" 0 "not set"

  echo "publish guard (CHART_REPO configured):"
  run CHART_REPO="acme/charts/widget" CHART_TAGS="0.4.0 0.4.0-beta.2 0.4.0-beta.3 sha256-3aada.sig" -- --candidate 0.4.0-beta.4
  expect "beta.4 refused while stable 0.4.0 is published" 1 "refusing to publish 0.4.0-beta.4"
  expect "  …and the message points at the fix" 1 "delete rights"
  run CHART_REPO="acme/charts/widget" CHART_TAGS="0.4.0-beta.2 0.4.0-beta.3" -- --candidate 0.4.0-beta.4
  expect "beta.4 accepted when no stable 0.4.0 exists" 0
  run CHART_REPO="acme/charts/widget" CHART_TAGS="0.4.0-beta.2 0.4.0-beta.3" -- --candidate 0.4.0
  expect "the stable release itself is accepted after its betas" 0
  run CHART_REPO="acme/charts/widget" CHART_TAGS="0.3.0 0.4.0-beta.1" -- --candidate 0.4.0-beta.2
  expect "an older stable line does not block a newer pre-release" 0
  run CHART_REPO="acme/charts/widget" CHART_TAGS="0.4.0" -- --candidate 0.4.0-rc.1
  expect "an rc after its stable is refused too" 1 "refusing to publish 0.4.0-rc.1"
  run CHART_REPO="acme/charts/widget" CHART_TAGS="" -- --candidate not-a-version
  expect "a malformed candidate is an invocation error, not a pass" 2
  run CHART_REPO="acme/charts/widget" CHART_GHCR_HOST=127.0.0.1:9 -- --candidate 0.4.0-beta.4
  expect "an unreadable but CONFIGURED registry fails closed (exit 2), not open" 2 "could not"
  run CHART_REPO="acme/charts/widget" CHART_GHCR_HOST=127.0.0.1:9 ALLOW_UNRESOLVED=1 -- --candidate 0.4.0-beta.4
  expect "ALLOW_UNRESOLVED=1 turns the same failure into an explicit pass" 0 "UNRESOLVED (allowed)"

  echo "default-resolution check (CHART_REPO configured):"
  run CHART_REPO="acme/charts/widget" CHART_TAGS="0.4.0 0.4.0-beta.2 0.4.0-beta.3" CHART_APPVERSION_OF="$appv_cmd" CHART_IMAGE_PROBE="$probe_beta_only" CHART_DEFAULT_IMAGES="acme/widget/api" --
  expect "bare install resolves to 0.4.0, whose v0.4.0 image is missing" 1 "MISSING registry.gitlab.com/acme/widget/api:v0.4.0"
  expect "  …and it names the chart Helm resolves to" 1 "resolves to chart 0.4.0"
  run CHART_REPO="acme/charts/widget" CHART_TAGS="0.4.0 0.4.0-beta.2 0.4.0-beta.3" CHART_APPVERSION_OF="$appv_cmd" CHART_IMAGE_PROBE="$probe_ok" CHART_DEFAULT_IMAGES="acme/widget/api" --
  expect "healthy: stable 0.4.0 whose default image exists, betas alongside" 0 "resolves to chart 0.4.0"
  run CHART_REPO="acme/charts/widget" CHART_TAGS="0.4.0-beta.2 0.4.0-beta.3" CHART_APPVERSION_OF="$appv_cmd" CHART_IMAGE_PROBE="$probe_ok" CHART_DEFAULT_IMAGES="acme/widget/api" --
  expect "pre-release only: a bare install fails loudly, which is fine" 0 "fails loudly"
  run CHART_REPO="acme/charts/widget" CHART_TAGS="0.3.0 0.4.0 0.4.0-beta.3" CHART_APPVERSION_OF="$appv_cmd" CHART_IMAGE_PROBE="$probe_beta_only" CHART_DEFAULT_IMAGES="acme/widget/api" --
  expect "the HIGHEST stable is the one checked (0.4.0, not 0.3.0)" 1 "resolves to chart 0.4.0"
  run CHART_REPO="acme/charts/widget" CHART_TAGS="sha256-3aada sha256-be9e.sig" CHART_APPVERSION_OF="$appv_cmd" CHART_DEFAULT_IMAGES="acme/widget/api" --
  expect "cosign tags are not chart versions: nothing found is an error" 2
  run CHART_REPO="acme/charts/widget" CHART_GHCR_HOST=127.0.0.1:9 --
  expect "an unreadable but CONFIGURED registry fails closed (exit 2), not open" 2 "could not"
  run CHART_REPO="acme/charts/widget" CHART_GHCR_HOST=127.0.0.1:9 ALLOW_UNRESOLVED=1 --
  expect "ALLOW_UNRESOLVED=1 turns the same failure into an explicit pass" 0 "UNRESOLVED (allowed)"
  run CHART_REPO="acme/charts/widget" CHART_TAGS="0.4.0" CHART_APPVERSION_OF="$appv_cmd" --
  expect "chart repo configured but no images to gate on: scoped OK, says what was not covered" 0 "no image was checked"

  rm -f "$probe_beta_only" "$appv_cmd"
  echo
  if [ "$fails" -gt 0 ]; then echo "SELF-TEST FAILED: $fails case(s)."; return 1; fi
  echo "SELF-TEST OK: not-configured skip, publish guard, and default-resolution check all behave, in both directions."
}

case "${1:-}" in
  --self-test)  self_test ;;
  --candidate)  [ -n "${2:-}" ] || die "--candidate needs a version"; check_candidate "$2" ;;
  "")           check_default ;;
  *)            die "usage: $0 [--self-test | --candidate <version>]" ;;
esac
