-- G5Link rate control and prescriptions (Rx) for sprayers and spreaders, through whichever soil mod is in use:
--   * GIANTS Precision Farming: ExtendedSprayer (LUADOC) - spec = impl[ExtendedSprayer.SPEC_TABLE_NAME],
--     sprayAmountAutoMode, sprayAmountManual (a level between sprayAmountManualMin and Max),
--     impl:setSprayAmountAutoMode(on), impl:setSprayAmountManualValue(level)
--   * Realistic Soil & Fertilizer: g_SoilFertilityManager.sprayerRateManager (src/SprayerRateManager.lua) -
--     getAutoMode/setAutoMode(vehicleId), getIndex/setIndex(vehicleId, i) into SoilConstants.SPRAYER_RATE.STEPS,
--     vehicleId = the root vehicle's id when a tractor carries the sprayer (TargetApplication.rateVehicleId)
-- "Auto" hands variable rate to that mod (its own soil maps). A G5 prescription (rx.xml from the bridge: a grid
-- of rate multipliers over a field) sets the rate cell by cell instead: S&F to the nearest step, Precision
-- Farming to the level it started at times the multiplier.

G5LinkRate = {}
G5LinkRate.TICK = 500
G5LinkRate.RX_INTERVAL = 2000

local function call(obj, fname, ...)
    if obj == nil then return nil end
    local fn = obj[fname]
    if type(fn) ~= "function" then return nil end
    local ok, a, b, c = pcall(fn, obj, ...)
    if ok then return a, b, c end
    return nil
end
local function finite(v) return type(v) == "number" and v == v and v ~= math.huge and v ~= -math.huge end

function G5LinkRate:reset()
    self.rx = { v = -1 }
    self.rxTimer = G5LinkRate.RX_INTERVAL
    self.timer = 0
    self.base = {}          -- PF: level when the prescription started, per implement
    self.last = nil
end
G5LinkRate:reset()

---------------------------------------------------------------------------
-- Which rate system an implement uses
---------------------------------------------------------------------------

local function pfSpec(impl)
    if ExtendedSprayer == nil or ExtendedSprayer.SPEC_TABLE_NAME == nil then return nil end
    local spec = impl[ExtendedSprayer.SPEC_TABLE_NAME]
    if type(spec) == "table" and spec.sprayAmountManual ~= nil then return spec end
    return nil
end

local function sfManager()
    local sfm = g_SoilFertilityManager
    if type(sfm) ~= "table" then return nil end
    local rm = sfm.sprayerRateManager
    if type(rm) == "table" and type(rm.getIndex) == "function" and type(rm.setIndex) == "function" then return rm end
    return nil
end

local function sfSteps()
    local c = SoilConstants
    if type(c) == "table" and type(c.SPRAYER_RATE) == "table" and type(c.SPRAYER_RATE.STEPS) == "table" then
        return c.SPRAYER_RATE.STEPS
    end
    return nil
end

local function sfVehicleId(impl)
    local root = impl.rootVehicle
    if root ~= nil and root ~= impl then return root.id or 0 end
    return impl.id or 0
end

-- {system = "pf"|"sf", impl, ...} for the first sprayer/spreader of the machine, or nil
function G5LinkRate:find(vehicle, host)
    for _, impl in ipairs(host:getImplements(vehicle)) do
        local spec = pfSpec(impl)
        if spec ~= nil then return { system = "pf", impl = impl, spec = spec } end
        if impl.spec_sprayer ~= nil then
            local rm = sfManager()
            if rm ~= nil and sfSteps() ~= nil then return { system = "sf", impl = impl, rm = rm, vid = sfVehicleId(impl) } end
        end
    end
    return nil
end

function G5LinkRate:state(r)
    if r.system == "pf" then
        local s = r.spec
        return { auto = s.sprayAmountAutoMode == true, value = s.sprayAmountManual, min = s.sprayAmountManualMin or 0,
            max = s.sprayAmountManualMax or 0, liming = s.isLiming == true }
    end
    local steps = sfSteps()
    local idx = call(r.rm, "getIndex", r.vid) or 1
    return { auto = call(r.rm, "getAutoMode", r.vid) == true, value = steps[idx] or 1, index = idx, steps = steps }
end

function G5LinkRate:setAuto(r, on)
    if r.system == "pf" then call(r.impl, "setSprayAmountAutoMode", on)
    elseif type(r.rm.setAutoMode) == "function" then pcall(r.rm.setAutoMode, r.rm, r.vid, on) end
end

-- multiplier m relative to the base: S&F nearest step; PF base level x m, rounded and clamped
function G5LinkRate:applyMultiplier(r, m)
    if r.system == "sf" then
        local steps, best, bi = sfSteps(), math.huge, 1
        for i, v in ipairs(steps) do
            if math.abs(v - m) < best then best, bi = math.abs(v - m), i end
        end
        if call(r.rm, "getIndex", r.vid) ~= bi then pcall(r.rm.setIndex, r.rm, r.vid, bi) end
        return steps[bi]
    end
    local key = tostring(r.impl.id or r.impl)
    local s = r.spec
    if self.base[key] == nil then self.base[key] = math.max(1, s.sprayAmountManual or 1) end
    local level = math.floor(self.base[key] * m + 0.5)
    level = math.max(s.sprayAmountManualMin or 0, math.min(s.sprayAmountManualMax or level, level))
    if s.sprayAmountManual ~= level then call(r.impl, "setSprayAmountManualValue", level) end
    return level
end

---------------------------------------------------------------------------
-- rx.xml: <rx v="" id="" name="" field="" cell="10" ox="" oz="" cols="" rows=""><r i="0" m="1,1.2,..."/></rx>
---------------------------------------------------------------------------

function G5LinkRate:loadRx(path)
    if path == nil or not fileExists(path) then
        if self.rx.v ~= -1 then self.rx = { v = -1 } self.base = {} end
        return
    end
    local xml = XMLFile.load("G5LinkRx", path)
    if xml == nil then return end
    local v = xml:getInt("rx#v", 0)
    if v ~= self.rx.v then
        local rx = { v = v, id = xml:getString("rx#id", ""), name = xml:getString("rx#name", ""), field = xml:getString("rx#field", ""),
            cell = xml:getFloat("rx#cell", 10), ox = xml:getFloat("rx#ox", 0), oz = xml:getFloat("rx#oz", 0),
            cols = xml:getInt("rx#cols", 0), rows = {}, active = xml:getString("rx#active", "false") == "true" }
        xml:iterate("rx.r", function(_, key)
            local i = xml:getInt(key .. "#i", -1)
            local list = {}
            for n in string.gmatch(xml:getString(key .. "#m", ""), "[^,]+") do table.insert(list, tonumber(n) or 0) end
            if i >= 0 then rx.rows[i] = list end
        end)
        rx.valid = rx.cell > 0 and rx.cols > 0 and rx.active
        self.rx = rx
        self.base = {}
    end
    xml:delete()
end

-- multiplier of the prescription cell at a point, nil outside the grid or in a 0 cell
function G5LinkRate:rxAt(x, z)
    local rx = self.rx
    if not rx.valid then return nil end
    local c, r = math.floor((x - rx.ox) / rx.cell), math.floor((z - rx.oz) / rx.cell)
    local row = rx.rows[r]
    local m = row and row[c + 1]
    if finite(m) and m > 0 then return m end
    return nil
end

local function centerOf(impl)
    local spec = impl.spec_workArea
    local sx, sz, n = 0, 0, 0
    for _, wa in ipairs(spec and spec.workAreas or {}) do
        -- main work areas only (no auxiliary or ridge-marker areas), as coverage and headland use
        local main = WorkAreaType == nil or wa.type ~= WorkAreaType.AUXILIARY
        if main and g_workAreaTypeManager ~= nil and g_workAreaTypeManager.getWorkAreaTypeIsAIArea ~= nil then
            local ok, isAi = pcall(g_workAreaTypeManager.getWorkAreaTypeIsAIArea, g_workAreaTypeManager, wa.type)
            main = not ok or isAi ~= false
        end
        for _, node in ipairs(main and { wa.start, wa.width } or {}) do
            local ok, x, _, z = pcall(getWorldTranslation, node)
            if ok and finite(x) then sx, sz, n = sx + x, sz + z, n + 1 end
        end
    end
    if n > 0 then return sx / n, sz / n end
    if impl.rootNode ~= nil then local x, _, z = getWorldTranslation(impl.rootNode) return x, z end
    return nil
end

function G5LinkRate:update(vehicle, dt, host)
    self.rxTimer = self.rxTimer + dt
    if self.rxTimer >= G5LinkRate.RX_INTERVAL then
        self.rxTimer = 0
        self:loadRx(host.dir and host.dir .. "rx.xml")
    end
    self.timer = self.timer + dt
    if self.timer < G5LinkRate.TICK then return end
    self.timer = 0
    self.last = nil
    if vehicle == nil then return end
    local r = self:find(vehicle, host)
    if r == nil then return end
    local st = self:state(r)
    local out = { system = r.system, state = st }
    -- follow the prescription while the sprayer is on
    if self.rx.valid and call(r.impl, "getIsTurnedOn") == true then
        local x, z = centerOf(r.impl)
        local ox, oz = 0, 0
        if G5LinkRtk ~= nil then
            local ok, a, b = pcall(G5LinkRtk.offset, G5LinkRtk, vehicle)
            if ok and finite(a) and finite(b) then ox, oz = a, b end
        end
        local m = x and self:rxAt(x + ox, z + oz)       -- the G5 knows the GNSS position
        if m ~= nil then
            if st.auto then self:setAuto(r, false) end
            out.rxRate = m
            out.applied = self:applyMultiplier(r, m)
        end
        out.rxActive = true
    end
    self.last = out
end

function G5LinkRate:write(xml)
    local o = self.last
    if o == nil then return end
    local k = "g5.rate"
    xml:setString(k .. "#system", o.system)
    xml:setBool(k .. "#auto", o.state.auto == true)
    if finite(o.state.value) then xml:setFloat(k .. "#value", o.state.value) end
    if finite(o.state.min) then xml:setFloat(k .. "#min", o.state.min) end
    if finite(o.state.max) then xml:setFloat(k .. "#max", o.state.max) end
    if o.state.steps ~= nil then
        local t = {}
        for _, v in ipairs(o.state.steps) do table.insert(t, tostring(v)) end
        xml:setString(k .. "#steps", table.concat(t, ","))
    end
    if self.rx.valid then
        xml:setString(k .. "#rx", self.rx.id)
        xml:setString(k .. "#rxName", self.rx.name)
    end
    if o.rxActive then xml:setBool(k .. "#rxActive", true) end
    if finite(o.rxRate) then xml:setFloat(k .. "#rxRate", o.rxRate) end
    if finite(o.applied) then xml:setFloat(k .. "#applied", o.applied) end
end

-- rateAuto (value 1/0), rateStep (value +1/-1)
function G5LinkRate:run(vehicle, cmd, host)
    if cmd.name ~= "rateAuto" and cmd.name ~= "rateStep" then return false end
    if vehicle == nil then return true end
    local r = self:find(vehicle, host)
    if r == nil then return true end
    if cmd.name == "rateAuto" then
        self:setAuto(r, cmd.value == 1)
    else
        local st = self:state(r)
        if r.system == "sf" then
            local idx = math.max(1, math.min(#st.steps, (st.index or 1) + (cmd.value > 0 and 1 or -1)))
            pcall(r.rm.setIndex, r.rm, r.vid, idx)
        else
            call(r.impl, "setSprayAmountManualValue", (st.value or 0) + (cmd.value > 0 and 1 or -1))
        end
    end
    return true
end
