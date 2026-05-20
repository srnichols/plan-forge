#!/usr/bin/env bash
# update-hero-refs.sh — Update chapter-hero image refs in docs/manual/*.html
# Converts .jpg refs to .webp and adds loading="lazy" decoding="async" attributes.
# Usage: bash scripts/update-hero-refs.sh
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

changed_files=()

for f in "$REPO_ROOT"/docs/manual/*.html; do
    [[ -f "$f" ]] || continue
    original=$(cat "$f")
    updated="$original"

    # Replace chapter-heroes/*.jpg with *.webp
    updated=$(echo "$updated" | sed 's|\(chapter-heroes/[A-Za-z0-9_-]*\)\.jpg|\1.webp|g')

    # Add loading="lazy" decoding="async" to chapter-hero img tags that don't already have them
    updated=$(echo "$updated" | sed 's|<img src="assets/chapter-heroes/[^"]*\.webp" alt="[^"]*"\( loading="lazy" decoding="async"\)\? class="chapter-hero" />|PLACEHOLDER|g')
    # Re-do with a proper sed replacement: add lazy/async before class= if not present
    # Use perl for reliable multi-attribute replacement
    if command -v perl >/dev/null 2>&1; then
        updated=$(echo "$updated" | perl -pe '
            s{(<img src="assets/chapter-heroes/[^"]+\.webp" alt="[^"]*")( class="chapter-hero" />)}{$1 loading="lazy" decoding="async"$2}g
        ')
        # Don't double-add: if already has loading="lazy" decoding="async"
        updated=$(echo "$updated" | perl -pe '
            s{loading="lazy" decoding="async" loading="lazy" decoding="async"}{loading="lazy" decoding="async"}g
        ')
    fi

    fname="$(basename "$f")"
    if [[ "$updated" != "$original" ]]; then
        printf '%s' "$updated" > "$f"
        changed_files+=("$fname")
    fi
done

echo "Files changed: ${#changed_files[@]}"
for f in "${changed_files[@]}"; do
    echo "  $f"
done

echo ""
echo "--- leftover chapter-heroes/*.jpg refs (should be 0) ---"
grep -rl 'chapter-heroes/[A-Za-z0-9_-]*\.jpg' "$REPO_ROOT/docs/manual/"*.html 2>/dev/null | wc -l | tr -d ' '

echo ""
echo "--- chapter-hero imgs total vs with lazy/async ---"
total=$(grep -c 'class="chapter-hero"' "$REPO_ROOT"/docs/manual/*.html 2>/dev/null | awk -F: '{sum += $2} END {print sum+0}')
lazy=$(grep -c 'loading="lazy" decoding="async" class="chapter-hero"' "$REPO_ROOT"/docs/manual/*.html 2>/dev/null | awk -F: '{sum += $2} END {print sum+0}')
echo "total:           $total"
echo "with lazy/async: $lazy"
