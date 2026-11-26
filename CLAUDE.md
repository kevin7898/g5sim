# CLAUDE.md

Context for Claude Code working in this repo. Read `NOTES.md` first for status and open questions.

## What this is

A G5 Universal-style display for **Farming Simulator 25 modding** (not real-world CAN work). The FS25
mod writes telemetry to a file, a Node bridge streams it to a browser or iPad, and taps go back as commands.

## Rules for this project

- **FS25 Lua:** follow [fs25-claude-skill](https://github.com/TheCodingDad-TisonK/fs25-claude-skill).
  - Look up APIs; don't guess them.
  - Lua 5.1: no `goto`, no `os.*` (use `g_currentMission.time`), no `table.move`.
  - modDesc `descVersion` must be 90–111.
  - Nil-check and `pcall` anything that touches a vehicle specialization.
- **The look must match the real G5.** When adding or changing a screen, check it against the real G5 in
  the Deere Display Simulator (see "Design reference" in NOTES.md), not against text descriptions.
  Use the palette in `G5Link/app/style.css` `:root`.
- **Sizes come from tokens.** Font sizes and control heights use the `:root` tokens in `G5Link/app/style.css`
  (`--fs-xs` 13 … `--fs-val` 46, `--h-sm` 44 / `--h-md` 50 / `--h-lg` 58) and `app/ops/ops.css`; no raw px font
  sizes. Nothing tappable on the display below `--h-sm`. Window actions sit bottom-right; windows show a loading
  line instead of opening empty.
- **Don't commit Deere screenshots, logos or artwork.** Icons in the app are original line drawings.
- **Tests:** run `G5Link/tests/run.sh` after any mod change. When the mod calls a new game or mod API, add it to the
  mocks in `tests/mod_smoke.lua` with a check, so a typo or a nil/NaN shows up before FS25 does.
- **Bridge:** keep it dependency-free (Node 18+ only).
- **Display:** designed on a 1280×720 canvas (16:9, the G5 frame ×4/3), scaled to fit. Menu > System > Screen Fit
  "Fill Screen" stretches the height (up to 1280×1024) or the width (up to 1706×720) to the screen, so pages must
  grow from grid/flex rows rather than fixed pixel heights. Check new pages at 1280×720 and 1024×768.

## Run and test

```bash
node G5Link/bridge/g5link-bridge.js --demo          # fake tractor + planter, every key works
node G5Link/bridge/g5link-bridge.js --demo combine  # fake combine with Realistic Harvesting data
node G5Link/bridge/g5link-bridge.js --demo tillage  # fake tractor + cultivator (Cultivator Settings, Realistic Tillage)
node G5Link/bridge/g5link-bridge.js --demo --demo-speed 8  # demo 8x faster, to fill maps quickly
node G5Link/bridge/g5link-bridge.js --dir <folder>  # read a real modSettings/FS25_G5Link folder
LUA=<lua5.1> LUAC=<luac5.1> sh G5Link/tests/run.sh   # Lua syntax + mocked-engine smoke test + bridge parse
python3 G5Link/tools/package.py                     # rebuild dist/ zips after changes
python3 G5Link/tools/make_icon.py                   # regenerate mod icon.dds
```

`.claude/launch.json` has a `g5link-demo` preview config on port 8765. Test the display at a
1280×720 viewport.

- **Other mods:** read their public API source before hooking in; only call it if it exists, pcall every call.
- **G5Link API:** `mod/FS25_G5Link/API.md` is the contract for other mods (version 1.0.0). Keep it in step with `scripts/Api.lua`; bump the major version for breaking changes.
- **G5Link API:** `mod/FS25_G5Link/API.md` is the contract for other mods (version 1.0.0). Keep it in step with `scripts/Api.lua`; bump the major version for breaking changes.
  Realistic Harvesting notes are in NOTES.md.

## Layout

- `G5Link/mod/FS25_G5Link/`: modDesc.xml, scripts/G5Link.lua, scripts/Controls.lua (shortcut controls, harvest automation, tillage), scripts/Headland.lua (headland automation), scripts/GrainCart.lua (Courseplay Grain Cart add-on), scripts/Rtk.lua (RTK package), scripts/Steering.lua (AutoTrac, Turn Automation, Resume key), scripts/Api.lua (public API, documented in API.md), scripts/Rtk.lua (RTK package), scripts/Api.lua (public API, documented in API.md), scripts/Json.lua, scripts/providers/ (FieldPath adapters), icon.dds
- `G5Link/bridge/`: g5link-bridge.js, coverage.js (map recording), fields.js (Ops Center fields and records), headland.js (headland files for the mod),
  start-bridge.bat, start-demo.bat
- `G5Link/app/`: index.html, style.css, app.js (pages, windows, commands, units), layers.js (map layers, legend,
  Select Map View), boundary.js (Boundary app), guidance.js (Guidance page and map drawing), headland.js (Headland Management), graincart.js (Grain Cart remote), starfire.js (StarFire / RTK), starfire.js (StarFire / RTK), shared.js (settings,
  units; also used by the Ops Center), ops/ (Ops Center web app at /ops/)
- `G5Link/tools/`: package.py, make_icon.py
- `research/`: Deere help-center study notes, page index, simulator exploration log
