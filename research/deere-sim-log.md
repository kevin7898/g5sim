# John Deere Display Simulator: exploration log

Started 2026-11-25. Site: https://displaysimulator.deere.com (signed in through signin.johndeere.com).

## Session 1: Help Center

**Current page:** `https://displaysimulator.deere.com/onscreen_help/help_contents.php?language=English%23en&modelNo=tractor&versionNo=current`
- Title: "Display Help Center". It covers Gen 4 CommandCenter and 4640 Universal Display.
- Help version: DisplayOS Help 10.20.258-12 (2025-3), Planting Apps Help 10.3.50-1 (2024)
- Query params: `language`, `modelNo` (tractor), `versionNo` (current). Other machines are probably reachable by changing `modelNo`.
- 63 topics. The links have no `href`; jQuery handlers (jquery-1.11.1) open them.

**Topics:** Safety, Welcome, Display, Tractor Overview, Audio, AutoLoad, AutoTrac Guidance, AutoTrac Turn Automation, ExactRate, Calibrations, COM Port Settings, Controls Setup, Date and Time, Diagnostics Center, Display and Sound, Engine, Equipment Manager, ExactRate Tractor Tank, Fields and Boundaries, File Manager, Flags, Front Hitch, HVAC, Implement Profile, ISOBUS File Server, ISOBUS Tasks, AutoTrac TIM, Virtual Terminal, iTEC, Language and Units, Layout Manager, Lights, Machine Monitor, Machine Profile, Machine Sync, Maintenance and Calibrations, Mapping, Original GreenStar Monitor, Phone, PTO, Remote Display Access (RDA), Rear Hitch, Rinse System, SCV, Section Control, SeedStar Planter, SeedStar - Air Seeding, Settings Manager, Sharing, Software Manager, Liquid System, StarFire Receiver, Steering, Suspension, Tank System, Trailer Brake, Transmission, Users and Access, Video, Wireless Settings, Work Monitor, Work Setup, Work Totals

## Session 2: Help topics

### How topics load
- Each topic link looks like `<a name="tractor/current/en/<topic>/<topic>.htm" onclick="subTopic(this)">`.
- `subTopic()` loads that path into the `#iframeLoadPages` iframe and adds `&dir=<path>` to the URL with `pushState`. Each topic therefore has its own address, and that address is what "Copy Link" copies.
- Topic pages are static `.htm` files at `/onscreen_help/<model>/<version>/<lang>/<folder>/<folder>.htm`. Each one links to sub-pages in the same folder, and some link across folders with `../other/other.htm`.
- The model, version and language are also saved as cookies (`HelpModelNo`, `HelpVersionNo`, `SelectedLanguage`) for 30 days. The page then reloads once, driven by `selectedSetFlag`.
- Open question: which `modelNo` values exist besides `tractor`. A quick probe found `tractor/`, `cotton/` and `4640/` paths that answer 200. `combine`, `sprayer`, `gator`, `excavator` and others returned 404.

### Topic survey (all 63 load with status 200)
Sizes and counts are for the top-level page only. Some folder names differ from the display name.

| Topic | Folder | KB | Images | Sub-links | Main sections |
|---|---|---|---|---|---|
| Safety | 005_safety | 3 | 5 | 0 | Signal words, park safely, avoid backover |
| Welcome | 00_welcome | 6 | 9 | 1 | Contextual help, search, browse, alerts, languages, updating help |
| Display | 01_display | 10 | 5 | 25 | Gen4 / G5 / 4640 / G5 Universal / G5e displays, reboot procedures, status LED |
| Tractor Overview | 05_tractor_overview | 6 | 8 | 12 | Cab controls, transport, hydraulics, CommandARM |
| Audio | audio | 3 | 6 | 5 | Radio, USB, Bluetooth, aux |
| AutoLoad | auto_load | 7 | 11 | 8 | Scraper status, draft, run page modules |
| AutoTrac Guidance | autotrac_guidance | 7 | 1 | 9 | Manual guidance, AutoTrac (licensed), RowSense / Vision, implement lightbar, Reichhardt GREEN FIT |
| AutoTrac Turn Automation | autotrac_turn_automation | 16 | 18 | 18 | Requirements, settings, status, map controls, iTEC link |
| ExactRate | boom | 7 | 11 | 9 | Working width, section status, ExactApply, specific gravity |
| Calibrations | calibrations | 3 | 4 | 6 | Nozzle flow, flow meter, pressure sensor, solution pump |
| COM Port Settings | com_port_settings | 7 | 3 | 5 | Diagnostics |
| Controls Setup | controls_setup | 7 | 12 | 9 | ISO AUX, SCV levers, third-party devices |
| Date and Time | date_and_time | 2 | 1 | 2 | |
| Diagnostics Center | diagnostics_center | 4 | 1 | 12 | System diagnostics, CCD bus info, ISOBUS controllers |
| Display and Sound | display_and_sound | 6 | 9 | 8 | Brightness, sound, touch calibration, standby |
| Engine | engine | 16 | 25 | 14 | Set speeds 1/2, max engine speed, shortcut keys |
| Equipment Manager | equipment_manager | 25 | 32 | 28 | Machine and implement profiles, detection |
| ExactRate Tractor Tank | exactrate_tractor_tank | 4 | 3 | 1 | |
| Fields and Boundaries | fields | 8 | 8 | 10 | Boundaries, headlands, area |
| File Manager | file_manager | 5 | 6 | 6 | Data sync, import/export, USB license, factory reset |
| Flags | flags | 10 | 13 | 4 | Presets, categories |
| Front Hitch | front_hitch | 5 | 8 | 6 | Limits, drop/raise rate |
| HVAC | hvac | 5 | 8 | 7 | Auto climate, temp, fan |
| Implement Profile | implement_profiles | 5 | 1 | 14 | Detection for planter, air seeder, ISO, GRC |
| ISOBUS File Server | isobus_file_server | 2 | 2 | 0 | |
| ISOBUS Tasks | isobus_tasks | 7 | 13 | 6 | Task select, product info, totals |
| AutoTrac TIM | isobus_tim | 10 | 14 | 2 | Tractor Implement Management requirements, automation state, LEDs |
| Virtual Terminal | isobus_vt | 25 | 32 | 22 | Multiple VTs, ISOBUS conformance, troubleshooting |
| iTEC | itec | 3 | 3 | 6 | Sequences and assignments |
| Language and Units | language_and_units | 1 | 1 | 2 | |
| Layout Manager | layout_manager | 3 | 4 | 4 | Run page sets, shortcut bar, library |
| Lights | lights | 7 | 9 | 8 | Field light presets, hood/beltline |
| Machine Monitor | machine_monitor | 3 | 2 | 10 | Speed/power, pressure, temp, electrical, hours |
| Machine Profile | machine_profiles | 5 | 2 | 11 | Detection (none / other / Wirtgen / combine) |
| Machine Sync | machine_sync | 18 | 18 | 16 | Theory of operation, master, network, disengagement best practices |
| Maintenance and Calibrations | maintenance_monitor | 1 | 1 | 3 | Service checks, intervals |
| Mapping | mapping | 14 | 21 | 10 | Layers, gestures, split map, legend, AutoPath |
| Original GreenStar Monitor | original_greenstar | 2 | 2 | 0 | |
| Phone | phone | 7 | 14 | 4 | Bluetooth pairing, favorites |
| PTO | pto | 11 | 11 | 8 | Operation, out-of-seat, cruise, external switches |
| Remote Display Access | rda | 6 | 7 | 0 | RDA / RDC |
| Rear Hitch | rear_hitch | 6 | 11 | 10 | Limits, rates, load depth, slip |
| Rinse System | rinse_system | 6 | 10 | 1 | |
| SCV | scv | 10 | 18 | 8 | Standard / independent / feature modes, flow assist |
| Section Control | section_control | 13 | 18 | 11 | Theory, headland, manual, multiple displays |
| SeedStar Planter | seedstar | 13 | 15 | 16 | Meter diagnostics, target rate, calibrations |
| SeedStar - Air Seeding | seedstar_air_seeding | 9 | 13 | 11 | Target rates, section status, setup |
| Settings Manager | settings_manager | 3 | 4 | 4 | Config edit, save, load |
| Sharing | sharing | 7 | 3 | 7 | Position / guidance / coverage sharing requirements |
| Software Manager | software_manager | 2 | 1 | 6 | Installs, SAR, activations, licenses |
| Liquid System | spray_system | 6 | 8 | 5 | Rx target rate, pressure relief |
| StarFire Receiver | starfire_receiver | 3 | 1 | 11 | TCM calibration, setup, activations |
| Steering | steering | 8 | 9 | 8 | ACS 2 variable ratio, sensitivity, reactive steering |
| Suspension | suspension | 5 | 6 | 3 | |
| Tank System | tank_system | 5 | 9 | 2 | |
| Trailer Brake | trailer_brake | 4 | 5 | 4 | Gain, pre-brake offset, test |
| Transmission | transmission | **42** | **63** | **58** | IVT/EVT, CommandPRO, 16-speed PST (the largest topic) |
| Users and Access | users_access | 2 | 1 | 3 | Profiles, access groups, theft protection |
| Video | video_gen4os | 20 | 20 | 4 | 4600/4640, 4200/4240, G5 video controls |
| Wireless Settings | wireless_settings | 5 | 7 | 3 | Machine to wireless, mobile to machine |
| Work Monitor | work_monitor | 3 | 4 | 3 | Values, recording |
| Work Setup | work_setup | 11 | 14 | 18 | Location, equipment, AutoPath recording |
| Work Totals | work_totals | 6 | 7 | 8 | Field / shared / load totals |

The topic now open in the pane is **AutoTrac Guidance**.

## Session 3: AutoTrac Guidance deep dive

Crawled every page linked from `autotrac_guidance/autotrac_guidance.htm` inside the same folder: **87 pages**, all status 200.
- Each page calls `importTOC("../00_welcome/files/guidance.toc")`. That TOC file is XML (`<map type="toc"><book><page navtitle href>`) with only 3 entries. It also lists `autotrac_guidance_access.htm`, which no page links to.
- The TOC hrefs point at `../contents/en/...` rather than `tractor/current/en/...`, which suggests the same help bundle is built for several machines.
- Pages it links to in other topics: layout_manager, layout_manager_add_shortcut, diagnostics_center_system_diagnostics_autotrac_health, machine_sync, mapping, starfire_receiver, gps_receiver_dynamic_tcm, equipment_manager, sharing, fields, implement_profiles_work_recording and dimensions_center_of_rotation.

### Page map, grouped by area (file prefix `guidance_` dropped)
- **Overview:** autotrac_guidance, application_main_page, rowsense_overview, implement_lightbar
- **Engage / disengage:** information_and_settings_autotrac_on_off, reactivating_autotrac, deactivating_autotrac, resume_button, autotrac_diagnostics
- **Speed limits:** min_and_max_speeds, plus one page each for Integrated AutoTrac, ATU 300 / ATC 300, ATU 200 and ATC-Raven
- **Track types:** select_guidance_method, plus straight, adaptive curve, AB curve, circle, boundary fill and AutoPath. Each type has a matching `create_track_*` page, plus quick_line and machine_access patterns.
- **Track management:** track_list, sorting_and_filtering, track_number_and_direction, track_spacing, swap_track, new/edit/add track sets, edit_guidance_track, circle edge
- **AutoPath:** select_guidance_method_autopath, autopath_setup (the longest page, about 1,000 words, covering source operations for planting, tillage, application and harvest), plus edit_autopath with select data, headland, align to boundary or existing track, and corner type. There are also autopath map and settings pages.
- **Information & Settings:** shift_track, track_selection, guidance_master, shared_signal, lightbar, curve_track, circle_track, implement_guidance, rowsense, tram_line, general_settings (tracking tones), turn_predictor
- **Steering optimization:** optimization, monitor_performance (tracking and heading error meters), forward_steer_adjustments, implement_steering, isobus_tim, restore_defaults. Separate pages cover line sensitivity (tracking and heading), acquire sensitivity, steering response rate and steering sensitivity.
- **Troubleshooting:** steering_optimization_troubleshooting, general_tuning, excessive wheel motion, aggressive and lazy S-ing, aggressive and lazy line acquisition, tracking inside or outside a curve
- **RowSense / Vision:** rowsense, rowsense_status, sensor settings and calibration, rowsense_calibration, vision_calibration, a 7-step Vision calibration procedure, row dropout

### Key concepts (my summary)
- **Feature tiers:** manual guidance (lightbar, included), AutoTrac (activation or license), RowSense / Vision (activation or license), and implement guidance.
- **AutoTrac status pie:** four stages.
  1. *Installed:* the steering control unit is detected, the license is present and secure authorization is done where the machine has it.
  2. *Configured:* Guidance Master is on, Track 0 is defined, StarFire signal is present, the steering control unit has no faults, speed is in range, a valid **TCM** (terrain compensation) message is present and the machine is in the right gear.
  3. *Enabled:* the Steer ON toggle is on.
  4. *Engaged:* the operator pressed Resume.

  A **Last Exit Code** explains why AutoTrac disengaged or won't engage.
- **Re-engage conditions:** heading within 80° of the track, within 40% of track spacing, operator seated, TCM on, and speed under the limit. In reverse, AutoTrac stays engaged for up to 45 seconds on most machines.
- **Integrated AutoTrac speed limits (forward high / low):**
  - 6R/7R/8R tractors: wheel 36 km/h, track 31 km/h, low 0.5 km/h
  - Articulated tractors: 31 km/h, low 1 km/h
  - Sprayers: 40 km/h
  - Combines and SPFH: 22 km/h
  - Windrowers: 28 km/h
  - Cotton harvesters: 15 km/h
  - XUVs: 30 km/h
  - Reverse: usually 10 km/h (5 km/h for cotton)
  - Newer 7R/8R serial ranges have no time limit in reverse
- **CAN-relevant terms:** steering control unit, TCM message, StarFire position, ISOBUS TIM, and ATU 200 / 300 / ATC aftermarket controllers (including Raven).

## App architecture (from network traffic)

- Front end: `/agriculture/`, using jQuery 1.9.1 and 1.11.1, Bootstrap, moment, JSZip and FileSaver
- `config.json`: html_version **3.58.2**, environment **PROD**, last updated 2026-10-08
- `stomp.js` and `pool_manager.js`: the simulator talks over **STOMP** (a messaging protocol, probably over WebSocket) to a pool of simulator instances
- Translations: `/agriculture/xml/ts/display_simulator_en.xml`
- Analytics: Adobe Launch (`_satellite`) and the OneTrust consent manager.

### REST API: `/simulator-interface/`

| Endpoint | Method | Result |
|---|---|---|
| `userType` | GET | `show-limited-access-products: false`, `show-development-access-products: false`, `show-training-access-products: false` (regular account tier) |
| `machines` | GET | Combine, Cotton Harvester, Nutrient Applicator/Floater, ProGator Utility Vehicle, Self-Propelled Forage Harvester, Sprayer, Sugar Cane Harvester, Tractor, Excavator |
| `implements` | GET | None, Baler, Manure Constituent Sensing, Planter, Rate Controller, Seeder, Tillage, Sprayer |
| `displays?machine=Tractor&implement=None` | GET | 4600 CommandCenter, 4640 Universal, G5 CommandCenter, G5 Universal, Corner Post, GS3 2630, GS3 CommandCenter, GS2 1800, Original GreenStar |
| `displays?machine=Tractor&implement=Planter` | GET | 4640 Universal, G5 Universal, GS3 2630, GS2 1800, Original GreenStar |
| `models` | POST | model list for a machine and display (body not captured) |
| `options` | POST | config options (body not captured) |
| `pool` | POST | checks the availability of a simulator instance (body not captured) |

The machine/implement/display picker already fetched G5_CommandCenter.png and G5_Universal.png, then Tractor + Planter.

### STOMP message templates (`servercommands.json`)
- `start-simulation` → `replyTo: queue://CLIENT`. The payload carries machine (model, transmission, machine_controller_simulation, command_arm_simulation, header, yield, moisture, bin_type), implement (seed_star, fertilizer_type, rate_controller, exact_rate), display (name, machine_sync, display_size, extended_monitor, software_version) and GPS (spacing, lat 40.591294 / lon -90.60378, which is near Moline IL, StarFire 6000). It also includes guidance (lightbar, AutoTrac), units, language, `run_mode: web` and `client_type: browser`.
- `stop-simulation`
- Keepalive: `{ "message": "PING" }`
- Errors are reported with `serviceName: html5-simulator`

## Console
- Two 404s, both for `/html5/xml/html/footer.html` (harmless, the help page's footer is missing)
- OneTrust and Adobe consent logging; nothing else notable

## Session 4: Full crawl
- All 944 pages in the tractor help bundle were crawled through the browser (fetch + DOMParser, about 11 s) and cached in sessionStorage.
- The page **blocks connections to localhost** (POST to 127.0.0.1 failed), so the data came back to disk through oversized tool results instead.
- Outputs:
  - `deere-help-index.md`: every page with title and word count.
  - `deere-help-notes.md`: condensed study notes, 12 batches. ★ marks the CAN / diagnostics material.
- Batches 1–11 were read in full (after removing sentences that repeat across pages). Batch 12 (SeedStar planter, 33k words) was read through a fact filter for numbers, requirements and diagnostics, so not every word.

## Session 5: G5 CommandCenter, tractor screens (2026-11-25)

Simulator: Tractor + G5 CommandCenter. Full-resolution 960×540 frames were captured for reference and
kept locally only (they are Deere's UI). This section describes what's on each screen.

### Default Tractor Run Page (the CommandCenter home)
A dense grid of small modules, each with a dark title strip:
- **Readings**: Counters A / Machine, 2×2 (fuel rate gal/h, engine hours, fuel per area gal/ac, engine load %)
- **Rear Hitch**: an icon plus 51% and a vertical 0–100 gauge with a position pointer and a set-point marker
- **SCV I–VI**: color-coded Roman-numeral headers (I green, II blue, III brown, IV black, V purple, VI gray), a vertical flow gauge and a timer (0s)
- **Front Hitch**: 50%, same gauge style
- **Mini guidance map** with a lightbar
- **Rear PTO**: rpm
- **Transmission**: max speed 33.5 MPH, cruise 2 12.4 and cruise 1 6.2; an orange LED marks the active one
- **Engine Power**: a power bar and 500.0 h; **Max Eng Speed** 1900 with an LED button
- **SCV XIV–XV**
- **PTO Gear**: 1000
- **Counters A Avg**: area rate ac/h
- **Shortcut bar**: SETUP, WORK (AUTO), AUTOTRAC, GUIDANCE, ISOBUS VT, FLAGS, PTO, ENGINE, TRANS, SCV, HITCH, CONTROLS, MENU

### App windows opened from the shortcut keys
All use the same window: dark olive header with a white title, ? and ⓘ icons, and a yellow ✕ key;
cream sections with gray centered headers; segmented ON/OFF toggles (dark = selected); LED dots on buttons.
- **PTO**: Front PTO rpm, Rear PTO rpm, Rear PTO Cruise (1000, ON/OFF), PTO Remote (ON/OFF), PTO Out-of-Seat (LED + OFF), Rear PTO Gear (1000 / 1000E selector)
- **Engine**: Max Engine Speed key + LED (1900 n/min), Engine Set Speeds 1 and 2 (1400 and 1600) keys + LEDs, Front/Rear PTO readouts and PTO Cruise, Exhaust Filter Cleaning (AUTO, plus a P key), Engine Power bar + hours
- **Transmission**: Mode as a stacked selector (Full AUTO / Custom / Manual, dark = selected), Custom Settings key, Set Speeds (Maximum 33.5; Cruise Speed 2 and 1 with LEDs), Shuttle Shift Speeds forward/reverse (grayed), Start Gear forward 8/12 selector and reverse 3
- **SCV**: left tabs I–IV / V–VI / XIV–XV (yellow arrow tab); per SCV a colored header, flow value 5.00 with a vertical gauge, and a timer 0s
- **Rear Hitch**: Hitch Position gauge 51% (pointer + set point); Raise Rate and Drop Rate vertical sliders (hare/tortoise, yellow pointer, 3.0); Upper Limit slider Max/Min 100%; Load Depth and Slip Sensitivity horizontal OFF–5 scales with a yellow pointer (0.0)
- **Controls**: icon tabs (joystick, armrest, button grid); a joystick picture with callout boxes per button (A1 rear hitch, A2 front hitch, A3 AUTO, Resume) with LEDs; footer keys Activate Custom, ISO Aux, Defaults, Save/Load

### CommandCenter Menu
- **Machine Settings**: Central Tire Inflation System, Controls, Engine, Front Hitch, Lights, Maintenance & Calibrations, PTO, Rear Hitch, SCV, Steering, Suspension, Transmission. White tiles with a yellow-and-green stripe.
- **System**: COM Port Settings, Diagnostics Center, Display Settings, File Manager, Software Manager, Users & Access, Wireless Settings. These use **khaki rounded tiles with no stripe**, a different style from the application tiles.

### Which of this FS25 can feed (for a later decision)
- Available or likely: engine rpm, max rpm, load, fuel rate (derived), engine hours, speed, cruise speed and max, gear/direction, PTO on/off (turned on), implement lowered state, attached implement list, work width
- Not simulated in FS25: SCV flow and timers, hitch rate/limit/load depth/slip settings, PTO gear and remote, exhaust filter state, start gears. These would be display-only placeholders, or would map to implement state per attacher joint.
