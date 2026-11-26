-- G5Link shortcut controls (pipe, fold, lights, beacon, hazard) and Harvest Automation.
-- Every command calls the same action-event function the keyboard binding calls
-- (Pipe.actionEventTogglePipe, Foldable.actionEventFoldAll, Lights.actionEventToggle*), so the
-- game's own checks, warnings and multiplayer events apply. All calls are pcall-wrapped.

G5LinkControls = {}

G5LinkControls.AUTO_INTERVAL = 1000   -- ms between Harvest Automation speed updates
G5LinkControls.AUTO_STEP = 0.5        -- km/h the cruise speed may change per update
G5LinkControls.AUTO_MIN = 1.0         -- km/h lowest speed automation will set
G5LinkControls.AUTO_LOAD_TARGET = 95  -- % engine load used when Realistic Harvesting is not active
G5LinkControls.AUTO_LOAD_BAND = 4     -- % dead band around the load target

local function call(obj, fname, ...)
    if obj == nil then
        return nil
    end
    local fn = obj[fname]
    if fn == nil then
        return nil
    end
    local ok, a, b, c = pcall(fn, obj, ...)
    if ok then
        return a, b, c
    end
    return nil
end

local function action(class, fname, vehicle)
    if class == nil or vehicle == nil or type(class[fname]) ~= "function" then
        return false
    end
    return (pcall(class[fname], vehicle, "", 1, nil, false))
end

local function round(v, digits)
    local m = 10 ^ (digits or 0)
    return math.floor(v * m + 0.5) / m
end

local function hasBit(mask, bitIndex)
    if type(mask) ~= "number" or type(bitIndex) ~= "number" or bit32 == nil then
        return false
    end
    return bit32.band(mask, 2 ^ bitIndex) ~= 0
end

function G5LinkControls:reset()
    self.auto = { on = false, max = 10, timer = 0, state = "off", target = nil, vehicle = nil }
end
G5LinkControls:reset()

-- The driven vehicle and its children, the driven vehicle first.
local function family(vehicle)
    local list = call(vehicle, "getChildVehicles")
    if type(list) ~= "table" then
        return { vehicle }
    end
    return list
end

-- Unloading pipe: combines, forage harvesters, auger wagons (spec_pipe, numStates > 1).
function G5LinkControls:findPipe(vehicle)
    for _, v in ipairs(family(vehicle)) do
        local spec = v.spec_pipe
        if spec ~= nil and type(spec.numStates) == "number" and spec.numStates > 1 then
            return v
        end
    end
    return nil
end

-- First vehicle with folding parts (a header, a planter, a cultivator). Fold All folds the rest.
function G5LinkControls:findFoldable(vehicle)
    for _, v in ipairs(family(vehicle)) do
        local spec = v.spec_foldable
        if spec ~= nil and spec.hasFoldingParts == true then
            return v
        end
    end
    return nil
end

function G5LinkControls:write(xml, vehicle, host)
    local k = "g5.controls"
    local lights = vehicle.spec_lights
    if lights ~= nil and Lights ~= nil and (lights.numLightTypes or 0) > 0 then
        local mask = lights.lightsTypesMask
        xml:setBool(k .. "#lights", hasBit(mask, Lights.LIGHT_TYPE_DEFAULT))
        xml:setBool(k .. "#workFront", hasBit(mask, Lights.LIGHT_TYPE_WORK_FRONT))
        xml:setBool(k .. "#workBack", hasBit(mask, Lights.LIGHT_TYPE_WORK_BACK))
        xml:setBool(k .. "#hazard", lights.turnLightState ~= nil and lights.turnLightState == Lights.TURNLIGHT_HAZARD)
    end
    if lights ~= nil and type(lights.beaconLights) == "table" and #lights.beaconLights > 0 then
        xml:setBool(k .. "#beacon", lights.beaconLightsActive == true)
    end

    local pipe = self:findPipe(vehicle)
    if pipe ~= nil then
        local spec = pipe.spec_pipe
        xml:setInt(k .. ".pipe#state", spec.currentState or 1)
        xml:setInt(k .. ".pipe#target", spec.targetState or 1)
        xml:setInt(k .. ".pipe#states", spec.numStates or 2)
        xml:setBool(k .. ".pipe#open", (spec.targetState or 1) > 1)
    end

    local fold = self:findFoldable(vehicle)
    if fold ~= nil then
        local spec = fold.spec_foldable
        xml:setBool(k .. ".fold#unfolded", call(fold, "getIsUnfolded") == true)
        xml:setBool(k .. ".fold#moving", (spec.foldMoveDirection or 0) ~= 0)
        xml:setString(k .. ".fold#name", call(fold, "getFullName") or "Implement")
    end

    local a = self.auto
    local ak = "g5.harvestAuto"
    xml:setBool(ak .. "#on", a.on)
    xml:setString(ak .. "#state", a.state)
    xml:setFloat(ak .. "#max", round(a.max, 1))
    if a.target ~= nil then
        xml:setFloat(ak .. "#target", round(a.target, 1))
    end
    if a.source ~= nil then
        xml:setString(ak .. "#source", a.source)
    end
end

-- Returns true when the command was one of ours.
function G5LinkControls:run(vehicle, cmd)
    local name = cmd.name
    if name == "pipeToggle" then
        action(Pipe, "actionEventTogglePipe", self:findPipe(vehicle))
    elseif name == "foldToggle" then
        action(Foldable, "actionEventFoldAll", self:findFoldable(vehicle))
    elseif name == "lightsToggle" then
        action(Lights, "actionEventToggleLights", vehicle)
    elseif name == "beaconToggle" then
        action(Lights, "actionEventToggleBeaconLights", vehicle)
    elseif name == "hazardToggle" then
        action(Lights, "actionEventToggleTurnLightHazard", vehicle)
    elseif name == "workLightsToggle" then
        self:toggleWorkLights(vehicle)
    elseif name == "harvestAuto" then
        -- value 1 = on, 0 = off, anything else toggles
        local on = not self.auto.on
        if cmd.value == 1 then
            on = true
        elseif cmd.value == 0 then
            on = false
        end
        self.auto.on = on
        self.auto.vehicle = on and vehicle or nil
        self.auto.timer = G5LinkControls.AUTO_INTERVAL
        self.auto.state = on and "standby" or "off"
        self.auto.target = nil
    elseif name == "tillageDepth" or name == "tillageDepthAdjust" or name == "tillageLevel" then
        if type(cmd.value) == "number" and cmd.value == cmd.value then
            local list = call(vehicle, "getChildVehicles") or {}
            self:runTillage(vehicle, cmd, list)
        end
    elseif name == "harvestAutoMax" then
        if type(cmd.value) == "number" and cmd.value == cmd.value then
            self.auto.max = math.max(G5LinkControls.AUTO_MIN, math.min(40, cmd.value))
        end
    else
        return false
    end
    return true
end

-- Front and back work lights together: if either is on, both go off; otherwise both come on.
function G5LinkControls:toggleWorkLights(vehicle)
    local spec = vehicle.spec_lights
    if spec == nil or Lights == nil or bit32 == nil or call(vehicle, "getCanToggleLight") ~= true then
        return
    end
    local front, back = Lights.LIGHT_TYPE_WORK_FRONT, Lights.LIGHT_TYPE_WORK_BACK
    if type(front) ~= "number" or type(back) ~= "number" then
        return
    end
    local mask = spec.lightsTypesMask or 0
    local bits = 2 ^ front + 2 ^ back
    if hasBit(mask, front) or hasBit(mask, back) then
        mask = bit32.band(mask, bit32.bnot(bits))
    else
        mask = bit32.bor(mask, bits)
    end
    call(vehicle, "setLightsTypesMask", mask)
end

-- Harvest Automation: keeps the cruise speed at Realistic Harvesting's recommended speed
-- (which follows its target engine load), or, without RH, holds the engine near a load target.
-- It only acts while cruise control is active, the combine is threshing and no AI worker drives.
function G5LinkControls:update(vehicle, dt, host)
    local a = self.auto
    if not a.on then
        return
    end
    if vehicle == nil or vehicle ~= a.vehicle then
        a.on = false
        a.state = "off"
        a.target = nil
        return
    end
    a.timer = a.timer + dt
    if a.timer < G5LinkControls.AUTO_INTERVAL then
        return
    end
    a.timer = 0

    local combine = host:findCombine(vehicle)
    if combine == nil then
        a.state = "noCombine"
        return
    end
    if call(vehicle, "getIsAIActive") == true then
        a.state = "ai"
        return
    end
    if Drivable == nil or call(vehicle, "getCruiseControlState") ~= Drivable.CRUISECONTROL_STATE_ACTIVE then
        a.state = "cruiseOff"
        return
    end
    if call(combine, "getIsTurnedOn") ~= true then
        a.state = "notThreshing"
        return
    end

    local current = call(vehicle, "getCruiseControlSpeed")
    if type(current) ~= "number" then
        a.state = "noCruise"
        return
    end

    local target
    local api = host:getRhApi()
    if api ~= nil then
        local ok, active = pcall(api.isRHMActive, combine)
        if ok and active == true and type(api.getRecommendedSpeed) == "function" then
            local ok2, rec = pcall(api.getRecommendedSpeed, combine)
            local ok3, harvesting = pcall(api.isActivelyHarvesting, combine)
            if ok3 and harvesting ~= true then
                a.state = "noCrop"
                return
            end
            if ok2 and type(rec) == "number" and rec == rec and rec > 0 then
                target = rec
                a.source = "rh"
            end
        end
    end
    if target == nil then
        local motor = call(vehicle, "getMotor")
        local load = call(motor, "getSmoothLoadPercentage")
        if type(load) ~= "number" or load ~= load then
            a.state = "noData"
            return
        end
        load = load * 100
        target = current
        if load > G5LinkControls.AUTO_LOAD_TARGET + G5LinkControls.AUTO_LOAD_BAND then
            target = current - G5LinkControls.AUTO_STEP
        elseif load < G5LinkControls.AUTO_LOAD_TARGET - G5LinkControls.AUTO_LOAD_BAND then
            target = current + G5LinkControls.AUTO_STEP
        end
        a.source = "load"
    end

    target = math.max(G5LinkControls.AUTO_MIN, math.min(a.max, target))
    a.target = target
    local step = math.max(-G5LinkControls.AUTO_STEP, math.min(G5LinkControls.AUTO_STEP, target - current))
    if math.abs(step) >= 0.05 then
        call(vehicle, "setCruiseControlMaxSpeed", round(current + step, 1), nil)
    end
    a.state = "active"
end

---------------------------------------------------------------------------
-- Tillage: tool type from the game's specializations; depth from the FieldPath
-- Realistic Tillage runtime when it is loaded (vehicle.spec_realisticTillage plus
-- vehicle:rtSetTillageDepth / rtChangeTillageDepth, Field-Path-Command exporter/scripts).
---------------------------------------------------------------------------

-- Working depth levels (TruSet-style set point on the display). They match the Cultivator Settings
-- modes (FS25_CultivatorSettings by Glowins: spec.mode 2 shallow, 3 normal, 4 deep).
G5LinkControls.MODE_NAMES = { [2] = "shallow", [3] = "normal", [4] = "deep" }
G5LinkControls.MODE_BY_NAME = { shallow = 2, normal = 3, deep = 4 }
-- Without Realistic Tillage depth, a depth set point (cm) picks a level: up to 10 cm shallow,
-- up to 22 cm normal, deeper is deep (subsoiling).
G5LinkControls.SHALLOW_MAX_CM = 10
G5LinkControls.NORMAL_MAX_CM = 22

local function finite(v) return type(v) == "number" and v == v and v ~= math.huge and v ~= -math.huge end

-- How a tool's working depth can be changed, and the level it is at now.
--   cultivatorSettings: the mod's own spec (spec_CultivatorSettings); with useWorkModes it maps
--     levels to WorkMode states (workModeMapping), otherwise its spec.mode is set directly.
--   workMode: vanilla WorkMode states; Cultivator.onWorkModeChanged applies workMode.useDeepMode.
function G5LinkControls:getDepthModes(impl)
    local cult = impl.spec_cultivator
    if cult == nil then
        return nil
    end
    local cs = impl.spec_CultivatorSettings
    local wm = impl.spec_workMode
    local m = { levels = {} }
    if type(cs) == "table" and type(cs.mode) == "number" and (cs.config or 0) > 1 then
        m.source = "cultivatorSettings"
        m.level = cs.mode
        m.locked = cs.config < 5            -- level fixed by the shop configuration
        if cs.useWorkModes and type(cs.workModeMapping) == "table" then
            for lvl = 2, 4 do
                if cs.workModeMapping[lvl] ~= nil then table.insert(m.levels, lvl) end
            end
        else
            m.levels = { 2, 3, 4 }
        end
        return m
    end
    if type(wm) == "table" and type(wm.workModes) == "table" and #wm.workModes > 1 then
        local hasShallow, hasDeep = nil, nil
        for i, mode in ipairs(wm.workModes) do
            if mode.useDeepMode == false and hasShallow == nil then hasShallow = i end
            if mode.useDeepMode == true and hasDeep == nil then hasDeep = i end
        end
        if hasShallow ~= nil and hasDeep ~= nil then
            m.source = "workMode"
            m.states = { [2] = hasShallow, [3] = hasDeep }
            m.levels = { 2, 3 }
            m.level = cult.useDeepMode == false and 2 or 3
            return m
        end
    end
    return nil
end

-- Cultivator.lua: isSubsoiler, isPowerHarrow, useDeepMode (false = shallow, disc-harrow mode).
function G5LinkControls:getTillage(impl)
    local t
    local cult = impl.spec_cultivator
    local modes = nil
    if cult ~= nil then
        modes = self:getDepthModes(impl)
    end
    if impl.spec_plow ~= nil then
        t = { type = "plow", deep = true }
    elseif cult ~= nil then
        if cult.isPowerHarrow == true then
            t = { type = "powerHarrow" }
        elseif modes ~= nil then
            t = { type = "cultivator" }          -- a level-switching tool stays one tool (one map)
        elseif cult.isSubsoiler == true then
            t = { type = "subsoiler" }
        elseif cult.useDeepMode == false then
            t = { type = "disc" }
        else
            t = { type = "cultivator" }
        end
        t.deep = cult.useDeepMode ~= false
        t.subsoil = cult.isSubsoiler == true
    elseif impl.spec_mulcher ~= nil then
        t = { type = "mulcher" }
    elseif impl.spec_roller ~= nil then
        t = { type = "roller" }
    elseif impl.spec_weeder ~= nil then
        t = { type = "weeder" }
    end
    if t ~= nil and cult ~= nil then
        local lvl = cult.useDeepMode == false and 2 or (cult.isSubsoiler == true and 4 or 3)
        t.level = G5LinkControls.MODE_NAMES[(modes and modes.level) or lvl]
        if modes ~= nil then
            t.modeSource = modes.source
            t.locked = modes.locked == true
            local names = {}
            for _, l in ipairs(modes.levels) do table.insert(names, G5LinkControls.MODE_NAMES[l]) end
            t.levels = table.concat(names, ",")
            if modes.source == "workMode" or (modes.source == "cultivatorSettings" and impl.spec_CultivatorSettings.useWorkModes) then
                t.changeAllowed = call(impl, "getIsWorkModeChangeAllowed") ~= false
            else
                t.changeAllowed = not t.locked
            end
        end
    end
    local rt = impl.spec_realisticTillage
    if type(rt) == "table" and rt.initialized == true then
        t = t or { type = tostring(rt.implementClass or "cultivator") }
        t.rtClass = rt.implementClass
        if finite(rt.depthCm) then t.depth = rt.depthCm end
        if finite(rt.targetDepthCm) then t.target = rt.targetDepthCm end
        if finite(rt.minDepthCm) then t.min = rt.minDepthCm end
        if finite(rt.maxDepthCm) then t.max = rt.maxDepthCm end
        t.limited = rt.depthLimited == true
        t.canSetDepth = type(impl.rtSetTillageDepth) == "function"
    end
    return t
end

function G5LinkControls:writeTillage(xml, key, t)
    xml:setString(key .. "#type", t.type)
    if t.deep ~= nil then xml:setBool(key .. "#deep", t.deep) end
    if t.subsoil ~= nil then xml:setBool(key .. "#subsoil", t.subsoil) end
    if t.level ~= nil then xml:setString(key .. "#level", t.level) end
    if t.levels ~= nil then
        xml:setString(key .. "#levels", t.levels)
        xml:setString(key .. "#modeSource", t.modeSource)
        xml:setBool(key .. "#locked", t.locked == true)
        xml:setBool(key .. "#changeAllowed", t.changeAllowed == true)
    end
    if t.depth ~= nil then
        xml:setFloat(key .. "#depth", round(t.depth, 1))
        xml:setFloat(key .. "#target", round(t.target or t.depth, 1))
        xml:setFloat(key .. "#min", round(t.min or 2, 0))
        xml:setFloat(key .. "#max", round(t.max or 38, 0))
        xml:setBool(key .. "#limited", t.limited == true)
        xml:setBool(key .. "#canSet", t.canSetDepth == true)
        xml:setString(key .. "#source", "realisticTillage")
    end
end

-- Puts one tool at a level (2 shallow, 3 normal, 4 deep) the way its own controls would.
function G5LinkControls:setLevel(impl, level)
    local modes = self:getDepthModes(impl)
    if modes == nil or modes.locked then
        return false
    end
    local available = false
    for _, l in ipairs(modes.levels) do if l == level then available = true end end
    if not available then
        -- deep asked of a two-level tool: use its deepest level
        if level == 4 and modes.source == "workMode" then level = 3 else return false end
    end
    if modes.source == "cultivatorSettings" then
        local cs = impl.spec_CultivatorSettings
        if cs.useWorkModes then
            local state = cs.workModeMapping[level]
            if state ~= nil and call(impl, "getIsWorkModeChangeAllowed") ~= false then
                call(impl, "setWorkMode", state)
                return true
            end
            return false
        end
        -- CultivatorSettings:TOGGLE sets spec.mode and raises the dirty flag; onUpdate applies it
        cs.mode = level
        if cs.dirtyFlag ~= nil then
            call(impl, "raiseDirtyFlags", cs.dirtyFlag)
        end
        return true
    end
    if call(impl, "getIsWorkModeChangeAllowed") == false then
        return false
    end
    call(impl, "setWorkMode", modes.states[level])
    return true
end

function G5LinkControls:levelForDepth(cm)
    if cm <= G5LinkControls.SHALLOW_MAX_CM then return 2 end
    if cm <= G5LinkControls.NORMAL_MAX_CM then return 3 end
    return 4
end

-- tillageDepth: TruSet depth set point in cm (value) for every attached tool: Realistic Tillage
--   tools take the depth, level-switching cultivators take the matching level.
-- tillageDepthAdjust: change Realistic Tillage depth by value cm.
-- tillageLevel: value 2 shallow, 3 normal, 4 deep.
function G5LinkControls:runTillage(vehicle, cmd, implements)
    for _, impl in ipairs(implements) do
        if cmd.name == "tillageDepth" then
            if type(impl.rtSetTillageDepth) == "function" then
                pcall(impl.rtSetTillageDepth, impl, cmd.value)
            end
            if impl.spec_cultivator ~= nil then
                self:setLevel(impl, self:levelForDepth(cmd.value))
            end
        elseif cmd.name == "tillageDepthAdjust" and type(impl.rtChangeTillageDepth) == "function" then
            pcall(impl.rtChangeTillageDepth, impl, cmd.value)
        elseif cmd.name == "tillageLevel" and impl.spec_cultivator ~= nil then
            self:setLevel(impl, math.floor(cmd.value + 0.5))
        end
    end
end
