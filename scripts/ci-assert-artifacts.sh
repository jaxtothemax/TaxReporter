#!/bin/sh
# scripts/ci-assert-artifacts.sh — fail the CURRENT job when a path it is about
# to upload as an artifact produced nothing.
#
# actions/upload-artifact treats an empty upload as non-fatal by default
# (`if-no-files-found: warn`): it prints "No files were found with the provided
# path" and the step — and the job — still succeed. GitLab had the same hole
# ("ERROR: No files to upload", "Job succeeded"), and upstream three tag publish
# jobs fell into it in one release (one had `cd`-ed away from the path it
# declared); the failure surfaced only in a downstream job. Call this in a `run:`
# step BEFORE the upload step, with every path the upload names, so the job that
# failed to produce the artifact is the one that goes red, naming the path.
#
# Every path is anchored at $GITHUB_WORKSPACE, which is where the upload actions
# resolve a relative `path:`, regardless of any `cd` or `working-directory:` an
# earlier step used. scripts/check-artifact-assertions.sh keeps the wiring in
# place.
#
# Usage: ci-assert-artifacts.sh PATH [PATH...]   (a trailing / means directory)
# Exit:  0 every path exists and is non-empty · 1 a path is missing/empty · 2 usage

[ "$#" -gt 0 ] || { echo "usage: ci-assert-artifacts.sh PATH [PATH...]" >&2; exit 2; }
root="${GITHUB_WORKSPACE:-$(pwd)}"
rc=0
for p in "$@"; do
  full="$root/${p%/}"
  if [ -d "$full" ]; then
    if [ -z "$(find "$full" -type f -print 2>/dev/null)" ]; then
      echo "ERROR: declared artifact path '$p' is empty (no files under $full)" >&2
      rc=1
    fi
  elif [ -s "$full" ]; then
    :
  else
    echo "ERROR: declared artifact path '$p' does not exist or is empty ($full)" >&2
    echo "       The upload step would upload nothing and still mark this job successful." >&2
    rc=1
  fi
done
exit "$rc"
