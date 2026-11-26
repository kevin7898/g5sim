# John Deere Operations Center: structure notes (for the G5Link Ops Center)

Seen 2026-11-26 in a signed-in account with little data. Captures are kept locally in `reference-shots/ops_*.jpg`
(git-ignored, Deere UI). No account, farm, location or field details are recorded here.

## Shell
- White header: Deere wordmark, "Operations Center", organization switcher on the right.
- Top navigation: **Home, Map, Setup ▾, Plan ▾, Analyze ▾, Service ▾, More ▾**, plus apps grid, JD assistant, "New", help, notifications.
- Home: date and weather strip (conditions, temperature, wind, humidity), then dashboard cards: High Alerts,
  Active Equipment, Setup carousel (e.g. Products), Discover.

## Menus
- **Setup:** Connections, Data Sync (send setup data to displays), Equipment (machines, implements, technology
  devices), Geofences and Curfews, **Land** (fields, boundaries, tracks and flags), Licenses, Products (varieties,
  chemicals, fertilizers, tank mixes), Setup File Creator.
- **Plan:** Prescriptions, Work Planner (work and prescriptions sent to equipment).
- **Analyze:** Field Analyzer (completed work field by field), FieldAgent (scouting imagery), Harvest Profit,
  Machine Analyzer, Machine Reports (fuel, utilization, maintenance), Work Analyzer (reports across fields),
  Work Overview (season to date).

## Land
- Tabs: **Clients and Farms, Fields, Boundaries, Guidance, Flags**. Map / Table toggle. Filter chips: Client, Farm,
  Field, Archived. Actions: Add, Archive, Export, Merge, Move.
- Tree: **Client > Farm > Field**, area per row, totals row ("Totals: 1 Clients, 1 Farms, 1 F...").
- Map legend: **Fields, Last Work Type:** Tillage (brown), Seeding (green), Application (blue), Harvest (orange).
- Field page: tabs Field, Boundaries, Guidance, Flags, Details. A card with the name, "client | farm", and checks for
  **Active Boundary, Entrance, Guidance**. Boundaries list: "<field>-Boundary", "Basic | — | Hand Drawn", area, an
  **Active** marker; "Select Active Boundary"; "+ Add Boundary" with **From Map** (search, select or draw),
  **From a previous operation** (generate in bulk from work data), **Upload** (.dbf .shp .shx .prj .zip).
  Entrances (count). Guidance.
- Boundary map legend: Boundary Type **Impassable** (magenta) and **Passable** (yellow). Satellite background.

## Map (also Field Analyzer)
- Left panel "Map" with tabs **Fields** and **Equipment**; search; filter chips (Client, Farm, Work, Crop for fields;
  Make, Type, Model, Tags for equipment). Fields grouped Active / Inactive with area, a work-layer icon and a chevron.
- Map: **Location History** timeline (date picker, 12:00 AM to 11:59 PM slider), planned-crop selector, a vertical
  tool bar (fit, zoom in/out, locate, settings, comments, weather, measure). "Analyze a Field" panel under the map:
  select a field, then the work-layer icon.
- Equipment needs a modem (JDLink) to appear on the map; otherwise listed as Inactive with an Equipment Status link.

## Service and Analyze, second look
- **Service:** Maintenance (plan maintenance intervals and repairs), PRO Service (diagnose and repair), Service Overview
  (service and maintenance needs across the fleet).
- **Maintenance:** tabs Summary and All Equipment; cards Maintenance Past Due, Maintenance Due Soon, Equipment Without a
  Maintenance Plan, Summary.
- **Work Analyzer:** operation selector (e.g. Seeding) and season; tabs Fields, Work, Varieties, Equipment, Operators,
  Technology; views Work Totals, Performance, Planter Performance.
- **Analyze > Harvest Profit** opens harvestprofit.com (separate sign-in). Its public pages describe: real-time P&L by
  field, crop or operation; Profit Maps (per-acre profit heat map from Operations Center spatial data and costs); grain
  inventory (loads, bins, deliveries); equipment cost analysis (engine hours, repairs, fuel); contracts and marketing
  plans; a budget card per field: Net, Revenue, Expenses (Seed, Chemical, Fertilizer), Cost per Bushel, Market Price.

## What G5Link takes from this
- Same mental model as built: boundaries are per-field records with an active one, and "from a previous operation"
  matches expand-from-coverage. Driven boundaries arrive from displays (Data Sync).
- To add: Client > Farm > Field naming, fields colored by last work type, the field status checks, boundary
  passable/impassable type, a Map page with Fields/Equipment tabs, and location history for machines.
