#!/usr/bin/env bash
# scripts/helm-install-drill.sh — boots this project's Helm chart on a real
# (kind) cluster and proves it installs AND upgrades cleanly.
#
# ## Why this exists
#
# `helm lint` / `helm template` prove the chart RENDERS. Neither ever boots
# it. This script actually runs `helm install` (and, on the upgrade leg,
# `helm upgrade`) against a disposable kind cluster and asserts every
# workload comes up Ready.
#
# DRILL_LEG (env var, default "install") selects which of two legs runs:
#
#   install  — `helm install` the HEAD chart straight onto a clean cluster.
#              This is the leg every template clone should wire into its MR
#              pipeline once it has a chart.
#   upgrade  — `helm install` the PREVIOUS released chart version (pulled
#              from the public OCI registry configured below), wait for it to
#              roll out, then `helm upgrade` the SAME release to the HEAD
#              chart. This is the leg every REAL operator walks on every
#              release, and it exercises failure modes a from-empty install
#              never can: migration/upgrade-hook ordering, values that
#              changed shape between releases, and immutable-field errors on
#              a chart's own subcharts (StatefulSet/PVC fields, etc.).
#              "Previous released" is resolved dynamically against the OCI
#              registry's own tag list (resolve_previous_chart_version()
#              below) rather than a hardcoded version string, so it keeps
#              tracking the real last release as the project ships more of
#              them. scripts/tests/helm-upgrade-leg-version.test.sh is the
#              offline, no-cluster-needed test for that resolution algorithm.
#
# This script does NOT know anything about what your chart actually
# deploys — no app-specific assertions (no admin-password checks, no
# per-container health-endpoint probing). It proves the one thing every
# chart shares: the workloads roll out and stay Ready, on a clean install
# and across an upgrade from the last release. Add your own chart-specific
# assertions after the "chart-specific assertions" marker near the bottom if
# your project needs more than that.
#
# ## Configuration
#
#   CHART_DIR             directory containing Chart.yaml        (helm)
#   CLUSTER                kind cluster name              (blueprint-drill)
#   RELEASE                 helm release name                  (blueprint)
#   NAMESPACE               kubernetes namespace                (default)
#   INSTALL_TIMEOUT          --timeout for helm install/upgrade       (8m)
#   DRILL_LEG                install | upgrade                    (install)
#   APISERVER_HOST      host the generated kubeconfig should target
#                        (127.0.0.1 locally; the dind service name in CI)
#
#   CHART_GHCR_HOST / CHART_OCI_REPO
#       Where the PREVIOUS released chart is pulled from for the upgrade
#       leg. Falls back to GHCR_HOST / CHART_REPO so this can share
#       scripts/check-chart-registry.sh's configuration — the two scripts
#       must never disagree about where "the published chart" lives.
#       DRILL_LEG=upgrade with no chart registry configured fails closed
#       (exit 2): unlike the registry drift gate, this leg was explicitly
#       asked to upgrade FROM something, so silently degrading to an install
#       would silently stop testing what it was invoked to test. Run
#       DRILL_LEG=install if you have no chart registry yet.
#
#   HELM_PRELOAD_IMAGES
#       Space-separated image refs to `docker pull` + `kind load` before
#       install, for a private registry the kind nodes cannot authenticate
#       to on their own. Empty by default — most template clones either use
#       public images or have not wired a private registry yet.
#   HELM_SET_ARGS
#       Extra flags (space-separated, e.g. "--set image.tag=abc123") passed
#       to both `helm install` and `helm upgrade` of the HEAD chart.
#
#   CLUSTER_CREATE_ATTEMPTS / CLUSTER_CREATE_RETRY_DELAY
#       kind's own node-boot wait (tailing the node container's log for a
#       systemd target — separate from `--wait`, which gates node Readiness)
#       has no knob to lengthen and can fail in under two seconds on a
#       loaded runner. Cluster creation is the single flakiest step in a
#       drill job (ported from TruePPM bfaa8bf05, #3966): delete whatever
#       partially came up and retry, bounded, rather than let a runner blip
#       fail the whole job. Defaults: 3 attempts, 5s between them.
#
# Requires docker, kind, kubectl, helm on PATH. In CI: a docker:dind
# service — see ci/helm.yml.
#
# This script has NO --self-test: it needs a live Docker daemon and network
# access to boot a cluster, which is not something a fixture can stand in
# for. scripts/tests/helm-upgrade-leg-version.test.sh covers the one part of
# it that IS a pure algorithm (resolve_previous_chart_version) offline.
#
# Usage:  scripts/helm-install-drill.sh
# Exit:   0 rolled out (and, on the upgrade leg, upgraded) cleanly
#         1 the chart failed to install / upgrade / become Ready
#         2 invocation or configuration error (no chart, tool missing,
#           registry unreadable/unconfigured on the upgrade leg)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

CHART_DIR="${CHART_DIR:-helm}"
CLUSTER="${CLUSTER:-blueprint-drill}"
RELEASE="${RELEASE:-blueprint}"
NAMESPACE="${NAMESPACE:-default}"
INSTALL_TIMEOUT="${INSTALL_TIMEOUT:-8m}"
DRILL_LEG="${DRILL_LEG:-install}"
APISERVER_HOST="${APISERVER_HOST:-127.0.0.1}"

CHART_GHCR_HOST="${CHART_GHCR_HOST:-${GHCR_HOST:-ghcr.io}}"
CHART_OCI_REPO="${CHART_OCI_REPO:-${CHART_REPO:-}}"

HELM_PRELOAD_IMAGES="${HELM_PRELOAD_IMAGES:-}"
# shellcheck disable=SC2206 # intentional word-splitting of operator-supplied flags
HELM_SET_ARGS=(${HELM_SET_ARGS:-})

CLUSTER_CREATE_ATTEMPTS="${CLUSTER_CREATE_ATTEMPTS:-3}"
CLUSTER_CREATE_RETRY_DELAY="${CLUSTER_CREATE_RETRY_DELAY:-5}"

log() { echo "[helm-install-drill] $*"; }
fail() { echo "FAIL: $*" >&2; exit 1; }
die() { echo "helm-install-drill: $*" >&2; exit 2; }

case "$DRILL_LEG" in
  install | upgrade) ;;
  *) die "DRILL_LEG must be 'install' or 'upgrade', got '$DRILL_LEG'" ;;
esac

[ -f "${CHART_DIR}/Chart.yaml" ] \
  || die "${CHART_DIR}/Chart.yaml not found — no Helm chart to drill. Set CHART_DIR if your chart lives elsewhere, or skip this job (see ci/helm.yml's exists: rule)."

for tool in docker kind kubectl helm; do
  command -v "$tool" >/dev/null 2>&1 || die "$tool not on PATH"
done

# ---- resolve the previous released chart version (upgrade leg only) --------
# Ported from TruePPM #3941, generalized variable names. "Previous" is the
# highest published version strictly BELOW HEAD's own Chart.yaml `version`.
# In the common case HEAD's Chart.yaml already equals the just-shipped tag
# (a release script bumps it at tag time), so this resolves to the release
# before that one. If HEAD has been bumped ahead of anything published yet
# (mid-cycle dev before the next tag), it falls back to the highest version
# actually in the registry. Merging HEAD's own version into the sorted list
# and walking to it — rather than special-casing "is HEAD's version already
# published?" — is what makes both cases fall out of one code path.
resolve_previous_chart_version() {
  local head_version token body versions merged
  # HEAD_CHART_VERSION lets a test stub the version without a real
  # Chart.yaml on disk (mirrors CHART_TAGS below and
  # scripts/check-chart-registry.sh's own override style) — see
  # scripts/tests/helm-upgrade-leg-version.test.sh.
  if [ -n "${HEAD_CHART_VERSION:-}" ]; then
    head_version="$HEAD_CHART_VERSION"
  else
    head_version="$(awk '/^version:[[:space:]]/{print $2; exit}' "${CHART_DIR}/Chart.yaml")"
  fi
  [ -n "$head_version" ] || fail "could not read 'version' from ${CHART_DIR}/Chart.yaml"

  # CHART_TAGS (whitespace-separated) skips the network read — same override
  # name and shape as scripts/check-chart-registry.sh's list_versions(), so a
  # test (or a local dry run) can stub both scripts identically.
  if [ "${CHART_TAGS+set}" = set ]; then
    # shellcheck disable=SC2086 # intentional word-splitting of a whitespace-separated tag list
    versions="$(printf '%s\n' $CHART_TAGS \
      | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$|^[0-9]+\.[0-9]+\.[0-9]+-[0-9A-Za-z.-]+$' || true)"
  else
    [ -n "$CHART_OCI_REPO" ] \
      || fail "CHART_GHCR_HOST/CHART_OCI_REPO (or GHCR_HOST/CHART_REPO) not set — cannot resolve the previous released chart from a registry that isn't configured. Configure it, or run DRILL_LEG=install instead."
    token="$(curl -fsS --max-time 30 --retry 3 \
      "https://${CHART_GHCR_HOST}/token?scope=repository:${CHART_OCI_REPO}:pull" \
      | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')" \
      || fail "could not get an anonymous pull token from ${CHART_GHCR_HOST} for ${CHART_OCI_REPO}"
    [ -n "$token" ] || fail "empty pull token from ${CHART_GHCR_HOST} for ${CHART_OCI_REPO}"
    body="$(curl -fsS --max-time 30 --retry 3 -H "Authorization: Bearer ${token}" \
      "https://${CHART_GHCR_HOST}/v2/${CHART_OCI_REPO}/tags/list?n=1000")" \
      || fail "could not read the chart tag list for ${CHART_GHCR_HOST}/${CHART_OCI_REPO}"
    versions="$(printf '%s' "$body" \
      | sed -n 's/.*"tags":\[\([^]]*\)\].*/\1/p' | tr ',' '\n' | tr -d '"' \
      | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$|^[0-9]+\.[0-9]+\.[0-9]+-[0-9A-Za-z.-]+$' || true)"
  fi
  [ -n "$versions" ] || fail "no chart versions found in ${CHART_GHCR_HOST}/${CHART_OCI_REPO} — is the registry readable?"

  merged="$(printf '%s\n%s\n' "$versions" "$head_version" | sort -V -u)"
  PREV_CHART_VERSION="$(printf '%s\n' "$merged" | awk -v head="$head_version" '
    $0 == head { print prev; found=1; exit }
    { prev = $0 }
    END { if (!found) print prev }
  ')"

  if [ -z "$PREV_CHART_VERSION" ]; then
    log "no published chart version older than HEAD (${head_version}) found in ${CHART_GHCR_HOST}/${CHART_OCI_REPO} — nothing to upgrade FROM yet; skipping the upgrade leg"
    exit 0
  fi
  log "upgrade leg: previous released chart = ${PREV_CHART_VERSION}, HEAD chart = ${head_version}"
}

# ---- diagnostics on any failure --------------------------------------------
dump_diagnostics() {
  echo "======== DIAGNOSTICS (deploy did not reach a healthy state) ========" >&2
  kubectl get pods -n "$NAMESPACE" -o wide 2>&1 >&2 || true
  local p
  for p in $(kubectl get pods -n "$NAMESPACE" -o name 2>/dev/null); do
    local ready
    ready="$(kubectl get "$p" -n "$NAMESPACE" -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null || true)"
    [ "$ready" = "True" ] && continue
    echo "---- describe $p ----" >&2
    kubectl describe "$p" -n "$NAMESPACE" 2>&1 >&2 || true
    echo "---- logs $p (all containers, incl. init) ----" >&2
    kubectl logs "$p" -n "$NAMESPACE" --all-containers --prefix --tail=80 2>&1 >&2 || true
  done
}

cleanup() { log "deleting kind cluster '$CLUSTER'"; kind delete cluster --name "$CLUSTER" >/dev/null 2>&1 || true; }
on_exit() {
  local rc=$?
  if [ "$rc" -ne 0 ] && kind get clusters 2>/dev/null | grep -Fx "$CLUSTER" >/dev/null 2>&1; then
    dump_diagnostics
  fi
  cleanup
  exit "$rc"
}
trap on_exit EXIT

# Resolve the upgrade-FROM version before spinning up a cluster — a registry
# read is cheap, a kind cluster is not.
if [ "$DRILL_LEG" = "upgrade" ]; then
  resolve_previous_chart_version
fi

# ---- 1. cluster -------------------------------------------------------------
log "creating kind cluster '$CLUSTER'"
cat >/tmp/blueprint-kind-config.yaml <<EOF
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
networking:
  apiServerAddress: "0.0.0.0"
  apiServerPort: 6443
kubeadmConfigPatches:
  - |
    kind: ClusterConfiguration
    apiServer:
      certSANs:
        - "${APISERVER_HOST}"
        - localhost
        - 127.0.0.1
EOF
attempt=1
while true; do
  if kind create cluster --name "$CLUSTER" --config /tmp/blueprint-kind-config.yaml --wait 120s; then
    break
  fi
  if [ "$attempt" -ge "$CLUSTER_CREATE_ATTEMPTS" ]; then
    fail "kind create cluster failed after ${CLUSTER_CREATE_ATTEMPTS} attempts"
  fi
  log "kind create cluster failed (attempt ${attempt}/${CLUSTER_CREATE_ATTEMPTS}) — deleting and retrying in ${CLUSTER_CREATE_RETRY_DELAY}s"
  kind delete cluster --name "$CLUSTER" >/dev/null 2>&1 || true
  sleep "$CLUSTER_CREATE_RETRY_DELAY"
  attempt=$((attempt + 1))
done

if [ "$APISERVER_HOST" != "127.0.0.1" ] && [ "$APISERVER_HOST" != "localhost" ]; then
  kubectl config set-cluster "kind-${CLUSTER}" --server="https://${APISERVER_HOST}:6443"
fi
kubectl cluster-info
kubectl wait --for=condition=Ready nodes --all --timeout=90s

# ---- 2. optionally preload private images -----------------------------------
if [ -n "$HELM_PRELOAD_IMAGES" ]; then
  if [ -n "${CI_REGISTRY_PASSWORD:-}" ] && [ -n "${CI_REGISTRY:-}" ]; then
    log "docker login ${CI_REGISTRY}"
    echo "${CI_REGISTRY_PASSWORD}" | docker login -u "${CI_REGISTRY_USER:-}" --password-stdin "${CI_REGISTRY}"
  fi
  for img in $HELM_PRELOAD_IMAGES; do
    log "pull + load $img"
    docker pull "$img"
    kind load docker-image "$img" --name "$CLUSTER"
  done
fi

# ---- 3. install (+ upgrade) --------------------------------------------------
if [ "$DRILL_LEG" = "upgrade" ]; then
  log "helm install ${RELEASE} FROM PREVIOUS RELEASED CHART ${PREV_CHART_VERSION} (oci://${CHART_GHCR_HOST}/${CHART_OCI_REPO})"
  helm install "$RELEASE" "oci://${CHART_GHCR_HOST}/${CHART_OCI_REPO}" --version "$PREV_CHART_VERSION" \
    -n "$NAMESPACE" --create-namespace \
    --wait --timeout "$INSTALL_TIMEOUT"
  log "previous release ${PREV_CHART_VERSION} rolled out — now helm upgrade -> HEAD chart"
  kubectl get pods -n "$NAMESPACE" -o wide

  log "helm upgrade ${RELEASE} -> HEAD chart (${CHART_DIR})"
  helm upgrade "$RELEASE" "$CHART_DIR" \
    -n "$NAMESPACE" \
    "${HELM_SET_ARGS[@]}" \
    --wait --timeout "$INSTALL_TIMEOUT"
  log "upgrade rollout complete"
else
  log "helm install ${RELEASE} (${CHART_DIR})"
  helm install "$RELEASE" "$CHART_DIR" \
    -n "$NAMESPACE" --create-namespace \
    "${HELM_SET_ARGS[@]}" \
    --wait --timeout "$INSTALL_TIMEOUT"
  log "rollout complete"
fi
kubectl get pods -n "$NAMESPACE" -o wide

# ---- 4. every pod actually Ready (or Succeeded) ------------------------------
# `--wait` above already gates on Deployment/StatefulSet minimums; this is a
# belt-and-suspenders sweep across every pod the release owns, so a workload
# `--wait` does not cover (a bare Job, a Pod outside a controller `--wait`
# tracks) cannot silently pass.
not_ready="$(kubectl get pods -n "$NAMESPACE" \
  -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.status.phase}{"\t"}{.status.conditions[?(@.type=="Ready")].status}{"\n"}{end}' \
  | awk -F'\t' '$2!="Succeeded" && $3!="True" {print}')"
if [ -n "$not_ready" ]; then
  echo "$not_ready" >&2
  fail "not every pod is Ready despite helm --wait reporting success"
fi
log "all pods Ready (or Succeeded)"

# ---- 5. helm test, if the chart defines any ----------------------------------
if [ -d "${CHART_DIR}/templates/tests" ]; then
  log "helm test ${RELEASE}"
  helm test "$RELEASE" -n "$NAMESPACE" --timeout 3m
else
  log "no ${CHART_DIR}/templates/tests/ — skipping helm test (chart defines none)"
fi

# ---- chart-specific assertions ----------------------------------------------
# Add project-specific checks here (a health endpoint, a bootstrap artifact,
# a negative-probe boot guard — see TruePPM's scripts/helm-install-drill.sh
# for the shape those take) once this template clone has a real chart.

log "HELM DRILL GREEN (leg=${DRILL_LEG}$([ "$DRILL_LEG" = upgrade ] && echo ", ${PREV_CHART_VERSION} -> HEAD"))"
