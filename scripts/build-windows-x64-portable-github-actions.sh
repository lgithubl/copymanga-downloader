#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

REPO="${GH_REPO:-lgithubl/copymanga-downloader}"
REF="${GH_REF:-windows-portable-build}"
WORKFLOW="${GH_WORKFLOW:-windows-portable.yml}"
ARTIFACT_NAME="${GH_ARTIFACT_NAME:-windows-x64-portable}"
OUT_DIR="${OUT_DIR:-artifacts/github-actions}"

find_gh() {
  if [[ -n "${GH_BIN:-}" ]]; then
    printf '%s\n' "$GH_BIN"
    return
  fi

  if command -v gh >/dev/null 2>&1; then
    command -v gh
    return
  fi

  local cached_gh="$ROOT_DIR/.cache/gh-bin/gh_2.100.0_macOS_amd64/bin/gh"
  if [[ -x "$cached_gh" ]]; then
    printf '%s\n' "$cached_gh"
    return
  fi

  echo "GitHub CLI not found. Install gh or set GH_BIN=/path/to/gh." >&2
  exit 1
}

GH="$(find_gh)"

"$GH" auth status --hostname github.com >/dev/null

echo "Triggering $WORKFLOW on $REPO@$REF ..."
"$GH" workflow run "$WORKFLOW" --repo "$REPO" --ref "$REF"

echo "Waiting for GitHub to create the run ..."
RUN_ID=""
for _ in {1..30}; do
  RUN_ID="$("$GH" run list \
    --repo "$REPO" \
    --workflow "$WORKFLOW" \
    --branch "$REF" \
    --event workflow_dispatch \
    --limit 1 \
    --json databaseId \
    --jq '.[0].databaseId // ""')"

  if [[ -n "$RUN_ID" ]]; then
    break
  fi
  sleep 2
done

if [[ -z "$RUN_ID" ]]; then
  echo "Could not find the triggered GitHub Actions run." >&2
  exit 1
fi

echo "Watching run $RUN_ID ..."
"$GH" run watch "$RUN_ID" --repo "$REPO" --exit-status

mkdir -p "$OUT_DIR"
echo "Downloading artifact $ARTIFACT_NAME to $OUT_DIR ..."
"$GH" run download "$RUN_ID" \
  --repo "$REPO" \
  --name "$ARTIFACT_NAME" \
  --dir "$OUT_DIR"

echo "Downloaded files:"
find "$OUT_DIR" -maxdepth 2 -type f -name '*windows_x64_portable*.zip' -print
