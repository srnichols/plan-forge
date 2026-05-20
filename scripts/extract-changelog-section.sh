#!/usr/bin/env bash
# Extract a single version's CHANGELOG section as raw markdown
# Usage: bash scripts/extract-changelog-section.sh 3.9.2
#        bash scripts/extract-changelog-section.sh 3.9.2 path/to/CHANGELOG.md
set -uo pipefail

VERSION="${1:-}"
CHANGELOG_PATH="${2:-CHANGELOG.md}"

if [[ -z "$VERSION" ]]; then
    echo "Usage: $0 <version> [changelog-path]" >&2
    exit 1
fi

if [[ ! -f "$CHANGELOG_PATH" ]]; then
    echo "Error: $CHANGELOG_PATH not found" >&2
    exit 1
fi

# Find the start line (1-based)
START_LINE=$(grep -n "^## \[$VERSION\]" "$CHANGELOG_PATH" | head -1 | cut -d: -f1)
if [[ -z "$START_LINE" ]]; then
    echo "Error: No CHANGELOG section for $VERSION" >&2
    exit 1
fi

TOTAL_LINES=$(wc -l < "$CHANGELOG_PATH")

# Find the next "## [" header after the start
END_LINE=$(awk "NR > $START_LINE && /^\#\# \[/ { print NR; exit }" "$CHANGELOG_PATH")
if [[ -z "$END_LINE" ]]; then
    END_LINE=$((TOTAL_LINES + 1))
fi

# Print from line after the header up to (but not including) the next header, strip trailing newlines
awk "NR > $START_LINE && NR < $END_LINE" "$CHANGELOG_PATH" | sed 's/[[:space:]]*$//' | awk '
    BEGIN { last_nonempty = "" }
    { lines[NR] = $0; if ($0 != "") last_nonempty = NR }
    END { for (i = 1; i <= last_nonempty; i++) print lines[i] }
'
