#!/bin/sh
# Round-trip equivalence gate:  <src-dir with .rs>  →  rust2ttm  →  tatamuc  →  AST compare
# usage: ./verify-roundtrip.sh <rust-src-dir> [work-dir]
set -e
SRC="$1"
WORK="${2:-$(mktemp -d)}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$HERE/../.."

R2T="$WORK/tool"
node "$ROOT/transpiler/tatamuc.mjs" --project "$HERE/src-ttm" "$R2T" >/dev/null
cargo build --quiet --manifest-path "$R2T/Cargo.toml"
BIN="$R2T/target/debug/tool"

"$BIN" convert "$SRC" "$WORK/ttm"
node "$ROOT/transpiler/tatamuc.mjs" --project "$WORK/ttm" "$WORK/regen" >/dev/null

SIBS=$(ls "$SRC"/*.rs | xargs -n1 basename | sed 's/\.rs$//' | grep -v '^main$' | paste -sd, -)
FAIL=0
for f in "$SRC"/*.rs; do
  name=$(basename "$f")
  if ! "$BIN" compare "$f" "$WORK/regen/src/$name" "$SIBS"; then
    FAIL=1
  fi
done
if [ "$FAIL" = 0 ]; then
  echo "ROUND-TRIP OK: all files AST-equivalent"
else
  echo "ROUND-TRIP FAILED" >&2
  exit 1
fi
