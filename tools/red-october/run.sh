#!/usr/bin/env bash
# The whole refresh, in the only order that works: ig_merge writes the live
# link alerts back into D-new.json, so build.py must run before it, never after.
set -euo pipefail
cd "$(dirname "$0")"
export PYTHONPATH=.
DAY="${1:-2026-10-27}"

echo "=== money through $DAY ==="
python3 build.py "$DAY"
echo
echo "=== instagram ==="
python3 ig_merge.py | head -16
echo
echo "=== asks ==="
python3 asks.py | head -20
echo
echo "=== page ==="
python3 patch.py
node --check <(python3 - <<'PY'
import re
h=open('red-october.html',encoding='utf8').read()
print(re.findall(r'<script>(.*?)</script>', h, re.S)[0])
PY
) && echo "javascript parses"
