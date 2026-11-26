# G5Link API for mod authors

G5Link (FS25_G5Link) runs a G5-style display, and its RTK package: StarFire-style receivers per machine,
GPS correction subscriptions, RTK base stations, feature requirements and monthly billing. This API lets
your mod read all of it and, if you run the farm's money, take over the billing.

API version: **1.0.0**. Breaking changes will bump the major version; check `api.getVersion()`.

## Getting the API

Mods load in alphabetical order, so look the API up when you need it, not when your script is sourced:

```lua
local function getG5Link()
    local api = g_currentMission ~= nil and g_currentMission.g5linkAPI or nil
    if api ~= nil and api.isReady() then
        return api
    end
    return nil
end
```

All calls are dot calls (`api.getSubscriptions(farmId)`). Reads return copies. Calls that move money or
change state run on the **server** only; on a client they return `false, "notServer"`.

## Correction levels

`api.getLevels()` returns the levels worst to best: `{id, name, passToPassM}`.

| id | Name | Pass to pass | How a machine gets it |
|---|---|---|---|
| `NONE` | 3D-None | 1.5 m | No corrections |
| `SF1` | SF1 | 15 cm | Free on every receiver |
| `SF2` | SF2 | 5 cm | Monthly subscription `SF2` |
| `SF3` | SF3 | 3 cm | Monthly subscription `SF3` (includes SF2) |
| `RTK` | RTK | 2.5 cm | `MRTK` subscription (cellular), `SFRTK` subscription (StarFire 7000), or the `RTK` activation plus an RTK station in range. RTK-X holds RTK for up to 14 game days after losing it. |

## Receivers and the equipment check

| id | Name | Runs |
|---|---|---|
| `NONE` | No GPS receiver | Nothing (3D-None). No subscriptions, no G5Link GPS features. |
| `SF3000` | StarFire 3000 | SF1, SF2, RTK by radio; RTK-X 15 game min |
| `SF6000` | StarFire 6000 | SF1 to SF3, Mobile RTK, RTK by radio; RTK-X 14 game days. The default when a machine's mod has no GPS option. |
| `SF7000` | StarFire 7000 | Everything, including SF-RTK |
| `OTHER` | Third-party GPS | Like a StarFire 6000; RTK-X 15 game min |

When a vehicle mod offers GPS in its shop configuration (its own StarFire choice, Buyable GPS's yes/no option,
realGPS, a brand like Trimble), G5Link reads the option the machine was bought with and uses it as the receiver;
an option with "RTK" in its name counts as the RTK activation. Change it with Customize in the shop. G5Link
prices those options from its list (`SF3000`, `SF6000` for StarFire 6000 and a plain "GPS: yes", `SF7000`, plus
`RTK` when the option includes RTK; "No GPS" costs nothing; other brands keep their price). `SHOP_GPS = 0` puts
every original price back. A configuration counts as GPS when its name, or one of its options, says GPS,
StarFire, RTK, receiver, globe or a known brand.

`api.getGpsHardware(vehicle)` returns `{receiver, rtk, option}` for any vehicle object, or `nil` when its mod
has no GPS option.

SF2, SF3 and SF-RTK pull in over a few minutes after the receiver starts. A G5Link feature that needs a
level waits for full accuracy.

## Reading

| Call | Returns |
|---|---|
| `api.getPriceList()` | `{SF2, SF3, MRTK, SFRTK}` per month, `{RTK, AUTOTRAC, SF7000}` one time, `SF3000`, `SF6000`, `SHOP_GPS` (GPS shop options), `BASE` and `BASE_UPKEEP` (the shop price G5Link puts on RTK station placeables). |
| `api.getVehicleGnss(vehicleUid)` | `{receiver, receiverName, hardwareSource = "shop"\|"g5link", shopOption, rtkActivated, subscriptions = {...}, monthlyCost}`, plus for a machine someone is driving `level, source ("SF1".."SF3", "RTK", "M-RTK", "SF-RTK", "RTK-X"), accuracy (0-1), errorX, errorZ (m), rtkxMinutesLeft, baseName, baseDistance`. |
| `api.getSubscriptions(farmId)` | Every machine with a subscription: `{vehicleUid, name, farmId, receiver, subscriptions = {"SF3", ...}, monthlyCost}`. `farmId` `nil` = all farms. |
| `api.getMonthlyCost(farmId)` | The farm's total per game month. |
| `api.getBaseStations(farmId)` | RTK stations: `{id (placeable unique id), name, x, z, farmId, state = "survey"\|"ok", surveyLeftMin, rangeM}`. |
| `api.getCharges(farmId)` | The last 48 charges: `{period, day, farmId, amount, kind = "subscription"\|"purchase", item, paidBy, text}`. |
| `api.isFeatureAllowed(vehicleUid, feature)` | `ok, requiredLevel`. Features: `"headland"` (SF2), `"grainCart"` (SF3), `"autotrac"` (a receiver plus the AutoTrac activation; returns `false, "activation"` or `false, "receiver"`). Always `true` when the player turned requirements off, except that AutoTrac still needs a receiver. |

`vehicleUid` is the vehicle's `uniqueId` as a string.

## Changing

```lua
api.setSubscription(vehicleUid, "SF3", true)   -- or false to cancel; "SF2", "SF3", "MRTK", "SFRTK"
api.buy(vehicleUid, "RTK")                     -- one time: "RTK", "AUTOTRAC" activation or "SF7000" receiver
```

Both return `ok, reason`. Reasons: `"notServer"`, `"needsReceiver"`, `"needsSF6000"`, `"needsSF7000"`,
`"changeInShop"` (the receiver is a shop option), `"unknownSubscription"`, `"unknownItem"`.

## RTK stations

Base stations are placeables built from the construction menu. Any placeable whose name or xml file name
contains **RTK** (or "base station") counts, e.g. the John Deere RTK Stations pack. G5Link sets the shop price
and daily upkeep of those items to its price list (`BASE`, `BASE_UPKEEP`; 0 keeps the mod's own price).
One built during play self-surveys for 120 game minutes; the radio range is 3 km. To make your own
placeable an RTK station, put "RTK" in its name or file name.

## Taking over the billing: `setPayer`

G5Link charges subscriptions each game month (`PERIOD_CHANGED`) and purchases when they're made, under its
own finance line ("GPS corrections"). A finance mod can take the money instead:

```lua
api.setPayer("FS25_FarmFinance", function(farmId, amount, info)
    -- info = {kind = "subscription"|"purchase", item, vehicleUid, description}
    -- book it your way (operating line, input account...), then:
    return true          -- you took the money; anything else and G5Link charges the farm in cash
end)
api.clearPayer("FS25_FarmFinance")
api.getPayer()           -- name of the mod that pays, or nil
```

The payer runs on the server, inside `pcall`. The charge history (`getCharges`) records who paid.

Farm Finance (FS25_FarmFinance 0.3.1 or later) registers itself as the payer when both mods are installed. It books
charges on the farm's input account, or on the operating line when the account is full; the player can switch to
operating line only, or to cash, in Farm Finance's input account. When it has no room it returns `false` and G5Link
charges cash. It never replaces a payer another mod already set, and it cancels a machine's subscriptions when a
Farm Finance lease is returned or the machine is sold.

Machines that are no longer in the game (sold, returned, deleted) have their subscriptions cancelled before each
month is billed, with a `subscriptionChanged` event per subscription.

## Events

```lua
api.subscribe("monthBilled", function(self, farmId, total, lines) end, self)
api.subscribe("subscriptionChanged", function(self, farmId, vehicleUid, subscription, active) end, self)
api.subscribe("purchased", function(self, farmId, vehicleUid, item, price, paidBy) end, self)
api.subscribe("levelChanged", function(self, vehicleUid, level, source) end, self)
api.unsubscribe("monthBilled", self)
```

`lines` in `monthBilled` = `{vehicleUid, name, subscriptions, amount}` per machine. With a target, the callback
is called as `callback(target, ...)`. Listeners and the payer stay registered until the savegame is unloaded; register again when one loads (look the API up lazily, as above).
