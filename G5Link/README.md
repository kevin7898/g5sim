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
| **Harvest Automation** | For combines: Speed Automation (the mod steps cruise speed toward Realistic Harvesting's recommended speed, 0.5 km/h per second, up to a max speed you set; without RH it holds about 95 % engine load), its state, RH's harvest-settings mode and efficiency, 5/15/30-minute trends of ground speed against target, engine load against target, throughput and grain loss (green bands show when automation was on), the grain tank with time to full and an auger key, and averages for the field |
| **Tillage** | For plows, cultivators, discs, rippers, power harrows, mulchers, rollers and weeders: speed, work rate, area, engine load, working depth, fuel rate and fuel per area. **TruSet-style depth**: a depth set point with − / + keys, a keypad and three editable presets (Seedbed, Secondary, Primary), plus Shallow / Normal / Deep. Cultivators with [Cultivator Settings](https://github.com/jason0611/FS25_CultivatorSettings) or the game's own work modes switch level by depth (up to 10 cm shallow, up to 22 cm normal, deeper is deep). With FieldPath Realistic Tillage the tool takes the exact depth, and the page warns when the tractor cannot pull it |
| **Planter** | With FieldPath Realistic Seeder: target and actual rate, singulation, skips, doubles (or distribution CV on drills), seed depth, established population, yield potential, a row-by-row rate chart, downforce and closing, soil moisture and compaction |
| **Field** | Soil under the machine from [Realistic Soil & Fertilizer](https://github.com/Realistic-Farming/FS25_SoilFertilizer): N, P and K with Good/Fair/Poor, pH, organic matter, compaction, yield potential, last crop, weed, pest and disease pressure, rotation. Ground from Mud System Physics: wheel slip, mud, tire pressure. AI driver from Courseplay or AutoDrive: state, progress, distance and turns left |

**Headland Management** (Menu > Headland, the HEADLAND key, or the chip on the Guidance map). When armed, the
implement lifts as its front edge reaches the headland, the speed changes if you set a headland speed, and after the
turn the implement drops and the work speed comes back. The headland is the band inside the field boundary
(a distance, or a number of passes times the implement width, with an override per field) and, like the G5,
**ground already worked** in this operation, so headland passes done first count. Lowering is automatic as the
implement leaves the headland, when steering is switched on (base game steering assist or Enhanced Vehicle track
steering), or either. Lead times allow for the hitch. Lifting by hand pauses it until you lower again. Without a
boundary or coverage it uses the steering assist line end or Enhanced Vehicle's headland distance.

**Shortcut keys follow the machine too.** On the *Automatic* bar the four free keys show what the machine has, in this
order: AutoTrac, Rate, Headland (implements that lift), Auto Speed (combines), Grain Cart, Auger, Fold, Work Lights,
Beacon, Hazard, Lights. They call the same game functions as the keyboard. Keys look like the G5's: a green strip with
white text when on, an LED and AUTO on keys with an automatic mode, the value on the Rate key, the AutoTrac pie on the
AUTOTRAC key, and gray keys that this machine can't use.

As in the G5 Field Guide, keys that switch something on or off have the status strip, and keys that open an app
(Setup, Guidance, Quick Line, Swap Track, Rate, Grain Cart, Help) have none. **Quick Line** makes a straight track along
the current heading; **Auto Turn** switches Turn Automation (its LED lights when on).

**Layout Manager** (Menu > Layout Manager): make your own shortcut bars. Duplicate the Automatic bar or start a new one,
Add Shortcut from each app (every key once, up to 12 plus MENU), move keys left or right, remove, rename, delete, and
choose which bar tractors and combines use. Extra keys there: Resume, Guidance, Swap Track, StarFire, Layout and Help
(what each key on the bar does).

**Run pages follow the machine.** Only the pages that fit what you are driving are offered: Harvesting
and Harvest Automation for a combine (instead of Tractor), Tillage with a tillage tool, Planter when a Realistic Seeder implement is attached, Implement
Details and Work Monitor with an implement, Field when soil, ground or AI-driver data exists.

**Every machine is recorded.** AI workers, Courseplay and AutoDrive machines and anything else of your farm that is
working are mapped too (G5Link writes them to fleet.xml twice a second), so yield maps, work records and Harvest
Profit include the fields you didn't drive yourself.

**Map layers.** The bridge records coverage from each implement's real work areas (section by section) and
saves it per savegame and operation in `modSettings/FS25_G5Link/maps/`. Tap the layers key on the map, or the
layer chip, for **Select Map View**: pick the operation (Harvest · Wheat, Seeding · Corn, ...), the primary layer
and the legend. Layers: Coverage (blue, dark blue = overlap), and as available Yield, Moisture, Grain Loss,
Seeding or Applied Rate, Singulation, Skips, Doubles, Distribution CV, Seed Depth, Soil Moisture, Compaction,
Yield Potential, Tillage Depth, Speed, and soil N, P, K and pH. Tillage maps are kept per tool (Tillage · Plow, Tillage · Disc, ...). **New Work** in the legend clears the map of that operation.

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
  harvested swath colored by its own profit per acre. Farm balance, loan and equity come from the game. With Farm
  Finance: credit score, the input account, and leases (cash rent, or the crop-share split) on each field.
- **Service** (Maintenance, after the Operations Center): Past Due, Due Soon, In the Workshop and Without a
  Maintenance Plan, from Advanced Damage System's service interval and workshop state. Machine condition stays
  hidden until inspected, as in that mod.
- **Equipment:** the farm's machines with status, field, fuel, hours and service.

**Data Sync and Work Setup.** Guidance tracks are kept in the bridge per savegame and field, so every display and
the Ops Center share them; the track list shows the current field's tracks first and picks up the last track used in
a field. Tracks made before Data Sync move over on first load. The **SETUP** key (or Menu > Applications > Work
Setup) sets client, farm, field (automatic or chosen), crop, variety and product. The variety names seeding maps and
records ("Seeding · Corn · P1197AM").

**Units.** Menu > System > Units: one key for all Metric or all US, and **Unit Settings** for each quantity
(speed, distance, area, liquid volume, yield and grain, seeding rate, pressure).

**Title bar:** run page name, game clock, link status (tap for the Status Center), and the
previous/next run page arrows. You can also swipe between pages.

**Shortcut bar:** Engine, Cruise, Lower/Raise (all), Turn On (all), Work, Setup, four machine keys, Display and Menu
(or your own bar, see Layout Manager).

**Menu:** Run Pages tab to jump to a page; Display tab for Metric / US units, Day / Night mode
and alert sounds.

Guidance is calculated on the iPad from the position the mod streams, so it is visual guidance with
a lightbar, like the G5's manual guidance. It doesn't steer the tractor. Tracks are saved on the iPad.

**Window shades** appear for low fuel or DEF, critical machine condition, lost connection,
a paused game, or when you're on foot.

"Sections" are the implement's work areas, so their count depends on how the vehicle mod is
built. Work totals are counted by G5Link itself while any work area is active, and reset
when you tap Reset Counter.

## RTK package (StarFire)

Every machine has a StarFire 6000 receiver running free **SF1**. Better corrections cost game money, like
Deere's licences: **SF2** and **SF3** subscriptions, **Mobile RTK** (cellular), **SF-RTK** (needs a StarFire
7000 upgrade), or the one-time **RTK** activation with your own **RTK station**, built from the construction
menu. Any RTK station placeable works (for example the John Deere RTK Stations pack); G5Link sets their shop
price and daily upkeep from its price list.

**Equipment check:** when a machine's mod offers GPS in the shop (its own StarFire 3000/6000/7000 choice with
or without RTK, Buyable GPS, realGPS, other brands), G5Link uses the option it was bought with: no receiver
means no corrections and no G5 GPS features, a StarFire 3000 runs SF2 at most. G5Link prices those shop options
from its list too, and the Ops Center RTK page lists machines that need attention.

The correction level changes what G5Link reports: with SF1 the position wanders about ±15 cm pass to pass, so
coverage maps show skips and overlaps, and headland lift points move; RTK holds about ±2.5 cm. The title bar
shows the level (SF1, SF3, RTK, RTK-X) like the G5. **RTK-X** keeps RTK accuracy for up to 14 game days after
leaving the station's 3 km radio range. Headland automation needs SF2 and the Grain Cart remote SF3 (switch
requirements off in StarFire if you prefer).

Manage it on the display (Menu > StarFire) or in the Ops Center (RTK). Subscriptions are charged each game
month under "GPS corrections". Other mods can read all of it and take over the billing through the G5Link
API: see `mod/FS25_G5Link/API.md`. With **Farm Finance** installed, it pays them for you: on the input
account or the operating line (or cash, your choice in Farm Finance), and machines you sell or return
from a lease stop billing.

## AutoTrac, Resume and Turn Automation (part of the RTK package)

With the **AutoTrac activation** (StarFire, $1,500 by default) G5Link steers the machine along the track you set on
the G5, onto the nearest pass, following Shift Track live. Status works like the G5's four-quarter pie:
**1/4 Installed** (activation and receiver), **2/4 Configured** (track set, no AI worker), **3/4 Enabled** (Steer ON)
and **4/4 Engaged**. Tap the AUTOTRAC key or the pie on the Guidance map for the **AutoTrac** window: Steer ON/OFF,
AutoTrac Diagnostics (each requirement), the Last Exit Code, Steering Sensitivity (50-200, default 70: higher steers
harder), Track Spacing by distance or rows × row width, and Shift Master. Engage with the **Resume** key: bind
*G5Link: AutoTrac Resume* in the game's controls (Alt+R by default) to any key, joystick or wheel button, or tap Resume
in the window. As on the G5 it engages only within 80° of the track and within 40% of the track spacing of a pass, and
above 0.5 km/h; it lets go when you steer by hand, turn Steer OFF, stop for 3 s or reverse for 45 s. While engaged the
track can't change and shifts are limited to 12 in (0.3 m). AutoTrac steers the position the receiver reports, so SF1
drift shows up as real skips and overlaps, and RTK holds the line.

The Guidance page shows Track Spacing as the G5 does ("60.000ft"), the track number and direction under the heading
("5S", "0" on Track 0), and "---" with no track. Swap Track (key or AutoTrac window) steps to the next track in the field.

**Turn Automation** (Menu > Headland > Turn Automation): at the headland, once headland automation has lifted the
implement, AutoTrac turns onto the next pass (a half circle, or a bulb turn when the passes are closer than twice the
turning radius), then headland automation lowers and the work speed comes back. Set passes to skip, the direction
(alternate, left, right) and the radius (Auto uses the machine's own).

## Prescriptions, rate control and field reports

**Ops Center > Field > Prescriptions:** build a variable-rate prescription from any recorded layer (yield, soil N, P, K,
pH, compaction, moisture...), split into 3 to 5 zones, with a rate multiplier per zone. Put one **in use** and sprayers
and spreaders follow it zone by zone through whichever soil mod you play with: **Precision Farming** (its set level times
the multiplier) or **Realistic Soil & Fertilizer** (the nearest rate step). Without a prescription, the G5's **Rate
Controller** (the RATE key) switches the soil mod's own Auto rate on or off and steps the manual rate.

**Field Report** (on each field) opens a printable page (Print / Save as PDF) with the work records, prescriptions and
tracks, and a CSV download of the records.

## Works with other mods

Everything is optional. G5Link checks for each mod and only uses it when it is installed.

| Mod | Adds |
|---|---|
| [Realistic Harvesting](https://github.com/exekx/FS25_RealisticHarvesting) | Yield, moisture, grain loss, harvest settings, Harvest Automation targets |
| FieldPath Realistic Seeder | Seeding rate, skips, doubles, singulation, soil moisture (Planter page, map layers) |
| [Realistic Soil & Fertilizer](https://github.com/Realistic-Farming/FS25_SoilFertilizer) | Soil N, P, K, pH (Field page, map layers) |
| Advanced Damage System, Farm Finance | Service and finances in the Ops Center |
| Courseplay, AutoDrive | AI driver state, Courseplay course on the map |
| Enhanced Vehicle | Track steering as a headland source and "lower on steering engage" |
| [Cultivator Settings](https://github.com/jason0611/FS25_CultivatorSettings) | Shallow / Normal / Deep from the Tillage page |
| **Recommended:** [Courseplay Grain Cart](https://mmp-farms.itch.io/grain-cart-remote-cp) (MMP Farms, needs Courseplay) | **Grain Cart** remote on the display: call the cart, pause, release, send it to unload, move it out of the way, and nudge it forward, back, left and right under the pipe. On the Guidance map the cart shows as a marker, and floating keys above the map legend (tap the header to fold them away) keep Call, Pause, Unload, Away and the nudges one tap away without covering the map. More opens the full window |

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

For the best fit, open Menu > System: **Screen Fit > Fill Screen** uses the whole iPad screen (no black bars),
and **Full Screen** hides Safari's bars. For a true full-screen app, tap Share > **Add to Home Screen** and open
G5Link from the Home Screen.

1. Join the same Wi-Fi as the PC.
2. In Safari, open the address the bridge printed.
3. Tap Share, then **Add to Home Screen**. Launching from the home-screen icon runs it full
   screen with no browser bars. Use it in landscape.

## Try it without the game

Run `start-demo.bat` (or `node bridge/g5link-bridge.js --demo` on any computer) and open the
printed address. A simulated tractor and planter drive around, and every key works.

For a combine with Realistic Harvesting data, run `node bridge/g5link-bridge.js --demo combine`.
For a tractor and field cultivator with Cultivator Settings and Realistic Tillage depth, run `--demo tillage`.

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
mod/FS25_G5Link/   the FS25 mod (modDesc.xml, scripts/G5Link.lua, Controls.lua, Headland.lua, icon.dds)
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
