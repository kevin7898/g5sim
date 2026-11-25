-- G5Link: streams vehicle telemetry to an external display and reads commands back.
--
-- FS25 mods have no sockets, so the bridge is file based:
--   game  -> modSettings/FS25_G5Link/telemetry.xml   (written every WRITE_INTERVAL ms)
--   bridge -> modSettings/FS25_G5Link/commands.xml   (polled every CMD_INTERVAL ms)
-- The companion bridge (Node.js) turns these into a live web app on the LAN.
--
-- API notes (verified against vendored Giants source / community LUADOC):
--   g_localPlayer:getCurrentVehicle()          VehicleStateRecorder.lua
--   Vehicle:getLastSpeed()  -> km/h             Vehicle.lua:2405
--   Vehicle:getChildVehicles() includes self    Vehicle.lua:992
--   VehicleMotor:getGearInfoToDisplay()         VehicleMotor.lua:626
--   Drivable:setCruiseControlMaxSpeed(speed, speedReverse)  (nil-safe per arg)
--   XMLFile.create / :save() / :delete(), XMLFile.load, fileExists
-- Everything that touches a specialization is nil-checked and pcall-wrapped so
-- one odd vehicle can never break the game loop.

G5Link = {}
G5Link.VERSION = "0.2.0"
G5Link.WRITE_INTERVAL = 250   -- ms between telemetry writes (4 Hz)
G5Link.CMD_INTERVAL = 250     -- ms between command file polls
G5Link.MAX_IMPLEMENTS = 8

local function call(obj, fname, ...)
    if obj == nil then
        return nil
    end
    local fn = obj[fname]
    if fn == nil then
        return nil
    end
    local ok, a, b, c, d, e, f, g, h = pcall(fn, obj, ...)
    if ok then
        return a, b, c, d, e, f, g, h
    end
    return nil
end

local function bool(v)
    return v == true
end

local function round(v, digits)
    if v == nil then
        return 0
    end
    local m = 10 ^ (digits or 0)
    return math.floor(v * m + 0.5) / m
end

---------------------------------------------------------------------------
-- Lifecycle
---------------------------------------------------------------------------

function G5Link:loadMap(name)
    local base = getUserProfileAppPath() .. "modSettings/"
    createFolder(base)
    self.dir = base .. "FS25_G5Link/"
    createFolder(self.dir)
    self.telemetryPath = self.dir .. "telemetry.xml"
    self.commandPath = self.dir .. "commands.xml"

    self.writeTimer = 0
    self.cmdTimer = 0
    self.seq = 0
    self.lastCmdId = self:readHighestCommandId()  -- ignore commands left over from last session
    self.lastVehicle = nil
    self:resetWork()

    print(string.format("G5Link %s: writing telemetry to %s", G5Link.VERSION, self.telemetryPath))
end

function G5Link:deleteMap()
    -- Leave a final "no session" file so the display shows the idle screen.
    self:writeIdle("unloaded")
end

function G5Link:resetWork()
    self.work = {
        area = 0,        -- m^2
        time = 0,        -- ms with work recording on
        distance = 0,    -- m driven while recording
        totalDistance = 0,
        fuelUsed = 0,    -- litres while recording
        totalFuel = 0,   -- litres since reset
        lastFuel = nil,
        recording = false
    }
end

function G5Link:update(dt)
    if g_currentMission == nil or g_localPlayer == nil then
        return
    end

    local vehicle = call(g_localPlayer, "getCurrentVehicle")
    if vehicle ~= self.lastVehicle then
        self.lastVehicle = vehicle
        self.work.lastFuel = nil
    end

    if vehicle ~= nil then
        self:accumulateWork(vehicle, dt)
    end

    self.writeTimer = self.writeTimer + dt
    if self.writeTimer >= G5Link.WRITE_INTERVAL then
        self.writeTimer = 0
        self:writeTelemetry(vehicle)
    end

    self.cmdTimer = self.cmdTimer + dt
    if self.cmdTimer >= G5Link.CMD_INTERVAL then
        self.cmdTimer = 0
        self:processCommands(vehicle)
    end
end

---------------------------------------------------------------------------
-- Data collection
---------------------------------------------------------------------------

function G5Link:getConsumer(vehicle, fillTypeName)
    if FillType == nil or FillType[fillTypeName] == nil then
        return nil
    end
    local idx = call(vehicle, "getConsumerFillUnitIndex", FillType[fillTypeName])
    if idx == nil then
        return nil
    end
    local level = call(vehicle, "getFillUnitFillLevel", idx)
    local cap = call(vehicle, "getFillUnitCapacity", idx)
    if level == nil or cap == nil or cap <= 0 then
        return nil
    end
    return level, cap
end

function G5Link:getFuel(vehicle)
    local types = {"DIESEL", "ELECTRICCHARGE", "METHANE"}
    for _, t in ipairs(types) do
        local level, cap = self:getConsumer(vehicle, t)
        if level ~= nil then
            return level, cap, t
        end
    end
    return nil
end

function G5Link:getImplementState(impl)
    local s = {}
    s.name = call(impl, "getFullName") or "Implement"
    s.canLower = impl.getIsLowered ~= nil and impl.getAllowsLowering ~= nil and bool(call(impl, "getAllowsLowering"))
    s.lowered = bool(call(impl, "getIsLowered", false))
    s.canTurnOn = bool(call(impl, "getCanBeTurnedOn"))
    s.turnedOn = bool(call(impl, "getIsTurnedOn"))
    s.width = call(impl, "getAIWorkAreaWidth") or 0

    -- Work areas stand in for "sections": one entry per work area, active or not.
    s.areas = {}
    local spec = impl.spec_workArea
    if spec ~= nil and spec.workAreas ~= nil and impl.getIsWorkAreaActive ~= nil then
        for _, wa in ipairs(spec.workAreas) do
            table.insert(s.areas, bool(call(impl, "getIsWorkAreaActive", wa)))
        end
    end

    s.fills = {}
    local fillUnits = call(impl, "getFillUnits")
    if fillUnits ~= nil then
        for i = 1, #fillUnits do
            local cap = call(impl, "getFillUnitCapacity", i) or 0
            if cap > 0 then
                local level = call(impl, "getFillUnitFillLevel", i) or 0
                local ftIndex = call(impl, "getFillUnitFillType", i)
                local title = ""
                if ftIndex ~= nil and g_fillTypeManager ~= nil then
                    local ft = g_fillTypeManager:getFillTypeByIndex(ftIndex)
                    if ft ~= nil then
                        title = ft.title or ft.name or ""
                    end
                end
                table.insert(s.fills, {title = title, level = level, cap = cap})
            end
        end
    end
    return s
end

function G5Link:getImplements(vehicle)
    local list = {}
    local children = call(vehicle, "getChildVehicles")
    if children == nil then
        return list
    end
    for _, child in ipairs(children) do
        if child ~= vehicle and #list < G5Link.MAX_IMPLEMENTS then
            table.insert(list, child)
        end
    end
    return list
end

function G5Link:isRecording(implements)
    for _, impl in ipairs(implements) do
        local spec = impl.spec_workArea
        if spec ~= nil and spec.workAreas ~= nil and impl.getIsWorkAreaActive ~= nil then
            for _, wa in ipairs(spec.workAreas) do
                if bool(call(impl, "getIsWorkAreaActive", wa)) then
                    return true
                end
            end
        end
    end
    return false
end

function G5Link:accumulateWork(vehicle, dt)
    local speed = call(vehicle, "getLastSpeed") or 0          -- km/h
    local meters = speed / 3.6 * dt / 1000
    local implements = self:getImplements(vehicle)
    local recording = self:isRecording(implements)
    self.work.recording = recording
    self.work.totalDistance = self.work.totalDistance + meters

    local fuel = self:getFuel(vehicle)
    if fuel ~= nil then
        if self.work.lastFuel ~= nil and fuel < self.work.lastFuel then
            local used = self.work.lastFuel - fuel
            if used < 5 then  -- ignore refuels/teleports
                self.work.totalFuel = self.work.totalFuel + used
                if recording then
                    self.work.fuelUsed = self.work.fuelUsed + used
                end
            end
        end
        self.work.lastFuel = fuel
    end

    if recording and speed > 0.3 then
        local width = 0
        for _, impl in ipairs(implements) do
            width = math.max(width, call(impl, "getAIWorkAreaWidth") or 0)
        end
        self.work.time = self.work.time + dt
        self.work.distance = self.work.distance + meters
        self.work.area = self.work.area + width * meters
    end
end

---------------------------------------------------------------------------
-- Telemetry file
---------------------------------------------------------------------------

function G5Link:writeGame(xml)
    local env = g_currentMission.environment
    if env ~= nil then
        xml:setInt("g5.game#day", env.currentDay or 0)
        xml:setInt("g5.game#hour", env.currentHour or 0)
        xml:setInt("g5.game#minute", env.currentMinute or 0)
    end
end

function G5Link:writeIdle(reason)
    if self.telemetryPath == nil then
        return
    end
    local xml = XMLFile.create("G5LinkTelemetry", self.telemetryPath, "g5")
    if xml == nil then
        return
    end
    self.seq = (self.seq or 0) + 1
    xml:setInt("g5#seq", self.seq)
    xml:setString("g5#version", G5Link.VERSION)
    xml:setString("g5#state", reason)
    xml:save()
    xml:delete()
end

function G5Link:writeTelemetry(vehicle)
    local xml = XMLFile.create("G5LinkTelemetry", self.telemetryPath, "g5")
    if xml == nil then
        return
    end
    self.seq = self.seq + 1
    xml:setInt("g5#seq", self.seq)
    xml:setString("g5#version", G5Link.VERSION)
    xml:setInt("g5#time", math.floor(g_currentMission.time or 0))
    xml:setInt("g5#lastCmd", self.lastCmdId)
    self:writeGame(xml)

    if vehicle == nil then
        xml:setString("g5#state", "onfoot")
    else
        xml:setString("g5#state", "vehicle")
        local k = "g5.vehicle"
        xml:setString(k .. "#name", call(vehicle, "getFullName") or "Vehicle")
        xml:setFloat(k .. "#speed", round(call(vehicle, "getLastSpeed") or 0, 1))
        xml:setBool(k .. "#motorOn", bool(call(vehicle, "getIsMotorStarted")))
        xml:setBool(k .. "#ai", bool(call(vehicle, "getIsAIActive")))
        xml:setBool(k .. "#onField", bool(call(vehicle, "getIsOnField")))

        local motor = call(vehicle, "getMotor")
        if motor ~= nil then
            xml:setFloat(k .. "#rpm", round(call(motor, "getLastModulatedMotorRpm") or 0, 0))
            xml:setFloat(k .. "#maxRpm", round(call(motor, "getMaxRpm") or 0, 0))
            xml:setFloat(k .. "#load", round((call(motor, "getSmoothLoadPercentage") or 0) * 100, 0))
            local gear, _, isAuto = call(motor, "getGearInfoToDisplay")
            xml:setString(k .. "#gear", tostring(gear or "N"))
            xml:setBool(k .. "#cvt", bool(isAuto))
            xml:setInt(k .. "#dir", call(motor, "getDrivingDirection") or 0)
        end

        local ccState = call(vehicle, "getCruiseControlState")
        if ccState ~= nil then
            xml:setInt(k .. "#ccState", ccState)
            xml:setFloat(k .. "#ccSpeed", round(call(vehicle, "getCruiseControlSpeed") or 0, 1))
            xml:setFloat(k .. "#ccMax", round(call(vehicle, "getCruiseControlMaxSpeed") or 0, 1))
        end

        local fuel, fuelCap, fuelType = self:getFuel(vehicle)
        if fuel ~= nil then
            xml:setFloat(k .. "#fuel", round(fuel, 1))
            xml:setFloat(k .. "#fuelCap", round(fuelCap, 0))
            xml:setString(k .. "#fuelType", fuelType)
        end
        local def, defCap = self:getConsumer(vehicle, "DEF")
        if def ~= nil then
            xml:setFloat(k .. "#def", round(def, 1))
            xml:setFloat(k .. "#defCap", round(defCap, 0))
        end

        local damage = call(vehicle, "getDamageAmount")
        if damage ~= nil then
            xml:setFloat(k .. "#damage", round(damage * 100, 1))
        end
        local opTime = call(vehicle, "getOperatingTime")
        if opTime ~= nil then
            xml:setFloat(k .. "#hours", round(opTime / 3600000, 1))
        end

        if vehicle.rootNode ~= nil then
            local x, _, z = getWorldTranslation(vehicle.rootNode)
            local dx, _, dz = localDirectionToWorld(vehicle.rootNode, 0, 0, 1)
            local heading = (180 - math.deg(math.atan2(dx, dz))) % 360
            xml:setFloat(k .. "#x", round(x, 1))
            xml:setFloat(k .. "#z", round(z, 1))
            xml:setFloat(k .. "#heading", round(heading, 0))
            if g_farmlandManager ~= nil then
                local fid = call(g_farmlandManager, "getFarmlandIdAtWorldPosition", x, z)
                if fid ~= nil then
                    xml:setInt(k .. "#farmland", fid)
                end
            end
        end

        local implements = self:getImplements(vehicle)
        for i, impl in ipairs(implements) do
            local s = self:getImplementState(impl)
            local ik = string.format("g5.implements.implement(%d)", i - 1)
            xml:setString(ik .. "#name", s.name)
            xml:setBool(ik .. "#canLower", s.canLower)
            xml:setBool(ik .. "#lowered", s.lowered)
            xml:setBool(ik .. "#canTurnOn", s.canTurnOn)
            xml:setBool(ik .. "#turnedOn", s.turnedOn)
            xml:setFloat(ik .. "#width", round(s.width, 2))
            local bits = ""
            for _, a in ipairs(s.areas) do
                bits = bits .. (a and "1" or "0")
            end
            xml:setString(ik .. "#areas", bits)
            for j, f in ipairs(s.fills) do
                local fk = string.format("%s.fill(%d)", ik, j - 1)
                xml:setString(fk .. "#title", f.title)
                xml:setFloat(fk .. "#level", round(f.level, 1))
                xml:setFloat(fk .. "#cap", round(f.cap, 0))
            end
        end

        self:writeCombine(xml, vehicle)
    end

    local w = self.work
    xml:setBool("g5.work#recording", w.recording)
    xml:setFloat("g5.work#area", round(w.area, 0))
    xml:setFloat("g5.work#time", round(w.time / 1000, 0))
    xml:setFloat("g5.work#distance", round(w.distance, 0))
    xml:setFloat("g5.work#totalDistance", round(w.totalDistance, 0))
    xml:setFloat("g5.work#fuelUsed", round(w.fuelUsed, 2))
    xml:setFloat("g5.work#totalFuel", round(w.totalFuel, 2))

    xml:save()
    xml:delete()
end

---------------------------------------------------------------------------
-- Combine and Realistic Harvesting
---------------------------------------------------------------------------

-- Writes a number only when it is a real, finite number (no nil, NaN or math.huge in the XML).
local function setNum(xml, key, v, digits)
    if type(v) == "number" and v == v and v ~= math.huge and v ~= -math.huge then
        xml:setFloat(key, round(v, digits or 2))
    end
end

-- The combine is the vehicle itself or, for trailed harvesters, one of its children.
-- Combine spec: spec_combine.fillUnitIndex is the grain tank (Combine.lua, getCombineFillLevelPercentage).
function G5Link:findCombine(vehicle)
    local children = call(vehicle, "getChildVehicles") or {vehicle}
    for _, c in ipairs(children) do
        if c.spec_combine ~= nil then
            return c
        end
    end
    return nil
end

function G5Link:writeCombine(xml, vehicle)
    local combine = self:findCombine(vehicle)
    if combine == nil then
        return
    end
    local k = "g5.combine"
    xml:setString(k .. "#name", call(combine, "getFullName") or "Combine")
    local idx = combine.spec_combine.fillUnitIndex
    if idx ~= nil then
        setNum(xml, k .. "#tank", call(combine, "getFillUnitFillLevel", idx), 0)
        setNum(xml, k .. "#tankCap", call(combine, "getFillUnitCapacity", idx), 0)
        local ftIndex = call(combine, "getFillUnitFillType", idx)
        if ftIndex ~= nil and g_fillTypeManager ~= nil then
            local ft = g_fillTypeManager:getFillTypeByIndex(ftIndex)
            if ft ~= nil and ft.name ~= "UNKNOWN" then
                xml:setString(k .. "#crop", ft.name or "")
                xml:setString(k .. "#cropTitle", ft.title or ft.name or "")
            end
        end
    end
    xml:setBool(k .. "#turnedOn", bool(call(combine, "getIsTurnedOn")))

    local ok, err = pcall(self.writeRealisticHarvesting, self, xml, combine)
    if not ok and not self.rhErrorLogged then
        self.rhErrorLogged = true
        print("G5Link: Realistic Harvesting read failed: " .. tostring(err))
    end
end

-- Realistic Harvesting (github.com/exekx/FS25_RealisticHarvesting) publishes a read-only
-- global RHM_Api (src/main.lua: getfenv(0)["RHM_Api"]). Every call is pcall-wrapped.
function G5Link:getRhApi()
    local api = RHM_Api
    if type(api) ~= "table" and type(FS25_RealisticHarvesting) == "table" then
        api = FS25_RealisticHarvesting.RHM_Api
    end
    if type(api) == "table" and type(api.isRHMActive) == "function" then
        return api
    end
    return nil
end

function G5Link:writeRealisticHarvesting(xml, combine)
    local api = self:getRhApi()
    if api == nil then
        return
    end
    local function get(fname, ...)
        local fn = api[fname]
        if type(fn) ~= "function" then
            return nil
        end
        local ok, a, b, c = pcall(fn, ...)
        if ok then
            return a, b, c
        end
        return nil
    end
    if get("isRHMActive", combine) ~= true then
        return
    end

    local k = "g5.rh"
    xml:setString(k .. "#version", tostring(get("getVersion") or ""))
    xml:setString(k .. "#crop", tostring(get("getCurrentCrop", combine) or "--"))
    xml:setString(k .. "#mode", tostring(get("getSettingsMode", combine) or "MANUAL"))
    xml:setBool(k .. "#harvesting", get("isActivelyHarvesting", combine) == true)
    xml:setBool(k .. "#ai", get("isAiWorkerActive", combine) == true)
    xml:setBool(k .. "#moistureHigh", get("isMoistureExceeded", combine) == true)
    setNum(xml, k .. "#tier", get("getPackageLevel", combine), 0)

    setNum(xml, k .. "#yield", get("getYield", combine), 2)                  -- t/ha
    setNum(xml, k .. "#lastYield", get("getLastValidYield", combine), 2)     -- t/ha
    setNum(xml, k .. "#tph", get("getTonPerHour", combine), 2)               -- t/h
    setNum(xml, k .. "#haph", get("getHectaresPerHour", combine), 2)         -- ha/h
    setNum(xml, k .. "#avgHaph", get("getAverageHectaresPerHour", combine), 2)
    setNum(xml, k .. "#lph", get("getLitersPerHour", combine), 1)            -- fuel l/h
    setNum(xml, k .. "#width", get("getWorkingWidth", combine), 2)           -- m
    setNum(xml, k .. "#massKg", get("getTotalHarvestedMass", combine), 0)

    setNum(xml, k .. "#moisture", get("getMoisture", combine), 1)            -- %
    setNum(xml, k .. "#moistureLimit", get("getMoistureLimit", combine), 1)
    setNum(xml, k .. "#weeds", get("getWeedRatio", combine), 3)              -- 0..1

    local loss = get("getTotalCropLoss", combine)
    setNum(xml, k .. "#loss", loss, 2)                                       -- %
    setNum(xml, k .. "#lossOverload", get("getOverloadLoss", combine), 2)
    setNum(xml, k .. "#lossMoisture", get("getMoistureLoss", combine), 2)
    setNum(xml, k .. "#lossSettings", get("getSettingsLoss", combine), 2)
    setNum(xml, k .. "#lossSlope", get("getSlopeLoss", combine), 2)
    setNum(xml, k .. "#lossWear", (get("getWearLoss", combine)), 2)
    if type(loss) == "number" then
        local rank = get("getEfficiencyRank", loss)
        if rank ~= nil then
            xml:setString(k .. "#rank", tostring(rank))
        end
    end

    setNum(xml, k .. "#load", get("getEngineLoad", combine), 1)              -- % (can exceed 100)
    setNum(xml, k .. "#targetLoad", get("getTargetEngineLoad", combine), 0)
    setNum(xml, k .. "#recSpeed", get("getRecommendedSpeed", combine), 1)    -- km/h
    setNum(xml, k .. "#efficiency", get("getSettingsEfficiency", combine), 3) -- 0.25..1

    -- Threshing settings: 0..100 % of each control's range. Names depend on machine type
    -- (grain: fan, rotor, concave, upperSieve, lowerSieve, feeder).
    local current = get("getSettings", combine)
    local optimal = get("getOptimalSettings", combine)
    if type(current) == "table" then
        local names = {}
        for name, v in pairs(current) do
            if type(v) == "number" and name ~= "targetEngineLoad" then
                table.insert(names, name)
            end
        end
        table.sort(names)
        for i, name in ipairs(names) do
            local sk = string.format("%s.setting(%d)", k, i - 1)
            xml:setString(sk .. "#name", name)
            setNum(xml, sk .. "#value", current[name], 1)
            local o = type(optimal) == "table" and optimal[name] or nil
            if type(o) == "table" then
                setNum(xml, sk .. "#opt", o.optimal, 1)
                setNum(xml, sk .. "#min", o.min, 1)
                setNum(xml, sk .. "#max", o.max, 1)
                setNum(xml, sk .. "#tol", o.tolerance, 1)
            end
        end
    end

    local trip = get("getCombineTrip", combine)
    if type(trip) == "table" then
        local tk = k .. ".trip"
        setNum(xml, tk .. "#areaHa", trip.harvestedAreaHa, 3)
        setNum(xml, tk .. "#massKg", trip.harvestedMassKg, 0)
        setNum(xml, tk .. "#liters", trip.harvestedLiters, 0)
        setNum(xml, tk .. "#lostLiters", trip.lostLiters, 0)
        setNum(xml, tk .. "#fuelL", trip.fuelUsedL, 1)
        setNum(xml, tk .. "#seconds", trip.sessionDuration, 0)
        setNum(xml, tk .. "#field", trip.fieldId, 0)
        if trip.efficiencyRank ~= nil then
            xml:setString(tk .. "#rank", tostring(trip.efficiencyRank))
        end
    end
end

---------------------------------------------------------------------------
-- Commands from the display
---------------------------------------------------------------------------

function G5Link:readHighestCommandId()
    local highest = 0
    if self.commandPath == nil or not fileExists(self.commandPath) then
        return highest
    end
    local xml = XMLFile.load("G5LinkCommands", self.commandPath)
    if xml == nil then
        return highest
    end
    xml:iterate("commands.cmd", function(_, key)
        highest = math.max(highest, xml:getInt(key .. "#id", 0))
    end)
    xml:delete()
    return highest
end

function G5Link:processCommands(vehicle)
    if not fileExists(self.commandPath) then
        return
    end
    local xml = XMLFile.load("G5LinkCommands", self.commandPath)
    if xml == nil then
        return
    end
    local pending = {}
    xml:iterate("commands.cmd", function(_, key)
        local id = xml:getInt(key .. "#id", 0)
        if id > self.lastCmdId then
            table.insert(pending, {
                id = id,
                name = xml:getString(key .. "#name", ""),
                value = xml:getFloat(key .. "#value", 0),
                index = xml:getInt(key .. "#index", 0)
            })
        end
    end)
    xml:delete()

    table.sort(pending, function(a, b) return a.id < b.id end)
    for _, cmd in ipairs(pending) do
        self.lastCmdId = cmd.id
        self:runCommand(vehicle, cmd)
    end
end

function G5Link:runCommand(vehicle, cmd)
    local name = cmd.name
    if name == "resetWork" then
        self:resetWork()
        return
    end
    if vehicle == nil then
        return
    end

    if name == "motorToggle" then
        if Motorized ~= nil and Motorized.actionEventToggleMotorState ~= nil then
            pcall(Motorized.actionEventToggleMotorState, vehicle, "", 1, nil, false)
        end

    elseif name == "cruiseToggle" then
        local state = call(vehicle, "getCruiseControlState")
        if state ~= nil and Drivable ~= nil then
            local newState = Drivable.CRUISECONTROL_STATE_OFF
            if state == Drivable.CRUISECONTROL_STATE_OFF then
                newState = Drivable.CRUISECONTROL_STATE_ACTIVE
            end
            call(vehicle, "setCruiseControlState", newState)
        end

    elseif name == "cruiseSet" then
        call(vehicle, "setCruiseControlMaxSpeed", cmd.value, nil)

    elseif name == "cruiseAdjust" then
        local current = call(vehicle, "getCruiseControlSpeed")
        if current ~= nil then
            call(vehicle, "setCruiseControlMaxSpeed", current + cmd.value, nil)
        end

    elseif name == "lowerAll" then
        if AttacherJoints ~= nil and AttacherJoints.actionEventLowerAllImplements ~= nil then
            pcall(AttacherJoints.actionEventLowerAllImplements, vehicle, "", 1, nil, false)
        end

    elseif name == "turnOnAll" then
        if TurnOnVehicle ~= nil and TurnOnVehicle.actionEventTurnOnAll ~= nil then
            pcall(TurnOnVehicle.actionEventTurnOnAll, vehicle, "", 1, nil, false)
        end

    elseif name == "implTurnOn" then
        local impl = self:getImplements(vehicle)[cmd.index + 1]
        if impl ~= nil and bool(call(impl, "getCanBeTurnedOn")) then
            call(impl, "setIsTurnedOn", not bool(call(impl, "getIsTurnedOn")))
        end
    end
end

addModEventListener(G5Link)
