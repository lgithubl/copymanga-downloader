#!/usr/bin/env bash
set -u

ROOT="${1:-/data/downloads}"
BROKEN=0
CHECKED=0

if [ ! -d "$ROOT" ]; then
  echo "Download directory does not exist: $ROOT" >&2
  exit 2
fi

file_size() {
  stat -c%s "$1" 2>/dev/null || stat -f%z "$1"
}

check_signature() {
  local file="$1"
  local ext="${file##*.}"
  local sig
  sig="$(xxd -p -l 12 "$file" 2>/dev/null || true)"

  case "$ext" in
    webp|WEBP)
      echo "$sig" | grep -Eiq '^52494646[0-9a-f]{8}57454250'
      ;;
    jpg|JPG|jpeg|JPEG)
      echo "$sig" | grep -Eiq '^ffd8ff'
      ;;
    png|PNG)
      echo "$sig" | grep -Eiq '^89504e470d0a1a0a'
      ;;
    gif|GIF)
      echo "$sig" | grep -Eiq '^474946383761|^474946383961'
      ;;
    *)
      return 0
      ;;
  esac
}

has_identify=0
if command -v identify >/dev/null 2>&1; then
  has_identify=1
fi

echo "Scanning images under: $ROOT"
if [ "$has_identify" -eq 1 ]; then
  echo "Mode: decode validation with ImageMagick identify"
else
  echo "Mode: size and file signature validation"
fi

while IFS= read -r -d '' file; do
  CHECKED=$((CHECKED + 1))
  size="$(file_size "$file")"

  if [ "$size" -le 0 ]; then
    echo "ZERO $file"
    BROKEN=$((BROKEN + 1))
    continue
  fi

  if [ "$has_identify" -eq 1 ]; then
    if ! identify -quiet "$file" >/dev/null 2>&1; then
      echo "BROKEN $file"
      BROKEN=$((BROKEN + 1))
    fi
  elif ! check_signature "$file"; then
    echo "BAD_SIGNATURE $file"
    BROKEN=$((BROKEN + 1))
  fi
done < <(
  find "$ROOT" -type f \
    \( -iname '*.webp' -o -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' -o -iname '*.gif' \) \
    -print0
)

echo "Checked: $CHECKED"
echo "Broken: $BROKEN"

if [ "$BROKEN" -gt 0 ]; then
  exit 1
fi
