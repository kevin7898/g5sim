# G5Link: a G5-style display for Farming Simulator 25 on your iPad

G5Link shows live data from the tractor you are driving in FS25 on a tablet next to you,
styled after the G5 Universal Display (16:9, Day and Night modes): run pages built from
modules, a status center in the title bar, a shortcut bar, app windows and window-shade alerts. Tapping keys on the tablet controls the game (engine, cruise control,
lower/raise, turn on).

```
FS25 on Windows PC                      same PC                      iPad (Safari)
FS25_G5Link mod  -- telemetry.xml -->   G5Link bridge (Node.js) -- live stream -->  G5 display
                 <-- commands.xml --                             <-- taps -----
```

FS25 mods can't open network connections, so the mod and the bridge talk through two small
files in `Documents\My Games\FarmingSimulator2025\modSettings\FS25_G5Link\`.

## What's on the display

| Run page | Shows |
|---|---|
| **Guidance** | Perspective (or top-down) map with your straight guidance tracks, coverage, pass-direction arrows, the Courseplay course and field boundary, a Courseplay/AutoDrive status chip, and the tractor and implement; a lightbar with off-track error; heading and track number; Set Track (A + Heading or A + B), track spacing, Shift Track (center, left, right) and shift increment; farmland |
| **Tractor** | Ground speed, gear and direction, engine rpm gauge and load, fuel and DEF bars, cruise control with − / + keys, an ON/OFF switch and a keypad (tap the set speed), first implement (lowered, turned on, width, section bar), work totals, heading compass |
| **Work Monitor** | Area worked, time worked, instant and average productivity, average working speed, distance, fuel used, fuel per area, fuel per hour, plus a counter reset |
| **Implement Details** | Every attached implement: lowered and turned-on state, working width, section status, fill levels with bars, a Turn On/Off key |
| **Machine Monitor** | Engine speed and load, ground speed, gear, fuel and DEF, fuel per hour, time to empty, engine hours, condition, farmland, AI worker |
| **Harvesting** | For combines: grain tank level. With the [Realistic Harvesting](https://github.com/exekx/FS25_RealisticHarvesting) mod also yield, moisture and its limit, throughput, productivity, grain loss (total and by cause, with an A to D grade), engine load against target, RH's recommended speed, fuel rate, the harvest settings against RH's optimum band, and field totals |
| **Planter** | With FieldPath Realistic Seeder: target and actual rate, singulation, skips, doubles (or distribution CV on drills), seed depth, established population, yield potential, a row-by-row rate chart, downforce and closing, soil moisture and compaction |
| **Field** | Soil under the machine from [Realistic Soil & Fertilizer](https://github.com/Realistic-Farming/FS25_SoilFertilizer): N, P and K with Good/Fair/Poor, pH, organic matter, compaction, yield potential, last crop, weed, pest and disease pressure, rotation. Ground from Mud System Physics: wheel slip, mud, tire pressure. AI driver from Courseplay or AutoDrive: state, progress, distance and turns left |

**Run pages follow the machine.** Only the pages that fit what you are driving are offered: Harvesting
for a combine (instead of Tractor), Planter when a Realistic Seeder implement is attached, Implement
Details and Work Monitor with an implement, Field when soil, ground or AI-driver data exists.

**Map layers.** The bridge records coverage from each implement's real work areas (section by section) and
saves it per savegame and operation in `modSettings/FS25_G5Link/maps/`. Tap the layers key on the map, or the
layer chip, for **Select Map View**: pick the operation (Harvest · Wheat, Seeding · Corn, ...), the primary layer
and the legend. Layers: Coverage (blue, dark blue = overlap), and as available Yield, Moisture, Grain Loss,
Seeding or Applied Rate, Singulation, Skips, Doubles, Distribution CV, Seed Depth, Soil Moisture, Compaction,
Yield Potential, Speed, and soil N, P, K and pH. **New Work** in the legend clears the map of that operation.

**Operations Center.** Open `http://<PC address>:8765/ops/` on a laptop, iPad or phone (or Menu > Applications >
Ops Center on the display). Laid out like the real Operations Center:
- **Map:** fields colored by last work type (tillage, seeding, application, harvest), with Fields and Equipment tabs.
- **Land:** Client > Farm > Field with totals. Each field page has its boundaries (one active), work records and
  coverage layers. **+ Add Boundary:** From Map (draw it), From a previous operation (trace it from coverage, e.g.
  after working new ground), or drive the edge with the display's Boundary app (Menu > Applications > Boundary: left
  edge, center or right edge with an offset, any vehicle). Game-map import can be switched off per savegame.
- **Analyze:** work records across fields; coverage outside every field can become a new field.
- **Harvest Profit** (after harvestprofit.com): P&L per field and for the operation. Revenue is harvested tonnes
  (Realistic Harvesting yield x covered area) x the game's crop price, or your own price per crop. Expenses are seed
  (Realistic Seeder litres per hectare x the game's seed cost), fertilizer and chemical (applied litres x the game's
  product cost), machinery per acre by work type and land rent (both editable under Prices & Costs). Each field has a
  budget card (net, revenue, expenses, cost per bushel, market price, break-even yield) and a **Profit Map**: every
  harvested swath colored by its own profit per acre. Farm balance, loan and equity come from the game.
- **Service** (Maintenance, after the Operations Center): Past Due, Due Soon, In the Workshop and Without a
  Maintenance Plan, from Advanced Damage System's service interval and workshop state. Machine condition stays
  hidden until inspected, as in that mod.
- **Equipment:** the farm's machines with status, field, fuel, hours and service.

**Units.** Menu > System > Units: one key for all Metric or all US, and **Unit Settings** for each quantity
(speed, distance, area, liquid volume, yield and grain, seeding rate, pressure).

**Title bar:** run page name, game clock, link status (tap for the Status Center), and the
previous/next run page arrows. You can also swipe between pages.

**Shortcut bar:** Engine, Cruise, Lower/Raise (all), Turn On (all), Work, Display and Menu.

**Menu:** Run Pages tab to jump to a page; Display tab for Metric / US units, Day / Night mode
and alert sounds.

Guidance is calculated on the iPad from the position the mod streams, so it is visual guidance with
a lightbar, like the G5's manual guidance. It doesn't steer the tractor. Tracks are saved on the iPad.

**Window shades** appear for low fuel or DEF, critical machine condition, lost connection,
a paused game, or when you're on foot.

"Sections" are the implement's work areas, so their count depends on how the vehicle mod is
built. Work totals are counted by G5Link itself while any work area is active, and reset
when you tap Reset Counter.

## Setup on the Windows PC

1. **Install Node.js** (LTS) from https://nodejs.org. It's needed for the bridge.
2. **Install the mod:** copy `dist/FS25_G5Link.zip` into
   `Documents\My Games\FarmingSimulator2025\mods\`. Don't unzip it.
3. **Copy the bridge:** unzip `dist/G5Link-PC.zip` anywhere, for example your Desktop.
4. **Start the bridge:** double-click `G5Link\bridge\start-bridge.bat`. It prints an address
   such as `http://192.168.1.50:8765`. The first time, Windows Firewall asks about Node.js:
   allow it on **Private networks**.
5. **Start FS25**, activate **G5Link - Display Bridge** in the savegame's mod list, load the game
   and get in a vehicle.

## Setup on the iPad

1. Join the same Wi-Fi as the PC.
2. In Safari, open the address the bridge printed.
3. Tap Share, then **Add to Home Screen**. Launching from the home-screen icon runs it full
   screen with no browser bars. Use it in landscape.

## Try it without the game

Run `start-demo.bat` (or `node bridge/g5link-bridge.js --demo` on any computer) and open the
printed address. A simulated tractor and planter drive around, and every key works.

For a combine with Realistic Harvesting data, run `node bridge/g5link-bridge.js --demo combine`.

## Options

```
node g5link-bridge.js --port 9000           use a different port
node g5link-bridge.js --dir "D:\path\..."   custom modSettings\FS25_G5Link folder
```

## Troubleshooting

- **Status center says "Waiting":** the bridge hasn't seen `telemetry.xml` yet. Make sure
  the mod is active in the savegame and you're in the game, not the main menu. Check
  `log.txt` in the FS25 profile folder for a line starting with `G5Link`.
- **"Paused":** the game stopped writing data, for example in the pause menu or ESC screen.
- **iPad can't load the page:** check that both devices are on the same network, that the
  firewall allowed Node.js on Private networks, and that you're typing the PC's address, not
  `localhost`.
- **A key does nothing:** some vehicles don't support every command (for example, Turn On
  on a tractor with no powered implement). The key flashes yellow until the game confirms.

## Project layout

```
mod/FS25_G5Link/   the FS25 mod (modDesc.xml, scripts/G5Link.lua, icon.dds)
bridge/            g5link-bridge.js (Node, no dependencies) + .bat launchers
app/               the display web app (served by the bridge)
tools/             make_icon.py, package.py
dist/              built zips
```

Rebuild the zips after changes: `python3 tools/package.py`.

## Ideas for later

- A native iPad app (Swift) using the same bridge stream
- A mapping page with coverage drawn from vehicle position
- AutoTrac-style guidance (AB lines, status pie, lightbar)
- A corner post display page
