#!/bin/sh
# Runs the G5Link mod tests: Lua 5.1 syntax check, mocked-engine smoke test, bridge parse check.
#   LUA=/path/to/lua5.1 LUAC=/path/to/luac5.1 sh G5Link/tests/run.sh
# Build Lua 5.1.5 if you have none: curl -O https://www.lua.org/ftp/lua-5.1.5.tar.gz,
# tar xzf it, then `make macosx` (or `make linux` / `make mingw`); the binaries are in src/.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
MOD="$HERE/../mod/FS25_G5Link"
LUA="${LUA:-lua5.1}"
LUAC="${LUAC:-luac5.1}"
OUT="${OUT:-${TMPDIR:-/tmp}/g5link-test}"
rm -rf "$OUT"; mkdir -p "$OUT"

echo "== syntax (luac -p, Lua 5.1)"
find "$MOD/scripts" -name '*.lua' | while read -r f; do "$LUAC" -p "$f"; echo "ok  ${f#$MOD/}"; done

echo "== banned in FS25 (os.*, io.*, goto, table.move, require, loadstring, dofile)"
if find "$MOD/scripts" -name '*.lua' -exec grep -nHE '\bos\.|\bio\.|\bgoto\b|table\.move|\brequire\(|\bloadstring\b|\bdofile\b' {} +; then
  echo "found banned calls"; exit 1
fi
echo "none"

echo "== smoke test (mocked engine)"
"$LUA" "$HERE/mod_smoke.lua" "$MOD" "$OUT"

echo "== bridge reads the output"
node "$HERE/check_output.js" "$OUT"
echo "all passed"
