-- G5Link public API for other mods: g_currentMission.g5linkAPI (see API.md in the mod folder).
-- Dot calls (api.getVersion(), not api:getVersion()). Reads return copies. Calls that move money or
-- change state run on the server only; elsewhere they return false, "notServer".

G5LinkAPI = {}
G5LinkAPI.VERSION = "1.0.0"

local function rtk() return G5LinkRtk end
local function dir() return G5Link ~= nil and G5Link.dir or nil end
local function copy(t)
    if type(t) ~= "table" then return t end
    local out = {}
    for k, v in pairs(t) do out[k] = copy(v) end
    return out
end
local function findVehicle(uid)
    local vs = g_currentMission and g_currentMission.vehicleSystem
    for _, v in pairs(vs and vs.vehicles or {}) do
        if tostring(v.uniqueId or v.id or "") == tostring(uid) then return v end
    end
    return nil
end
local function subList(e)
    local list = {}
    for _, s in ipairs(G5LinkRtk.SUBSCRIPTIONS) do
        if e.subs[s] then table.insert(list, s) end
    end
    return list
end

function G5LinkAPI.getVersion()
    return G5LinkAPI.VERSION
end

function G5LinkAPI.isReady()
    return rtk() ~= nil and rtk().data ~= nil
end

---------------------------------------------------------------------------
-- Reads
---------------------------------------------------------------------------

-- Correction levels worst to best: {id, name, passToPassM}
function G5LinkAPI.getLevels()
    local out = {}
    for i, l in ipairs(G5LinkRtk.LEVELS) do out[i] = { id = l.id, name = l.name, passToPassM = l.p2p } end
    return out
end

-- Prices: monthly SF2, SF3, MRTK, SFRTK; one-time RTK (activation), SF7000 (receiver).
-- Base stations are bought in the construction menu (RTK station placeables), not here.
function G5LinkAPI.getPriceList()
    if not G5LinkAPI.isReady() then return {} end
    return copy(rtk().data.prices)
end

-- Receiver and corrections of one machine. Live fields (level, source, accuracy, errorX/Z) are
-- only filled for a machine someone is driving.
function G5LinkAPI.getVehicleGnss(vehicleUid)
    if not G5LinkAPI.isReady() then return nil end
    local uid = tostring(vehicleUid)
    local e = rtk().data.vehicles[uid]
    local g = rtk().live[uid]
    local v = findVehicle(uid)
    if v ~= nil then e = rtk():entry(uid, v) end                -- runs the equipment check
    local out = {
        receiver = e and G5LinkRtk.receiverOf(e) or G5LinkRtk.DEFAULT_RECEIVER,
        receiverName = (G5LinkRtk.RECEIVERS[e and G5LinkRtk.receiverOf(e) or G5LinkRtk.DEFAULT_RECEIVER] or {}).name,
        hardwareSource = e and e.hwReceiver ~= nil and "shop" or "g5link",
        shopOption = e and e.hwOption or nil,
        rtkActivated = e ~= nil and G5LinkRtk.hasRtkOf(e) or false,
        subscriptions = e and subList(e) or {},
        monthlyCost = e and rtk():monthlyCost(e) or 0,
    }
    if g ~= nil then
        out.level = g.level
        out.source = g.src
        out.accuracy = g.accuracy
        out.errorX, out.errorZ = g.ex, g.ez
        out.rtkxMinutesLeft = g.rtkxLeft
        out.baseName = g.base and g.base.name or nil
        out.baseDistance = g.baseDist
    end
    return out
end

-- Every machine with a subscription: {vehicleUid, name, farmId, receiver, subscriptions = {...}, monthlyCost}
function G5LinkAPI.getSubscriptions(farmId)
    local out = {}
    if not G5LinkAPI.isReady() then return out end
    for uid, e in pairs(rtk().data.vehicles) do
        local subs = subList(e)
        if #subs > 0 and (farmId == nil or e.farmId == farmId) then
            table.insert(out, { vehicleUid = uid, name = e.name, farmId = e.farmId, receiver = G5LinkRtk.receiverOf(e),
                subscriptions = subs, monthlyCost = rtk():monthlyCost(e) })
        end
    end
    table.sort(out, function(a, b) return a.vehicleUid < b.vehicleUid end)
    return out
end

-- Total monthly subscription cost of a farm.
function G5LinkAPI.getMonthlyCost(farmId)
    local total = 0
    for _, s in ipairs(G5LinkAPI.getSubscriptions(farmId)) do total = total + s.monthlyCost end
    return total
end

-- Base stations (placed RTK station placeables): {id = placeable unique id, name, x, z, farmId,
-- state = "survey"|"ok", surveyLeftMin, rangeM}
function G5LinkAPI.getBaseStations(farmId)
    local out = {}
    if not G5LinkAPI.isReady() then return out end
    for _, b in ipairs(rtk().bases or {}) do
        if farmId == nil or b.farmId == farmId then
            local st, left = rtk():baseState(b)
            table.insert(out, { id = b.id, name = b.name, x = b.x, z = b.z, farmId = b.farmId, state = st,
                surveyLeftMin = left, rangeM = G5LinkRtk.BASE_RANGE })
        end
    end
    return out
end

-- Charges made (last 48): {period, day, farmId, amount, kind = "subscription"|"purchase", item, paidBy, text}
function G5LinkAPI.getCharges(farmId)
    local out = {}
    if not G5LinkAPI.isReady() then return out end
    for _, l in ipairs(rtk().data.ledger) do
        if farmId == nil or l.farmId == farmId then table.insert(out, copy(l)) end
    end
    return out
end

-- Is a G5Link feature allowed on a machine at its current correction level?
-- Features: "headland" (SF2), "grainCart" (SF3). Returns ok, requiredLevel.
-- Equipment check of any vehicle: the GPS hardware its shop configuration fits, or nil when its mod
-- has no GPS option. {receiver = "NONE"|"SF3000"|"SF6000"|"SF7000"|"OTHER", rtk, option}
function G5LinkAPI.getGpsHardware(vehicle)
    if rtk() == nil or vehicle == nil then return nil end
    local ok, hw = pcall(rtk().hardwareOf, rtk(), vehicle)
    return ok and copy(hw) or nil
end

function G5LinkAPI.isFeatureAllowed(vehicleUid, feature)
    if not G5LinkAPI.isReady() then return true end
    local v = findVehicle(vehicleUid)
    if v == nil then return false, G5LinkRtk.GATES[feature] end
    return rtk():allows(v, feature)
end

---------------------------------------------------------------------------
-- Changes (server only)
---------------------------------------------------------------------------

function G5LinkAPI.setSubscription(vehicleUid, subscription, active)
    if not G5LinkAPI.isReady() then return false, "notReady" end
    return rtk():setSubscription(tostring(vehicleUid), subscription, active == true, findVehicle(vehicleUid), dir())
end

-- item: "SF7000" or "RTK"
function G5LinkAPI.buy(vehicleUid, item)
    if not G5LinkAPI.isReady() then return false, "notReady" end
    return rtk():buy(tostring(vehicleUid), item, findVehicle(vehicleUid), dir())
end

-- A placeable your mod adds can count as an RTK base: put "RTK" in its name or xml file name.

---------------------------------------------------------------------------
-- Billing hand-off
---------------------------------------------------------------------------

-- Let another mod take the money for G5Link's charges (monthly subscriptions and one-time purchases).
-- payFn(farmId, amount, info) runs on the server; return true when your mod booked the money,
-- anything else and G5Link charges the farm in cash. info = {kind = "subscription"|"purchase", item,
-- vehicleUid, description}.
function G5LinkAPI.setPayer(modName, payFn)
    if rtk() == nil then return false, "notReady" end
    if type(payFn) ~= "function" then return false, "noFunction" end
    rtk().payer = { name = tostring(modName or "other mod"), fn = payFn }
    rtk().dirty = true
    return true
end

function G5LinkAPI.clearPayer(modName)
    if rtk() == nil or rtk().payer == nil then return false end
    if modName ~= nil and rtk().payer.name ~= tostring(modName) then return false end
    rtk().payer = nil
    rtk().dirty = true
    return true
end

function G5LinkAPI.getPayer()
    return rtk() ~= nil and rtk().payer ~= nil and rtk().payer.name or nil
end

---------------------------------------------------------------------------
-- Events
---------------------------------------------------------------------------
-- "monthBilled"         (farmId, total, lines)            after each month's subscriptions were charged
-- "subscriptionChanged" (farmId, vehicleUid, subscription, active)
-- "purchased"           (farmId, vehicleUid, item, price, paidBy)
-- "levelChanged"        (vehicleUid, level, source)        the driven machine's correction changed

function G5LinkAPI.subscribe(event, fn, target)
    if rtk() == nil or type(fn) ~= "function" then return false end
    rtk().listeners[event] = rtk().listeners[event] or {}
    table.insert(rtk().listeners[event], { fn = fn, target = target })
    return true
end

function G5LinkAPI.unsubscribe(event, target)
    if rtk() == nil then return false end
    local list = rtk().listeners[event] or {}
    for i = #list, 1, -1 do
        if list[i].target == target then table.remove(list, i) end
    end
    return true
end
