-- G5Link RTK package: StarFire-style receivers, correction subscriptions, RTK base stations, RTK-X,
-- a simulated GNSS position error per correction level, feature gates, and monthly billing.
--
-- The error only moves what G5Link reports (telemetry positions, work-area geometry, headland points):
-- the vehicle itself still drives where the game, base game steering assist or Enhanced Vehicle puts it,
-- so a low correction level shows up as drift, skips and overlaps on the G5 maps, like a real display.
--
-- Base stations are placeables built from the construction menu: any placeable of the farm with "RTK" in
-- its name or xml file (e.g. the John Deere RTK Stations pack). One placed during play self-surveys first;
-- ones already on the map when the savegame loads count as surveyed.
-- State per savegame: modSettings/FS25_G5Link/rtk_<savegame>.xml (receivers, subscriptions, survey times,
-- prices, ledger). rtk.json is written for the bridge. Money moves on the server only.
-- Game calls used (as in FS25_FarmFinance, which runs in game): g_currentMission:addMoney(amount, farmId,
-- moneyType, true, true), MoneyType.register, FinanceStats.statNames, MessageType.PERIOD_CHANGED,
-- environment.currentPeriod / currentDay / currentHour / currentMinute.

G5LinkRtk = {}

-- Correction levels, worst to best. sigma: stationary error per axis (m); tau: correlation time (s).
-- p2p: the 15-minute pass-to-pass figure the level is sized for (Deere's published SF1/SF2/SF3/RTK values).
G5LinkRtk.LEVELS = {
    { id = "NONE", name = "3D-None", sigma = 0.80, tau = 600, p2p = 1.50 },
    { id = "SF1", name = "SF1", sigma = 0.086, tau = 1800, p2p = 0.15 },
    { id = "SF2", name = "SF2", sigma = 0.029, tau = 1800, p2p = 0.05 },
    { id = "SF3", name = "SF3", sigma = 0.017, tau = 1800, p2p = 0.03 },
    { id = "RTK", name = "RTK", sigma = 0.012, tau = 3600, p2p = 0.025 },
}
G5LinkRtk.LEVEL = { NONE = 1, SF1 = 2, SF2 = 3, SF3 = 4, RTK = 5 }

-- Receivers: which satellite corrections they can run, and how long RTK-X holds RTK after losing it.
-- maxSat: best satellite correction it runs; mrtk: can use Mobile RTK; none: no receiver at all.
G5LinkRtk.RECEIVERS = {
    NONE = { name = "No GPS receiver", none = true, maxSat = "NONE", sfRtk = false, mrtk = false, rtkxGameMin = 0 },
    SF3000 = { name = "StarFire 3000", maxSat = "SF2", sfRtk = false, mrtk = false, rtkxGameMin = 15 },
    SF6000 = { name = "StarFire 6000", maxSat = "SF3", sfRtk = false, mrtk = true, rtkxGameMin = 14 * 24 * 60 },
    SF7000 = { name = "StarFire 7000", maxSat = "SF3", sfRtk = true, mrtk = true, rtkxGameMin = 14 * 24 * 60 },
    OTHER = { name = "Third-party GPS", maxSat = "SF3", sfRtk = false, mrtk = true, rtkxGameMin = 15 },
}
G5LinkRtk.DEFAULT_RECEIVER = "SF6000"
G5LinkRtk.SUBSCRIPTIONS = { "SF2", "SF3", "MRTK", "SFRTK" }       -- monthly, per machine
G5LinkRtk.SUB_NAMES = { SF2 = "SF2", SF3 = "SF3", MRTK = "Mobile RTK", SFRTK = "SF-RTK" }
G5LinkRtk.DEFAULT_PRICES = {
    SF2 = 70, SF3 = 120, MRTK = 130, SFRTK = 170,                  -- per month
    RTK = 2500, SF7000 = 9000, AUTOTRAC = 1500, SECTION = 1500,    -- one time
    SF3000 = 4000, SF6000 = 7000,                                  -- GPS shop options on machines (with SF7000 and RTK)
    SHOP_GPS = 1,                                                  -- 1 = price GPS shop options from this list, 0 = the mods' own
    BASE = 15000, BASE_UPKEEP = 10,                                -- shop price and daily upkeep set on RTK station placeables (0 = the mod's own)
}
G5LinkRtk.BASE_PATTERNS = { "rtk", "basestation", "base station" }  -- placeable name / xml file, lower case
G5LinkRtk.SCAN_INTERVAL = 5000       -- ms between placeable scans
-- Pull-in (real seconds) from SF1 to the subscribed level after the receiver starts, and RTK fix time.
G5LinkRtk.PULL_IN = { SF2 = 120, SF3 = 240, SFRTK = 300 }
G5LinkRtk.RTK_FIX = 10
G5LinkRtk.BASE_RANGE = 3000          -- m radio range of a base station
G5LinkRtk.BASE_SURVEY_MIN = 120      -- game minutes of self-survey after placing a base
-- Feature gates (minimum level), like Deere activations.
G5LinkRtk.GATES = { headland = "SF2", grainCart = "SF3", autotrac = "SF1", section = "SF1" }   -- autotrac and section also need their activation
G5LinkRtk.MONEY_STAT = "g5linkRtk"
G5LinkRtk.TICK = 250

local function call(obj, fname, ...)
    if obj == nil then return nil end
    local fn = obj[fname]
    if type(fn) ~= "function" then return nil end
    local ok, a, b, c = pcall(fn, obj, ...)
    if ok then return a, b, c end
    return nil
end
local function finite(v) return type(v) == "number" and v == v and v ~= math.huge and v ~= -math.huge end
local function isServer() return g_server ~= nil end

local function gaussian()
    local u1 = math.max(1e-9, math.random())
    local u2 = math.random()
    return math.sqrt(-2 * math.log(u1)) * math.cos(2 * math.pi * u2)
end

local function gameMinutes()
    local env = g_currentMission and g_currentMission.environment
    if env == nil then return 0 end
    return (env.currentDay or 0) * 1440 + (env.currentHour or 0) * 60 + (env.currentMinute or 0)
end

local function vehicleUid(v)
    if v == nil then return nil end
    return tostring(v.uniqueId or v.id or "")
end

-- keepHooks: keep listeners and the payer other mods registered (they may load before G5Link).
function G5LinkRtk:reset(keepHooks)
    self.data = nil          -- saved state, loaded per savegame
    self.save = nil
    self.live = {}           -- uid -> {ex, ez, startedAt, rtkAt, rtkLostAt, level, src, accuracy}
    if not keepHooks then
        self.listeners = {}
        self.payer = nil     -- {name, fn}: another mod takes the money (setPayer in the API)
    end
    self.timer = 0
    self.jsonTimer = 0
    self.dirty = true
    self.pendingPeriods = 0
    self.moneyType = nil
    self.bases = nil
    self.scanTimer = nil
end
G5LinkRtk:reset()

---------------------------------------------------------------------------
-- Persistence
---------------------------------------------------------------------------

function G5LinkRtk:saveKey()
    return G5Link:saveKey() or "unsaved"
end

function G5LinkRtk:newData()
    local prices = {}
    for k, v in pairs(G5LinkRtk.DEFAULT_PRICES) do prices[k] = v end
    return { vehicles = {}, surveys = {}, prices = prices, gates = true, ledger = {} }
end

function G5LinkRtk:path(dir, key)
    return dir .. "rtk_" .. string.gsub(key, "[^%w_%-]", "_") .. ".xml"
end

function G5LinkRtk:load(dir)
    local key = self:saveKey()
    if self.data ~= nil and self.save == key then
        return
    end
    local fromUnsaved = self.data ~= nil and self.save == "unsaved" and key ~= "unsaved"
    local previous = self.data
    self.save = key
    self.data = self:newData()
    local path = self:path(dir, key)
    if fileExists(path) then
        local xml = XMLFile.load("G5LinkRtk", path)
        if xml ~= nil then
            local d = self.data
            d.gates = xml:getString("rtk#gates", "true") ~= "false"
            for k, _ in pairs(G5LinkRtk.DEFAULT_PRICES) do
                local p = xml:getFloat("rtk.prices#" .. k, nil)
                if finite(p) and p >= 0 then d.prices[k] = p end
            end
            xml:iterate("rtk.vehicle", function(_, vk)
                local uid = xml:getString(vk .. "#uid", nil)
                if uid ~= nil then
                    local e = { receiver = xml:getString(vk .. "#receiver", G5LinkRtk.DEFAULT_RECEIVER),
                        rtk = xml:getString(vk .. "#rtk", "false") == "true", name = xml:getString(vk .. "#name", ""),
                        autotrac = xml:getString(vk .. "#autotrac", "false") == "true",
                        section = xml:getString(vk .. "#section", "false") == "true",
                        farmId = xml:getInt(vk .. "#farm", 1), subs = {} }
                    if G5LinkRtk.RECEIVERS[e.receiver] == nil then e.receiver = G5LinkRtk.DEFAULT_RECEIVER end
                    for s in string.gmatch(xml:getString(vk .. "#subs", ""), "[%w]+") do e.subs[s] = true end
                    d.vehicles[uid] = e
                end
            end)
            xml:iterate("rtk.survey", function(_, bk)
                local id = xml:getString(bk .. "#id", nil)
                if id ~= nil then d.surveys[id] = xml:getInt(bk .. "#placedAt", -100000) end
            end)
            xml:iterate("rtk.bill", function(_, lk)
                table.insert(d.ledger, { period = xml:getInt(lk .. "#period", 0), day = xml:getInt(lk .. "#day", 0),
                    farmId = xml:getInt(lk .. "#farm", 1), amount = xml:getFloat(lk .. "#amount", 0),
                    kind = xml:getString(lk .. "#kind", "subscription"), item = xml:getString(lk .. "#item", ""),
                    paidBy = xml:getString(lk .. "#paidBy", "G5Link"), text = xml:getString(lk .. "#text", "") })
            end)
            xml:delete()
        end
    elseif fromUnsaved then
        self.data = previous      -- a new game saved for the first time: keep what was set up before
        self:write(dir)
    end
    pcall(self.applyStorePrices, self)
    self.dirty = true
end

function G5LinkRtk:write(dir)
    local d = self.data
    if d == nil or dir == nil then return end
    local xml = XMLFile.create("G5LinkRtk", self:path(dir, self.save or "unsaved"), "rtk")
    if xml == nil then return end
    xml:setString("rtk#gates", d.gates and "true" or "false")
    for k, v in pairs(d.prices) do xml:setFloat("rtk.prices#" .. k, v) end
    local i = 0
    for uid, e in pairs(d.vehicles) do
        local k = string.format("rtk.vehicle(%d)", i)
        local subs = {}
        for s, on in pairs(e.subs) do if on then table.insert(subs, s) end end
        table.sort(subs)
        xml:setString(k .. "#uid", uid)
        xml:setString(k .. "#name", e.name or "")
        xml:setInt(k .. "#farm", e.farmId or 1)
        xml:setString(k .. "#receiver", e.receiver)
        xml:setString(k .. "#rtk", e.rtk and "true" or "false")
        xml:setString(k .. "#autotrac", e.autotrac and "true" or "false")
        xml:setString(k .. "#section", e.section and "true" or "false")
        xml:setString(k .. "#subs", table.concat(subs, ","))
        i = i + 1
    end
    local j = 0
    for id, at in pairs(d.surveys) do
        local k = string.format("rtk.survey(%d)", j)
        xml:setString(k .. "#id", id)
        xml:setInt(k .. "#placedAt", at)
        j = j + 1
    end
    for j, l in ipairs(d.ledger) do
        local k = string.format("rtk.bill(%d)", j - 1)
        xml:setInt(k .. "#period", l.period)
        xml:setInt(k .. "#day", l.day)
        xml:setInt(k .. "#farm", l.farmId)
        xml:setFloat(k .. "#amount", l.amount)
        xml:setString(k .. "#kind", l.kind)
        xml:setString(k .. "#item", l.item)
        xml:setString(k .. "#paidBy", l.paidBy)
        xml:setString(k .. "#text", l.text)
    end
    xml:save()
    xml:delete()
    self.dirty = true
end

---------------------------------------------------------------------------
-- Events (API subscribe) and money
---------------------------------------------------------------------------

function G5LinkRtk:fire(event, ...)
    for _, l in ipairs(self.listeners[event] or {}) do
        if l.target ~= nil then
            pcall(l.fn, l.target, ...)
        else
            pcall(l.fn, ...)
        end
    end
end

function G5LinkRtk:registerMoneyType()
    if self.moneyType ~= nil or MoneyType == nil then
        return self.moneyType or (MoneyType and MoneyType.OTHER)
    end
    MoneyType.__g5Types = MoneyType.__g5Types or {}
    local mt = MoneyType.__g5Types[G5LinkRtk.MONEY_STAT]
    if mt == nil and type(MoneyType.register) == "function" then
        local ok, created = pcall(MoneyType.register, G5LinkRtk.MONEY_STAT, "g5_stat_rtk", g_currentModName or "FS25_G5Link")
        if ok and created ~= nil then
            mt = created
            MoneyType.__g5Types[G5LinkRtk.MONEY_STAT] = created
        end
    end
    if mt ~= nil and FinanceStats ~= nil and FinanceStats.statNames ~= nil and FinanceStats.statNameToIndex ~= nil
        and FinanceStats.statNameToIndex[G5LinkRtk.MONEY_STAT] == nil then
        table.insert(FinanceStats.statNames, G5LinkRtk.MONEY_STAT)
        FinanceStats.statNameToIndex[G5LinkRtk.MONEY_STAT] = #FinanceStats.statNames
        if FinanceStats.statNamesI18n ~= nil and g_i18n ~= nil then
            FinanceStats.statNamesI18n[G5LinkRtk.MONEY_STAT] = g_i18n:getText("g5_stat_rtk")
        end
    end
    self.moneyType = mt or MoneyType.OTHER
    return self.moneyType
end

-- Takes money for one item: the registered payer (e.g. Farm Finance) first, else cash.
-- Returns ok, paidBy.
function G5LinkRtk:charge(farmId, amount, info, dir)
    if not isServer() then
        return false, "notServer"
    end
    if not finite(amount) or amount <= 0 then
        return true, "none"
    end
    local paidBy = "G5Link"
    local took = false
    if self.payer ~= nil then
        local ok, res = pcall(self.payer.fn, farmId, amount, info)
        if ok and res == true then
            took = true
            paidBy = self.payer.name
        end
    end
    if not took then
        g_currentMission:addMoney(-amount, farmId, self:registerMoneyType(), true, true)
    end
    local d = self.data
    table.insert(d.ledger, { period = (g_currentMission.environment and g_currentMission.environment.currentPeriod) or 0,
        day = (g_currentMission.environment and g_currentMission.environment.currentDay) or 0, farmId = farmId,
        amount = amount, kind = info.kind, item = info.item or "", paidBy = paidBy, text = info.description or "" })
    while #d.ledger > 48 do table.remove(d.ledger, 1) end
    self:write(dir)
    return true, paidBy
end

---------------------------------------------------------------------------
-- Machines, subscriptions, bases
---------------------------------------------------------------------------

---------------------------------------------------------------------------
-- Equipment check: GPS hardware from the machine's shop configuration
---------------------------------------------------------------------------
-- Mods offer GPS as a shop option: their own receivers (StarFire 3000/6000/7000 globes, RTK), Buyable GPS
-- (a GPS yes/no option on every vehicle), realGPS and others. storeItem.configurations[configName] holds
-- the option items {name, price, dailyUpkeep, isYesNoOption}; vehicle.configurations[configName] is the
-- index fitted (ConfigurationUtil.getConfigItemByConfigId does the same lookup).
G5LinkRtk.GPS_CONFIG_WORDS = { "gps", "starfire", "rtk", "receiver", "globe", "guidance", "autotrac", "lenk" }
G5LinkRtk.GPS_ITEM_WORDS = { "starfire", "gps", "rtk", "receiver", "globe", "trimble", "novatel", "topcon", "raven", "ag leader",
    "agleader", "leica", "hemisphere", "autopilot", "autotrac", "fendt guide", "s10", "xcn" }
G5LinkRtk.NONE_WORDS = { "no gps", "without", "none", "no receiver", "ohne", "kein", "aucun", "sans" }

local function lower(v) return string.lower(tostring(v or "")) end
local function hasWord(text, words)
    for _, w in ipairs(words) do
        if string.find(text, w, 1, true) ~= nil then return true end
    end
    return false
end
local function yesNoText(key)
    if g_i18n == nil then return nil end
    local ok, t = pcall(g_i18n.getText, g_i18n, key)
    return ok and type(t) == "string" and lower(t) or nil
end

-- Is a configuration (name + items) a GPS option?
function G5LinkRtk.isGpsConfig(configName, items)
    if hasWord(lower(configName), G5LinkRtk.GPS_CONFIG_WORDS) then return true end
    for _, it in ipairs(items or {}) do
        if hasWord(lower(it.name), G5LinkRtk.GPS_ITEM_WORDS) then return true end
    end
    return false
end

-- What one option item fits: receiver id ("NONE", "SF3000", "SF6000", "SF7000", "OTHER"), RTK included.
function G5LinkRtk.classifyGpsItem(item, configName)
    local n = lower(item.name)
    local no = yesNoText("configuration_valueNo")
    local yes = yesNoText("configuration_valueYes")
    if (no ~= nil and n == no) or n == "no" or hasWord(n, G5LinkRtk.NONE_WORDS) then return "NONE", false end
    local rtk = string.find(n, "rtk", 1, true) ~= nil and string.find(n, "no rtk", 1, true) == nil
    if string.find(n, "7000", 1, true) or string.find(n, "7500", 1, true) or string.find(n, "sf-rtk", 1, true) then return "SF7000", rtk end
    if string.find(n, "6000", 1, true) then return "SF6000", rtk end
    if string.find(n, "3000", 1, true) then return "SF3000", rtk end
    if string.find(n, "starfire", 1, true) then return "SF6000", rtk end
    if (yes ~= nil and n == yes) or n == "yes" then
        -- a yes/no GPS option (e.g. Buyable GPS): a receiver with no brand
        return "OTHER", rtk or string.find(lower(configName), "rtk", 1, true) ~= nil
    end
    return "OTHER", rtk
end

-- GPS hardware fitted to a vehicle: {receiver, rtk, option, configName} or nil when it has no GPS option.
function G5LinkRtk:hardwareOf(vehicle)
    if vehicle == nil or type(vehicle.configurations) ~= "table" or g_storeManager == nil then return nil end
    local store = call(g_storeManager, "getItemByXMLFilename", vehicle.configFileName)
    if store == nil or type(store.configurations) ~= "table" then return nil end
    local found = nil
    for configName, items in pairs(store.configurations) do
        if type(items) == "table" and G5LinkRtk.isGpsConfig(configName, items) then
            local idx = vehicle.configurations[configName]
            local item = idx ~= nil and items[idx] or nil
            if item ~= nil then
                local receiver, rtk = G5LinkRtk.classifyGpsItem(item, configName)
                -- several GPS options (receiver + separate RTK yes/no): combine them
                if found == nil then
                    found = { receiver = receiver, rtk = rtk, option = tostring(item.name or ""), configName = configName }
                else
                    if string.find(lower(configName), "rtk", 1, true) ~= nil and receiver ~= "NONE" then
                        found.rtk = true
                    elseif found.receiver == "NONE" or (found.receiver == "OTHER" and receiver ~= "NONE") then
                        found.receiver = receiver
                    end
                    found.rtk = found.rtk or rtk
                    found.option = found.option .. ", " .. tostring(item.name or "")
                end
            end
        end
    end
    return found
end

-- Effective receiver and RTK: shop hardware when the machine has a GPS option, else what G5Link sold.
local function recv(e) return e.hwReceiver or e.receiver end
local function hasRtk(e) return e.hwRtk == true or e.rtk == true end
G5LinkRtk.receiverOf, G5LinkRtk.hasRtkOf = recv, hasRtk

function G5LinkRtk:entry(uid, vehicle)
    local d = self.data
    local e = d.vehicles[uid]
    if e == nil then
        e = { receiver = G5LinkRtk.DEFAULT_RECEIVER, rtk = false, subs = {}, name = "", farmId = 1 }
        d.vehicles[uid] = e
    end
    if vehicle ~= nil then
        e.name = call(vehicle, "getFullName") or e.name
        e.farmId = call(vehicle, "getOwnerFarmId") or e.farmId
        -- equipment check, refreshed every 5 s (the shop's Customize can change it)
        local now = (g_currentMission and g_currentMission.time) or 0
        if e.hwCheckedAt == nil or now - e.hwCheckedAt >= 5000 or now < e.hwCheckedAt then
            e.hwCheckedAt = now
            local ok, hw = pcall(self.hardwareOf, self, vehicle)
            if ok and hw ~= nil then
                e.hwReceiver, e.hwRtk, e.hwOption = hw.receiver, hw.rtk, hw.option
            else
                e.hwReceiver, e.hwRtk, e.hwOption = nil, nil, nil
            end
        end
    end
    return e
end

function G5LinkRtk:monthlyCost(e)
    local total = 0
    for _, s in ipairs(G5LinkRtk.SUBSCRIPTIONS) do
        if e.subs[s] then total = total + (self.data.prices[s] or 0) end
    end
    return total
end

-- Subscribe or cancel (monthly). SF-RTK needs a StarFire 7000; SF3 includes SF2.
function G5LinkRtk:setSubscription(uid, sub, on, vehicle, dir)
    if not isServer() then return false, "notServer" end
    if self.data.prices[sub] == nil or G5LinkRtk.SUB_NAMES[sub] == nil then return false, "unknownSubscription" end
    local e = self:entry(uid, vehicle)
    local r = G5LinkRtk.RECEIVERS[recv(e)] or G5LinkRtk.RECEIVERS.SF6000
    if on and r.none then return false, "needsReceiver" end
    if on and sub == "SFRTK" and not r.sfRtk then return false, "needsSF7000" end
    if on and sub == "SF3" and r.maxSat == "SF2" then return false, "needsSF6000" end
    if on and sub == "MRTK" and not r.mrtk then return false, "needsSF6000" end
    if (e.subs[sub] == true) == on then return true end
    e.subs[sub] = on or nil
    if on and sub == "SF3" then e.subs.SF2 = nil end        -- SF3 covers SF2
    self:write(dir)
    self:fire("subscriptionChanged", e.farmId, uid, sub, on)
    return true
end

-- One-time purchases: "SF7000" receiver upgrade, "RTK" radio activation, "AUTOTRAC" and "SECTION" (Section Control) activations.
function G5LinkRtk:buy(uid, item, vehicle, dir)
    if not isServer() then return false, "notServer" end
    local e = self:entry(uid, vehicle)
    if item == "SF7000" then
        if e.hwReceiver ~= nil then return false, "changeInShop" end    -- the machine's GPS is a shop option
        if e.receiver == "SF7000" then return true end
    elseif item == "RTK" then
        if hasRtk(e) then return true end
        if e.hwReceiver == "NONE" then return false, "needsReceiver" end
    elseif item == "AUTOTRAC" then
        if e.autotrac then return true end
    elseif item == "SECTION" then
        if e.section then return true end
    else
        return false, "unknownItem"
    end
    local price = self.data.prices[item] or 0
    local text = ({ RTK = "RTK activation", AUTOTRAC = "AutoTrac activation", SECTION = "Section Control activation", SF7000 = "StarFire 7000 receiver" })[item] .. (e.name ~= "" and (" - " .. e.name) or "")
    local ok, paidBy = self:charge(e.farmId, price, { kind = "purchase", item = item, vehicleUid = uid, description = text }, dir)
    if not ok then return false, paidBy end
    if item == "SF7000" then e.receiver = "SF7000" elseif item == "AUTOTRAC" then e.autotrac = true elseif item == "SECTION" then e.section = true else e.rtk = true end
    self:write(dir)
    self:fire("purchased", e.farmId, uid, item, price, paidBy)
    return true, paidBy
end

-- RTK base stations: placeables of a farm whose name or xml file says RTK.
local function isBasePlaceable(p)
    local text = string.lower(tostring(call(p, "getName") or "") .. " " .. tostring(p.configFileName or ""))
    for _, pat in ipairs(G5LinkRtk.BASE_PATTERNS) do
        if string.find(text, pat, 1, true) ~= nil then return true end
    end
    return false
end

function G5LinkRtk:scanBases(firstScan)
    local list = {}
    local ps = g_currentMission and g_currentMission.placeableSystem
    for _, p in ipairs(ps and ps.placeables or {}) do
        if p.rootNode ~= nil and isBasePlaceable(p) then
            local ok, x, _, z = pcall(getWorldTranslation, p.rootNode)
            local id = tostring(call(p, "getUniqueId") or p.id or "")
            if ok and finite(x) and finite(z) and id ~= "" then
                if self.data.surveys[id] == nil then
                    -- built while playing: self survey from now; already there at load: surveyed
                    self.data.surveys[id] = firstScan and -100000 or gameMinutes()
                    self.surveysDirty = true
                end
                table.insert(list, { id = id, name = call(p, "getName") or "RTK Station", x = x, z = z,
                    farmId = call(p, "getOwnerFarmId") or 1, placedAt = self.data.surveys[id] })
            end
        end
    end
    self.bases = list
    return list
end

-- Shop price of RTK station placeables from other mods: set to the G5Link price list (the mod's own price is
-- kept and comes back with price 0). Only this game's store item changes; nothing of the other mod is copied.
function G5LinkRtk:applyStorePrices()
    local items = g_storeManager ~= nil and call(g_storeManager, "getItems") or nil
    if type(items) ~= "table" then return end
    local price, upkeep = self.data.prices.BASE or 0, self.data.prices.BASE_UPKEEP or 0
    self.stationItems = {}
    for _, item in pairs(items) do
        local isPlaceable = StoreSpecies == nil or item.species == StoreSpecies.PLACEABLE
        local text = string.lower(tostring(item.name or "") .. " " .. tostring(item.xmlFilename or ""))
        local match = false
        for _, pat in ipairs(G5LinkRtk.BASE_PATTERNS) do
            if string.find(text, pat, 1, true) ~= nil then match = true end
        end
        if type(item.configurations) == "table" then
            pcall(self.priceGpsOptions, self, item)
        end
        if isPlaceable and match and type(item.price) == "number" then
            if item.g5OrigPrice == nil then
                item.g5OrigPrice, item.g5OrigUpkeep = item.price, item.dailyUpkeep or 0
            end
            item.price = price > 0 and price or item.g5OrigPrice
            item.dailyUpkeep = price > 0 and upkeep or item.g5OrigUpkeep
            table.insert(self.stationItems, { name = tostring(item.name or "RTK station"), xml = tostring(item.xmlFilename or ""),
                modPrice = item.g5OrigPrice, modUpkeep = item.g5OrigUpkeep, price = item.price, upkeep = item.dailyUpkeep })
        end
    end
end

-- GPS shop options of a machine priced from the price list: StarFire 3000/6000/7000, a plain "GPS yes"
-- (priced as a StarFire 6000), plus the RTK activation when the option includes RTK. "No GPS" costs nothing.
-- Other brands keep their mod's price. SHOP_GPS 0 puts every original price back.
function G5LinkRtk:priceGpsOptions(item)
    local p = self.data.prices
    local on = (p.SHOP_GPS or 1) ~= 0
    for configName, items in pairs(item.configurations) do
        if type(items) == "table" and G5LinkRtk.isGpsConfig(configName, items) then
            local rtkConfig = string.find(lower(configName), "rtk", 1, true) ~= nil
            for _, it in ipairs(items) do
                if type(it.price) == "number" then
                    if it.g5OrigPrice == nil then it.g5OrigPrice = it.price end
                    local receiver, rtk = G5LinkRtk.classifyGpsItem(it, configName)
                    local price = it.g5OrigPrice
                    if on then
                        if receiver == "NONE" then
                            price = 0
                        elseif rtkConfig and receiver == "OTHER" then
                            price = p.RTK or it.g5OrigPrice                -- a separate "RTK: yes" option
                        elseif receiver ~= "OTHER" or lower(it.name) == "yes" or lower(it.name) == yesNoText("configuration_valueYes")
                            or lower(it.name) == "gps" then
                            local base = receiver == "OTHER" and p.SF6000 or p[receiver]
                            price = (base or it.g5OrigPrice) + (rtk and (p.RTK or 0) or 0)
                        end
                    end
                    it.price = price
                end
            end
            self.gpsOptionItems = self.gpsOptionItems or {}
            self.gpsOptionItems[tostring(item.xmlFilename or item.name)] = { name = tostring(item.name or ""), config = configName, options = #items }
        end
    end
end

function G5LinkRtk:baseState(b)
    local left = G5LinkRtk.BASE_SURVEY_MIN - (gameMinutes() - b.placedAt)
    if left > 0 then return "survey", left end
    return "ok", 0
end

-- Closest base of the farm: base, distance, bearing (deg, 0 = north / -z).
function G5LinkRtk:baseFor(farmId, x, z)
    local best, bd, bearing = nil, math.huge, nil
    for _, b in ipairs(self.bases or {}) do
        if b.farmId == farmId then
            local d = math.sqrt((b.x - x) ^ 2 + (b.z - z) ^ 2)
            if d < bd then best, bd = b, d end
        end
    end
    if best ~= nil then
        bearing = (math.deg(math.atan2(best.x - x, -(best.z - z))) + 360) % 360
    end
    return best, bd, bearing
end

---------------------------------------------------------------------------
-- The receiver: which correction it runs now, and the simulated error
---------------------------------------------------------------------------

-- Best satellite (non-RTK) level the subscriptions allow, with its pull-in time.
function G5LinkRtk:satLevel(e)
    local r = G5LinkRtk.RECEIVERS[recv(e)] or G5LinkRtk.RECEIVERS.SF6000
    if r.none then return "NONE", "None", 0 end
    if e.subs.SFRTK and r.sfRtk then return "RTK", "SF-RTK", G5LinkRtk.PULL_IN.SFRTK end
    if e.subs.SF3 and r.maxSat == "SF3" then return "SF3", "SF3", G5LinkRtk.PULL_IN.SF3 end
    if (e.subs.SF2 or e.subs.SF3) then return "SF2", "SF2", G5LinkRtk.PULL_IN.SF2 end
    return "SF1", "SF1", 0
end

function G5LinkRtk:updateVehicle(vehicle, dt)
    local uid = vehicleUid(vehicle)
    if uid == nil or uid == "" or vehicle.rootNode == nil then return nil end
    local e = self:entry(uid, vehicle)
    local g = self.live[uid]
    local now = (g_currentMission.time or 0) / 1000
    if g == nil then
        g = { ex = 0, ez = 0, startedAt = now, rtkAt = nil, rtkLostAtGame = nil }
        local s = G5LinkRtk.LEVELS[G5LinkRtk.LEVEL.SF1].sigma
        g.ex, g.ez = gaussian() * s, gaussian() * s
        self.live[uid] = g
    end
    local x, _, z = getWorldTranslation(vehicle.rootNode)

    -- RTK by radio (own base + activation) or cellular (M-RTK)
    local rtkSrc = nil
    local base, bdist, bearing = self:baseFor(e.farmId, x, z)
    g.base, g.baseDist, g.baseBearing, g.baseState = nil, nil, nil, nil
    if base ~= nil then
        g.base, g.baseDist, g.baseBearing = base, bdist, bearing
        g.baseState = self:baseState(base)
        if hasRtk(e) and g.baseState == "ok" and bdist <= G5LinkRtk.BASE_RANGE then rtkSrc = "RTK" end
    end
    local rcv = G5LinkRtk.RECEIVERS[recv(e)] or G5LinkRtk.RECEIVERS.SF6000
    if rcv.none then rtkSrc = nil end
    if rtkSrc == nil and e.subs.MRTK and rcv.mrtk then rtkSrc = "M-RTK" end
    local level, src = self:satLevel(e)
    local pull = 0
    if rtkSrc ~= nil then
        if g.rtkAt == nil then g.rtkAt = now end
        g.rtkLostAtGame = nil
        if now - g.rtkAt >= G5LinkRtk.RTK_FIX then
            if g.level ~= "RTK" then g.ex, g.ez = g.ex * 0.1, g.ez * 0.1 end   -- RTK fix snaps in
            level, src = "RTK", rtkSrc
        end
    else
        if g.rtkAt ~= nil and g.level == "RTK" and g.src ~= "SF-RTK" then
            g.rtkLostAtGame = gameMinutes()                                 -- start RTK-X
        end
        g.rtkAt = nil
        if g.rtkLostAtGame ~= nil and gameMinutes() - g.rtkLostAtGame < rcv.rtkxGameMin then
            level, src = "RTK", "RTK-X"
        else
            g.rtkLostAtGame = nil
            local _, _, p = self:satLevel(e)
            pull = p
        end
    end

    -- pull-in: accuracy climbs from SF1 to the satellite level over the pull-in time
    local accuracy = 1
    local sigma = G5LinkRtk.LEVELS[G5LinkRtk.LEVEL[level]].sigma
    if pull > 0 and src ~= "RTK-X" then
        accuracy = math.min(1, (now - g.startedAt) / pull)
        local s1 = G5LinkRtk.LEVELS[G5LinkRtk.LEVEL.SF1].sigma
        sigma = s1 + (sigma - s1) * accuracy
    end
    local tau = G5LinkRtk.LEVELS[G5LinkRtk.LEVEL[level]].tau
    local h = math.min(dt / 1000, 5)
    local k = math.sqrt(2 * h / tau) * sigma
    g.ex = g.ex - g.ex * h / tau + k * gaussian()
    g.ez = g.ez - g.ez * h / tau + k * gaussian()
    if level ~= g.level then self:fire("levelChanged", uid, level, src) end
    g.level, g.src, g.accuracy, g.sigma = level, src, accuracy, sigma
    g.rtkxLeft = g.rtkLostAtGame ~= nil and (rcv.rtkxGameMin - (gameMinutes() - g.rtkLostAtGame)) or nil
    return g, e
end

-- Position offset to add to everything reported for this vehicle.
function G5LinkRtk:offset(vehicle)
    local g = self.live[vehicleUid(vehicle) or ""]
    if g == nil then return 0, 0 end
    return g.ex, g.ez
end

function G5LinkRtk:levelOf(vehicle)
    local g = self.live[vehicleUid(vehicle) or ""]
    return g and G5LinkRtk.LEVEL[g.level] or G5LinkRtk.LEVEL.SF1
end

-- Is a G5Link feature allowed on this vehicle? Returns ok, requiredLevelName.
function G5LinkRtk:allows(vehicle, feature)
    local need = G5LinkRtk.GATES[feature]
    if need == nil or self.data == nil then return true end
    if feature == "autotrac" or feature == "section" then
        -- AutoTrac and Section Control run on any correction (SF1 drifts more) but need a receiver, and
        -- their activation when requirements are on
        local e = self.data.vehicles[vehicleUid(vehicle) or ""]
        if e ~= nil and recv(e) == "NONE" then return false, "receiver" end
        local active = e ~= nil and (feature == "autotrac" and e.autotrac or feature == "section" and e.section)
        if self.data.gates and not active then return false, "activation" end
        return true, need
    end
    if not self.data.gates then return true end
    local g = self.live[vehicleUid(vehicle) or ""]
    local lvl = g and G5LinkRtk.LEVEL[g.level] or G5LinkRtk.LEVEL.SF1
    local acc = g and g.accuracy or 1
    return lvl >= G5LinkRtk.LEVEL[need] and acc >= 1, need
end

---------------------------------------------------------------------------
-- Monthly billing
---------------------------------------------------------------------------

function G5LinkRtk:onPeriodChanged()
    if isServer() then self.pendingPeriods = self.pendingPeriods + 1 end
end

-- Machines that left the game (sold, returned to a lease dealer, deleted) stop
-- billing: their subscriptions are cancelled before the month is charged.
function G5LinkRtk:dropMissingMachines(dir)
    local vs = g_currentMission and g_currentMission.vehicleSystem
    local list = vs and vs.vehicles
    if type(list) ~= "table" or next(list) == nil then return 0 end   -- no vehicle list yet: never guess
    local present = {}
    for _, v in pairs(list) do
        local uid = vehicleUid(v)
        if uid ~= nil and uid ~= "" then present[uid] = true end
    end
    local dropped = 0
    for uid, e in pairs(self.data.vehicles) do
        if not present[uid] and next(e.subs or {}) ~= nil then
            local subs = {}
            for s in pairs(e.subs) do table.insert(subs, s) end
            table.sort(subs)
            e.subs = {}
            dropped = dropped + 1
            for _, s in ipairs(subs) do self:fire("subscriptionChanged", e.farmId, uid, s, false) end
        end
    end
    if dropped > 0 then self:write(dir) end
    return dropped
end

-- Bills every machine's subscriptions, one line per machine, per farm.
function G5LinkRtk:billMonth(dir)
    self:dropMissingMachines(dir)
    local farms = {}
    for uid, e in pairs(self.data.vehicles) do
        local cost = self:monthlyCost(e)
        if cost > 0 then
            local subs = {}
            for _, s in ipairs(G5LinkRtk.SUBSCRIPTIONS) do if e.subs[s] then table.insert(subs, G5LinkRtk.SUB_NAMES[s]) end end
            farms[e.farmId] = farms[e.farmId] or { total = 0, lines = {} }
            table.insert(farms[e.farmId].lines, { vehicleUid = uid, name = e.name, subscriptions = subs, amount = cost })
            farms[e.farmId].total = farms[e.farmId].total + cost
        end
    end
    for farmId, f in pairs(farms) do
        for _, l in ipairs(f.lines) do
            self:charge(farmId, l.amount, { kind = "subscription", item = table.concat(l.subscriptions, "+"), vehicleUid = l.vehicleUid,
                description = "GPS corrections " .. table.concat(l.subscriptions, ", ") .. (l.name ~= "" and (" - " .. l.name) or "") }, dir)
        end
        self:fire("monthBilled", farmId, f.total, f.lines)
    end
end

---------------------------------------------------------------------------
-- Update, telemetry, bridge file, commands
---------------------------------------------------------------------------

function G5LinkRtk:update(vehicle, dt, host)
    if host.dir == nil then return end
    self:load(host.dir)
    if self.pendingPeriods > 0 then
        self.pendingPeriods = self.pendingPeriods - 1
        local ok, err = pcall(self.billMonth, self, host.dir)
        if not ok then print("G5Link: RTK billing failed: " .. tostring(err)) end
    end
    self.scanTimer = (self.scanTimer or G5LinkRtk.SCAN_INTERVAL) + dt
    if self.scanTimer >= G5LinkRtk.SCAN_INTERVAL then
        self.scanTimer = 0
        local before = self.bases and #self.bases or -1
        self:scanBases(self.bases == nil)
        if self.surveysDirty then self.surveysDirty = false self:write(host.dir) end
        if #self.bases ~= before then self.dirty = true end
    end
    self.timer = self.timer + dt
    if self.timer >= G5LinkRtk.TICK then
        if vehicle ~= nil then self:updateVehicle(vehicle, self.timer) end
        self.timer = 0
    end
    self.jsonTimer = self.jsonTimer + dt
    if self.dirty or self.jsonTimer >= 10000 then
        self.jsonTimer = 0
        self.dirty = false
        pcall(self.writeJson, self, host)
    end
end

function G5LinkRtk:write_telemetry(xml, vehicle)
    local uid = vehicleUid(vehicle)
    local g = uid and self.live[uid]
    local e = uid and self.data and self.data.vehicles[uid]
    if g == nil or e == nil then return end
    local k = "g5.gnss"
    local lv = G5LinkRtk.LEVELS[G5LinkRtk.LEVEL[g.level]]
    xml:setString(k .. "#receiver", recv(e))
    xml:setString(k .. "#receiverName", (G5LinkRtk.RECEIVERS[recv(e)] or G5LinkRtk.RECEIVERS.SF6000).name)
    xml:setString(k .. "#hwSource", e.hwReceiver ~= nil and "shop" or "g5link")
    if e.hwOption ~= nil then xml:setString(k .. "#hwOption", e.hwOption) end
    xml:setBool(k .. "#rtkActivated", hasRtk(e))
    xml:setString(k .. "#level", g.level)
    xml:setString(k .. "#src", g.src or g.level)
    xml:setFloat(k .. "#accuracy", math.floor(g.accuracy * 100 + 0.5))
    xml:setFloat(k .. "#p2p", math.floor(lv.p2p * 1000 + 0.5) / 1000)
    xml:setFloat(k .. "#ex", math.floor(g.ex * 1000 + 0.5) / 1000)
    xml:setFloat(k .. "#ez", math.floor(g.ez * 1000 + 0.5) / 1000)
    xml:setBool(k .. "#gates", self.data.gates)
    if g.rtkxLeft ~= nil then xml:setInt(k .. "#rtkxMin", math.max(0, math.floor(g.rtkxLeft))) end
    if g.base ~= nil then
        xml:setString(k .. "#base", g.base.name)
        xml:setString(k .. "#baseState", g.baseState or "ok")
        xml:setInt(k .. "#baseDist", math.floor(g.baseDist + 0.5))
        xml:setInt(k .. "#baseBearing", math.floor(g.baseBearing + 0.5))
        xml:setBool(k .. "#inRange", g.baseDist <= G5LinkRtk.BASE_RANGE)
    end
    local r = self.lastResult
    if r ~= nil then
        xml:setInt(k .. ".result#id", r.id or 0)
        xml:setBool(k .. ".result#ok", r.ok)
        xml:setString(k .. ".result#action", tostring(r.action or ""))
        if r.error ~= nil then xml:setString(k .. ".result#error", tostring(r.error)) end
    end
    for f, _ in pairs(G5LinkRtk.GATES) do
        local ok = self:allows(vehicle, f)
        xml:setBool(k .. ".gate#" .. f, ok)
    end
end

-- rtk.json for the bridge: machines of the farm with receivers and subscriptions, bases, prices, ledger.
function G5LinkRtk:writeJson(host)
    if G5Json == nil or self.data == nil then return end
    local d = self.data
    local out = { save = self.save, gates = d.gates, prices = d.prices, payer = self.payer and self.payer.name or nil,
        baseRange = G5LinkRtk.BASE_RANGE, surveyMin = G5LinkRtk.BASE_SURVEY_MIN, gateLevels = G5LinkRtk.GATES,
        vehicles = {}, bases = {}, ledger = d.ledger, stationItems = self.stationItems or {},
        gpsOptionMachines = (function() local n = 0 for _ in pairs(self.gpsOptionItems or {}) do n = n + 1 end return n end)(), day = (g_currentMission.environment and g_currentMission.environment.currentDay) or 0 }
    local vs = g_currentMission.vehicleSystem
    local seen = {}
    for _, v in pairs(vs and vs.vehicles or {}) do
        if v.spec_motorized ~= nil and v.rootNode ~= nil then
            local uid = vehicleUid(v)
            seen[uid] = true
            local e = d.vehicles[uid]
            if e == nil or e.hwCheckedAt == nil then e = self:entry(uid, v) end
            local subs = {}
            if e ~= nil then for _, s in ipairs(G5LinkRtk.SUBSCRIPTIONS) do if e.subs[s] then table.insert(subs, s) end end end
            local g = self.live[uid]
            table.insert(out.vehicles, { id = uid, name = call(v, "getFullName") or "Vehicle", farmId = call(v, "getOwnerFarmId") or 1,
                receiver = recv(e), rtk = hasRtk(e), autotrac = e.autotrac == true, section = e.section == true, hwSource = e.hwReceiver ~= nil and "shop" or "g5link", hwOption = e.hwOption,
                receiverName = (G5LinkRtk.RECEIVERS[recv(e)] or G5LinkRtk.RECEIVERS.SF6000).name, subs = subs,
                monthly = e and self:monthlyCost(e) or 0, level = g and g.level or nil, src = g and g.src or nil })
            if #out.vehicles >= 120 then break end
        end
    end
    for _, b in ipairs(self.bases or {}) do
        local st, left = self:baseState(b)
        table.insert(out.bases, { id = b.id, name = b.name, x = b.x, z = b.z, farmId = b.farmId, state = st, surveyLeftMin = left })
    end
    local f = createFile(host.dir .. "rtk.json", FileAccess.WRITE)
    if f ~= nil and f ~= 0 then
        fileWrite(f, G5Json.encode(out))
        delete(f)
    end
end

-- "rtk" command, arg "action=...;key=value;...": sub, buy, gates, price.
local function parseArg(s)
    local t = {}
    for k, v in string.gmatch(s or "", "([%w_]+)=([^;]*)") do t[k] = v end
    return t
end

function G5LinkRtk:run(vehicle, cmd, host)
    if cmd.name ~= "rtk" then return false end
    if self.data == nil then self:load(host.dir) end
    local a = parseArg(cmd.arg)
    local uid = a.vehicle
    local target = vehicle
    if uid == nil or uid == "" or uid == "current" then
        uid = vehicleUid(vehicle)
    else
        target = nil
        local vs = g_currentMission.vehicleSystem
        for _, v in pairs(vs and vs.vehicles or {}) do
            if vehicleUid(v) == uid then target = v end
        end
    end
    local ok, res
    if a.action == "sub" and uid ~= nil then
        ok, res = self:setSubscription(uid, a.item, a.on == "1", target, host.dir)
    elseif a.action == "buy" and uid ~= nil then
        ok, res = self:buy(uid, a.item, target, host.dir)
    elseif a.action == "gates" and isServer() then
        self.data.gates = a.on == "1"
        self:write(host.dir)
        ok = true
    elseif a.action == "price" and isServer() then
        local p = tonumber(a.value)
        if self.data.prices[a.item] ~= nil and finite(p) and p >= 0 then
            self.data.prices[a.item] = p
            self:write(host.dir)
            pcall(self.applyStorePrices, self)
            ok = true
        end
    end
    if a.action == nil or (ok == nil and res == nil) then res = res or "unknownAction" end
    self.lastResult = { ok = ok == true, error = ok and nil or res, action = a.action, id = cmd.id }
    print(string.format("G5Link: RTK %s %s -> %s%s", tostring(a.action), tostring(a.item or ""), ok and "ok" or "refused",
        ok and "" or (" (" .. tostring(res) .. ")")))
    self.dirty = true
    return true
end
