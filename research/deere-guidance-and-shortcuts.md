# Deere G5: guidance setup, AutoTrac and the shortcut bar

Research for G5Link (2026-11-26). Sources: the on-screen help in the Deere Display Simulator
(`displaysimulator.deere.com/onscreen_help/tractor/current/en/`, pages named below), our earlier notes
(`deere-help-notes.md` batch 11, `deere-sim-log.md` sessions 3–6) and the reference frames in `reference-shots/`
(kept locally, not committed). Summaries in our own words.

## AutoTrac status: the four-quarter pie

AutoTrac's state is a circle in four quarters (`guidance_autotrac_on_off`, sim-log session 3). Each stage fills a
quarter; the AUTOTRAC shortcut key shows the pie as its icon (`reference-shots/guidance.png`, `cc_tractor.png`).

| Quarters | Stage | Means |
|---|---|---|
| 1/4 | Installed | Steering controller found, activation present |
| 2/4 | Configured | Guidance Master on, Track 0 defined, StarFire signal, no steering faults, speed in range, TCM present, right gear |
| 3/4 | Enabled | Steer ON toggle on (Guidance main page) |
| 4/4 | Engaged | Operator pressed **Resume**: AutoTrac is steering |

- A **Last Exit Code** says why it disengaged or won't engage. **AutoTrac Diagnostics** lists each requirement.
- Engage needs: heading within 80° of the track, within 40 % of track spacing, operator seated, speed under the
  limit. Disengage: below 0.5 km/h, out of seat 7 s (drops to 1/4), Steer OFF (2/4), road/resume switch off (1/4).
  In reverse it stays engaged up to 45 s.
- Resume is a hardware button (armrest / joystick) and a shortcut; Steer ON/OFF is on the Guidance page.

## Guidance main page (`guidance_application_main_page`)

Side module, top to bottom (`reference-shots/guidance.png`): track name ("Planting line …"), **Set Track**,
**Track Spacing** ("60.000ft", three decimals, no space), **Shift Track** (center key, left / right keys),
**Shift Increment** ("1.0 in"); below it **Location** ("5 South / Field").
Also on the page: AutoTrac Diagnostics, **Steer ON/OFF toggle**, **Steering Sensitivity**, Advanced Settings.
The map shows the lightbar, heading chip ("E 90°") and under it the **track number and direction** chip.

- **Track number and direction** (`guidance_track_number_and_direction`): lines away from Track 0, then the
  direction relative to Track 0's heading, e.g. "5S", "3S" → "1S" across a turn; "0" on Track 0.
- **Track spacing** (`guidance_track_spacing`): the distance between passes, independent of the implement's
  working width. Set by distance **or by number of rows × row width**. Spacing = width: no gap; larger: gap;
  smaller: overlap (for tillage, spraying or GPS drift).
- **Shift track** (`guidance_information_and_settings_shift_track_settings`): left/right by the Shift Increment
  (0.01–10 m / 1–360 in), center = current GPS position. **No shift over 0.3 m (12 in) while engaged.** A Shift
  Master switch turns shifting on/off. Shifts can be shared with the work group.
- **Steering sensitivity** 50–200, default 70; forward adjustments for line tracking, heading, heading lead,
  response rate, acquire and curve (each 50–200).
- **Track selection** (`guidance_information_and_settings_track_selection`): with Guidance Track Selection on
  (default) choosing a field picks its first track; with none the track name shows "---". The track never changes
  while engaged.
- **Track list** (`guidance_track_list`, Set Track): current line on top, list with preview and Edit; New Track,
  New Track Set; OK bottom-right switches. The current track can't be deleted.
- **Create straight track** (`guidance_create_track_straight_track`): A + B (B more than 3 m from A), A + Heading
  (0 = N, 90 = E), Auto B (fits the last 5 points after 15 m), Lat/Lon, Lat/Lon + Heading, Machine Access variants.
  Other types: AB curve, adaptive curve, circle, boundary fill, AutoPath.
- **Swap Track** (`guidance_swap_track`): steps to the next track in a Track Set (or all tracks); a shortcut key
  and a Next Track module.

## The shortcut bar (`layout_manager_*`, reference frames)

- One row along the bottom; equal-width keys, MENU last (green). The G5 frame fits about 13 keys.
- Each key: icon, a bold label, and a **status strip** underneath. **Off: black strip, white text. On: green strip,
  white text** (sim-log session 6; G5Link still has a black strip with green text). Keys with an AUTO mode show an
  **LED dot + "AUTO"** in the icon area (WORK, AUTO TURN). Some show a value instead of an icon ("36.0" rate key).
  Keys that can't be used are **grayed out** (FAST START). Two-LED keys exist (RESIDUE).
- Examples: tractor default SETUP, WORK, AUTOTRAC, GUIDANCE, ISOBUS VT, FLAGS, PTO, ENGINE, TRANS, SCV, HITCH,
  CONTROLS, MENU; planter on Guidance SETUP, WORK, SECTION CTL, AUTOTRAC, GUIDANCE, SWAP TRACK, rate, ROW RUNOFF,
  EPG, SEEDSTAR, FAST START, HELP, MENU; combine SETUP, WORK, AUTOTRAC, GUIDANCE, AUTO TURN, SWAP TRACK, SYNC,
  RESIDUE, AUTO ISSUE, AUTO READY ×2, HELP, MENU.
- **Layout Manager > Shortcut Bars**: several named bars (edit, duplicate, create new). **Add Shortcut** picks an
  application (same list as the Menu) then a shortcut; each shortcut once per bar; press and slide to rearrange;
  select and Remove. Run page sets (up to 10 pages) are edited the same way.

## What G5Link should change

1. **Key look:** green ON strip with white text; LED + AUTO keys; grayed-out keys; value keys.
2. **AUTOTRAC key and pie:** four-quarter icon (activation → track/receiver → Steer ON → engaged), OFF/ON strip;
   tapping opens AutoTrac on the Guidance page; Resume engages.
3. **Guidance page like the G5:** Steer ON/OFF toggle, AutoTrac Diagnostics with requirements and the last exit code,
   Steering Sensitivity (50–200), Track Spacing by distance or rows × row width shown "60.000ft", track number and
   direction chip ("5S"), Shift Master, no shift over 0.3 m while engaged, engage rules (80°, 40 % of spacing,
   0.5 km/h), Swap Track key, track selection by field.
4. **Layout Manager for the bar:** choose, order and remove keys from a library (each once), several bars, an
   "Automatic" bar that picks keys for the machine (today's behaviour), GUIDANCE / SWAP TRACK / HELP keys.
