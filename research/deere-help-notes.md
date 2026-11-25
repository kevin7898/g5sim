# Deere Gen4 / G5 Tractor Help Center: study notes

These are my own condensed notes from crawling the whole tractor help bundle (`/onscreen_help/tractor/current/en/`) on 2026-11-25.

**Crawl results:**
- 944 pages, 937 loaded and 7 were dead links. About 196,000 words across 69 folders.
- Dead links: harvest_setup, 10_sugar_cane, transmission/Traction_Assist, dry_application_system, harvest_automation, diagnostic_center (typo for diagnostics_center), unused_files/...about.
- Some links point at an internal authoring server: `file://frxfileserv1/tech pubs/Help Text/Gen 4 Tractors B/en/...`, covering controls_setup advanced settings, transmission advanced settings, CommandPRO shuttle speeds and speed limits, and itec.

**Words per folder:**
| Folder | Pages | Words |
|---|---|---|
| seedstar | 142 | 33.5k |
| autotrac_guidance | 88 | 19.2k |
| 05_tractor_overview | 74 | 16.8k |
| transmission | 35 | 10.4k |
| seedstar_air_seeding | 53 | 9.9k |
| implement_profiles | 33 | 9.3k |
| machine_profiles | 32 | 8.1k |
| diagnostics_center | 51 | 7.6k |
| starfire_receiver | 38 | 6.5k |
| work_setup | 31 | 6.0k |
| everything else | | under 4k each |

---

## Batch 1: small and system topics

### Display hardware
- **Gen4 CommandCenter** has a separate processor plus a touchscreen on the CommandARM, in 8.4 in or 10 in sizes.
  - **4600 processor:** 4 analog video inputs, 4 USB, 2 display outputs.
  - **4200 processor:** 1 analog video input, 1 USB, 1 display output.
- **G5 CommandCenter processor:** 4 analog video inputs, digital video, 2 USB, 2 display outputs.
- **Universal displays** (4240, 4640, G5, G5Plus) are self-contained and move between machines. They use a **26-pin machine connector**, Ethernet, and video / extended-monitor ports. The 4640 also has built-in Wi-Fi and a status LED (green = ready, orange = booting, powering down or reprogramming).
- **G5e** is an implement-only display with a 12-pin connector.
- **Warm vs cold boot:**
  - Gen4: warm boot if keyed on within 24 h. Cold boot after more than 24 h off, after 20 warm boots, or when prompted (language change, adding a 2nd display).
  - G5: 48 h and 100 warm boots.
  - On the 4640, some implement control units need a key cycle; using the power button instead can cause communication problems.
- **Menu tabs:** Machine Settings, Applications, System.
- **Status Center** always shows date/time and data storage, plus GPS and notifications. Its VT button shows which VT is on which display (only when 2 displays are connected).

### Alerts taxonomy
An **Alert** is usually triggered by a **DTC** (diagnostic trouble code). There are three levels:
- **Information:** performance may degrade; monitor it.
- **Service:** action is needed to avoid damage.
- **Stop:** damage is occurring, a primary function is lost, or a legal stop is required.

Other message types are Message (prompts for a response), Safety Warning and Window Shade (a drop-down that auto-hides).

### COM ports (RS-232)
- There are 2 serial COM ports. An extra harness is needed.
- **Device types:**
  - **Field Doc Connect** (Raven etc.): 9600 baud, data-log trigger under 3 s.
  - **Serial GPS:** 19200 baud, 1 or 5 Hz (5 Hz is needed for manual guidance), NMEA sentences GGA, GSA and RMC, 8N1, no flow control. **AutoTrac does not work with third-party RS-232 GPS.**
  - Also N-Sensing, GreenSeeker, LH 5000, and grain cart scales (Digistar, Agromatics, J&M).
- **Diagnostics:** a port shows inactive if no message arrives for 10 s. Expected messages are GGA, GSA and RMC (GPS), AR (Field Doc), RC (GreenSeeker), D2 (N-sensor) and Weight (grain cart).

### Date/time, language, units
- GPS sets the date and time automatically; manual changes are only possible without GPS. The date is used for error logs, activations, licenses and data filtering.
- Language & Units has separate tabs for the Display and for ISOBUS VT. The display has an active and an alternate language with a Swap shortcut. Units are English, Mixed English or Metric. Changes need a reboot.

### Users & Access
- Two profiles: **Administrator** (Full Access group) and **Operator** (Limited Access group, where features can be locked per application).
- Locks only apply when Operator is active and the admin has a PIN. A separate Security PIN locks the whole display.

### Wireless
- **Machine to Wireless:** connects through the **MTG** (modular telematics gateway) or a USB Wi-Fi adapter, and the MTG takes priority.
  - MTG Wi-Fi uses 2.4 GHz, channels 1–11.
  - Used for OTA updates, remote diagnostics, RDA, online activations and Data Sync.
  - Security must be Open or WPA2-PSK. Passwords are 8–31 characters.
  - RDA isn't available over a USB adapter.
- **Mobile to Machine:** the MTG acts as a hotspot. The SSID defaults to the machine serial number, it is 2.4 GHz only on channels 1, 6 and 11, and it is used for Harvest Mobile.
- **RDA / RDC (remote display access / control):**
  - Started from JDLink.com or MyJohnDeere.com.
  - The video path is display → Ethernet → MTG → cellular → Deere network.
  - A blue screen outline means view only; yellow means remote control.

### Sharing (In-Field Data Sharing)
- Up to **6 operators** per work group.
- Coverage arrives in 30-second segments; member positions update every 6 s.
- A member counts as inactive after 10 minutes with no coverage.
- **Shared:** guidance lines, coverage and as-applied maps.
- **Requirements:**
  - Same Operations Center org, work ID, client, farm and field.
  - For coverage, also the same operation and crop/product, tank mix or Rx.
  - An MTG with a JDLink Connect subscription.
  - An In-Field Data Sharing activation (4600/4640) or license (G5).
  - SF2 correction or better recommended, since SF1 causes shifts.

### ISOBUS bits
- **ISOBUS File Server:** stores files exchanged between implement and tractor (config, fertilizer tables, language files). Only one display should run it.
- **AutoTrac TIM** (Tractor Implement Management): lets AutoTrac steer **AEF TIM-Guidance certified third-party tractors**.
  - Needs a 4240 or 4640, a StarFire receiver, AutoTrac and TIM activations, and a TIM harness.
  - Five states: Unavailable → Not Ready → Ready to Enable → Enabled → Active.
  - LEDs: Engaged, Assigned, Not Assigned, Disabled/Unavailable (no TIM server on the ISOBUS).
  - The diagnostics General tab covers client errors and the Server tab covers tractor-side errors.
- **Original GreenStar Monitor:** a legacy UI for control units built for the original GreenStar display.

### Settings Manager
Saves and loads named configurations of machine, implement and ISOBUS control-unit settings per application. Export and import through File Manager carry only the profile name, run pages, iTEC sequences and pull-type sprayer settings.

### Flags
- Three shapes: area, line and point. Entrance flags can only be points.
- Default categories are Rock, Weeds and Entrance.
- A flag is recorded at the work point if one is defined, otherwise under the GPS receiver.
- Up to 5 can record at once.
- Operations Center alerts sound 20 s and 10 s before a flag.

### Maintenance
- **Calibrations:** radar (John Deere dual-beam radar only) and wheel slip (needs a calibrated radar; drive unloaded on a hard, level surface).
- **Service checks:** engine oil and coolant level. Wait 40 minutes after shutdown.
- **Service intervals:** 1–9999 engine hours, with a warning 20 h before due.

### Tractor sub-systems (small apps)
- **Steering:**
  - ACS 2 variable ratio gives a quicker ratio below 20 km/h.
  - ACS 2 sensitivity has Low, Med (default) and High.
  - Wheel resistance ranges from −2 to +2 in steps of 0.1.
  - Reactive steering (7R non-ACS) returns the wheel to center. LEDs: green active, orange on but inactive, grey off, red fault.
  - 2-track manual steering sensitivity ranges 75–175 (default 100). Tread spacing is set in Advanced Settings and the steering control unit uses it.
- **Suspension (front axle, not on track models):**
  - AUTO is recommended for transport. MAX is for loader work and switches off above 30 km/h, then back on below 20 km/h.
  - Manual height is overridden above 5 km/h.
- **Front hitch:**
  - Upper limit (0% = full down, 100% = full up), drop and raise rate. A full drop should take at least 2 s.
  - Single-acting mode needs float or the top 10% of travel.
  - Depth set point. Status: at rest, commanded, float, locked.
- **HVAC:**
  - Auto climate control is overridden by any manual fan, mode or A/C change, or by the CommandARM buttons.
  - Defrost turns A/C on automatically.
- **Lights:**
  - Two field-light presets. Hood or beltline lights in road mode.
  - Fault "!" per lamp.
  - Entrance/exit and delayed-off lighting, DRL.
- **7-pin outlet:**
  - North American pinout: 1 ground, 2 flood, 3 left turn, 4 brake, 5 right turn, 6 tail, 7 accessory.
  - The European pinout differs; F11 needs a 30 A fuse for fog lights.
- **Trailer brake:**
  - Gain 0–10 and pre-brake offset −10 to +10.
  - A brake test (dual-line hydraulic brakes, in PARK) releases the trailer brakes to check that the park brake holds.
- **ExactRate tractor tank:**
  - Fill alarm at 80% (hazards and horn), low alarm at 5%.
  - Maximum transport weight is 24,040 kg (53,000 lb). Don't transport with fluid in the tanks.
- **Tank System / In-Furrow / Frame-Mounted fertilizer:** pump and system on/off, with green/grey status.
- **Rinse System:** rinses the pump and delivery lines with fresh water through the ExactRate sections and aspirator fittings.
- **Audio:**
  - Radio presets: 6 per bank (FM1, FM2, FMT, AM, AMT); WX presets are fixed.
  - Bluetooth pairing can take up to 5 minutes.
  - AUX gain ranges from −9 to +9.

### Safety page
Standard signal words (DANGER, WARNING, CAUTION). Park safely: lower equipment, key out, disconnect the battery ground, tag the machine. Avoid backovers: don't rely on cameras.

---

## Batch 2: implement-control and UI apps

### ISOBUS VT and the ISOBUS stack
- **Virtual Terminal:**
  - Supports ISO 11783 control units and displays **VT version 4**, with up to 64 softkeys.
  - The implement uploads its UI object pool when it connects. A 2nd VT is available with an extended monitor.
  - Run page modules come from the implement (full with or without softkeys, half, quarter, vertical).
  - Troubleshooting: check the control unit's status in Status Center / Diagnostics, then "Clean Up ISOBUS VT" deletes the stored object pools, which reload on the next connect.
  - A "John Deere VT" variant does the same for Deere's proprietary control units.
  - Settings → About → ISOBUS Conformance lists the AEF conformance.
- **ISOBUS Tasks:**
  - Records totals from **AEF TC-BAS** implements and John Deere pull-type sprayers. One task at a time.
  - Totals include time, area, mass and volume, with up to 6 products per task.
  - Target rate can't be changed here. "Totals Request" chooses which controller reports totals (default: Display).
- **Section Control:**
  - Supports **AEF TC-SC** implements (up to **255 sections**). Most Deere gear supports up to **16 sections**.
  - It "sends a CAN Bus message to the machine or implement controller to change section status."
  - The task controller can't run on 2 displays.
- **Controls Setup / ISO AUX:**
  - Maps the tractor joystick, CommandPRO joystick, CommandARM levers and 1–4 buttons to tractor functions, iTEC sequences or ISOBUS implement functions.
  - ISO AUX decides whether joystick messages go to the implement.
  - Third-party ISOBUS input devices can drive implement and some tractor functions.
- **Mobile Weather:** a machine-mounted station reporting wind speed and direction, temperature, humidity and Delta T, with alert thresholds.
- **Reichhardt GREEN FIT:** lets non-Deere machines use AutoTrac. Vehicle offsets must match the machine and the StarFire.

### iTEC (headland turn automation)
- Sequences are lists of function + action + **step distance** from the point where iTEC engages. They are auto-sorted by distance, and negative distances are allowed with Turn Automation.
- Sequence sets (e.g. planter raise and lower) are assigned to iTEC buttons.
- **AutoLearn** watches operator actions over 3 or more passes and proposes sequences.
- Sequence status values: Off, Operator Presence, Ready, Wheel Speed Low, Active, Complete, RPM Limit, Aborted, Park, Error.
- The tractor's IMS (Implement Management System) must be **disabled** for Turn Automation; if IMS is on, iTEC master switches off.

### Layout Manager
- Run pages are made of modules (each module once per page).
- Run page sets hold up to **10 pages** each. Shortcut bars hold each shortcut once.
- Factory pages can't be edited.
- Pages can be imported from a display of the same size.

### PTO
- **Rear PTO auto-disengages** if PTO speed is under 100 rpm for more than 1 s, or engine speed is under 500 rpm.
- **Front PTO auto-disengages** (7R/8R) if clutch slip is over 40% for more than 1 s; on 8R, over 10% for more than 45 s.
- After an overload disengage, wait 15 s; in cold weather, 5 minutes.
- **Out of seat for 7 s:** the PTO disengages unless Out-of-Seat or Remote is enabled. On 7R/8R with an implement, being out of seat another 3 s shuts the engine down.
- **External switches:** wheel speed must be under 0.5 km/h. Hold for 4 s to confirm, with hazards and horn.
- Engagement rate options: AUTO (closed loop on the PTO speed sensor), Low, High. Rear PTO Cruise limits engine speed relative to PTO speed.

### Liquid system / Tank / Calibrations (planter liquid fertilizer)
- Apply-OFF pressure is at most 380 kPa (50 psi). The pump shuts off after 30 minutes of not applying.
- Pressure relief opens the row valves for 6 s with the pump off and the EPG on; do it twice.
- Liquid System Response is a unitless rate setting (3 is typical). Increase it if the response takes over 4 s.
- **Rx at 0 rate:** with Section Control on, the 0-rate areas turn sections off.
- **Calibrations:**
  - Nozzle flow check.
  - Row-flow pressure sensor zero (takes over 1 minute).
  - Flowmeter: enter the **pulses per gallon** from its tag.
  - Pressure sensor: zero it open to air (about 5 minutes).
  - Solution pump A/B low/high speeds and current (about 5 minutes). Recalibrate if it can't reach 10 psi or less.
  - Reset all.

### Video
- **Camera inputs:**
  - 4600/4640: 4 analog inputs, digital over Ethernet, 2 feeds.
  - 4200/4240: 1 analog input, 1 feed.
  - G5Plus / G5 CommandCenter: 4 analog inputs, digital, 3 feeds.
  - G5 Universal: 1 analog input, digital, 1 feed.
- **Triggers:**
  - Tractor: reverse, SCV 1–16, front/rear PTO, front/rear hitch.
  - Combine: separator, grain-tank full or three-quarters full, auger.
  - Sprayer: boom-fold states, SCM/ASM video buttons.
  - Spreader: spinner state, bin low.
- Field of view is 90, 125, 160 or 180°. At most 4 cameras in the scan rotation.

### AutoLoad (9R scraper tractors)
- Works only in **gears 5–13**.
- Set points: Transport, Ready, Loading. Initial draft covers the 1st half of the cut and average draft the 2nd; each ranges 0–250.
- The load counter wraps at 9999. A dimension table gives tongue-to-rear-pin and blade-to-axle lengths for each scraper model.
- Status colors: black transport, green entering cut, blue loading, orange ready, grey fault.

### Equipment Manager
- Lists detected machines, implements and control units. Machine types: Tractor, Product Applicator, Harvester, SPFH, Truck, Utility Vehicle.
- Implement profiles: SeedStar 2/3/4 planters and air seeders, baler, manure constituent sensing, tillage, ISOBUS (with or without SC support), GreenStar Rate Controller, RC2000 / RC Dry, dry spreader, sprayer, harvesters, windrower, and Wirtgen soil stabilizer.
- "Add Operation" creates a virtual operation for documentation only.

### Phone and Bluetooth
Up to 5 paired devices and 25 favorites. Recents keeps 10 outgoing, 10 incoming and 10 missed calls.

---

## Batch 3a: engine, mapping, Section Control, Machine Sync, hitch

### Engine
- **Engine set speeds 1 and 2:** 1100–2150 rpm, capped by Max Engine Speed. They replace Max Engine Speed in IVT/EVT pedal mode.
- **Max engine speed 1 and 2:** a constant-speed governor curve for fuel economy.
  - Full AUTO minimum at full throttle: 1200 rpm on 7/8 Series, 1500 rpm on 9 Series.
  - Custom mode has ECO ON (lugs low) and ECO OFF.
- **Decelerator:** 50–95% (default 65%).
- **Exhaust filter (FT4 / Stage V):**
  - AUTO cleaning resets to AUTO every key cycle.
  - Parked cleaning takes about 1 h; Requested cleaning takes 2–3 h.
  - 15 L engines do an initial cleaning after a few hours.
- **Engine braking:** AUTO, using engine compression. Also intelligent power management (IPM).

### Mapping and work data
- Work data is recorded against GPS position and time (lat/lon, elevation, field, coverage, documentation).
- The map shows data within 0.64 km of the machine. There's no per-field size limit beyond display memory.
- **Layers:** coverage (blue = once, dark blue = more than once), rate, dry yield, moisture, variety (10 colors), product, weed pressure and crop canopy (See & Spray), and pass visualization.
- Legends have 10 gradients and are auto-set from the Rx.
- Rx maps are shapefiles imported through File Manager; a 0 rate shows black and turns sections off.
- Heading: 0° = N. The track counter goes up to 999.
- **Views:** Field, Perspective and Fixed Field; Machine-Heading-Up or North-Up; split map.
- Gestures: pinch, double-tap-hold zoom, two-finger tap to zoom out, and edge swipe to flip run pages.
- On a planter, seed rate is the average per drive-motor section. Sections can't span drive motors.

### Section Control
- **Needs:** a SC activation or license, a GNSS receiver (SF2 or better), and a compatible control unit.
- **Decision inputs:** GPS position, coverage map, offsets, section status, overlap settings, **mechanical delay**, field and headland boundaries.
- Map diagnostics shows the look-ahead (white = commanded off, orange = commanded on).
- **Performance tuning:**
  1. Plant a headland, then a perpendicular pass at constant speed.
  2. Dig and measure the skip or overlap entering and exiting.
  3. Enter it, and the mechanical delays in the Implement Profile are auto-corrected.
- **Default planter overlap:** seed placement 50%, exterior boundary 100%, interior boundary 50%.
- Continuous Tillage keeps the tool in the ground over prior coverage.
- **Signal quality:** RTK / M-RTK / SF-RTK / SF3 / SF2 work well; SF1, WAAS and EGNOS cause drift.
- Manual SC groups the total sections into N groups.

### Machine Sync (leader and follower, e.g. combine and grain cart)
- The follower's AutoTrac tracks to a home point relative to the leader, using in-line and lateral offsets from both StarFires.
- Machines talk over the **MTG 4G LTE**.
- **Network:** the SSID defaults to the serial number, a random password is assigned, default channel 6.
- Doesn't support curves sharper than **0.5° per meter**.
- **Without shared signal,** both machines need StarFire 7000 or newer with SF-RTK.
- With JDLink Boost, the MTG drops the network when the machines are within 50 m.
- Nudges of more than 66 cm forward or back cause a brief return to Acquiring.
- **States:** Off, Error, Not Ready, Ready (press Resume), Acquiring, Tracking.
- **Operational zone:** front edge 25 m and back edge 20 m from the leader's receiver. It is left-hand for combines and harvesters and U-shaped for others. Up to 3 home points.
- Controlled traffic mode keeps the follower on its own guidance line and matches only speed.
- **Follower speed sensitivity:** start at 1 on a PST; set Line Sensitivity–Heading to 50 to reduce S-ing.
- **Disengage best practice:** steering takes over and the set speed snaps to the leader's last speed. On a PST, move the shift lever up; with an IVT linear lever, go F1 to F2; with a CommandPRO lever, any movement exits.
- Auto Unload status colors: grey, orange (degraded), green, blue.

### Rear hitch
- Upper limit, drop rate (a full drop should take at least 2 s) and raise rate.
- **Load Depth:** 0 = position control; higher values = draft control.
- Slip sensitivity (needs radar and draft mode) only raises the hitch and overrides draft.
- Lock damping counteracts transport bounce (not on 9R).
- **Lever positions:** proportional raise or lower, raise detent to the upper limit, lower detent to the depth set point, float.

### Display and Sound
- Brightness AUTO follows the cab light switch: day mode with lights off, night mode with lights on.
- Touch calibration, or use a USB mouse if the touchscreen fails. Standby (not on sprayers).
- **Second display:**
  - A Gen4 or G5 CommandCenter can add a GS3 2630, 4640 or G5 Universal at the corner post.
  - A Universal display can pair with a CommandCenter.
  - AutoTrac can't run on both. The 2nd display needs its own activations.

### Software Manager
Installs and updates over USB or online, plus Remote Software Updates from the dealer through the MTG. It also handles activations (activate, deactivate, transfer), licenses, and version and system info.

### Work Monitor / Work Totals
- **Totals tabs:** Field, Shared, Load (moisture, dry yield, wet weight), Module (cotton), Bale (length, flakes, moisture, preservative), Custom date range.
- Area = working width × ground speed × time worked.

## Batch 3b: software, multiple displays, work data

### Section status: why a section is OFF (highest priority first)
1. Low speed (under **0.8 km/h**)
2. Interior headland
3. Exterior headland
4. Interior boundary
5. Exterior boundary
6. Rx zero rate
7. Coverage

"Indexed OFF" means the control unit turned the section off. "Enabled, not applying" covers a raised tool, clutches off, zero rate across a drive motor, or See & Spray seeing no green. Intentional overlap goes up to 254 cm; intentional skip goes up to ½ the row spacing.

### Software Manager, activations and licenses (useful for understanding the platform)
- **Bundle naming:** "YY-N" means the Nth bundle of year 20YY (e.g. 19-3, 20-1). Shared Totals needs 21-1 or newer, Custom Totals 21-2 or newer.
- **Packages:** Display OS, Display OS Help, Planter Apps (installing needs a dealer with **Service ADVISOR**), Planter Apps Help.
- **Controllers the display can flash over USB:** GreenStar Rate Controller and RC Dry, **StarFire 3000 / 6000 / 7000 / 7500**, Application Controller 1100 / 1120, AutoTrac Universal steering controller, AutoTrac Vision camera controller.
- **Remote Software Updates:**
  - Delivered through JDLink (needs a subscription) to the StarFire and machine controllers.
  - Dealers use **Service ADVISOR Remote (SAR)** over JDLink to read DTCs, record diagnostic data and reprogram controllers remotely. Some controllers aren't SAR-compatible.
  - If the operator cancels the download alert 3 times, the update is rejected.
  - The display updates first, then reboots, then controllers update.
  - Low battery voltage interrupts the update. A failed update rolls back.
- **USB updates:** downloaded with the Software Manager utility from my.deere.com. If any package fails, everything rolls back. Rolling back to older software loses recorded data, so export first.
- **Activations** (Gen4, through StellarSupport.com):
  - Needs the display serial number plus a **challenge code**, and returns a confirmation code.
  - One code does one kind of action (activate or deactivate) but can cover several features.
  - Features: AutoPath, AutoTrac, Turn Automation, Basics, Implement Guidance, In-Field Data Sharing, Machine Sync, RowSense, Section Control. States: Active, Demo, Inactive/Expired.
  - CommandCenter activations transfer only once the original display is decommissioned.
- **Licenses** (G5 style):
  - Tied to the display serial number, plus the **machine PIN** for a CommandCenter.
  - Delivered over the air (checked at power-on) or as a USB file. States: Active, Issue, Start Date Pending, Expired, Pending, Terminated.
  - Pending usually means a wrong date: the date comes from StarFire GPS, so set it manually without a receiver. The display must also be registered to an Ops Center org.
  - Non-display hardware is activated through the details page; other ECUs are activated through ISOBUS VT.

### Multiple displays (useful for CAN)
- The CommandCenter **searches the implement CAN bus for a 2nd display for about 60 s** after key-on. After a display is removed, it searches for 2–3 minutes before reporting "Second Display Not Found."
- **Modes:**
  - **Single Display**
  - **Machine Only:** the 2nd display runs Precision Ag and the VT. Use it with ISOBUS AUX reconfigurable control.
  - **Implement Viewer:** Precision Ag runs on the other display.
  - **Precision Ag Applications:** the CommandCenter runs Precision Ag and the VT goes to the other display.
  - **Advanced**
- **Function toggles:** Precision Ag Apps (AutoTrac, SC, documentation), ISOBUS Implement Viewer 1 and 2, ISOBUS Certification (turning it off allows the Original GreenStar Monitor), Task Controller (TC incl. SC messages), File Server (needs USB; files go in the /Fileserver folder).
- **Priority = "Function Instance":** the lower number wins, e.g. VT on the CC with priority 1 beats a GS3 2630 with 2.
- Never enable Precision Ag on both displays. An ISOBUS implement either has "Next VT" or appears on whichever display boots first.

### Calibration procedure prerequisites (liquid)
- **Row-flow pressure sensor:** engine off, key on, 0 speed, pump off. Takes about 10 s.
- **Solution pump:**
  - Engine at low idle, hydraulic oil at 60–88 °C, at least 568 L (150 gal) in the tank, pressure under 34 kPa (5 psi).
  - If it fails, check the load sense, detent an unused SCV, and check the load-sense orifice.
- **Pressure sensor:** empty and open to air. Voltage out of range shows red.
- **Nozzle flow check:** parked, implement raised, high idle, EPG on, a fixed target rate (not an Rx).

### Exhaust filter details
- Disable AUTO cleaning only when indoors without high-temperature venting, near fuel, in heavy chaff, or without time to finish.
- **Parked cleaning:**
  - Needs no motion, low idle, park brake on and PTOs off.
  - Two stages: preparation, then cleaning (over 40 min).
  - Aborts on throttle, transmission engagement, engine stop or PTO.
  - Ignoring it leads to a forced Request cleaning and eventually power derate.

### Work Monitor / Totals definitions
- **Idle:** engine running, not moving, no SCV movement, PTO off. The distance counter wraps at 99,999.
- Instant values show dashes below 0.1 km/h. Average productivity = area ÷ engine hours.
- Crop-specific values exist for combine, SPFH, cotton (round modules, RFID tag count), sugar cane (elevator trash, usage categories), sprayer and See & Spray (area worked vs applied, weed pressure), and HarvestLab manure (N, NH4, P, K, dry matter).
- **Work Recording:** comes from the Implement Profile's recording trigger (manual is possible). For See & Spray it needs master on, pump on, S&S on and at least 1 section enabled.
- Field totals include area/time/product remaining (needs an exterior boundary). Combine Automation adds grain loss and foreign material / broken grain on a 1–10 scale.

### Hitch modes
Position control means Load Depth = 0. Draft control suits non-floating tillage on rolling ground. If draft goes too deep, set it to 1 and raise slip sensitivity. Resume returns to the depth set point, and only while moving if the hitch is below it.

---

## Batch 4: Fields, File Manager, Machine Monitor

### Fields and boundaries
- G5 and Gen4 store data as **lat/lon points**; client, farm and field are only filters. Older displays keyed data on the field name.
- **Boundaries:** exterior; interior, either impassable (pink, e.g. a well) or passable (yellow, e.g. a waterway); headland (yellow dashes).
- **Headland types:** constant offset, top/bottom offset (heading angle from N), or driven. Only one headland per boundary.
- Boundaries can be created from the coverage map (gaps become passable interiors) or by driving, using the GPS point or the implement work point (default offset = ½ the working width).
- Area is computed on a flat 2-D plane, while work totals include elevation, so the two differ.
- **RTK base station per field:** with auto-switching, the saved base station is used when the machine returns to that field.
- **Autonomy boundaries** (blue = autonomy quality):
  - StarFire 7000 or newer, SF-RTK or RTK (not Mobile RTK), RTK-X enabled.
  - The correction mode or base station can't change mid-recording. Not within 30 km of a geological fault.
  - The offset point must match the physical receiver.
  - **Lateral offset limit:** with a machine receiver, the lesser of ½ machine width + 1.5 m or 4 m; with an implement work point, the lesser of ½ implement width + 1.5 m or 16 m.
  - Recording accuracy must be at least 80% (86–100% is best). Accuracy drops with shading, no TCM calibration, short signal acquisition, a re-mounted or reconnected receiver, or changed offsets.
  - Record at least 1.5 m from obstacles. Undo removes 5 m. You must close within 100 m of the start point.

### File Manager and data
- A memory warning appears at **95%**.
- **Factory reset** wipes setup, documentation, guidance, totals and run pages, but keeps activations, licenses and language.
- **Ops Center link:**
  - Needs a Basics license or activation plus an MTG (JDLink Connect, a WDT license), a USB Wi-Fi adapter, or the 4640's built-in Wi-Fi.
  - **Registration needs IPv4**; hotspots must use an IPv4 APN.
  - MTG diagnostics: signal %, MTG version, call state Open or Closed.
- **Work data sync:** sent every **30 s** as "packets" (1 packet = 30 s of work data), queued while offline.
  - Files only become visible in Ops Center after a trigger: new work or a field change, connection lost for more than 30 minutes, a key cycle within 30 minutes, or key off for more than 30 minutes.
  - Setup data sync uses a transaction-log state machine: Pending, Pending Delete, Deleted, Ignored, Error, Received, Pending Save, Saved, Pending Send, Sending, Sent, Pending Merge, Merged, Not Supported ("---" names).
- **USB layout:**
  - Setup goes in `JD4600/` (Export All uses `GS3_2630\JD4600`). Work data goes in `JD-Data/`; custom export uses a `Gen4/` folder.
  - Prescriptions (shapefiles) go in `Rx/` and licenses in `LicenseFiles/`.
- **Format split:**
  - "Current System" displays: G5, G5e, G5Plus, 4600 V2, 4200 V2, 4640, 4240.
  - "Legacy System" displays: 4600 V1, 4200 V1, 4100, GS3 2630.
  - **Since 25.3, legacy formats can't be imported or exported directly**; they have to go through Ops Center's Setup File Creator. The same applies to Apex.
- **Data types:**
  - Guidance tracks (machine-access patterns don't transfer), implement profiles (connection type, recording trigger, operation and rate CU aren't imported), and machine profiles (profiles with a machine PIN are hidden on import and replaced by the auto-detected one).
  - Run pages (G5 imports from all; Gen4 only from the same size), work data (only maps import; totals never transfer), boundaries, Rx, setup, ISOBUS Tasks (10 MB limit, no wireless), Harvest ID (cotton RFID), access settings and settings configurations.
  - **Export-only:** screenshots (hold the top-left corner for 3 s), error logs, quarantined data (recovery needs a dealer), **StarFire Data Capture** (SF6000/7000/7500, enabled from the receiver's VT page).
  - **Ethernet Device Files:** logs pulled over **FTP** from Deere devices on Ethernet. Sizes: All logs, Recent+Setup, Runtime.
  - **Import-only:** Variety Locator, AutoPath line data (one per field), license files.
- **Name conflicts:** "Field1" becomes "Field1(1)". Names over 20 characters are truncated on re-import.

### Machine Monitor (these are basically the CAN parameters the display shows)
- **Speed and power:**
  - GPS speed, wheel speed, radar speed.
  - **Wheel slip** = wheel vs GPS or radar speed in %, dashes below 0.1 km/h; 10–15% is best for draft work.
  - Below 0.5 km/h, speeds gain a decimal or switch to m/h; they switch back above 1.6 km/h.
  - Engine rpm, **engine load %** (power delivered ÷ rated), front and rear PTO rpm.
- **Fuel and pressure:** oil pressure, fuel %, DEF %, fuel per area, fuel per hour, time to empty, **air trailer-brake pressure** (at least 6 bar before moving; about 8 bar typical).
- **Temperature:** coolant, transmission oil, outside air (reads high because it's near the engine), hydraulic oil.
- **Electrical:** battery voltage, meaning the display's supply voltage.
- **Hours:** engine (lifetime, can't be reset), implement CU, header, separator, FieldCruise, auto height, **AutoTrac hours**, divider, elevator, SmartClean.
- **Lifetime usage:** resets if the CommandCenter processor is replaced.
- The R-series (MY2014+) list covers 6R/7R/8R/9R.
- Other machines' groups: combine (backshaft), sugar cane (basecutter, chopper, elevator, primary fan), cotton (fan, conveyor, beater, meter, RMB, wrap, unit speeds, rockshaft pressure), nutrient applicator (conveyor, spinner, rollers).

---

## Batch 5: Turn Automation, ExactRate, SCV

### AutoTrac Turn Automation (ATTA)
- Coordinates headland turns together with iTEC, using integrated AutoTrac (and RowSense on some machines).
- **Not compatible with:** front-mounted implements, implements in series where the work-point implement isn't hitched directly, or ground-driven air carts without a tow-between or leading configuration.
- **Tractor IMS / iTEC must be disabled** on older serial numbers: 6R up to 20100, 7R up to 10001, 8R up to 67001, 8RT up to 909001, 9R up to 10000, 9RT up to 904000.
- **With Active Implement Guidance** (Application Controller 1100), set "AT + Imp Work State" or "Disable steering when work recording off" so the implement doesn't steer in turns.
- **Status:** Off, Not Ready, Error, Disengaged (with a reason), Ready (press Resume), Active, Active-with-attention.
- **Requirements:**
  - Master on and iTEC on.
  - Straight, AB curve (across the whole field) or AutoPath guidance; not machine-access tracks.
  - Headland sequences defined, boundaries and headlands complete.
  - Implement **center of rotation** measured.
- **Settings:**
  - Turn Size 0–10 (higher gives a bulb or U shape).
  - Start Turn ±100 in 0.3 m steps; Start Turn Offset is for AutoPath boundaries; Shift Row ±24 rows for AutoPath rows.
  - Speed control (max turn speed and max in-field speed, never above the tractor set speed). Turning it off leaves the operator in charge, with the AutoTrac low-speed minimum.
  - Equipment control: without it, no iTEC is needed.
- **Advanced:**
  - Minimum turn radius and maximum turn angle (auto-set from profiles).
  - Turn deceleration threshold and response aggressiveness.
  - Figure-8 "maximize coverage" places triggers at coverage intersections.
  - **SC optimization:** slows before section-off points and holds speed until sections come back on, using the implement's mechanical delay or manual decel and accel times.
  - Spiral in or out with N passes; passes more than 80% covered are skipped.
  - Auger-extended turns allowed; follow headland curvature; impassable-boundary warning.
- **Map controls:**
  - Left/right turn icons with the distance, which turns orange as it gets close.
  - Up to 5 track skips.
  - Turn types: straight, U, figure-8 (switches to U above 45° to the headland), spiral.

### ExactRate (planter liquid fertilizer, per-row PWM valves)
- **Settings and diagnostics:**
  - Working width comes from the sections.
  - Section states: Ready, Off (auto), Active, Row Applying, Row Fault, Disabled.
  - Specific gravity table: water 1.00, 28% N 1.28, 32% N 1.33, 10-34-0 1.37, 7-27-7 1.32, and so on. Range 0.84–1.96.
  - **Valve pulsing modes:** OFF (fully open, will over-apply), **Auto** (manages pressure and duty cycle; the only mode with turn compensation), Fixed (operator sets the duty cycle).
- **Row diagnostics:**
  - Readings: **source address**, hardware part, serial and manufacture date, software part and version, supply voltage, valve A/B current in mA, valve A/B **PWM duty %**.
  - Faults: **"Subnet 1 sync line runtime fault"**, valve low current, stuck open, solenoid sticking.
- **Flow detection:**
  - Per-row pressure sensors report supply V, signal V and kPa. Sensitivity is Low, Medium or High.
  - Alarm options: shade + beep, beep only, shade only, none.
- **Master Apply** is toggled automatically by planting state and needs the EPG on.

### SCV
- **Modes:** Standard (one time and flow for both directions), Independent (separate extend and retract values), Feature (the implement controls detent time over ISOBUS or the implement connector).
- **Detent time:** 0 to C (continuous), in steps of 1 s to 10, 2 s to 20, 5 s to 30, 10 s to 60, 30 s to 120, then 60 s.
- **Flow** setting runs from 0.04 to 10 in steps of 0.04, or 1.0 with "++". TouchSet depth control adds set points.
- **Lever:** neutral, proportional extend/retract, timed detent extend/retract, float (disabled if in float at start-up until cycled to neutral).
- **Flow Assist:** raises engine rpm at constant wheel speed to meet hydraulic demand. Only in Full AUTO and Custom.
- **Flow sharing:** continuous gets priority over timed. If everything is set to C, flow is reduced equally. Loader mode ignores the time and flow settings. Response curves: linear, progressive, combination.
- **7R pump flow:** 63 cc or 85 cc pump; 85 cc gives 222 L/min at 2100 rpm.
  - Rear SCV at setting 10 is about 132 L/min. Power beyond (½ in) maxes at 132 L/min.
- **8R:** 85 cc gives 227 L/min, or 321 L/min with 85+35 cc. High-flow ¾ in SCV I is 159 L/min at setting 10.
- **9R:** 85+85 cc gives 424 L/min at 2100 rpm.
- Flow tables map each setting (1–10) to L/min for standard and high-flow SCVs.

---

## Batch 6: StarFire receiver, Work Setup

### StarFire receivers (SF3000 / 6000 / 7000 / 7500)
- The **TCM** (terrain compensation module, built in) corrects roll, pitch and yaw. **AutoTrac needs TCM ON.**
  - TCM turns back ON after every power cycle.
  - Signs: roll + = tilted right; pitch + = nose up; yaw rate + = turning right.
- **Classic TCM calibration:**
  1. Park on hard, level ground.
  2. Turn the machine 180°, putting the tires in the same spots (rear wheels for a floating front axle; all wheels or tracks for a fixed axle).
  - A mounting or tire-pressure tilt shows up as a consistent pass-to-pass skip or overlap.
- **Advanced TCM calibration:** SF6000+, software 4.40N (bundle 20-2) or newer, AutoTrac. You drive a temporary AutoTrac line; level ground isn't needed and several receivers calibrate at once. Accuracy must be at least 80%.
- **Correction modes:**
  - SF1 and OFF are always available. SF2 on SF3000, SF3 on SF6000, SF-RTK on SF7000/7500 (all licensed).
  - RTK (radio, 900 MHz with channel and network ID, or 450 MHz), RTK-X, M-RTK (cellular through JDLink), WAAS (NA), EGNOS (EU).
  - "GPS" means a third-party receiver. With shared signal, the lower mode is shown.
- **Accuracy guide:** SF2, SF3 and SF-RTK at full accuracy are good for row crop. SF1, WAAS and EGNOS are only OK for tillage, air seeding and broad-acre spraying.
- **RTK-X (extend):**
  - SF3000: 2–15 minutes in the first hour of base operation, 15 minutes after that.
  - SF6000/7000/7500: **up to 14 days** after 2 minutes of RTK.
  - After that it falls back to WAAS, EGNOS or 3D-None. SF2 fallback is optional on the SF3000.
- **Base station:** self-survey takes 24 h. States: OK, No Stored Base, Initializing, Self Survey, No Signal. Shows base battery voltage and the distance and direction.
- **Radio self-test:** noise under 120 dB, signal 35–106, with a margin of at least 26 dB.
- **M-RTK NTRIP settings:** host `<state>.jdmrtk.<country>` (e.g. ia.jdmrtk.us, on.jdmrtk.ca), plus port, mountpoint, user and password. The correction-age bar is green while streaming.
- **Serial (NMEA) out:** 4800–115200 baud, 1/5/10 Hz, GGA, GSA, RMC, VTG, ZDA.
- **Setup:**
  - Mount direction: forward for tractors, sprayers and combines; backward for Gators.
  - **Fore/aft** from the center of rotation (auto-detected on some machines).
  - **Height** from the ground to the middle of the dome (default 320 cm). A 30 cm height error on a 10° slope gives a 5 cm ground error.
  - QuickStart (up to 6 minutes). Hours On After Shutdown: 0, 3, 6, 12 or 24 h. Optimized Shading (SF3000, L1-only).
- **Activations:** 24-digit codes entered as three 8-digit boxes. A grace-period "Use 1" option. OTA activation over the StarFire satellite network.
- **Sky plot:** red = searching, blue = tracked, green = used. L1/L2 (G1/G2 for GLONASS) SNR bars. Position-solution and velocity-solution satellite counts.
- **Diagnostics — Readings tab:** **unswitched and switched voltage, CAN High and CAN Low voltage (vehicle bus)**, software and hardware part numbers, serial, receiver hours, **receiver address**, QuickStart status, external antenna, serial NMEA, and RTK radio details.
- **Diagnostics — logs:**
  - Data Logs (SF3000/6000, last 60 minutes): PDOP (under 2 is optimal), satellites used (5° mask), nav mode, differential mode, SF signal quality (over 5 is normal), High/Low **AGC**.
  - Health tab (SF7000/7500): GNSS signal % (shading or jamming lowers it), AGC.
- **Security PIN** (SF6000+): admin and operator 4-digit PINs.
  - **Turned on through Diagnostics Center → Controllers → GR7.001 → Address 050 = 1.**
  - Receiver IDs: GR6 / GR7 / MG1 / MG2 (machine) and IR6 / IR7 (implement).
  - After 5 wrong PINs you get 72 h of temporary access with a prompt every 2 h. The master unlock code (24 digits, from StellarSupport) is valid for 8 days.
  - Can't backdate software while the PIN is on, and reprogramming doesn't clear it.

### Work Setup
- **Sections:** Location (client, farm, field), Equipment (machine and implement profile; configure the GreenStar Rate Controller in the VT first), Settings Manager, Details (operator and license, conditions, season / crop year), Work Summary (operation, variety, product, rate / Rx), New Work, Work List, Harvest Setup, AutoPath Recording.
- **New work starts automatically when:**
  - The client, farm or field changes without resuming.
  - The crop changes while planting or harvesting.
  - A dry or gas product changes, or the product or tank mix changes with more than one liquid operation.
  - A new implement set appears, an implement disconnects and becomes virtual, or the machine joins a sharing group.
- **Operation types and units:**
  - Planting: seeds/area. Seeding: mass/area. Gas application: mass/area.
  - Liquid application (single product or tank mix), dry application (single or blend), tillage (type and depth), harvesting (variety locator), cotton (lint %, gin ID, producer ID), forage, mowing.
  - Baling, swathing and transport have no attributes.
- **Rx:**
  - Look-ahead in seconds, a % multiplier, rate column, no-GPS rate or keep the previous rate, out-of-zone rate (0 = don't apply).
  - **Multiple Zone Rate Selection** per meter: Highest (default), Lowest non-zero, Weighted Average, Most Common.
  - Apex Rx files must be exported as shapefiles.
- **Varieties:** Single, Dual (half and half) or Custom (up to 6 varieties per row). Dual and Custom aren't available on AEF ISOBUS implements.
- **Variety locator:** documents the variety at the header center point.
- **Tank mix:** carrier + products. Changing the mix rate adjusts only the carrier. Blends need at least 2 products.
- **ISOBUS documentation mode:**
  - TC-GEO tasks. Totals request is "Controlled by Display" (frequent polling, recommended) or "by Implement".
  - Needs a John Deere crop type.
  - Completed tasks aren't imported.
- **Work groups** last 30 days. Sharing auto-creates or joins a group when client, farm, field and operation match.
- **Auto work-plan activation** on field entry.
- **Remove completed plans:** over 90% coverage, or unused for 2 weeks.
- **HarvestLab moisture base profiles:** USA, Canada, Australia (NZ uses Australia), Europe, CIS, Custom.

---

## Batch 7: Diagnostics Center ★ CAN bus ★ and Machine Profiles

### Diagnostics Center tabs
Machine Messages, CCD Bus Info, System Diagnostics, **Controller Diagnostics**, **Trouble Codes**, **CAN Bus Info**, Network (MTG), Sharing. ISOBUS controllers also show up in Status Center.

### Buses on a Deere tractor
- **Vehicle CAN:** engine (front) ↔ transmission and hydraulics (rear).
- **Implement CAN:** StarFire receiver, display/VT, and the ISO breakaway connector (**IBBC**) at the rear. "ISOBUS" = the tractor's implement CAN extended to the implement (ISO 11783).
- **CCD bus:** the older machine bus for engine, hydraulic and transmission units. Its tab shows comms counters with green/yellow status and a zero button.
- **Which tractors have CAN:** 6x20 (mostly) / 6x30 / 6R+, 7020 / 7x30 / 7R+, 8020 / 8x30 / 8R+, 9x30 / 9R+.
- **Which don't:** 6x20 and older (some 6020s are CCD), 7x10, 8x10, 9x20 and older. Those can be retrofitted with a GreenStar generic or universal guidance harness, which gives implement CAN only.
- **Implement bus speed:** **250 kbit/s**, the same as ISOBUS, and every device must match.
- **MTG CAN 1–4** can each show No activity, 250 kbps or **500 kbps**, so some vehicle buses run at 500k.

### Wiring and electrical (Deere color code)
4 wires:
- Red = CAN power 12 V
- Black = ground
- **Yellow = CAN High**
- **Green = CAN Low** ("green like the grass on the ground")

Both data lines idle at about 2.5 V.

**Multimeter readings:**
- CAN-H: 2.5–3.5 V (2.7–3.3 V running).
- CAN-L: 1.5–2.5 V (1.7–2.3 V running).

**Display "peak" values:** the highest per-second average since the last cold boot, normally **1.7–3.3 V**. Don't compare them with a multimeter.

**Termination check (H to L resistance):**
- **60 Ω** = both terminators OK.
- **120 Ω** = one terminator bad.
- **0 Ω or open** = both bad.

You need a scope to see real edges.

### CAN Bus Info fields
- **Network Status:** Active means at least one other node is talking. Inactive means only the display is on the bus; the message count still increments.
- **Total Message Count**, **CAN-H/L voltage**, **Bus Utilization**, **Baud Rate**.
- **Bus utilization:**
  - 100% = full 250k.
  - **≥45% may cause problems.**
  - Some ISOBUS implements fail above **25%**.
  - A StarFire alone adds about **5–7%**.
- **Bus State:** Active / **Passive** / **Warn** / **Off**, with counters for **Passive Error Count, Bus Warn Count, Bus Off Count, Overrun Error Count**. Overrun means the app is receiving faster than it can process.
  - Fix order: wiring and connectors, then a cold boot, then the dealer.

### Controller Diagnostics
- Each device is listed by **Device ID, CAN Address, and CAN Network** (Implement / Machine / Ethernet), with a has-codes flag and a **Message Count** (messages received from that unit; zero-able).
- Sort by name, by has-codes, or by **TLA** (the three-letter acronym of the controller, e.g. a GR7 receiver).
- Opening a unit puts the display in **Diagnostic Mode** (which hurts performance; close the page to exit). "Hide Diagnostic Center" lets you run a calibration elsewhere while staying in diag mode.
- **Tabs per controller:**
  - **Diagnostic Addresses:** numbered addresses with a type. *Data* is read-only (e.g. software version); *Input* is editable (e.g. calibration). Changing them can damage controllers.
  - **Readings:** number + name. A white field is editable, grey is read-only.
  - **Calibrations:** calibrate, enable/disable systems, run routines.
  - **Trouble Codes:** per-unit active and stored codes. Refresh, Clear; sorts by Code, Count, Status, Type (Stop / Service / Info).
  - **Controller Info:** ISO identity details, useful for ISOBUS diagnostics.
  - Ethernet units add **Ethernet Info** and **Port Info**.
- **Example:** StarFire Security PIN is enabled at **GR7.001 → Address 050 = 1**. The naming pattern is `<TLA><instance>.<nnn>`.
- **Ethernet Info:**
  - IP, MAC, link state, gateway, DHCP flag (1 = DHCP, 0 = static), subnet.
  - **Logical Address = DoIP address**, **UDS version**, **DoIP protocol version year**, active diagnostic session.
  - So Deere's Ethernet ECUs use **UDS over DoIP** (ISO 14229 / 13400).
  - A missing IP "might indicate a CAN issue," which suggests IP configuration is negotiated over CAN.
- **Port Info** (Ethernet switch): per port, LED, MAC, IP, link, Tx frames, good Rx frames, Tx error ratio. Cable diagnostics for ports **J1–J10** run from the Calibrations tab.

### Trouble Codes tab (global)
- View by Code or by Device.
- **Fields:** Type, Number, Device ID, CAN network, Status (active/stored), Count, Description.
- Clear All. Types: Stop, Service, Info.

### Display Hardware readings
- Part and serial numbers, operating hours, USB presence.
- **Unswitched and switched voltage.**
- **Implement and Vehicle CAN-H/L voltages.**
- Radar input status and **radar frequency**, implement switch status.
- AutoTrac Controller calibrations: **steering valve** and **wheel angle sensor**.

### Display cold boot (manual)
- **With a battery switch:** key off, wait, switch off, key on 5 s, key off, switch on, start.
- **Without one:** disconnect the battery.
- **Universal displays:** hold power 4 s, or unplug the 26-pin (12-pin on the G5e).

### AutoTrac Health (System Diagnostics)
Values are calculated only at 4/4 engaged and are shown as **95th percentiles**.

**Good-condition targets:**
| Measure | 3–8 mph | 8–12 mph | 12–15 mph |
|---|---|---|---|
| Off-track error | 4 cm | 8 cm | 12 cm |
| Heading error, straight | 0.8° | 1° | 1.2° |
| Heading error, curve | 1.6° | 3° | 3.6° |
| Yaw rate, straight | 1° | 1.5° | 1.8° |
| Yaw rate, curve | 2° | 4.5° | 5.4° |

- **Conditions:** surface roughness (from StarFire pitch, roll and speed), **wheel slip over 6% hurts AutoTrac**, GPS accuracy % (100% needed), signal strength.
- **AutoTrac Mode** (the type of steering controller): AT 2.0, AT 1.0 (integrated), ATC 300, ATC Raven, ATC Reichhardt, ATC Deere, ATU 300, ATU 200, ATU 100.
- **Resume switch state**, averaged over 20 s.
- **Average wheel angle vs average yaw rate:** more than 1° of WAS while yaw shows straight means a **WAS bias** that needs fixing.
- Other System Diagnostics pages per machine system have **General / Switch Readings / Sensor Readings / Output Readings (commanded vs actual)** tabs. Also Machine Sync and HarvestLab diagnostics.

### Network (MTG) diagnostics
- MTG and display serial numbers and firmware, Ethernet link to the display, **WDT status**, Ops Center link (MTG and display), cellular, GPS, Wi-Fi and satellite antenna status, active MTG DTC.
- **MTG CAN 1–4 activity and baud.**
- The MTG stores **up to 1000 h of JDLink data** offline.
- **Network:** carrier / SSID / **STARLINK**, org ID and name, MTG and display **AWS certificate** authentication, 2G/3G/4G / Wi-Fi / satellite, Tx/Rx rates, RDA state.
- Customer-owned SIM (APN, "Allow Optional Data", config file).
- Starlink terminal and router details (latency, uptime, ping drop, obstruction %).

### ISOBUS controller status (Status Center)
- Per implement: device class and serial number, with **VT** and **TC** connection status (Connected / Disconnected / Error / Loading).
- **Troubleshoot states:**
  - Implement Disconnected: no TC or VT messages.
  - Implement Failed to Load: both failed validation.
  - TC Disconnected: SC, Rx, documentation and profile all stop.
  - VT Disconnected.
  - TC failed to load: implement software may need to change; export error logs.
  - VT failed to load.

### Machine Profile (offset geometry)
- Defaults live in the **machine control units**; edits are stored in the display. Reset Profile restores the defaults.
- **Tractor:**
  - Front and rear axle offsets from the articulation point (articulated machines).
  - GPS lateral offset, in-line offset (rear axle for row crop; track tractors use GPS→center of rotation→rear axle), and height.
  - Dimensions are machine-supplied and read-only (length, width, lateral, in-line, center offsets).
  - Wheelbase, minimum turn radius (drive a full lock circle and halve the diameter).
  - **Connection offsets** per hitch type (rear axle → hitch point; a Universal display on a track tractor uses center of rotation → hitch).
- **GPS in-line reference by machine:**
  - Row crop: rear axle.
  - Track tractor: CoR (Universal) or rear axle (CommandCenter).
  - Articulated: front axle.
  - Combine, sprayer, SPFH, cotton: non-steering axle.
  - Windrower: front axle.
  - Cane: track center.
  - Generic: single steer axle → non-steering axle; two steer axles → midpoint; articulated → pivot; track → track midpoint.
- **GPS lateral calibration test:** drive an AB line both ways with AutoTrac, flag the drawbar center, and halve the measured difference.
- **Other machines:**
  - Combine: GPS offsets, header lateral offset, work point (pivot → cut), connection offset (axle → feeder-house face plate).
  - Sprayer: working width (nozzles × spacing), work point(s) (boom / center frame or front / rear boom; Hagie), mechanical delay, tank configuration, direct injection.
  - Dry spreader: bins, work point, mechanical delay.
  - Also forage, cotton, windrower, cane, Wirtgen, product applicator, pickup truck, utility vehicle, and "Yield Documentation, Specialty Crop".

### More diagnostics (batch 7, continued)
- **Oscilloscope view:**
  - An idle bus sits at 2.5 V on both lines.
  - A dominant bit drives **CAN-H to 3.5 V and CAN-L to 1.5 V**.
  - One bit lasts **4 µs** at 250 kbit/s.
  - With no other node, the message count doesn't increment and the status is Inactive.
- **AutoTrac Controller valve calibration** (aftermarket ATC):
  - Hydraulic oil warm, level and dry surface, lowest gear at max rpm. The machine creeps left and right during it.
  - Do it each season or when weaving or seeing lateral error.
  - WAS calibration is separate.
- **Machine Sync health:** antenna configuration, follower Wi-Fi RSSI over the last 5 minutes (−100 to 0 dB), latency kickout count, and the distance at the last kickout. A data-collection toggle exports through File Manager → Diagnostic Data.
- **HarvestLab:**
  - Overview (application, sensor, motor controller).
  - The quality indicator holds the last value for 2 minutes, then documentation stops.
  - Window cleanliness check. Run a reference yearly or every 700 h. Optical data auto-save.
- **Center of rotation** (track tractor / implement): turn at about 45° under load and measure from the rear axle to where soil starts building on the outside track.
- **Connection type:** the GS3 2630's "Rear 2-Point" is replaced by Rear 3-Point plus a pivot offset in the Implement Profile.

---

## Batch 8a: Implement Profile, Transmission (first half)

### Implement Profile
- **Profiles are keyed by profile name + the detected ISO NAME.**
  - The ISO NAME changes when some control-unit settings change, e.g. switching a unit between fertilizer and seeding. That's the ISO 11783 64-bit NAME.
  - To see it: Diagnostics Center → controller → **Controller Info** tab.
- **Detection:**
  - The first connect raises "Implement Profile Created." The control unit auto-fills some fields; **the work point is never auto-set.**
  - Key-cycle and let the CommandCenter power down when connecting or disconnecting ISOBUS implements.
- **Connection types:** Drawbar, Rear 3-Point (with pivot offset), Front 3-Point, Wagon-Hitch, Ball, Clevis, Hitch-Hook, Piton (types vary per implement).
- **Fields:**
  - **Center of rotation:** connection → where the load-bearing parts touch the ground, measured with the tool engaged. Not needed for front 3-pt or non-pivoting rear 3-pt. Used by mapping, SC, guidance and ATTA.
  - **Lateral offset** and **work point** (connection → drop or application point).
  - **Mechanical delay:** average time for product to reach the ground after an ON or OFF command, set per tank.
  - Implement receiver mount and offsets.
  - **Overall width and length**, used for **autonomy**.
- **Planter:** single or split row layout. Front length, working length, rear connection, work point = seed drop.
- **Air seeder tank configuration:**
  - Individual / **Alternate** (one tank at a time, same product) / **Merge** (simultaneous, with an Rx % per tank).
  - Alternate or Merge locks the work point and disables SC performance tuning. Delay = shortest off and longest on time.
- **Baler:** work point = pickup, bale drop point, steamer.
- **MCS / slurry:** section offset from the CoR.
- **ISOBUS control units:**
  - Up to 2 AEF units: front + rear, or 2 rear with up to 5 operations each. Up to 5 implements can connect, but with more than 2 the operations per implement drop to 2.
  - **Non-linear and multi-rank implements up to 32 ranks.**
  - Linear or non-linear work point. Coverage map follows Actual Rate (recommended) or Section Control.
  - With the Product Applicator machine profile, CoR and lateral = 0 and the work point lives on the machine profile.
- **RC2000:** sections shared across operations turn off together.
- **Virtual implement:** pick controller and operations (baling, dry, forage, gas, harvesting, liquid, mowing, swathing, planting, transport, seeding, tillage), plus work recording trigger and dimensions.
- On a GS3 2630 running AMS, the CommandCenter's implement profile isn't needed.

### Transmission
- **Types:** IVT/EVT, IVT/EVT + CommandPRO, 16-speed PowerShift (PST), e18, e23.
- **IVT/EVT modes:**
  - **Full AUTO:** auto minimum engine speed. Load anticipation reacts to the hitch, SCVs and PTO. Droop held at max power.
  - **Custom:** droop with PTO on and off (% rpm drop before downshifting), minimum engine speed, load anticipation for PTO, hitch and SCV (SCV kicks in at ≥25% flow or continuous detent). ECO ON/OFF minimum speeds.
  - **Pedal:** only selectable when stopped with the park brake on; reverts to AUTO at 0% hand throttle.
  - **Manual.**
- **Set speeds (IVT):**
  - F1/F2 speed bands. SS1 is always 10–12.5% below SS2 and auto-adjusts.
  - Inching mode below 2 km/h in band 1; exits when SS1 is over 2 km/h or SS2 over 10 km/h.
  - Tip: set about 3 km/h above the working speed.
- **CommandPRO:** maximum set speed plus SS1/SS2; disabled when the pedal is used. Shuttle forward and reverse settings.
- **16-speed PST:**
  - Target start gears and APS (automatic PowerShift) max gear with droop sensitivity.
  - Park engages only below 1.75 km/h. Under-idle load drops to NEUTRAL with a DTC.
  - Moving off requires cycling out of N or P. The operator-presence sensor blocks starting to move.
- **EVT Implement Traction Assist** (electric drive to the implement through **VC-B "offboarding" connectors**):
  - Engages at working speed and disengages at transport speed.
  - Derated with clutch or brake pressed or above a 45° drawbar angle. The ISB button disables it.
  - Calibrate at 6 km/h straight for 10 s.
  - Status: grey (off / disconnected / no EPG / fault), green idle, blue active.

## Batch 8b: Transmission (rest), implement measuring

### Transmission details
- **16-speed PST:**
  - Best engine speed under full load is 1800–2200 rpm. Startup gears default to **7F / 2R**; preselect F1–F11 and R1–R3.
  - Shuttling from F14–F16 always goes to R2.
  - Overheat auto-downshifts from F13/F12/F10/F8/F6.
  - Ground-speed matching when the clutch is released.
  - Cold weather (≤ −10 °C): park release can take up to 1 minute. N shows for 3 s, otherwise it returns to P.
  - **APS** (auto PowerShift): shifts based on throttle, engine rpm and fuel-flow power. Sensitivity Low / Med / High (the **PTP** control unit auto-selects Low with the PTO on). Throttle changes shift at most 3 gears. Programmable in iTEC.
- **e18:** F1–F13 / R1–R5; won't go above F13 until warm. Park below 1.75 km/h.
- **e23:** startup **8F / 4R**, F1–F15 / R1–R6. Left-hand reverser or right-hand drive lever.
- **Efficiency Manager:** auto gear and engine speed to hold the set speed (Full AUTO / Custom, or Manual with set speeds active).
- **IVT/EVT:**
  - Engine is limited to 1500 rpm below −5 °C transmission oil; wheel speed limited to 5 km/h below −15 °C.
  - Seat switch required. Fallback if the seat switch fails: cycle the clutch or brake.
  - **PowerZero** holds the machine stationary. Pedal mode minimum is 0.6 km/h.
- **Advanced settings:**
  - **True Ground Speed Input:** radar vs GPS (7R / 8R); recalibrate radar, then slip.
  - Start gears, backup alarm.
  - **AutoClutch sensitivity:** Off / Low / Med / High.
  - **Reverse/Forward ratio:** e.g. F×0.3, or Independent. Max reverse is 20 km/h on 7/8 Series.
  - LSB ride control, Traction Assist aggressiveness.
  - **AUTO MFWD** and **AUTO Diff Lock** disengage at a selectable steering angle.
- **CommandPRO joystick:**
  - Rockers A–D and buttons 10–12 are reconfigurable.
  - Accel response Soft / Normal / Strong. Max set speed detent, zero-speed detent.
  - PARK button (also sets trailer brakes; auto-parks when the operator leaves the seat in PowerZero).
  - Activation button + direction for shuttling. **Inching** in the left gate (default 2 km/h, max 5 km/h).
  - Speed limits can be locked through the Operator profile.
  - Downhill: brake + joystick forward to "stretch" the combination.

### Implement measuring
- **Mechanical delay typicals:**
  - Self-propelled sprayer: about 1.0 s, with ON slightly longer than OFF.
  - **Planter: ON 0.5–1.0 s, OFF 0.3 s.**
  - Air seeder: measure ON at the outside openers and OFF at the center.
  - Dry spreader: about 1.0 s.
- **CoR:** typically the fixed axle (two axles: their midpoint). On a 3-pt with a pivot, measure from the 3-pt, not the pivot (unlike the GS3).
- **Lateral offset:**
  - Only the first implement's value is used, so sum the offsets of all implements.
  - Test: drive 3 AutoTrac passes and measure the two guess rows. Enter (difference ÷ 2) toward the wider side.
- **Implement GPS mount:** lateral, in-line from the hitch point (used to compute the StarFire fore/aft) and height (overrides the StarFire value). Set up the implement receiver **before** tuning mechanical delay.
- **Section offset:** for non-linear implements, up to 5 ranks in this help (32 on ISO pages). Negative = in front of the zero line.
- **Coverage map:** Actual Rate (paint only when dispensing) vs Section Control (paint when sections are on).
- **Work-recording triggers:** Implement Controller (AUTO), Manual, Front/Rear PTO, Front/Rear 3-pt, **Implement Switch Closed/Open (CAN or hardware switch)**, SCV 1–16 (in detent), AccuDepth, **AutoTrac Engaged (4/4)**.

---

## Batch 9: Tractor Overview (cab, connectors, hydraulics)

### ★ DTC format on the CommandCenter
- An alert overlay shows the **control unit (TLA) followed by an "industry standard number": digits left of the decimal = the system, digits right of it = the condition.**
- This is the J1939 **SPN.FMI** style (e.g. `ECU 000100.01` = oil pressure, data below normal).
- **Alert behavior:**
  - **STOP:** light flashes and the alarm sounds continuously.
  - **Service:** flashes, alarm 5 times; can escalate to STOP.
  - **Info:** solid light, a 2 s alarm when the "GSix" is on the bus.
- **The engine auto-shuts down on a STOP signal if the operator is out of the seat for more than 3 s with the transmission in PARK.**

### ★ Diagnostic addresses in the wild (Tow Mode, 9R with a dead engine)
- Enable backup steering under Controller Diagnostics → Diagnostic Addresses on:
  - **TSB** (two-track machines)
  - **XSB** (wheel / 4-track with ACS ActiveCommand Steering)
  - **XSC** (wheel / 4-track with AutoTrac)
- **Address 025 = Back Up Mode ON.** Monitor **PTP address 055** (park brake pressure) and pump the hand pump to **1800 kPa**.
- A key cycle returns 025 to OFF.
- **Fuse moves:** fuse 32 goes to slot 22; the 10 A spare goes to slot 21.
- **So the controller TLAs seen so far:** PTP (powertrain / transmission), TSB / XSB / XSC (steering), GR6 / GR7 / MG1 / MG2 / IR6 / IR7 (StarFire receivers).

### Come Home and Tow modes
- **Come Home:**
  1. Pull the come-home fuse.
  2. Start within 3 s of key-on.
  - Limits: PST and e23 at 1500 rpm; IVT and EVT at 5 km/h.
  - A DTC that forces NEUTRAL still lets you tow. A DTC that forces PARK won't release the park brake.
- **7R/8R tow:** pulling the come-home fuse enables the **electric hydraulic pump** for steering and brakes. Up to 8 km/h forward and 3 km/h reverse. A dead machine needs a 100 A supply.
- **9R tow:** engine above 1250 rpm; at most 8 km/h for 8 km. The backup pump won't run below −10 °C hydraulic oil.

### ★ Connectors (useful for tapping signals)
- **Right-hand side console:**
  - **ISO 11783 connector** (in-cab ISOBUS).
  - CommandCenter USB (data and reprogramming; doesn't charge).
  - 12 V outlet: top = ground, bottom-left = unswitched battery, bottom-right = switched.
  - Radio AUX/USB (500 mA).
  - **Diagnostic connector (dealer use).**
- **Right-hand front corner post:**
  - Universal **display connector**, **Ethernet connector**, GreenStar display connector.
  - **ISO 11786 connector** (speed and implement-switch signals). Pins: **1 = True ground speed, 2 = Buffered wheel speed, 3–5 = unused, 6 = Implement switch, 7 = Ground.**
- **RS-232 serial** behind the upper right radio bezel gives **NMEA 0183 GPS** out.
- **Rear corner posts:** 12 V outlets, 120 V or 230 V AC outlet, USB-C charging (5 A / 60 W each).
- **Hydraulic option connector** (rear cab panel): needed for SCV automation and feature mode (TouchSet, laser scraper, AutoLoad). Key off when first connecting. A reset procedure exists for DTCs.
- **9-pin implement connector:** a special harness with a **loop circuit that disables the tractor hitch control unit** (used for TouchSet and hitch auxiliary raise).
- **CB / business band:** NMO roof mount, RG-58/U 50 Ω, 3.35 m to a PL-259. Don't route near controller harnesses. Power: A switched (red), B ground (black), C unswitched (red).

### Corner post display (what's on the bus)
- Turn and trailer-turn indicators (1 or 2 trailers), high beam, preheat (6.8 L), **tach ("----" = no rpm signal)**, IPM, max engine speed, manual engine speed, engine set speed 1/2, exhaust filter cleaning.
- **Ground speed ("---" = no signal)**, set speed direction / number / value, CommandPRO set and max speed, direction, gear, P/N.
- AutoTrac, auto shift, inching (below 2 km/h, or a 2.5× limit), pedal mode, iTEC, tractor automation, joystick, diff lock, MFWD, front PTO (1000), rear PTO gear.
- **Gauges:**
  - Trailer air brake %: red 0–66%, green 66.4–100%.
  - Coolant: 40–120 °C bar.
  - Fuel and DEF: 5% per segment.
- **Warnings:** steering (red), yellow brake (an electrical fault that limits fault detection), red brake (serious brake fault; flashing = park lock can't engage).

### CommandARM / controls
- Navigation bar has a dial plus app shortcuts (SCV, rear hitch, engine, transmission, PTO, iTEC, lights, HVAC, controls setup, AutoLoad).
- **Joystick:** buttons 5–9, a rocker and an axis are reconfigurable; lock button.
- **Left side:**
  - AutoTrac Resume (also enables **TIA, Tractor-Implement Automation**).
  - Buttons 1–4, MFWD / AUTO MFWD, diff lock / AUTO, SCV lock.
  - **ISB (ISOBUS shortcut / stop) button.**
  - Hand throttle, max engine speed, ECO, pedal lock, engine set speed 1/2, manual engine mode.
- **Hitch:** lock (with creep return), resume (only when moving if the hitch is below the set point), upper-limit, drop-rate and load-depth dials.
- **Operator presence:** a 5 s warning with the PTO engaged or an SCV in detent. **SCVs don't disengage when the operator leaves the seat.**

### MFWD / diff lock automation
- **AUTO MFWD and AUTO diff lock:**
  - Disengage above **23 km/h**, on any brake, or past the steering-angle threshold.
  - Re-engage below **19 km/h**.
  - Brake assist: both pedals above 5 km/h engages MFWD for 4-wheel braking.
- **9R alternate braking:** a diff-lock logic table for 3–47 km/h.

### Hydraulic plumbing (summary)
- **SCV color codes on 9R:** I green, II blue, III brown, IV black, V violet, VI grey, VII white, VIII light green. 7R mid/front: XI green, XII blue, XIII brown, XIV black, XV violet.
- **High-flow (two pumps):** primary for high-pressure / low-flow (air-seeder fans aside: cylinders, active down-force); secondary for motors (19–26.5 L/min each at about 100 bar).
- On 8R, the top SCV and the hitch valve return to the sump while lower SCVs return to the charge pump, so **don't put motors on the uppermost SCV**.
- **Motors:**
  - Feed from the SCV retract port. Return to the power-beyond / motor return, or use the **special check-valve return tip** if returning to an SCV.
  - **Stop motors with float, never neutral** (neutral damages the seals).
  - Case drain to the sump coupler.
- **Power beyond needs a load-sense line.** Sensing upstream of the flow valve makes the pump run at max pressure. Power-beyond max is 200 bar.
- Active down-force means continuous detent, so the pump sits at max pressure; keep motors to a minimum.

### Misc
- Turn signal: lane change = 3 flashes; self-canceling on wheel return.
- 7R/8RW/8RX have dual brake pedals; 8RT and 9R have a single pedal.
- Seats (air, ActiveSeat II), mirrors, refrigerator, emergency exit (step-down points per model).

---

## Batch 10: SeedStar Air Seeding (disk drill / CCS)

- **Main page:** drive status, target rates, the **RelativeFlow** opener-flow graph (blockage sensors per row, "Stabilizing" after a key cycle), section status, Setup, Utilities, and Diagnostics & Calibrations.
- **Fast Start:** primes the meters while stationary. Needs EPG on (or a DC-DC converter) and the frame-height condition. Overrides Section Control. Can auto-enable when the openers lower.
- **Implement profile:** the connection type is fixed. Rank selection is dual, front or rear; the work point follows it (front/rear rank values, measured from the hitch pivot to the rearmost seed tube).
  - **CoR** = drawbar pin to rear axle.
  - **Mechanical delay** ranges 0–15 s (stopwatch method using the rear calibration switch). **Tool compensation** = center-to-outer opener time.
- **Meter drives:** 4 sections (L wing, L center, R center, R wing), each with status, speed and voltage. Green / orange (non-stop fault) / red (stop fault).
- **Engage requirements:** openers down, a target rate selected, EPG active.
- **Curve compensation:** meter section speeds follow implement **yaw rate**. ON for long curves, OFF for fast S-turns.
- **MDV (meter displacement value):** seed per roller revolution. Default comes from the roller and crop; Custom comes from calibration.
  - **ActiveCal** computes the MDV from the tank-scale weight while seeding.
  - Meter verification: 0.04–0.8 ha test area (stationary method below 12.8 km/h).
- **Tank scale:**
  - Load cells, each with a **serial number and diagnostic address**. States: OK, No Load Cell Communication, Initializing.
  - Zero with the tank empty; "Mobile Handoff" lets you finish calibration on a phone.
  - Alarm by area-to-empty (default 2 ha) or weight (default 220 kg, max 5000 kg).
- **Blockage diagnostics:**
  - Master module: high-current voltage, **source address**, software assembly.
  - Each blockage module: serial, part number, software, voltage, sensor voltage, **input duty cycle**.
  - Alarm sensitivity 0–10, reminder 0–120 s (default 30), meter ON/OFF delays.
- **Downforce diagnostics:** sensor mV, kPa, setpoint vs actual force (N), **valve command vs feedback current (mA)**. Increment, warning delay, set-point timeout.
- **Machine speeds:** tractor wheel speed, tractor ground speed (GPS/radar), **implement radar speed and frequency**.
  - Speed needs a source plus a motion sensor (implement radar). Auto mode falls back automatically; wheel speed needs a frame radar.
  - Manual speed is for diagnostics only.
- **System voltages:** valve power 1/3 (F3 tank fuse), valve power 2/ECU (F1), sensor supply 1 (height and downforce sensors), sensor supply 2 (plenum pressure).
- **Power-beyond control:** extend/retract pressure sensors with voltage and thresholds; **SV1–SV5** status with command and feedback voltage.
  - SCV automation on 30-series and newer tractors with power beyond: timed detent 10–180 s (default 20), and power beyond holds downforce after that.
  - Without power beyond: continuous (the pump stays at high standby).
  - Older or non-Deere tractors: timer set on the tractor.
- **Seed motor start/stop by opener height %:** common threshold (default 50%) or separate thresholds (stop default 25%). Stop just as the gauge wheels lift.
- **EPG** (electric power generation, PTO-driven alternator): main bus voltage gauge, gear-case temperature, clear fault. Engage the PTO before turning EPG ON.
- **Bin level:** a disconnected or open-circuit sensor reads FULL (fail-safe caveat).
- Lifetime: time worked (at least 1 row seeding), area, key-on hours.

---

## Batch 11: AutoTrac Guidance (full text; the structure is in the session 3 log)

- **Guided Line Acquisition:** needs an **AT 2.0 steering controller**. A dotted path to the line is computed from speed, position, wheel angle and heading. Not in reverse.
- **Reichhardt GREEN FIT low-speed mode:** you must first drive more than 100 m above 0.5 km/h with AutoTrac disabled.
- **Steering sensitivity:** 50–200, default **70**.
  - **Too low:** slow wander, about 10 s side to side.
  - **Too high:** wheel motion at about 1 s. Extreme values reset it to the default.
- **Forward steering adjustments** (each 50–200):
  - Line Sensitivity–Tracking (response to off-track error)
  - Line Sensitivity–Heading (response to heading error)
  - **Heading Lead** (yaw-rate look-ahead against oversteer)
  - Steering Response Rate
  - Acquire Sensitivity
  - Curve Sensitivity
- **Implement Guidance (passive):** steers the tractor off-line so the implement holds the line. Needs machine and implement receivers. Not for rear 3-pt implements (except the TT 8022 planter on a non-pivoting 3-pt).
- **Shared Signal:** the most accurate correction must be on the machine receiver; it shares to the implement receiver.
- **Shift track:**
  - Increment 0.01–10 m. **No shifts over 0.3 m while engaged.** AutoPath allows at most 76 cm of total shift.
  - Shifts can be shared with the work group (the receiver must reselect the line).
- **Track list:** projected-line accuracy degrades beyond 16 km. Preview only within 3 miles. Only straight and circle tracks can be shared, one at a time.
- **Track spacing vs working width are independent:** spacing > width leaves a gap; spacing < width overlaps.
- **AB curve:**
  - At least 3 m long. Generates 5 tracks per side (10 with Turn Automation).
  - The machine must be within 400 m of the last generated track. AutoTrac is unavailable while it generates.
  - 91 m recorded and projected extensions.
  - **Radial shifts** (not lateral), with smoothing. Radial shifts don't transfer to GreenStar displays.
- **Adaptive curve:** each pass is generated from the previous one. Projection appears within 0.5–1.5× track spacing. Maximum straight segment 0.8 km. Shifting isn't recommended and skip pass isn't available.
- **Boundary track:** 3 lines (1 outside, 2 inside) plus 15 m extensions. Straight fill tracks have no slope compensation and can't be exported.
- **Quick Line:** Auto B fits the last 5 points over 15 m. A+B: point A can be reset within 3 m.
- **Straight-track "Guidance Line Calculation":** John Deere (default), **Non-JD 1 = BeeLine**, **Non-JD 2 = Trimble** math, so lines match rows made with competitor systems.
- **Tram lines:** straight and AB only; default spacing 3 passes (0–50).
- **RowSense:**
  - Row entry by GPS Steer (press Resume twice) or Manual. Sensor priority: RowSense, Vision, or both.
  - Row dropout falls back to GPS and re-centers. Manual RowSense (header sensor only) on SPFH and cotton.
  - Status: standby, sensors+GPS, sensors only, GPS only.
- **AutoPath:**
  - Source operation = planting, tillage or application **with an implement receiver**, SF3 or better, display software 10.10+ (10.18+ to use it), and an AutoPath activation.
  - **Annual row crops only.**
  - Lines extend 20 m past the row ends and bridge waterways up to 50 m.
  - One file per field, and it can't be exported.
  - For Turn Automation, the next path must be within 45° and both paths must hit a headland.
  - "Automation 4.0" activation on the 4600 v2 / 4640. Use advanced TCM calibration.
- **Disengage triggers:**
  - Slowing below 0.5 km/h.
  - Operator out of the seat for more than 7 s (seat switch), or no presence activity for 7 minutes. This drops to 1/4 and starts a 30 s timer: restoring within 30 s returns to 3/4; after that, only 2/4.
  - Steer OFF gives 2/4. The road / resume switch OFF gives 1/4.
- AutoTrac can go **as slow as 0.1 km/h** on some machines.
- **Speed tables for aftermarket controllers:**
  - **ATU/ATC 300:** tractors 30 km/h, sprayers 37, combine / SPFH / windrower / cotton 25.
  - **ATU 200:** low limit 0.8 km/h on most machines.
  - **ATC Raven:** tractors 31, windrower 20.
- **Tuning recipe:**
  - Set steering sensitivity to **100** (good range 70–120).
  - Adjust in steps: tracking ±20, heading ±10, heading lead ±10, response ±10, acquire ±20, curve ±20.
  - Tune by driving 1.2 m off and parallel to the AB line.
  - Heading error target: within ±1° on a straight.
  - **Excessive wheel motion:** lower response rate, then heading and tracking.
  - **Aggressive S-ing:** lower heading sensitivity.
  - **Lazy or aggressive acquisition:** adjust acquire sensitivity.
  - **Implement steering** adds slope sensitivity and slope response.
- **Circle track:** up to 1.6 km from the pivot, for slopes under 2%. Record above 3.2 km/h.
- **Tones and indicators:**
  - Tracking tones sound 10–40 cm off track. Lightbar range 2.5–30.5 cm (steer-toward or off-track logic).
  - Turn predictor goes yellow 10 s before the turn and red after.
- **Adaptive curve extensions:** 90 m within 40% of track spacing. "Coverage track" needs a field name.
- **RowSense sensor offset:** −50 to 50. **Vision confidence must be ≥8** (0–10) to be used. Vision calibration needs more than 30 m of driving; recalibrate when the crop has grown more than 30 cm.
- **AutoPath shift limits:** 12 in while engaged, 30 in total (or up to 100 in with the checkbox).
- **TIM:** at least 60 cm recommended (TIM settings, StarFire position).

---

## Batch 12: SeedStar planter (142 pages; read with a fact filter)

- **Fast Start:** meters run at a simulated 1.6 km/h for 6 s or until ground speed reaches 2.4 km/h. Times out if there's no motion within 6 s. Needs EPG and frame height.
- **Meter drive states:** Engaged, Ready (various unmet conditions), Commanded Off (SC), Error. Red row = under 50% of target population.
- **★ Row Unit Controllers (RUC) on CAN:**
  - **RUC Row Addressing** shows each RUC's control-unit ID, **CAN bus address**, serial number and address state (OK / Error).
  - Error usually means wiring: check terminals, power and ground, **CAN Hi/Lo voltage**, and the **address wires**. So RUCs get their CAN address from the harness position.
  - RUC hardware/software pages list part number, software version and an **Rx message count** per row.
- **Sensor electrical specs** (handy for probing):
  - Most analog sensors: **5 V supply (4.5–5.5 V range), signal 0.5–4.5 V**. Pneumatic sensors read 0.08–4.9 V.
  - Liquid fertilizer pressure sensor: 0–1380 kPa sensor range, 690 kPa system maximum. Operating 103–621 kPa; do not exceed 689 kPa.
  - Vacuum sensors read in inches of H2O.
  - Gauge-wheel downforce load sensors measure applied load.
  - **Ride quality = row-unit accelerometers** (100% = no vibration).
  - Pneumatic downforce operates at 101–1136 kPa.
- **Downforce:**
  - Target margin (default 45 kg / 100 lb), with high and low margin alarms.
  - Ground contact alarm default 80%. Ride quality default 50%.
  - Active downforce pause timer 5–30 s (default 15).
  - Increment 4.5–222 N (default 89 N).
  - Hydraulic downforce (IRHD) has valve tests and needs 138–221 bar and oil above 49 °C.
- **Seed metrics:**
  - **Singulation** (default alarm 92%; perfect = 100%).
  - **Spacing CV** (0 best to 1 worst; default 0.16).
  - Population high/low alarms (default 10%), seed disk holes (default 32), population adjust factor 1.00.
- **Row cleaners and closing wheels (pneumatic):**
  - Row cleaner pressure 7–200 kPa (default 21).
  - Closing wheels: position 0 ≈ 9 kg (rubber) or 27 kg (cast iron); position 5 adds 32 kg.
  - Status: within 15% green, 15–25% amber, over 25% red.
- **Frame control:** height set points (transport 80%, folding 30%, plant 20%). Functions time out after 60 s. Implement Automation is required for rockshaft-connected folding planters. Cylinder walking allows 32 km/h for 2 h at half load.
- **Meter start/stop height:** start 50%, stop 25%; below 20% isn't recommended. Momentary-style height switches ignore these settings.
- **Utilities:**
  - Fill (meters turn 3 s) and BrushBelt purge (1 s ≈ 2 belt revolutions). Prerequisites: raised, stationary, EPG active, no RUC or motor faults, vacuum at operating level.
  - Switching manual and automatic vacuum needs a power cycle. Each vacuum blower needs its own SCV.
- **Mechanical delay:** 0.10–15 s.
- **Speed sources:** tractor wheel speed, ground speed, implement wheel-motion sensor.
- **Tests:** air purge (below 186 bar), valve flush (below 100 bar), seed sensor test, runoff (not while planting).

---

# Crawl complete: 944 pages across 69 folders, all read (batches 1–12)
