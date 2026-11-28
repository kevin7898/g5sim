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
if [ -z "$OUT" ]; then
  OUT=$(mktemp -d "${TMPDIR:-/tmp}/g5link-test.XXXXXX")
else
  mkdir "$OUT"
fi

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

echo "== coverage recorder"
node "$HERE/coverage_test.js"

echo "== Ops Center field store"
node "$HERE/fields_test.js"
echo "== work jobs and retained totals"
node "$HERE/jobs_test.js"
echo "== recorded machine replays"
node "$HERE/work_replay_test.js"
echo "== driven boundary recorder"
node "$HERE/boundary_test.js"
echo "== run page layout"
node "$HERE/run_page_test.js"
echo "== display update compatibility"
node "$HERE/display_update_test.js"
echo "== headland link"
node "$HERE/headland_test.js"
echo "== prescriptions"
node "$HERE/rx_test.js"
node "$HERE/demo_farm_test.js"
echo "all passed"
