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
G5Link.VERSION = "0.10.0"
G5Link.WRITE_INTERVAL = 250   -- ms between telemetry writes (4 Hz)
G5Link.CMD_INTERVAL = 250     -- ms between command file polls
G5Link.MAX_IMPLEMENTS = 8
G5Link.PROVIDER_INTERVAL = 1000  -- ms between providers.json writes (soil, Courseplay, AutoDrive, mud)
G5Link.COURSE_MAX_POINTS = 4000   -- waypoints kept in course.json
G5Link.SEEDER_INTERVAL = 1000    -- ms between Realistic Seeder snapshots (getSnapshot builds presets each call)
G5Link.FARM_INTERVAL = 5000      -- ms between equipment.json writes (Ops Center)
G5Link.FIELD_CHECK_INTERVAL = 10000  -- ms between field ownership checks (fields.json rewritten on change)
G5Link.MAX_VEHICLES = 120
G5Link.ECONOMY_INTERVAL = 30000  -- ms between economy.json writes (prices, farm finances)
G5Link.FLEET_INTERVAL = 500      -- ms between fleet.xml writes (other working machines, for coverage maps)
G5Link.MAX_FLEET = 16

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
    self.loadNumber = (self.loadNumber or 0) + 1
    local started = type(getDate) == "function" and getDate("%Y%m%d%H%M%S") or "local"
    self.session = string.format("%s-%d-%d", started, math.floor(g_time or 0), self.loadNumber)
    local base = getUserProfileAppPath() .. "modSettings/"
    createFolder(base)
    self.dir = base .. "FS25_G5Link/"
    createFolder(self.dir)
    self.telemetryPath = self.dir .. "telemetry.xml"
    self.commandPath = self.dir .. "commands.xml"
    self.providersPath = self.dir .. "providers.json"
    self.coursePath = self.dir .. "course.json"
    self.providerTimer = 0
    self.providerSeq = 0
    self.lastCourseKey = false
    self.seederCache = {}
    self.equipmentPath = self.dir .. "equipment.json"
    self.fieldsPath = self.dir .. "fields.json"
    self.farmTimer = 0
    self.economyPath = self.dir .. "economy.json"
    self.fleetPath = self.dir .. "fleet.xml"
    self.fleetTimer = 0
    self.fleetSeq = 0
    self.economyTimer = G5Link.ECONOMY_INTERVAL - 3000   -- first write shortly after loading
    self.fieldTimer = G5Link.FIELD_CHECK_INTERVAL  -- first check on the first update (fields are empty during loadMap)
    self.fieldsKey = nil

    self.writeTimer = 0
    self.cmdTimer = 0
    self.seq = 0
    self.lastCmdId = self:readHighestCommandId()  -- ignore commands left over from last session
    self.lastVehicle = nil
    self:resetWork()
    if G5LinkHeadland ~= nil then
        G5LinkHeadland:reset()
    end
    if G5LinkGrainCart ~= nil then
        G5LinkGrainCart:reset()
    end
    if G5LinkSteer ~= nil then
        G5LinkSteer:reset()
    end
    if G5LinkRate ~= nil then
        G5LinkRate:reset()
    end
    if G5LinkSection ~= nil then
        G5LinkSection:reset()
    end
    if G5LinkHyd ~= nil then
        G5LinkHyd:reset()
    end
    if G5LinkRtk ~= nil then
        G5LinkRtk:reset(true)
        if g_messageCenter ~= nil and MessageType ~= nil and MessageType.PERIOD_CHANGED ~= nil then
            pcall(g_messageCenter.subscribe, g_messageCenter, MessageType.PERIOD_CHANGED, G5LinkRtk.onPeriodChanged, G5LinkRtk)
        end
        if G5LinkAPI ~= nil then
            g_currentMission.g5linkAPI = G5LinkAPI
        end
    end

    if G5LinkProviders ~= nil then
        local ok, err = pcall(G5LinkProviders.loadMap, G5LinkProviders)
        if not ok then
            print("G5Link: provider setup failed: " .. tostring(err))
        end
    end

    print(string.format("G5Link %s: writing telemetry to %s", G5Link.VERSION, self.telemetryPath))
end

function G5Link:deleteMap()
    -- Leave a final "no session" file so the display shows the idle screen.
    self:writeIdle("unloaded")
    if G5LinkRtk ~= nil then
        if g_messageCenter ~= nil and g_messageCenter.unsubscribeAll ~= nil then
            pcall(g_messageCenter.unsubscribeAll, g_messageCenter, G5LinkRtk)
        end
        G5LinkRtk:reset(false)
    end
    if g_currentMission ~= nil and g_currentMission.g5linkAPI == G5LinkAPI then
        g_currentMission.g5linkAPI = nil
    end
    if G5LinkProviders ~= nil then
        pcall(G5LinkProviders.deleteMap, G5LinkProviders)
    end
end

function G5Link:resetWork()
    self.workReset = (self.workReset or 0) + 1
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
    if G5LinkRtk ~= nil then
        local ok, err = pcall(G5LinkRtk.update, G5LinkRtk, vehicle, dt, self)
        if not ok and not self.rtkErrorLogged then
            self.rtkErrorLogged = true
            print("G5Link: RTK update failed: " .. tostring(err))
        end
    end
    if G5LinkHeadland ~= nil then
        local ok, err = pcall(G5LinkHeadland.update, G5LinkHeadland, vehicle, dt, self)
        if not ok and not self.headlandErrorLogged then
            self.headlandErrorLogged = true
            print("G5Link: headland automation failed: " .. tostring(err))
        end
    end
    if G5LinkSteer ~= nil then
        local ok, err = pcall(G5LinkSteer.update, G5LinkSteer, vehicle, dt, self)
        if not ok and not self.steerErrorLogged then
            self.steerErrorLogged = true
            print("G5Link: AutoTrac update failed: " .. tostring(err))
            pcall(G5LinkSteer.disengage, G5LinkSteer, "error")
        end
    end
    if G5LinkRate ~= nil then
        local ok, err = pcall(G5LinkRate.update, G5LinkRate, vehicle, dt, self)
        if not ok and not self.rateErrorLogged then
            self.rateErrorLogged = true
            print("G5Link: rate control failed: " .. tostring(err))
        end
    end
    if G5LinkSection ~= nil then
        local ok, err = pcall(G5LinkSection.update, G5LinkSection, vehicle, dt, self)
        if not ok and not self.sectionErrorLogged then
            self.sectionErrorLogged = true
            print("G5Link: section control failed: " .. tostring(err))
        end
    end
    if G5LinkControls ~= nil then
        local ok, err = pcall(G5LinkControls.update, G5LinkControls, vehicle, dt, self)
        if not ok and not self.autoErrorLogged then
            self.autoErrorLogged = true
            print("G5Link: harvest automation failed: " .. tostring(err))
        end
    end

    self.writeTimer = self.writeTimer + dt
    if self.writeTimer >= G5Link.WRITE_INTERVAL then
        self.writeTimer = 0
        self:writeTelemetry(vehicle)
    end
    self.fleetTimer = (self.fleetTimer or 0) + dt
    if self.fleetTimer >= G5Link.FLEET_INTERVAL then
        self.fleetTimer = 0
        local ok, err = pcall(self.writeFleet, self, vehicle)
        if not ok and not self.fleetErrorLogged then
            self.fleetErrorLogged = true
            print("G5Link: fleet write failed: " .. tostring(err))
        end
    end

    self.cmdTimer = self.cmdTimer + dt
    if self.cmdTimer >= G5Link.CMD_INTERVAL then
        self.cmdTimer = 0
        self:processCommands(vehicle)
    end

    self.farmTimer = self.farmTimer + dt
    if self.farmTimer >= G5Link.FARM_INTERVAL then
        self.farmTimer = 0
        local ok, err = pcall(self.writeEquipment, self)
        if not ok and not self.farmErrorLogged then
            self.farmErrorLogged = true
            print("G5Link: equipment write failed: " .. tostring(err))
        end
    end
    self.economyTimer = self.economyTimer + dt
    if self.economyTimer >= G5Link.ECONOMY_INTERVAL then
        self.economyTimer = 0
        local ok, err = pcall(self.writeEconomy, self)
        if not ok and not self.economyErrorLogged then
            self.economyErrorLogged = true
            print("G5Link: economy write failed: " .. tostring(err))
        end
    end
    self.fieldTimer = self.fieldTimer + dt
    if self.fieldTimer >= G5Link.FIELD_CHECK_INTERVAL then
        self.fieldTimer = 0
        local ok, err = pcall(self.writeFields, self)
        if not ok and not self.fieldErrorLogged then
            self.fieldErrorLogged = true
            print("G5Link: fields write failed: " .. tostring(err))
        end
    end

    if G5LinkProviders ~= nil then
        pcall(G5LinkProviders.update, G5LinkProviders, dt)
        self.providerTimer = self.providerTimer + dt
        if self.providerTimer >= G5Link.PROVIDER_INTERVAL then
            self.providerTimer = 0
            local ok, err = pcall(self.writeProviders, self, vehicle)
            if not ok and not self.providerErrorLogged then
                self.providerErrorLogged = true
                print("G5Link: provider write failed: " .. tostring(err))
            end
        end
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

-- Main work areas only: auxiliary areas (and non-AI areas such as ridge markers) do not paint coverage.
-- WorkArea.lua skips WorkAreaType.AUXILIARY the same way; getWorkAreaTypeIsAIArea is used in WorkArea.lua too.
local function isMainWorkArea(wa)
    if type(wa) ~= "table" then
        return false
    end
    if WorkAreaType ~= nil and wa.type ~= nil and wa.type == WorkAreaType.AUXILIARY then
        return false
    end
    if g_workAreaTypeManager ~= nil and g_workAreaTypeManager.getWorkAreaTypeIsAIArea ~= nil and wa.type ~= nil then
        local ok, isAi = pcall(g_workAreaTypeManager.getWorkAreaTypeIsAIArea, g_workAreaTypeManager, wa.type)
        if ok and isAi == false then
            return false
        end
    end
    return true
end

local function nodePos(node)
    if node == nil then
        return nil
    end
    local ok, x, _, z = pcall(getWorldTranslation, node)
    if ok and type(x) == "number" and type(z) == "number" then
        return x, z
    end
    return nil
end

-- Realistic Seeder (FieldPath) Placement API: g_currentMission.realisticSeederAPI, dot calls,
-- getCapabilities(vehicle) -> profile or nil; getSnapshot(vehicle) -> detached table.
function G5Link:getSeeder(impl)
    local api = g_currentMission and g_currentMission.realisticSeederAPI
    if type(api) ~= "table" or type(api.getSnapshot) ~= "function" then
        return nil
    end
    self.seederCache = self.seederCache or {}
    local now = g_currentMission.time or 0
    local cached = self.seederCache[impl]
    if cached ~= nil and now - cached.time < G5Link.SEEDER_INTERVAL then
        return cached.snap
    end
    local snap = nil
    local okCap, caps = pcall(api.getCapabilities, impl)
    if okCap and type(caps) == "table" then
        local ok, value = pcall(api.getSnapshot, impl)
        if ok and type(value) == "table" then
            snap = value
        end
    end
    self.seederCache[impl] = {time = now, snap = snap}
    return snap
end

local function observedInputTank(impl, index)
    if type(index) ~= "number" or index < 1 then return nil end
    local trigger = impl.spec_fillUnit and impl.spec_fillUnit.fillTrigger
    if trigger == nil or trigger.isFilling ~= false then return nil end
    if impl.spec_dischargeable ~= nil and call(impl, "getDischargeState") ~= 0 then return nil end
    local indexType = call(impl, "getFillUnitFillType", index)
    local product = indexType and call(g_fillTypeManager, "getFillTypeByIndex", indexType)
    local level = call(impl, "getFillUnitFillLevel", index)
    if product == nil or type(product.name) ~= "string" or product.name == "UNKNOWN" or type(level) ~= "number" or level < 0 then return nil end
    return {tank = index, product = product.name, liters = level}
end

-- The stock variable-width specialization interpolates the working edge along local X.
local function boomEdges(nodes, edge, sections, direction)
    if type(nodes) ~= "table" or type(sections) ~= "table" then return nil end
    for _, node in ipairs(nodes) do
        if node.node == edge and node.startTrans == nil and node.endTrans == nil
            and type(node.startTransX) == "number" and type(node.endTransX) == "number" then
            local range = node.endTransX - node.startTransX
            if range * direction <= 0 then return nil end
            local ends = {[0] = node.startTransX}
            for i, section in ipairs(sections) do
                local f = section.width
                if type(f) ~= "number" or not (f > 0 and f <= 1) then return nil end
                ends[i] = ends[0] + f * range
                if (ends[i] - ends[i - 1]) * direction <= 0.01 then return nil end
            end
            return ends
        end
    end
    return nil
end

local function splitSprayerBoom(impl, area, s)
    local mode = impl.spec_variableWorkWidth
    if mode == nil or mode.isActive ~= true or mode.hasCenter ~= true or #s.geometry ~= 1 or not s.geometry[1]
        or type(mode.leftSide) ~= "number" or type(mode.rightSide) ~= "number" then return end
    -- The two endpoints and the height anchor must share the same working plane.
    local parent = getParent(area.start)
    if parent ~= getParent(area.width) or parent ~= getParent(area.height) then return end
    local left = boomEdges(mode.sectionNodesLeft, area.start, mode.sectionsLeft, 1)
    local right = boomEdges(mode.sectionNodesRight, area.width, mode.sectionsRight, -1)
    if left == nil or right == nil or #left == 0 or #right == 0 or left[0] <= right[0] then return end
    local lx, _, lz = getTranslation(area.start)
    local rx, _, rz = getTranslation(area.width)
    local hx = getTranslation(area.height)
    if left[mode.leftSide] == nil or right[mode.rightSide] == nil or not (lx > rx)
        or math.abs(lz - rz) > 0.01 or math.abs(hx - lx) > 0.01
        or math.abs(lx - left[mode.leftSide]) > 0.02 or math.abs(rx - right[mode.rightSide]) > 0.02 then return end

    local g, active, processing = s.geometry[1], s.areas[1], s.processing[1]
    local areas, geometry, observations = {}, {}, {}
    local function section(from, to, enabled)
        local i = #areas + 1
        areas[i] = enabled and active
        observations[i] = enabled and processing or "0"
        geometry[i] = false
        if enabled then
            local a, b = (lx - from) / (lx - rx), (lx - to) / (lx - rx)
            local dx, dz = g[3] - g[1], g[4] - g[2]
            geometry[i] = {g[1] + a * dx, g[2] + a * dz, g[1] + b * dx, g[2] + b * dz,
                g[5] + a * dx, g[6] + a * dz}
        end
    end
    for i = #left, 1, -1 do section(left[i], left[i - 1], i <= mode.leftSide) end
    section(left[0], right[0], true)
    for i = 1, #right do section(right[i - 1], right[i], i <= mode.rightSide) end
    s.areas, s.geometry, s.processing = areas, geometry, observations
    s.width = lx - rx
    s.sprayer.boom = {left = mode.leftSide, right = mode.rightSide, leftMax = #left, rightMax = #right,
        canSet = impl.isServer == true and type(impl.setSectionsActive) == "function"}
end

function G5Link:getImplementState(impl)
    local s = {}
    s.name = call(impl, "getFullName") or "Implement"
    s.canLower = impl.getIsLowered ~= nil
        and (bool(call(impl, "getAllowsLowering")) or G5LinkControls:hasFoldMiddleLift(impl))
    s.lowered = bool(call(impl, "getIsLowered", false))
    s.canTurnOn = bool(call(impl, "getCanBeTurnedOn"))
    s.turnedOn = bool(call(impl, "getIsTurnedOn"))
    s.width = call(impl, "getAIWorkAreaWidth") or 0

    -- Work areas stand in for "sections": one entry per main work area, with its corners in the
    -- world (start, width and height nodes, as WorkArea.lua reads them) for coverage mapping.
    s.areas = {}
    s.geometry = {}
    s.processing = {}
    local spec, mainArea = impl.spec_workArea, nil
    if spec ~= nil and spec.workAreas ~= nil and impl.getIsWorkAreaActive ~= nil then
        for _, wa in ipairs(spec.workAreas) do
            if isMainWorkArea(wa) then
                mainArea = wa
                local active = bool(call(impl, "getIsWorkAreaActive", wa))
                table.insert(s.areas, active)
                local changed = nil
                if type(wa.lastProcessingTime) == "number" and impl.getIsWorkAreaProcessing ~= nil then
                    changed = active and wa.lastProcessingTime > 0 and call(impl, "getIsWorkAreaProcessing", wa) == true
                end
                table.insert(s.processing, changed == nil and "?" or changed and "1" or "0")
                local sx, sz = nodePos(wa.start)
                local wx, wz = nodePos(wa.width)
                local hx, hz = nodePos(wa.height)
                if sx ~= nil and wx ~= nil and hx ~= nil then
                    table.insert(s.geometry, {sx, sz, wx, wz, hx, hz})
                else
                    table.insert(s.geometry, false)
                end
            end
        end
    end
    s.seeder = self:getSeeder(impl)
    -- Row clutches / electric drives / drill sections (Realistic Seeder 2.6+): one section per lane,
    -- on only while the implement works and the lane is not shut off, so coverage skips shut-off rows.
    if G5LinkSection ~= nil then
        local ok, sc = pcall(G5LinkSection.lanesOf, G5LinkSection, impl)
        if ok and sc ~= nil then
            local working = false
            for _, on in ipairs(s.areas) do
                if on then working = true end
            end
            local areas, geometry = {}, {}
            for i = 1, sc.lanes do
                local r = sc.rows[i]
                local g = type(r) == "table" and r.geometry or nil
                local fine = type(g) == "table"
                for _, key in ipairs({ "sx", "sz", "wx", "wz", "hx", "hz" }) do
                    local v = fine and g[key] or nil
                    if type(v) ~= "number" or v ~= v or v == math.huge or v == -math.huge then fine = false end
                end
                if not fine then
                    areas = nil
                    break
                end
                table.insert(areas, working and r.active == true)
                table.insert(geometry, { g.sx, g.sz, g.wx, g.wz, g.hx, g.hz })
            end
            if areas ~= nil and #areas > 0 then
                -- Native processing is confirmed for the tool. The provider identifies enabled lanes.
                local changed, measured = false, false
                for _, bit in ipairs(s.processing) do
                    changed = changed or bit == "1"
                    measured = measured or bit ~= "?"
                end
                s.processing = {}
                for i, active in ipairs(areas) do
                    s.processing[i] = not active and "0" or changed and "1" or measured and "0" or "?"
                end
                s.areas, s.geometry = areas, geometry
            end
            s.section = sc
        end
    end
    if G5LinkControls ~= nil then
        local ok, t = pcall(G5LinkControls.getTillage, G5LinkControls, impl)
        if ok then
            s.tillage = t
        end
    end

    if impl.spec_sowingMachine ~= nil then
        local index = call(impl, "getSowingMachineSeedFillTypeIndex")
        local fill = index and call(g_fillTypeManager, "getFillTypeByIndex", index)
        s.stockCrop = fill and fill.name or nil
    end
    if s.seeder ~= nil or impl.spec_sowingMachine ~= nil then
        s.operation = "seeding"
        local spec = impl.spec_sowingMachine
        local params = spec and spec.workAreaParameters
        local info = g_currentMission and g_currentMission.missionInfo
        if s.seeder == nil and params and params.isActive and params.seedsVehicle == impl and spec.consumableName == nil
            and (call(impl, "getIsAIActive") == false or info and info.helperBuySeeds == false) then
            s.input = observedInputTank(impl, params.seedsVehicleFillUnitIndex)
        end
    elseif impl.spec_sprayer ~= nil then
        s.operation = "application"
        local params = impl.spec_sprayer.workAreaParameters
        local index = call(impl, "getSprayerFillUnitIndex")
        local productIndex = index and call(impl, "getFillUnitFillType", index)
        local applying = params ~= nil and s.turnedOn and params.isActive == true and (params.lastTotalArea or 0) > 0
        if applying then productIndex = params.sprayFillType or productIndex end
        local product = productIndex and call(g_fillTypeManager, "getFillTypeByIndex", productIndex)
        if not applying and index and (product == nil or product.name == "UNKNOWN") then
            local previous = call(impl, "getFillUnitLastValidFillType", index)
            product = previous and call(g_fillTypeManager, "getFillTypeByIndex", previous)
        end
        s.sprayer = { master = s.turnedOn, tank = index, product = product and product.name,
            productTitle = product and product.title, level = index and call(impl, "getFillUnitFillLevel", index),
            cap = index and call(impl, "getFillUnitCapacity", index),
            applying = params and applying }
        -- FS25 varies the coverage with ground speed, but its stock volumetric flow can
        -- continue at a stop. Do not report the scheduled flow for a partially supplied tick.
        if params ~= nil then
            if not applying then
                s.sprayer.flowLpm = 0
            elseif type(params.usage) == "number" and type(params.sprayFillLevel) == "number"
                and params.sprayFillLevel >= params.usage and type(params.usagePerMin) == "number"
                and params.usagePerMin >= 0 then
                s.sprayer.flowLpm = params.usagePerMin
            end
        end
        if applying and params.sprayVehicle == impl and params.lastIsExternallyFilled == false then
            s.input = observedInputTank(impl, params.sprayVehicleFillUnitIndex)
        end
        if mainArea ~= nil then splitSprayerBoom(impl, mainArea, s) end
    elseif impl.spec_cutter ~= nil then
        s.operation = "harvest"
    elseif s.tillage ~= nil then
        s.operation = "tillage"
    end

    s.fills = {}
    local fillUnits = call(impl, "getFillUnits")
    if fillUnits ~= nil then
        for i = 1, #fillUnits do
            local cap = call(impl, "getFillUnitCapacity", i) or 0
            if cap > 0 then
                local level = call(impl, "getFillUnitFillLevel", i) or 0
                local ftIndex = call(impl, "getFillUnitFillType", i)
                local title, ftName = "", ""
                if ftIndex ~= nil and g_fillTypeManager ~= nil then
                    local ft = g_fillTypeManager:getFillTypeByIndex(ftIndex)
                    if ft ~= nil then
                        title = ft.title or ft.name or ""
                        ftName = ft.name or ""
                    end
                end
                table.insert(s.fills, {title = title, type = ftName, level = level, cap = cap})
            end
        end
    end
    return s
end

function G5Link:getImplements(vehicle)
    local list = {}
    if vehicle == nil then return list end
    local children = call(vehicle, "getChildVehicles")
    for _, child in ipairs(children or {}) do
        if child ~= vehicle and #list < G5Link.MAX_IMPLEMENTS then
            table.insert(list, child)
        end
    end
    -- Self-propelled sprayers have the same work areas and tank specialization as drawn tools.
    if vehicle.spec_sprayer ~= nil and #list < G5Link.MAX_IMPLEMENTS then
        table.insert(list, vehicle)
    end
    return list
end

function G5Link:isRecording(implements)
    for _, impl in ipairs(implements) do
        local spec = impl.spec_workArea
        if spec ~= nil and spec.workAreas ~= nil and impl.getIsWorkAreaActive ~= nil then
            for _, wa in ipairs(spec.workAreas) do
                if isMainWorkArea(wa) and bool(call(impl, "getIsWorkAreaActive", wa)) then
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

function G5Link:saveKey()
    local info = g_currentMission and g_currentMission.missionInfo
    if info == nil then return nil end
    local index = info.savegameIndex
    -- FS25 swaps savegameDirectory to its temporary write directory during a save.
    if type(index) == "number" and index > 0 and index % 1 == 0 then
        return "savegame" .. index
    end
    local dir = info.savegameDirectory
    local key = type(dir) == "string" and string.match(dir, "([^/\\]+)[/\\]*$") or nil
    if key ~= nil and string.lower(key) ~= "tempsavegame" then return key end
    return nil
end

function G5Link:writeGame(xml)
    local env = g_currentMission.environment
    if env ~= nil then
        xml:setInt("g5.game#day", env.currentDay or 0)
        xml:setInt("g5.game#hour", env.currentHour or 0)
        xml:setInt("g5.game#minute", env.currentMinute or 0)
    end
    local info = g_currentMission.missionInfo
    if info ~= nil then
        if type(info.helperBuySeeds) == "boolean" then xml:setBool("g5.game#helperBuySeeds", info.helperBuySeeds) end
        if type(info.helperBuyFertilizer) == "boolean" then xml:setBool("g5.game#helperBuyFertilizer", info.helperBuyFertilizer) end
    end
    local key = self:saveKey()
    if key ~= nil then xml:setString("g5.game#save", key) end
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
    xml:setString("g5#session", self.session)
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
    xml:setString("g5#session", self.session)
    xml:setInt("g5#time", math.floor(g_currentMission.time or 0))
    xml:setInt("g5#lastCmd", self.lastCmdId)
    self:writeGame(xml)

    if vehicle == nil then
        xml:setString("g5#state", "onfoot")
    else
        xml:setString("g5#state", "vehicle")
        local k = "g5.vehicle"
        xml:setString(k .. "#name", call(vehicle, "getFullName") or "Vehicle")
        local id = vehicle.uniqueId or vehicle.id
        if id ~= nil then xml:setString(k .. "#id", tostring(id)) end
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

        -- GNSS error of the receiver's correction level: everything G5Link reports moves with it (Rtk.lua)
        local gx, gz = 0, 0
        if G5LinkRtk ~= nil then
            local ok, ox, oz = pcall(G5LinkRtk.offset, G5LinkRtk, vehicle)
            if ok and type(ox) == "number" and type(oz) == "number" then gx, gz = ox, oz end
        end
        self.gnssOffset = { gx, gz }
        if vehicle.rootNode ~= nil then
            local x, _, z = getWorldTranslation(vehicle.rootNode)
            local dx, _, dz = localDirectionToWorld(vehicle.rootNode, 0, 0, 1)
            local heading = (180 - math.deg(math.atan2(dx, dz))) % 360
            xml:setFloat(k .. "#x", round(x + gx, 2))
            xml:setFloat(k .. "#z", round(z + gz, 2))
            xml:setFloat(k .. "#heading", round(heading, 0))
            if g_farmlandManager ~= nil then
                local fid = call(g_farmlandManager, "getFarmlandIdAtWorldPosition", x, z)
                if fid ~= nil then
                    xml:setInt(k .. "#farmland", fid)
                end
            end
            local fieldId = self:getFieldIdAt(x, z)
            if fieldId ~= nil then
                xml:setInt(k .. "#field", fieldId)
            end
        end

        self:writeImplementsTo(xml, "g5.implements", vehicle, self.gnssOffset[1], self.gnssOffset[2])

        self:writeCombine(xml, vehicle)
        if G5LinkHeadland ~= nil then
            pcall(G5LinkHeadland.write, G5LinkHeadland, xml)
        end
        if G5LinkSteer ~= nil then
            pcall(G5LinkSteer.write, G5LinkSteer, xml, vehicle)
        end
        if G5LinkRate ~= nil then
            pcall(G5LinkRate.write, G5LinkRate, xml)
        end
        if G5LinkSection ~= nil then
            pcall(G5LinkSection.write, G5LinkSection, xml)
        end
        if G5LinkHyd ~= nil then
            local ok, err = pcall(G5LinkHyd.write, G5LinkHyd, xml, vehicle)
            if not ok and not self.hydErrorLogged then
                self.hydErrorLogged = true
                print("G5Link: Realistic Hydraulics read failed: " .. tostring(err))
            end
        end
        if G5LinkRtk ~= nil then
            local ok, err = pcall(G5LinkRtk.write_telemetry, G5LinkRtk, xml, vehicle)
            if not ok and not self.gnssErrorLogged then
                self.gnssErrorLogged = true
                print("G5Link: GNSS telemetry failed: " .. tostring(err))
            end
        end
        if G5LinkGrainCart ~= nil then
            local ok, err = pcall(G5LinkGrainCart.write, G5LinkGrainCart, xml, vehicle, self, G5Link.WRITE_INTERVAL)
            if not ok and not self.grainCartErrorLogged then
                self.grainCartErrorLogged = true
                print("G5Link: Courseplay Grain Cart read failed: " .. tostring(err))
            end
        end
        if G5LinkControls ~= nil then
            local ok, err = pcall(G5LinkControls.write, G5LinkControls, xml, vehicle, self)
            if not ok and not self.controlsErrorLogged then
                self.controlsErrorLogged = true
                print("G5Link: controls read failed: " .. tostring(err))
            end
        end
    end

    local w = self.work
    xml:setBool("g5.work#recording", w.recording)
    xml:setFloat("g5.work#area", round(w.area, 0))
    xml:setFloat("g5.work#time", round(w.time / 1000, 0))
    xml:setInt("g5.work#counterEpoch", self.workReset)
    xml:setFloat("g5.work#distance", round(w.distance, 0))
    xml:setFloat("g5.work#totalDistance", round(w.totalDistance, 0))
    xml:setFloat("g5.work#fuelUsed", round(w.fuelUsed, 2))
    xml:setFloat("g5.work#totalFuel", round(w.totalFuel, 2))

    xml:save()
    xml:delete()
end

---------------------------------------------------------------------------
-- Realistic Seeder snapshot -> telemetry (PLACEMENT_API_V1/V2 field names)
---------------------------------------------------------------------------

local function setNumber(xml, key, v, digits)
    if type(v) == "number" and v == v and v ~= math.huge and v ~= -math.huge then
        xml:setFloat(key, round(v, digits or 2))
    end
end

function G5Link:writeSeeder(xml, k, snap)
    local caps = type(snap.capabilities) == "table" and snap.capabilities or {}
    local app = type(snap.application) == "table" and snap.application or {}
    local m = type(snap.measurements) == "table" and snap.measurements or {}
    local set = type(snap.settings) == "table" and snap.settings or {}
    local est = type(snap.estimates) == "table" and snap.estimates or {}
    local soil = type(est.soil) == "table" and est.soil or {}
    local sensed = type(snap.soilMeasurements) == "table" and snap.soilMeasurements or nil
    local pop = type(est.population) == "table" and est.population or {}
    local controls = type(snap.controls) == "table" and snap.controls or {}

    xml:setString(k .. "#kind", tostring(snap.kind or caps.kind or ""))
    xml:setString(k .. "#crop", tostring(snap.crop or ""))
    xml:setString(k .. "#unit", tostring(app.unit or ""))                 -- seedsPerAcre | poundsPerAcre
    xml:setBool(k .. "#monitor", caps.seedMonitor == true)
    xml:setBool(k .. "#depthSensor", caps.depthSensor == true)
    xml:setBool(k .. "#fresh", controls.sampleFresh == true)
    setNumber(xml, k .. "#rate", app.ratePerAcre, 1)                      -- target, per acre
    setNumber(xml, k .. "#actual", m.actualRatePerAcre, 1)                -- seed monitor only
    setNumber(xml, k .. "#skips", m.skipsPercent, 2)
    setNumber(xml, k .. "#doubles", m.doublesPercent, 2)                  -- planters only
    setNumber(xml, k .. "#cv", m.distributionCvPercent, 2)                -- drills only
    setNumber(xml, k .. "#depthSet", set.depthMm, 1)
    setNumber(xml, k .. "#depth", m.depthMm, 1)                           -- fitted depth sensor only
    setNumber(xml, k .. "#pressure", set.pressurePercent, 0)
    setNumber(xml, k .. "#closing", set.closingPercent, 0)
    -- soil: fitted sensor reading when fresh, otherwise the placement model's estimate (0..1)
    local soilSrc = sensed or soil
    setNumber(xml, k .. "#moisture", soilSrc.moisture, 3)
    setNumber(xml, k .. "#compaction", soilSrc.compaction, 3)
    xml:setString(k .. "#soilSource", sensed and "sensor" or (soil.moisture ~= nil and tostring(soil.moistureSource or "model") or ""))
    setNumber(xml, k .. "#popTarget", pop.targetSeedsPerAcre, 0)
    setNumber(xml, k .. "#popEstablished", pop.establishedSeedsPerAcre, 0)
    setNumber(xml, k .. "#yieldPotential", pop.yieldPotentialPercent, 1)
    setNumber(xml, k .. "#lph", snap.nominalLitersPerHa, 2)               -- seed litres per hectare at the set rate
    if type(snap.rows) == "table" then
        for i, row in ipairs(snap.rows) do
            if type(row) == "table" then
                local rk = string.format("%s.row(%d)", k, i - 1)
                setNumber(xml, rk .. "#r", row.row, 0)
                xml:setBool(rk .. "#on", row.active == true)
                setNumber(xml, rk .. "#target", row.targetRatePerAcre, 1)
                setNumber(xml, rk .. "#actual", row.actualRatePerAcre, 1)
                setNumber(xml, rk .. "#skips", row.skipsPercent, 2)
                setNumber(xml, rk .. "#doubles", row.doublesPercent, 2)
            end
        end
    end
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

-- Implements of a machine under base (e.g. "g5.implements"), positions moved by (ox, oz).
function G5Link:writeImplementsTo(xml, base, vehicle, ox, oz)
    local implements = self:getImplements(vehicle)
    for i, impl in ipairs(implements) do
        local s = self:getImplementState(impl)
        local ik = string.format("%s.implement(%d)", base, i - 1)
        xml:setString(ik .. "#name", s.name)
        local id = impl.uniqueId or impl.id
        if id ~= nil then xml:setString(ik .. "#id", tostring(id)) end
        xml:setBool(ik .. "#canLower", s.canLower)
        xml:setBool(ik .. "#lowered", s.lowered)
        xml:setBool(ik .. "#canTurnOn", s.canTurnOn)
        xml:setBool(ik .. "#turnedOn", s.turnedOn)
        xml:setFloat(ik .. "#width", round(s.width, 2))
        if s.operation ~= nil then xml:setString(ik .. "#operation", s.operation) end
        if s.stockCrop ~= nil then xml:setString(ik .. "#stockCrop", s.stockCrop) end
        if #s.processing > 0 then xml:setString(ik .. "#processing", table.concat(s.processing)) end
        if s.sprayer ~= nil then
            local k, b = ik .. ".sprayer", s.sprayer
            xml:setString(k .. "#provider", "fs25")
            xml:setBool(k .. "#master", b.master)
            if b.applying ~= nil then xml:setBool(k .. "#applying", b.applying) end
            setNumber(xml, k .. "#flowLpm", b.flowLpm, 2)
            if type(b.tank) == "number" then xml:setInt(k .. "#tank", b.tank) end
            if type(b.level) == "number" then xml:setFloat(k .. "#level", round(b.level, 1)) end
            if type(b.cap) == "number" then xml:setFloat(k .. "#cap", round(b.cap, 0)) end
            if b.product ~= nil then xml:setString(k .. "#product", b.product) end
            if type(b.productTitle) == "string" and b.productTitle ~= "" then xml:setString(k .. "#productTitle", b.productTitle) end
            if b.boom ~= nil then
                local bk = k .. ".boom"
                for _, field in ipairs({"left", "right", "leftMax", "rightMax"}) do
                    xml:setInt(bk .. "#" .. field, b.boom[field])
                end
                xml:setBool(bk .. "#canSet", b.boom.canSet)
            end
        end
        if s.input ~= nil then
            local k, input = ik .. ".input", s.input
            xml:setInt(k .. "#tank", input.tank)
            xml:setString(k .. "#product", input.product)
            setNumber(xml, k .. "#liters", input.liters, 4)
        end
        local bits = ""
        for _, a in ipairs(s.areas) do
            bits = bits .. (a and "1" or "0")
        end
        xml:setString(ik .. "#areas", bits)
        for j, g in ipairs(s.geometry) do
            if g then
                local ak = string.format("%s.area(%d)", ik, j - 1)
                xml:setInt(ak .. "#i", j - 1)
                xml:setFloat(ak .. "#sx", round(g[1] + ox, 2))
                xml:setFloat(ak .. "#sz", round(g[2] + oz, 2))
                xml:setFloat(ak .. "#wx", round(g[3] + ox, 2))
                xml:setFloat(ak .. "#wz", round(g[4] + oz, 2))
                xml:setFloat(ak .. "#hx", round(g[5] + ox, 2))
                xml:setFloat(ak .. "#hz", round(g[6] + oz, 2))
            end
        end
        if s.seeder ~= nil then
            local ok, err = pcall(self.writeSeeder, self, xml, ik .. ".seeder", s.seeder)
            if not ok and not self.seederErrorLogged then
                self.seederErrorLogged = true
                print("G5Link: Realistic Seeder read failed: " .. tostring(err))
            end
        end
        if s.section ~= nil then
            local sk = ik .. ".section"
            local sc = s.section
            xml:setString(sk .. "#kind", tostring(sc.laneKind or "row"))
            xml:setInt(sk .. "#lanes", sc.lanes)
            xml:setInt(sk .. "#rowsPerLane", tonumber(sc.rowsPerLane) or 1)
            xml:setString(sk .. "#controller", tostring(sc.controller or ""))
            xml:setBool(sk .. "#auto", sc.enabled == true)
            xml:setBool(sk .. "#perRowRate", sc.perRowRate == true)
            -- per lane: 1 on, 0 switched off, a = shut off automatically (ground already planted)
            local states = {}
            for i = 1, sc.lanes do
                local r = sc.rows[i] or {}
                states[i] = r.active and "1" or (r.reason == "covered" and "a" or "0")
            end
            xml:setString(sk .. "#rows", table.concat(states))
        end
        if s.tillage ~= nil then
            pcall(G5LinkControls.writeTillage, G5LinkControls, xml, ik .. ".tillage", s.tillage)
        end
        for j, f in ipairs(s.fills) do
            local fk = string.format("%s.fill(%d)", ik, j - 1)
            xml:setString(fk .. "#title", f.title)
            xml:setString(fk .. "#type", f.type)
            xml:setFloat(fk .. "#level", round(f.level, 1))
            xml:setFloat(fk .. "#cap", round(f.cap, 0))
        end
    end

end

function G5Link:writeCombine(xml, vehicle, base)
    local combine = self:findCombine(vehicle)
    if combine == nil then
        return
    end
    base = base or "g5"
    local k = base .. ".combine"
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

    local ok, err = pcall(self.writeRealisticHarvesting, self, xml, combine, base)
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

function G5Link:writeRealisticHarvesting(xml, combine, base)
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

    local k = (base or "g5") .. ".rh"
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
    -- real units for each control (RPM, mm), from RH's RHM_UnitConverter (not global: in RH's mod environment)
    local env = FS25_RealisticHarvesting
    local conv = type(env) == "table" and type(env.RHM_UnitConverter) == "table" and env.RHM_UnitConverter or nil
    local machineType = tostring(get("getMachineType", combine) or "grain")
    local function rangeOf(name)
        if conv == nil or type(conv.getPhysicalRange) ~= "function" then return nil end
        local ok, r = pcall(conv.getPhysicalRange, name, machineType)
        if ok and type(r) == "table" and type(r.min) == "number" and type(r.max) == "number" and r.max > r.min then return r end
        return nil
    end
    xml:setString(k .. "#machineType", machineType)
    setNum(xml, k .. "#engineLoadSet", type(current) == "table" and current.targetEngineLoad or nil, 0)
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
            local r = rangeOf(name)
            if r ~= nil then
                setNum(xml, sk .. "#pmin", r.min, 2)
                setNum(xml, sk .. "#pmax", r.max, 2)
                setNum(xml, sk .. "#step", r.step, 2)
                xml:setString(sk .. "#unit", tostring(r.unit or ""))
            end
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
-- Other mods (providers.json, course.json)
---------------------------------------------------------------------------

local function mapFieldId(field)
    if type(field) ~= "table" then return nil end
    local id = call(field, "getId") or field.fieldId
    return type(id) == "number" and id > 0 and id or nil
end

local function mapFields()
    local fields = g_fieldManager and (call(g_fieldManager, "getFields") or g_fieldManager.fields)
    return type(fields) == "table" and fields or {}
end

local function fieldFarmlandId(field)
    local farmland = call(field, "getFarmland") or field.farmland
    return type(farmland) == "table" and (call(farmland, "getId") or farmland.id) or nil
end

local function fieldOutline(field)
    local polygon = {}
    for _, node in ipairs(call(field, "getPolygonPoints") or field.polygonPoints or {}) do
        local x, z = nodePos(node)
        if x ~= nil then polygon[#polygon + 1] = {x, z} end
    end
    return polygon
end

-- Stock FS25 maps link each field to a Farmland object. The parcel also
-- contains yards and grass margins, so check the field's own polygon.
function G5Link:getFieldIdAt(x, z)
    local manager = g_currentMission and g_currentMission.soilFertilityManager
    local system = manager and manager.soilSystem
    local hooks = system and system.hookManager
    local id = call(hooks, "getFieldIdAtWorldPosition", x, z, false)
    if type(id) == "number" and id > 0 then
        return id
    end
    id = mapFieldId(call(g_fieldManager, "getFieldAtWorldPosition", x, z))
    if id ~= nil then return id end
    local farmland = call(g_farmlandManager, "getFarmlandAtWorldPosition", x, z)
    local field = call(farmland, "getField")
    id = mapFieldId(field)
    if id == nil then return nil end
    local polygon = fieldOutline(field)
    if #polygon < 3 then return nil end
    local inside = false
    local a = polygon[#polygon]
    for _, b in ipairs(polygon) do
        if (a[2] > z) ~= (b[2] > z) and x < (b[1] - a[1]) * (z - a[2]) / (b[2] - a[2]) + a[1] then
            inside = not inside
        end
        a = b
    end
    return inside and id or nil
end

-- The local player's farm (as Realistic Harvesting's RHM_Api.getActiveFarmId resolves it).
-- fleet.xml: every other machine of the farm that is working right now (AI workers, Courseplay, AutoDrive,
-- a second player), in the same shape as the telemetry's vehicle, implements, combine and rh blocks, so the
-- bridge records their coverage too. True positions: their receivers are not simulated.
function G5Link:writeFleet(current)
    local vs = g_currentMission and g_currentMission.vehicleSystem
    if vs == nil or type(vs.vehicles) ~= "table" or self.fleetPath == nil then return end
    local farmId = self:getFarmId()
    local xml = XMLFile.create("G5LinkFleet", self.fleetPath, "fleet")
    if xml == nil then return end
    self.fleetSeq = (self.fleetSeq or 0) + 1
    xml:setInt("fleet#seq", self.fleetSeq)
    xml:setString("fleet#session", self.session)
    xml:setInt("fleet#time", math.floor(g_currentMission.time or 0))
    local save = self:saveKey()
    if save ~= nil then xml:setString("fleet#save", save) end
    local n = 0
    for _, v in pairs(vs.vehicles) do
        if n >= G5Link.MAX_FLEET then break end
        local root = call(v, "getRootVehicle")
        if v ~= current and v.rootNode ~= nil and v.spec_motorized ~= nil and (root == nil or root == v)
            and (farmId == nil or call(v, "getOwnerFarmId") == farmId) then
            local implements = self:getImplements(v)
            local ai = call(v, "getIsAIActive") == true
            if ai or self:isRecording(implements) then
                local k = string.format("fleet.vehicle(%d)", n)
                n = n + 1
                local x, _, z = getWorldTranslation(v.rootNode)
                local dx, _, dz = localDirectionToWorld(v.rootNode, 0, 0, 1)
                xml:setString(k .. "#id", tostring(v.uniqueId or v.id or n))
                xml:setString(k .. "#name", call(v, "getFullName") or "Vehicle")
                xml:setFloat(k .. "#x", round(x, 2))
                xml:setFloat(k .. "#z", round(z, 2))
                xml:setFloat(k .. "#heading", round((180 - math.deg(math.atan2(dx, dz))) % 360, 0))
                xml:setFloat(k .. "#speed", round(call(v, "getLastSpeed") or 0, 1))
                xml:setBool(k .. "#ai", ai)
                xml:setBool(k .. "#onField", bool(call(v, "getIsOnField")))
                xml:setBool(k .. "#motorOn", bool(call(v, "getIsMotorStarted")))
                local motor = call(v, "getMotor")
                if motor ~= nil then xml:setInt(k .. "#dir", call(motor, "getDrivingDirection") or 0) end
                local fieldId = self:getFieldIdAt(x, z)
                if fieldId ~= nil then xml:setInt(k .. "#field", fieldId) end
                self:writeImplementsTo(xml, k .. ".implements", v, 0, 0)
                self:writeCombine(xml, v, k)
            end
        end
    end
    xml:setInt("fleet#count", n)
    xml:save()
    xml:delete()
end

function G5Link:getFarmId()
    local id = call(g_localPlayer, "getFarmId")
    if type(id) ~= "number" or id == 0 then
        id = call(g_currentMission and g_currentMission.player, "getFarmId")
    end
    if type(id) ~= "number" or id == 0 then
        id = call(g_currentMission, "getFarmId")
    end
    if type(id) ~= "number" or id == 0 then
        id = 1
    end
    return id
end

-- fields.json for the Ops Center: map fields with their native outlines, acreage and ownership.
function G5Link:writeFields()
    local fields = mapFields()
    if #fields == 0 then
        return  -- empty during loading; retried on the next check
    end
    local farmId = self:getFarmId()
    -- farm name for the Ops Center's Client > Farm > Field naming (Farm.name; unverified field, guarded)
    local farm = call(g_farmManager, "getFarmById", farmId)
    local farmName = type(farm) == "table" and type(farm.name) == "string" and farm.name or nil
    local out = {farmId = farmId, farmName = farmName, fields = {}}
    for _, field in ipairs(fields) do
        local id = mapFieldId(field)
        if id ~= nil then
            local farmlandId = fieldFarmlandId(field)
            local owner = farmlandId and call(g_farmlandManager, "getFarmlandOwner", farmlandId) or nil
            local poly = fieldOutline(field)
            for _, point in ipairs(poly) do point[1], point[2] = round(point[1], 1), round(point[2], 1) end
            local name = field.name or call(field, "getName")
            local area = call(field, "getAreaHa") or field.areaHa
            local x, z = call(field, "getCenterOfFieldWorldPosition")
            if #poly >= 3 then
                out.fields[#out.fields + 1] = {
                    id = id, name = type(name) == "string" and name ~= tostring(id) and name or nil,
                    areaHa = type(area) == "number" and round(area, 3) or nil,
                    farmland = farmlandId, owner = owner, x = round(x or field.posX, 1), z = round(z or field.posZ, 1),
                    polygon = poly
                }
            end
        end
    end
    if #out.fields == 0 then return end
    local body = G5Json.encode(out)
    if body ~= self.fieldsKey and self:writeTextFile(self.fieldsPath, body) then
        self.fieldsKey = body
    end
end

local function vehicleKind(v)
    if v.spec_combine ~= nil then return "combine" end
    local tn = type(v.typeName) == "string" and string.lower(v.typeName) or ""
    if string.find(tn, "truck") then return "truck" end
    if string.find(tn, "car") or string.find(tn, "pickup") then return "car" end
    if string.find(tn, "sprayer") then return "sprayer" end
    if string.find(tn, "forage") then return "forageHarvester" end
    if string.find(tn, "loader") or string.find(tn, "telehandler") then return "loader" end
    return "tractor"
end

-- Advanced Damage System (id577): only what the player can see in the game -- the workshop state and
-- the service interval -- never ADS's hidden condition numbers (they are learned by inspection).
-- Same surface as VDTelemetry's ADS integration (checked there against ADS 0.10.0.3): a vehicle's
-- spec_AdvancedDamageSystem, getIsADSExcluded(), getServiceIntervalElapsedHours(), getServiceInterval(),
-- and spec.currentState resolved through FS25_AdvancedDamageSystem.AdvancedDamageSystem.STATUS.
function G5Link:getAdsService(v)
    local spec = v.spec_AdvancedDamageSystem
    if type(spec) ~= "table" or type(v.getIsADSExcluded) ~= "function" then
        return nil
    end
    local ok, excluded = pcall(v.getIsADSExcluded, v)
    if not ok or excluded ~= false then
        return nil
    end
    local out = {}
    local hours = call(v, "getServiceIntervalElapsedHours")
    local interval = call(v, "getServiceInterval")
    if type(hours) == "number" and type(interval) == "number" and interval > 0 then
        out.hours = round(hours, 1)
        out.interval = round(interval, 1)
    end
    local state = spec.currentState
    if type(state) == "string" then
        local token = nil
        local env = FS25_AdvancedDamageSystem
        local class = type(env) == "table" and env.AdvancedDamageSystem or nil
        local statuses = type(class) == "table" and class.STATUS or nil
        if type(statuses) == "table" then
            for name, value in pairs(statuses) do
                if value == state and type(name) == "string" then
                    token = name
                end
            end
        end
        if token == nil then
            local suffix = string.match(state, "^ads_spec_state_(%a+)$")
            token = suffix ~= nil and string.upper(suffix) or "UNKNOWN"
        end
        out.state = token
    end
    if out.state == nil and out.hours == nil then
        return nil
    end
    return out
end

-- economy.json for Harvest Profit: farm finances (Farm:getBalance/getLoan/getEquity) and, per fill type,
-- the game price (economyManager:getPricePerLiter), input cost (getCostPerLiter) and mass (massPerLiter, t/L).
function G5Link:writeEconomy()
    local mission = g_currentMission
    local econ = mission and mission.economyManager
    local farmId = self:getFarmId()
    local farm = call(g_farmManager, "getFarmById", farmId)
    local out = {farmId = farmId, day = mission.environment and mission.environment.currentDay or nil, fillTypes = {}}
    if type(farm) == "table" then
        out.balance = call(farm, "getBalance")
        out.loan = call(farm, "getLoan")
        out.equity = call(farm, "getEquity")
    end
    local list = call(g_fillTypeManager, "getFillTypes") or (g_fillTypeManager and g_fillTypeManager.fillTypes) or {}
    local n = 0
    for _, ft in pairs(list) do
        if type(ft) == "table" and type(ft.name) == "string" and ft.index ~= nil and n < 400 then
            local price = call(econ, "getPricePerLiter", ft.index)
            local cost = call(econ, "getCostPerLiter", ft.index)
            if (type(price) == "number" and price > 0) or (type(cost) == "number" and cost > 0) then
                n = n + 1
                out.fillTypes[ft.name] = {
                    title = type(ft.title) == "string" and ft.title or ft.name,
                    price = type(price) == "number" and round(price, 5) or nil,
                    cost = type(cost) == "number" and round(cost, 5) or nil,
                    mass = type(ft.massPerLiter) == "number" and ft.massPerLiter or nil
                }
            end
        end
    end
    local ok, ff = pcall(self.readFarmFinance, self, farmId)
    if ok and ff ~= nil then
        out.farmFinance = ff
    end
    self:writeTextFile(self.economyPath, G5Json.encode(out))
end

-- Farm Finance (FS25_FarmFinance) public API 1.x: g_currentMission.farmFinanceAPI, dot calls, read-only here.
-- Credit score, the input account, and the lease contract on each field's farmland (API.md).
function G5Link:readFarmFinance(farmId)
    local api = g_currentMission and g_currentMission.farmFinanceAPI
    if type(api) ~= "table" or type(api.isReady) ~= "function" then
        return nil
    end
    local okReady, ready = pcall(api.isReady)
    if not okReady or ready ~= true then
        return nil
    end
    local function get(fname, ...)
        local fn = api[fname]
        if type(fn) ~= "function" then return nil end
        local ok, a, b = pcall(fn, ...)
        if ok then return a, b end
        return nil
    end
    local out = {}
    out.apiVersion, out.modVersion = get("getVersion")
    out.bankActive = get("isBankActive") == true
    out.creditScore, out.creditGrade = get("getCreditScore", farmId)
    local acc = get("getInputAccount", farmId)
    if type(acc) == "table" then
        out.inputAccount = {enabled = acc.enabled == true, limit = acc.limit, balance = acc.balance, available = acc.available,
            pastDue = acc.pastDue, dueCropYear = acc.dueCropYear, earlyPayDiscount = acc.earlyPayDiscount}
    end
    -- full read access (Farm Finance read API): everything for this farm in one table, plus the rate market
    local summary = get("getFarmSummary", farmId)
    if type(summary) == "table" then
        out.summary = summary
    end
    local market = get("getMarket")
    if type(market) == "table" then
        out.market = {baseRate = market.baseRate, trend = market.trend, trendMonthsLeft = market.trendMonthsLeft,
            cropYear = market.cropYear, period = market.period, monthIndex = market.monthIndex}
    end
    out.contracts = {}
    local seen = {}
    for _, field in ipairs(mapFields()) do
        local farmlandId = fieldFarmlandId(field)
        if farmlandId ~= nil and not seen[farmlandId] then
            seen[farmlandId] = true
            local c = get("getLandContract", farmlandId)
            if type(c) == "table" and c.farmId == farmId then
                out.contracts[tostring(farmlandId)] = {kind = c.kind, leaseType = c.leaseType, annualRent = c.annualRent,
                    landownerShare = c.landownerShare, inputShare = c.inputShare, endCropYear = c.endCropYear}
            end
        end
    end
    return out
end

-- equipment.json for the Ops Center: the farm's motorized machines (VehicleSystem.vehicles).
function G5Link:writeEquipment()
    local vs = g_currentMission and g_currentMission.vehicleSystem
    local list = vs and vs.vehicles
    if type(list) ~= "table" then
        return
    end
    local farmId = self:getFarmId()
    local current = call(g_localPlayer, "getCurrentVehicle")
    local out = {farmId = farmId, day = g_currentMission.environment and g_currentMission.environment.currentDay or nil,
        time = math.floor(g_currentMission.time or 0), vehicles = {}}
    for _, v in ipairs(list) do
        if #out.vehicles >= G5Link.MAX_VEHICLES then
            break
        end
        if type(v) == "table" and v.spec_motorized ~= nil and call(v, "getOwnerFarmId") == farmId and v.rootNode ~= nil then
            local x, z = nodePos(v.rootNode)
            if x ~= nil then
                local e = {id = tostring(v.uniqueId or v.id or #out.vehicles + 1), name = call(v, "getFullName") or "Vehicle",
                    kind = vehicleKind(v), x = round(x, 1), z = round(z, 1),
                    speed = round(call(v, "getLastSpeed") or 0, 1), motorOn = bool(call(v, "getIsMotorStarted")),
                    ai = bool(call(v, "getIsAIActive")), inUse = v == current}
                local okDir, dx, _, dz = pcall(localDirectionToWorld, v.rootNode, 0, 0, 1)
                if okDir and type(dx) == "number" then
                    e.heading = round((180 - math.deg(math.atan2(dx, dz))) % 360, 0)
                end
                local fuel, cap = self:getFuel(v)
                if fuel ~= nil and cap ~= nil and cap > 0 then
                    e.fuelPct = round(fuel / cap * 100, 0)
                end
                local opTime = call(v, "getOperatingTime")
                if type(opTime) == "number" then e.hours = round(opTime / 3600000, 1) end
                local damage = call(v, "getDamageAmount")
                if type(damage) == "number" then e.damage = round(damage * 100, 0) end
                e.field = self:getFieldIdAt(x, z)
                e.ads = self:getAdsService(v)
                local implNames = {}
                for _, impl in ipairs(self:getImplements(v)) do
                    implNames[#implNames + 1] = call(impl, "getFullName") or "Implement"
                end
                e.implements = implNames
                out.vehicles[#out.vehicles + 1] = e
            end
        end
    end
    self:writeTextFile(self.equipmentPath, G5Json.encode(out))
end

-- createFile / fileWrite / delete: Giants file API (see BitmapUtil.writeBitmapToFile).
function G5Link:writeTextFile(path, text)
    if createFile == nil or fileWrite == nil or FileAccess == nil then
        return false
    end
    local file = createFile(path, FileAccess.WRITE)
    if file == nil or file == 0 then
        return false
    end
    fileWrite(file, text)
    delete(file)
    return true
end

function G5Link:writeProviders(vehicle)
    local api = G5LinkProviders.api
    if api == nil or type(api.getDisplayFrame) ~= "function" then
        return
    end

    local context = {vehicle = vehicle, maxWaypoints = 1}
    if vehicle ~= nil and vehicle.rootNode ~= nil then
        local x, _, z = getWorldTranslation(vehicle.rootNode)
        context.x, context.z = x, z
        context.fieldId = self:getFieldIdAt(x, z)
    end

    local ok, frame = pcall(api.getDisplayFrame, context)
    if not ok or type(frame) ~= "table" then
        return
    end
    frame.providers = frame.providers or {}

    -- Keep the 1 Hz frame small: course and field geometry go to course.json on change.
    local cp = frame.providers.courseplay
    local courseKey = nil
    if type(cp) == "table" then
        local course = cp.course
        if type(course) == "table" then
            course.waypoints = nil
            courseKey = tostring(course.hash or "") .. "|" .. tostring(course.name or "") .. "|"
                .. tostring(course.waypointCount or 0) .. "|" .. tostring(course.length or 0)
        end
        cp.hasFieldPolygon = type(cp.fieldPolygon) == "table" and #cp.fieldPolygon > 0
        cp.fieldPolygon = nil
        cp.islandPolygons = nil
    end
    local ad = frame.providers.autodrive
    if type(ad) == "table" and type(ad.activePath) == "table" and #ad.activePath > 64 then
        local trimmed = {}
        for i = 1, 64 do trimmed[i] = ad.activePath[i] end
        ad.activePath = trimmed
    end

    if courseKey ~= self.lastCourseKey then
        self.lastCourseKey = courseKey
        self:writeCourse(api, vehicle, courseKey)
    end

    self.providerSeq = self.providerSeq + 1
    frame.seq = self.providerSeq
    frame.courseKey = courseKey
    frame.source = G5LinkProviders.external and "fieldPathPrivateAPI" or "g5link"
    frame.status = G5LinkProviders:getStatuses()
    self:writeTextFile(self.providersPath, G5Json.encode(frame))
end

-- course.json: Courseplay field-work course and field boundary, as compact [x, z, flags] lists.
-- flags: 1 = row start, 2 = row end, 4 = headland, 8 = connecting path, 16 = reverse
function G5Link:writeCourse(api, vehicle, courseKey)
    local out = {key = courseKey, waypoints = {}, field = {}}
    if courseKey ~= nil and type(api.getSnapshot) == "function" then
        local ok, snap = pcall(api.getSnapshot, "courseplay", {vehicle = vehicle, maxWaypoints = 20000})
        if ok and type(snap) == "table" then
            local course = snap.course or {}
            out.name = course.name
            out.workWidth = course.workWidth
            local wps = course.waypoints or {}
            local step = math.max(1, math.ceil(#wps / G5Link.COURSE_MAX_POINTS))
            for i = 1, #wps, step do
                local w = wps[i]
                if w ~= nil and w.x ~= nil and w.z ~= nil then
                    local flags = (w.rowStart and 1 or 0) + (w.rowEnd and 2 or 0)
                        + (((w.headland or 0) > 0) and 4 or 0) + (w.connectingPath and 8 or 0)
                        + (w.reverse and 16 or 0)
                    out.waypoints[#out.waypoints + 1] = {round(w.x, 1), round(w.z, 1), flags}
                end
            end
            local poly = snap.fieldPolygon or {}
            local pstep = math.max(1, math.ceil(#poly / G5Link.COURSE_MAX_POINTS))
            for i = 1, #poly, pstep do
                local p = poly[i]
                if p ~= nil and p.x ~= nil and p.z ~= nil then
                    out.field[#out.field + 1] = {round(p.x, 1), round(p.z, 1)}
                end
            end
        end
    end
    self:writeTextFile(self.coursePath, G5Json.encode(out))
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
                index = xml:getInt(key .. "#index", 0),
                arg = xml:getString(key .. "#arg", ""),
                session = xml:getString(key .. "#session", ""),
                save = xml:getString(key .. "#save", ""),
                vehicle = xml:getString(key .. "#vehicle", ""),
                implement = xml:getString(key .. "#implement", "")
            })
        end
    end)
    xml:delete()

    table.sort(pending, function(a, b) return a.id < b.id end)
    for _, cmd in ipairs(pending) do
        self.lastCmdId = cmd.id
        local actualId = vehicle and (vehicle.uniqueId or vehicle.id)
        if cmd.session == "" or cmd.session == self.session and cmd.save == (self:saveKey() or "unsaved")
            and actualId ~= nil and cmd.vehicle == tostring(actualId) then
            self:runCommand(vehicle, cmd)
        end
    end
end

function G5Link:runCommand(vehicle, cmd)
    local name = cmd.name
    if name == "resetWork" then
        self:resetWork()
        return
    end
    -- RTK commands also come from the Ops Center while on foot (they name the machine)
    if G5LinkRtk ~= nil then
        local ok, handled = pcall(G5LinkRtk.run, G5LinkRtk, vehicle, cmd, self)
        if ok and handled then
            return
        end
        if not ok then
            -- never fail silently: log it and tell the display
            print("G5Link: RTK command '" .. tostring(cmd.arg) .. "' failed: " .. tostring(handled))
            G5LinkRtk.lastResult = { ok = false, error = "script: " .. tostring(handled), action = "error", id = cmd.id }
            return
        end
    end
    if vehicle == nil then
        return
    end
    if G5LinkRate ~= nil then
        local ok, handled = pcall(G5LinkRate.run, G5LinkRate, vehicle, cmd, self)
        if ok and handled then
            return
        end
    end
    if G5LinkSection ~= nil then
        local ok, handled = pcall(G5LinkSection.run, G5LinkSection, vehicle, cmd, self)
        if ok and handled then
            return
        end
    end
    if G5LinkHyd ~= nil then
        local ok, handled = pcall(G5LinkHyd.run, G5LinkHyd, vehicle, cmd)
        if ok and handled then
            return
        end
    end
    if G5LinkSteer ~= nil then
        local ok, handled = pcall(G5LinkSteer.run, G5LinkSteer, vehicle, cmd)
        if ok and handled then
            return
        end
    end
    if G5LinkGrainCart ~= nil then
        local ok, handled = pcall(G5LinkGrainCart.run, G5LinkGrainCart, vehicle, cmd)
        if ok and handled then
            return
        end
    end
    if G5LinkControls ~= nil then
        local ok, handled = pcall(G5LinkControls.run, G5LinkControls, vehicle, cmd)
        if ok and handled then
            return
        end
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

    elseif name == "boomWidth" then
        if cmd.session == "" or vehicle.isServer ~= true or call(vehicle, "getIsAIActive") == true then return end
        if cmd.arg ~= "left" and cmd.arg ~= "right" then return end
        local impl = self:getImplements(vehicle)[cmd.index + 1]
        local id = impl and (impl.uniqueId or impl.id)
        if id == nil or tostring(id) ~= cmd.implement or call(impl, "getIsAIActive") == true then return end
        local sprayer = self:getImplementState(impl).sprayer
        local boom = sprayer and sprayer.boom
        if boom == nil or not boom.canSet or not (cmd.value >= 0 and cmd.value <= boom[cmd.arg .. "Max"])
            or cmd.value % 1 ~= 0 then return end
        local left = cmd.arg == "left" and cmd.value or boom.left
        local right = cmd.arg == "right" and cmd.value or boom.right
        call(impl, "setSectionsActive", left, right)

    elseif name == "implTurnOn" then
        local impl = self:getImplements(vehicle)[cmd.index + 1]
        if impl ~= nil and bool(call(impl, "getCanBeTurnedOn")) then
            call(impl, "setIsTurnedOn", not bool(call(impl, "getIsTurnedOn")))
        end
    end
end

addModEventListener(G5Link)
