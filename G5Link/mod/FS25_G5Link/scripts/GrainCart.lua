-- G5Link support for Courseplay Grain Cart (MMP Farms, FS25_CourseplayGrainCart, GPL-3.0, optional).
-- Its classes live in the Courseplay mod environment (getfenv(0)[g_modManager.CP_MOD_NAME]), like the
-- add-on itself does it (scripts/GrainCartAddon.lua). Read from its 1.0.1.0 source:
--   GrainCartCommandEvent.sendEvent(cart, combine, command)    server or client, same as its panel and Alt keys
--   AIDriveStrategyUnloadCombine.GC_COMMANDS                    CALL 1 ... MOVE_AWAY 9
--   cart:getCpDriveStrategy():gcGetStatus()                     server / single player
--   GrainCartAddon.clientStatus[cart]                           multiplayer clients
--   GrainCartAddon.hud.selectedCart                             the cart picked in its panel
--   CpGrainCartHud.stateTexts[stateName]                        state -> "CP_grainCart_status_<kind>"
-- Every call is pcall-wrapped; nothing here runs unless the add-on is loaded.

G5LinkGrainCart = {}

G5LinkGrainCart.MAX_DISTANCE = 1500   -- m, the add-on's own panel range (CpGrainCartHud.maxDistance)
G5LinkGrainCart.LIST_INTERVAL = 2000  -- ms between cart searches
G5LinkGrainCart.COMMANDS = { call = "CALL", forward = "NUDGE_FORWARD", back = "NUDGE_BACK", pause = "PAUSE",
    release = "RELEASE", unload = "UNLOAD", left = "NUDGE_LEFT", right = "NUDGE_RIGHT", away = "MOVE_AWAY" }

local function call(obj, fname, ...)
    if obj == nil then
        return nil
    end
    local fn = obj[fname]
    if type(fn) ~= "function" then
        return nil
    end
    local ok, a, b, c = pcall(fn, obj, ...)
    if ok then
        return a, b, c
    end
    return nil
end
local function finite(v) return type(v) == "number" and v == v and v ~= math.huge and v ~= -math.huge end

function G5LinkGrainCart:reset()
    self.carts = {}
    self.listTimer = G5LinkGrainCart.LIST_INTERVAL
    self.selected = nil
    self.lastVehicle = nil
end
G5LinkGrainCart:reset()

-- The Courseplay environment with the add-on's classes, or nil.
function G5LinkGrainCart:env()
    if g_modManager == nil or type(g_modManager.CP_MOD_NAME) ~= "string" then
        return nil
    end
    local ok, env = pcall(function() return getfenv(0)[g_modManager.CP_MOD_NAME] end)
    if not ok or type(env) ~= "table" or type(env.GrainCartCommandEvent) ~= "table"
        or type(env.AIDriveStrategyUnloadCombine) ~= "table" or type(env.AIDriveStrategyUnloadCombine.GC_COMMANDS) ~= "table" then
        return nil
    end
    return env
end

local function isCart(v)
    return call(v, "getIsCpCombineUnloaderActive") == true
end
local function isHarvester(v)
    -- the add-on uses AIUtil.getImplementOrVehicleWithSpecialization(v, Combine) and (v, Pipe)
    for _, c in ipairs(call(v, "getChildVehicles") or { v }) do
        if c.spec_combine ~= nil then
            return true
        end
    end
    return false
end

local function distance(a, b)
    local ok, ax, _, az = pcall(getWorldTranslation, a.rootNode)
    local ok2, bx, _, bz = pcall(getWorldTranslation, b.rootNode)
    if not ok or not ok2 then
        return math.huge
    end
    return math.sqrt((ax - bx) ^ 2 + (az - bz) ^ 2)
end

-- Active grain carts of the player's farm, closest first.
function G5LinkGrainCart:findCarts(vehicle)
    local list = {}
    local vs = g_currentMission and g_currentMission.vehicleSystem
    if vs == nil or type(vs.vehicles) ~= "table" then
        return list
    end
    local farm = call(vehicle, "getOwnerFarmId")
    for _, v in pairs(vs.vehicles) do
        if v ~= vehicle and v.rootNode ~= nil and (farm == nil or call(v, "getOwnerFarmId") == farm) and isCart(v) then
            local root = call(v, "getRootVehicle")
            if root == nil or root == v then
                local d = distance(vehicle, v)
                if d < G5LinkGrainCart.MAX_DISTANCE then
                    table.insert(list, { v = v, d = d })
                end
            end
        end
    end
    table.sort(list, function(a, b) return a.d < b.d end)
    local out = {}
    for _, e in ipairs(list) do table.insert(out, e.v) end
    return out
end

-- The cart to command: the one picked in the add-on's panel if it is in range, else ours, else the closest.
function G5LinkGrainCart:context(vehicle, env, dt)
    if vehicle ~= self.lastVehicle then
        self.lastVehicle = vehicle
        self.listTimer = G5LinkGrainCart.LIST_INTERVAL
    end
    self.listTimer = self.listTimer + (dt or 0)
    local inCart = isCart(vehicle)
    if not inCart and not isHarvester(vehicle) then
        return nil
    end
    if self.listTimer >= G5LinkGrainCart.LIST_INTERVAL then
        self.listTimer = 0
        self.carts = inCart and {} or self:findCarts(vehicle)
    end
    if inCart then
        return { cart = vehicle, inCart = true, carts = 1 }
    end
    local hud = env.GrainCartAddon and env.GrainCartAddon.hud
    local pick = nil
    for _, c in ipairs(self.carts) do
        if hud ~= nil and c == hud.selectedCart then pick = c end
    end
    if pick == nil then
        for _, c in ipairs(self.carts) do
            if c == self.selected then pick = c end
        end
    end
    pick = pick or self.carts[1]
    self.selected = pick
    if pick == nil then
        return { carts = 0, combine = vehicle }
    end
    return { cart = pick, combine = vehicle, carts = #self.carts }
end

function G5LinkGrainCart:status(env, cart)
    local strategy = g_server ~= nil and call(cart, "getCpDriveStrategy") or nil
    if strategy ~= nil and type(strategy.gcGetStatus) == "function" then
        local ok, st = pcall(strategy.gcGetStatus, strategy)
        if ok and type(st) == "table" then
            return st
        end
    end
    local addon = env.GrainCartAddon
    if addon ~= nil and type(addon.clientStatus) == "table" and type(addon.clientStatus[cart]) == "table" then
        return addon.clientStatus[cart]
    end
    return {}
end

-- Fill level of the cart: every fill unit on the tractor and its trailers, except fuel and DEF.
local function cartFill(cart)
    local level, cap = 0, 0
    for _, v in ipairs(call(cart, "getChildVehicles") or { cart }) do
        local units = call(v, "getFillUnits")
        if type(units) == "table" then
            for i = 1, #units do
                local c = call(v, "getFillUnitCapacity", i) or 0
                local ft = call(v, "getFillUnitFillType", i)
                local isFuel = FillType ~= nil and (ft == FillType.DIESEL or ft == FillType.DEF or ft == FillType.ELECTRICCHARGE or ft == FillType.METHANE)
                if c > 0 and not isFuel and v ~= cart then
                    level = level + (call(v, "getFillUnitFillLevel", i) or 0)
                    cap = cap + c
                end
            end
        end
    end
    return level, cap
end

function G5LinkGrainCart:write(xml, vehicle, host, dt)
    local env = self:env()
    if env == nil or vehicle == nil then
        return
    end
    local ctx = self:context(vehicle, env, dt)
    if ctx == nil then
        return
    end
    local k = "g5.grainCart"
    xml:setInt(k .. "#carts", ctx.carts or 0)
    xml:setBool(k .. "#inCart", ctx.inCart == true)
    local cart = ctx.cart
    if cart == nil then
        return
    end
    xml:setString(k .. "#name", call(cart, "getFullName") or "Grain Cart")
    local st = self:status(env, cart)
    if type(st.stateName) == "string" then
        xml:setString(k .. "#state", st.stateName)
        local hudClass = env.CpGrainCartHud
        local key = hudClass and type(hudClass.stateTexts) == "table" and hudClass.stateTexts[st.stateName]
        if type(key) == "string" then
            xml:setString(k .. "#kind", (string.gsub(key, "^CP_grainCart_status_", "")))
        end
    end
    xml:setBool(k .. "#paused", st.paused == true)
    xml:setBool(k .. "#outOfPosition", st.outOfPosition == true)
    xml:setBool(k .. "#released", st.autoCallsBlocked == true)
    if finite(st.nudge) then xml:setFloat(k .. "#nudge", st.nudge) end
    if finite(st.nudgeX) then xml:setFloat(k .. "#nudgeX", st.nudgeX) end
    local level, cap = cartFill(cart)
    if cap > 0 then
        xml:setFloat(k .. "#fill", math.floor(level + 0.5))
        xml:setFloat(k .. "#cap", math.floor(cap + 0.5))
    end
    local ok, x, _, z = pcall(getWorldTranslation, cart.rootNode)
    if ok and finite(x) and finite(z) then
        xml:setFloat(k .. "#x", math.floor(x * 10 + 0.5) / 10)
        xml:setFloat(k .. "#z", math.floor(z * 10 + 0.5) / 10)
        local d = distance(vehicle, cart)
        if finite(d) then xml:setFloat(k .. "#dist", math.floor(d + 0.5)) end
    end
end

-- grainCart command: index = which (1 call ... 9 move away, as GC_COMMANDS); grainCartNext: pick the next cart.
function G5LinkGrainCart:run(vehicle, cmd)
    if cmd.name ~= "grainCart" and cmd.name ~= "grainCartNext" then
        return false
    end
    local env = self:env()
    if env == nil or vehicle == nil then
        return true
    end
    local ctx = self:context(vehicle, env, 0)
    if ctx == nil then
        return true
    end
    if cmd.name == "grainCartNext" then
        if #self.carts > 1 then
            for i, c in ipairs(self.carts) do
                if c == self.selected then
                    self.selected = self.carts[i % #self.carts + 1]
                    break
                end
            end
            local hud = env.GrainCartAddon and env.GrainCartAddon.hud
            if hud ~= nil then hud.selectedCart = self.selected end   -- keep its panel on the same cart
        end
        return true
    end
    local commands = env.AIDriveStrategyUnloadCombine.GC_COMMANDS
    local valid = false
    for _, n in pairs(commands) do
        if n == cmd.index then valid = true end
    end
    if not valid or ctx.cart == nil then
        return true
    end
    local target = ctx.combine
    if ctx.inCart then
        -- in the cart: command it to the closest harvester, as the add-on's panel does
        target = nil
        local best = math.huge
        local vs = g_currentMission and g_currentMission.vehicleSystem
        for _, v in pairs(vs and vs.vehicles or {}) do
            local root = call(v, "getRootVehicle")
            if v ~= ctx.cart and v.rootNode ~= nil and (root == nil or root == v) and isHarvester(v) then
                local d = distance(ctx.cart, v)
                if d < best and d < G5LinkGrainCart.MAX_DISTANCE then best, target = d, v end
            end
        end
    end
    if cmd.index == commands.CALL and target == nil then
        return true
    end
    pcall(env.GrainCartCommandEvent.sendEvent, ctx.cart, target, cmd.index)
    return true
end
