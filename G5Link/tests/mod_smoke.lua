-- G5Link mod smoke test. Runs the real mod scripts under plain Lua 5.1 with a mocked
-- Giants engine and mocked Realistic Harvesting, Soil & Fertilizer, Courseplay and AutoDrive.
--
--   lua5.1 G5Link/tests/mod_smoke.lua <mod folder> <output folder>
--
-- Writes each scenario's modSettings/FS25_G5Link files under <output folder>/<scenario>/,
-- which tests/check_output.js then reads with the real bridge parser.
-- The mocks follow the APIs the mod uses; they cannot prove the real game behaves the same.

local MOD = assert(arg[1], "usage: mod_smoke.lua <mod folder> <output folder>")
local OUT = assert(arg[2], "usage: mod_smoke.lua <mod folder> <output folder>")

local failures, checks = 0, 0
local function check(cond, label)
    checks = checks + 1
    if not cond then
        failures = failures + 1
        print("  FAIL " .. label)
    end
end
local function eq(actual, expected, label)
    check(actual == expected, string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
end
local function near(actual, expected, tol, label)
    check(type(actual) == "number" and math.abs(actual - expected) <= tol,
        string.format("%s: expected ~%s, got %s", label, tostring(expected), tostring(actual)))
end

---------------------------------------------------------------------------
-- Mock Giants engine
---------------------------------------------------------------------------
local PROFILE = nil  -- set per scenario
local logLines = {}
function print(...)  -- capture the mod's log lines, still echo them
    local parts = {}
    for i = 1, select("#", ...) do parts[#parts + 1] = tostring(select(i, ...)) end
    local line = table.concat(parts, "\t")
    logLines[#logLines + 1] = line
    io.write("    log: " .. line .. "\n")
end

function getUserProfileAppPath() return PROFILE end
-- Deterministic GNSS noise: with u = 0.25 the Box-Muller cosine term is cos(pi/2) = 0, so the simulated
-- receiver error stays at 0 unless a scenario swaps math.random.
local realRandom = math.random
math.random = function() return 0.25 end
function createFolder(path) os.execute('mkdir -p "' .. path .. '"') end
function fileExists(path)
    local f = io.open(path, "r")
    if f then f:close() return true end
    return false
end

FileAccess = {READ = 1, WRITE = 2}
local openFiles, nextFileId = {}, 100
function createFile(path, mode)
    local f = io.open(path, mode == FileAccess.WRITE and "w" or "r")
    if f == nil then return 0 end
    nextFileId = nextFileId + 1
    openFiles[nextFileId] = f
    return nextFileId
end
function fileWrite(id, text)
    assert(openFiles[id], "fileWrite on a closed file")
    assert(type(text) == "string", "fileWrite needs a string")
    openFiles[id]:write(text)
end
function delete(id)
    if openFiles[id] then openFiles[id]:close() openFiles[id] = nil end
end

-- XMLFile: keeps key -> value, writes Giants-style XML on save, and loads flat files.
local function xmlEscape(s)
    return (string.gsub(s, '[&<>"]', {["&"] = "&amp;", ["<"] = "&lt;", [">"] = "&gt;", ['"'] = "&quot;"}))
end
local function xmlUnescape(s)
    return (string.gsub(s, "&(%a+);", {amp = "&", lt = "<", gt = ">", quot = '"', apos = "'"}))
end
local function isFinite(v) return v == v and v ~= math.huge and v ~= -math.huge end

local XMLObj = {}
XMLObj.__index = XMLObj
XMLFile = {saved = {}}

function XMLFile.create(name, path, root)
    return setmetatable({name = name, path = path, root = root, values = {}, order = {}, alive = true}, XMLObj)
end

function XMLObj:set(key, value)
    assert(self.alive, "XMLFile used after delete: " .. key)
    assert(type(key) == "string" and string.sub(key, 1, #self.root) == self.root, "key outside root: " .. tostring(key))
    if self.values[key] == nil then self.order[#self.order + 1] = key end
    self.values[key] = value
end
function XMLObj:setInt(key, v)
    assert(type(v) == "number" and isFinite(v), "setInt(" .. key .. ") got " .. tostring(v))
    self:set(key, string.format("%d", v))
end
function XMLObj:setFloat(key, v)
    assert(type(v) == "number" and isFinite(v), "setFloat(" .. key .. ") got " .. tostring(v))
    self:set(key, string.format("%.6f", v))
end
function XMLObj:setString(key, v)
    assert(type(v) == "string", "setString(" .. key .. ") got " .. type(v))
    self:set(key, v)
end
function XMLObj:setBool(key, v)
    assert(type(v) == "boolean", "setBool(" .. key .. ") got " .. type(v))
    self:set(key, v and "true" or "false")
end

function XMLObj:save()
    assert(self.alive, "save after delete")
    -- build an element tree from "a.b(1).c#attr" keys
    local rootNode = {tag = self.root, attrs = {}, attrOrder = {}, kids = {}, byKey = {}}
    for _, key in ipairs(self.order) do
        local path, attr = string.match(key, "^([^#]+)#(.+)$")
        assert(path, "key without attribute: " .. key)
        local node = rootNode
        local first = true
        for part in string.gmatch(path, "[^%.]+") do
            if first then
                assert(part == self.root, "bad root in " .. key)
                first = false
            else
                local child = node.byKey[part]
                if child == nil then
                    child = {tag = string.match(part, "^[%w_]+"), attrs = {}, attrOrder = {}, kids = {}, byKey = {}}
                    node.byKey[part] = child
                    node.kids[#node.kids + 1] = child
                end
                node = child
            end
        end
        if node.attrs[attr] == nil then node.attrOrder[#node.attrOrder + 1] = attr end
        node.attrs[attr] = self.values[key]
    end
    local out = {'<?xml version="1.0" encoding="utf-8" standalone="no"?>\n'}
    local function write(node, indent)
        local a = {}
        for _, k in ipairs(node.attrOrder) do a[#a + 1] = string.format(' %s="%s"', k, xmlEscape(node.attrs[k])) end
        if #node.kids == 0 then
            out[#out + 1] = string.format("%s<%s%s/>\n", indent, node.tag, table.concat(a))
        else
            out[#out + 1] = string.format("%s<%s%s>\n", indent, node.tag, table.concat(a))
            for _, kid in ipairs(node.kids) do write(kid, indent .. "    ") end
            out[#out + 1] = string.format("%s</%s>\n", indent, node.tag)
        end
    end
    write(rootNode, "")
    local f = assert(io.open(self.path, "w"))
    f:write(table.concat(out))
    f:close()
    XMLFile.saved[self.path] = self
end
function XMLObj:delete() self.alive = false end

function XMLFile.load(name, path)
    local f = io.open(path, "r")
    if f == nil then return nil end
    local text = f:read("*a")
    f:close()
    local obj = setmetatable({name = name, path = path, values = {}, order = {}, alive = true}, XMLObj)
    local stack = {}
    for close, tag, attrs, selfClose in string.gmatch(text, "<(/?)([%w_]+)(.-)(/?)>") do
        if close == "/" then
            table.remove(stack)
        else
            local parent = stack[#stack]
            local p
            if parent == nil then
                p = tag
            else
                local idx = parent.counts[tag] or 0
                parent.counts[tag] = idx + 1
                p = string.format("%s.%s(%d)", parent.path, tag, idx)
            end
            for k, v in string.gmatch(attrs, '([%w_]+)="([^"]*)"') do obj.values[p .. "#" .. k] = xmlUnescape(v) end
            if selfClose ~= "/" then stack[#stack + 1] = {path = p, counts = {}} end
        end
    end
    return obj
end
function XMLObj:getString(key, default) local v = self.values[key] if v == nil then return default end return v end
function XMLObj:getInt(key, default) local v = tonumber(self.values[key]) if v == nil then return default end return math.floor(v) end
function XMLObj:getBool(key, default) local v = self.values[key] if v == nil then return default end return v == "true" end
function XMLObj:getFloat(key, default) local v = tonumber(self.values[key]) if v == nil then return default end return v end
function XMLObj:iterate(path, fn)
    local i = 0
    while true do
        local key = string.format("%s(%d)", path, i)
        local found = false
        for k in pairs(self.values) do
            if string.sub(k, 1, #key + 1) == key .. "#" then found = true break end
        end
        if not found then return end
        if fn(i + 1, key) == false then return end
        i = i + 1
    end
end

function Class(classTable) return {__index = classTable} end
local listeners = {}
function addModEventListener(listener) listeners[#listeners + 1] = listener end

-- nodes: id -> {x, z, dx, dz}
local nodes = {}
function getWorldTranslation(node) local n = assert(nodes[node], "unknown node") return n.x, 0, n.z end
function localDirectionToWorld(node, lx, ly, lz) local n = assert(nodes[node], "unknown node") return n.dx, 0, n.dz end

FillType = {UNKNOWN = 0, DIESEL = 1, DEF = 2, ELECTRICCHARGE = 3, METHANE = 4, SEEDS = 5, WHEAT = 6, LIQUIDFERTILIZER = 7}
local FILLTYPES = {
    [1] = {name = "DIESEL", title = "Diesel"}, [2] = {name = "DEF", title = "DEF"}, [5] = {name = "SEEDS", title = "Seeds"},
    [6] = {name = "WHEAT", title = "Wheat"}, [7] = {name = "LIQUIDFERTILIZER", title = "Liquid Fertilizer"},
}
Drivable = {CRUISECONTROL_STATE_OFF = 0, CRUISECONTROL_STATE_ACTIVE = 1, CRUISECONTROL_STATE_FULL = 2}

local calls = {}
local function record(name, ...) calls[#calls + 1] = {name = name, args = {...}} end
local function called(name)
    for _, c in ipairs(calls) do if c.name == name then return c end end
    return nil
end
Motorized = {actionEventToggleMotorState = function(v) record("motorToggle", v) end}
AttacherJoints = {actionEventLowerAllImplements = function(v) record("lowerAll", v) end}
TurnOnVehicle = {actionEventTurnOnAll = function(v) record("turnOnAll", v) end}

-- bit32 exists in FS25's Lua; plain Lua 5.1 needs a stand-in (non-negative integers only)
local function bitop(a, b, f)
    local r, m = 0, 1
    while a > 0 or b > 0 do
        if f(a % 2, b % 2) then r = r + m end
        a, b, m = math.floor(a / 2), math.floor(b / 2), m * 2
    end
    return r
end
bit32 = {
    band = function(a, b) return bitop(a, b, function(x, y) return x == 1 and y == 1 end) end,
    bor = function(a, b) return bitop(a, b, function(x, y) return x == 1 or y == 1 end) end,
    bnot = function(a) return 4294967295 - a end,
}
-- Light, pipe and fold action events (names from Lights.lua, Pipe.lua, Foldable.lua)
Lights = {LIGHT_TYPE_DEFAULT = 0, LIGHT_TYPE_WORK_BACK = 1, LIGHT_TYPE_WORK_FRONT = 2, LIGHT_TYPE_HIGHBEAM = 3,
    TURNLIGHT_OFF = 0, TURNLIGHT_LEFT = 1, TURNLIGHT_RIGHT = 2, TURNLIGHT_HAZARD = 3,
    actionEventToggleLights = function(v) record("lightsToggle", v) v.spec_lights.lightsTypesMask = 1 end,
    actionEventToggleBeaconLights = function(v) record("beaconToggle", v)
        v.spec_lights.beaconLightsActive = not v.spec_lights.beaconLightsActive end,
    actionEventToggleTurnLightHazard = function(v) record("hazardToggle", v) v.spec_lights.turnLightState = 3 end,
}
AIAutomaticSteering = {STATE = {DISABLED = 0, AVAILABLE = 1, ACTIVE = 2}}
Pipe = {actionEventTogglePipe = function(v) record("pipeToggle", v) v.spec_pipe.targetState = 2 end}
Foldable = {actionEventFoldAll = function(v) record("foldToggle", v) v.spec_foldable.foldMoveDirection = -1 end}

---------------------------------------------------------------------------
-- Mock vehicles
---------------------------------------------------------------------------
local function makeMotor(state)
    return {
        getLastModulatedMotorRpm = function(self) return state.rpm end,
        getMaxRpm = function(self) return 2100 end,
        getSmoothLoadPercentage = function(self) return 0.62 end,
        getGearInfoToDisplay = function(self) return "D", true, true end,
        getDrivingDirection = function(self) return 1 end,
    }
end

WorkAreaType = {DEFAULT = 1, AUXILIARY = 2, SOWINGMACHINE = 3, RIDGEMARKER = 4}
g_workAreaTypeManager = {getWorkAreaTypeIsAIArea = function(self, t) return t ~= WorkAreaType.RIDGEMARKER end}

local function addNode(x, z)
    local id = #nodes + 1
    nodes[id] = {x = x, z = z, dx = 1, dz = 0}
    return id
end

local function makeImplement(width, areas)
    local s = {lowered = true, on = true}
    local wa = {}
    for i = 1, areas do
        -- areas across the bar at x = 92.5 (7.5 m behind a tractor at x = 100), z from 200 - w/2
        local z0 = 200 - width / 2 + width * (i - 1) / areas
        local z1 = 200 - width / 2 + width * i / areas
        wa[#wa + 1] = {index = i, type = WorkAreaType.SOWINGMACHINE,
            start = addNode(92.5, z0), width = addNode(92.5, z1), height = addNode(91.5, z0)}
    end
    wa[#wa + 1] = {index = 99, type = WorkAreaType.AUXILIARY, start = addNode(0, 0), width = addNode(0, 1), height = addNode(1, 0)}
    wa[#wa + 1] = {index = 98, type = WorkAreaType.RIDGEMARKER, start = addNode(0, 0), width = addNode(0, 1), height = addNode(1, 0)}
    local impl = {
        spec_workArea = {workAreas = wa},
        getFullName = function(self) return "Test Planter" end,
        getAllowsLowering = function(self) return true end,
        getIsLowered = function(self) return s.lowered end,
        getCanBeTurnedOn = function(self) return true end,
        getIsTurnedOn = function(self) return s.on end,
        setIsTurnedOn = function(self, on) s.on = on record("setIsTurnedOn", on) end,
        getAIWorkAreaWidth = function(self) return width end,
        getIsWorkAreaActive = function(self, area) return s.on and area.index ~= 3 end,
        getFillUnits = function(self) return {{}, {}} end,
        getFillUnitCapacity = function(self, i) return ({2800, 2271})[i] end,
        getFillUnitFillLevel = function(self, i) return ({2500.25, 1600})[i] end,
        getFillUnitFillType = function(self, i) return ({FillType.SEEDS, FillType.LIQUIDFERTILIZER})[i] end,
    }
    return impl, s
end

local function makeVehicle(opts)
    local s = {speed = opts.speed or 10, rpm = 1450, cc = 0, ccSpeed = 11.5, fuel = 500, def = 60, motorOn = true}
    local node = #nodes + 1
    nodes[node] = {x = opts.x or 100, z = opts.z or 200, dx = 1, dz = 0}
    local v = {rootNode = node}
    v.getFullName = function(self) return opts.name or "Test Tractor" end
    v.getLastSpeed = function(self) return s.speed end
    v.getIsMotorStarted = function(self) return s.motorOn end
    v.getIsAIActive = function(self) return false end
    v.getIsOnField = function(self) return true end
    v.getMotor = function(self) if opts.brokenMotor then error("motor exploded") end return makeMotor(s) end
    v.getCruiseControlState = function(self) return s.cc end
    v.setCruiseControlState = function(self, st) s.cc = st record("setCruiseControlState", st) end
    v.getCruiseControlSpeed = function(self) return s.ccSpeed end
    v.getCruiseControlMaxSpeed = function(self) return 40 end
    v.setCruiseControlMaxSpeed = function(self, speed, rev) s.ccSpeed = speed record("setCruiseControlMaxSpeed", speed, rev) end
    v.getConsumerFillUnitIndex = function(self, ft)
        if ft == FillType.DIESEL then return 1 elseif ft == FillType.DEF then return 2 end
        return nil
    end
    v.getFillUnitFillLevel = function(self, i)
        if opts.combine and i == 3 then return 5200 end
        return ({s.fuel, s.def})[i]
    end
    v.getFillUnitCapacity = function(self, i)
        if opts.combine and i == 3 then return 14100 end
        return ({680, 72})[i]
    end
    v.getFillUnitFillType = function(self, i) if i == 3 then return FillType.WHEAT end return FillType.DIESEL end
    v.getDamageAmount = function(self) return 0.125 end
    v.getOperatingTime = function(self) return 1287.4 * 3600000 end
    v.getIsTurnedOn = function(self) return true end
    if opts.combine then v.spec_combine = {fillUnitIndex = 3} end
    v.children = {v}
    v.getChildVehicles = function(self) return v.children end
    return v, s
end

-- Courseplay vehicle functions (names from the FieldPath Courseplay adapter)
local function addCourseplay(v)
    local course = {}
    local function wp(i) return {x = 100 + (i % 10) * 10, z = 200 + math.floor(i / 10) * 12, angle = 0,
        getRowNumber = function(self) return math.floor(i / 10) + 1 end} end
    course.getNumberOfWaypoints = function(self) return 50 end
    course.getWaypoint = function(self, i) return wp(i) end
    course.isReverseAt = function(self, i) return false end
    course.isTurnEndAtIx = function(self, i) return i % 10 == 1 end
    course.isTurnStartAtIx = function(self, i) return i % 10 == 0 end
    course.isOnConnectingPath = function(self, i) return i > 45 end
    course.getHeadlandNumber = function(self, i) return 0 end
    course.getName = function(self) return "Field 12 course" end
    course.getHash = function(self) return "hash-1" end
    course.getWorkWidth = function(self) return 12.19 end
    course.getNumberOfHeadlands = function(self) return 0 end
    course.getCurrentWaypointIx = function(self) return 21 end
    course.getLastPassedWaypointIx = function(self) return 20 end
    course.getLength = function(self) return 500 end
    course.getRemainingDistanceAndTurnsFrom = function(self, ix) return 290, 3 end
    course.isTemporary = function(self) return false end
    v.getIsCpActive = function(self) return true end
    v.getIsCpFieldWorkActive = function(self) return true end
    v.getIsCpDriveToFieldWorkActive = function(self) return false end
    v.getCpFieldWorkProgress = function(self) return 0.42 end
    v.getCurrentCpCourseName = function(self) return "Field 12 course" end
    v.getFieldWorkCourse = function(self) return course end
    v.cpGetFieldPolygon = function(self) return {{x = 90, z = 190}, {x = 220, z = 190}, {x = 220, z = 270}, {x = 90, z = 270}} end
    v.cpGetIslandPolygons = function(self) return {} end
    v.getCpActiveInfoTexts = function(self) return {} end
end

local function addAutoDrive(v)
    v.ad = {
        stateModule = {
            isActive = function(self) return true end,
            getMode = function(self) return 1 end,
            getCurrentLocalizedTaskInfo = function(self) return "Deliver to Grain Bins" end,
            getName = function(self) return "AD" end,
            getFirstMarkerName = function(self) return "Grain Bins" end,
            getRemainingDriveTime = function(self) return 125 end,
            getSpeedLimit = function(self) return 40 end,
        },
        drivePathModule = {
            getWayPoints = function(self)
                local p = {}
                for i = 1, 100 do p[i] = {id = i, x = i, y = 0, z = -i} end
                return p, 2
            end,
            getIsReversing = function(self) return false end,
            isOnRoadNetwork = function(self) return true end,
            isTargetReached = function(self) return false end,
        },
    }
end

---------------------------------------------------------------------------
-- Mock mods
---------------------------------------------------------------------------
local function rhApi()
    return {
        isRHMActive = function(v) return true end,
        getVersion = function() return "1.6.5.1-Beta-2" end,
        getCurrentCrop = function(v) return "WHEAT" end,
        getSettingsMode = function(v) return "MANUAL" end,
        isActivelyHarvesting = function(v) return true end,
        isAiWorkerActive = function(v) return false end,
        isMoistureExceeded = function(v) return true end,
        getPackageLevel = function(v) return 3 end,
        getYield = function(v) return 0 / 0 end,               -- NaN: must be skipped, not written
        getLastValidYield = function(v) return 6.52 end,
        getTonPerHour = function(v) return math.huge end,       -- infinity: must be skipped
        getHectaresPerHour = function(v) return 7.3 end,
        getAverageHectaresPerHour = function(v) return 6.9 end,
        getLitersPerHour = function(v) return 58 end,
        getWorkingWidth = function(v) return 12.19 end,
        getTotalHarvestedMass = function(v) return 20100 end,
        getMoisture = function(v) return 15.2 end,
        getMoistureLimit = function(v) return 14.5 end,
        getWeedRatio = function(v) return 0.04 end,
        getTotalCropLoss = function(v) return 0.8 end,
        getOverloadLoss = function(v) return 0.1 end,
        getMoistureLoss = function(v) return 0.3 end,
        getSettingsLoss = function(v) return 0.4 end,
        getSlopeLoss = function(v) error("slope model crashed") end,  -- must be contained by pcall
        getWearLoss = function(v) return 0.05, 0.02, 0.03 end,
        getEfficiencyRank = function(loss) return "A" end,
        getEngineLoad = function(v) return 104.5 end,
        getTargetEngineLoad = function(v) return 80 end,
        getRecommendedSpeed = function(v) return 5.8 end,
        getSettingsEfficiency = function(v) return 0.94 end,
        getSettings = function(v) return {fan = 70, rotor = 64, concave = 31, upperSieve = 33, lowerSieve = 22, feeder = 36, targetEngineLoad = 80} end,
        getOptimalSettings = function(v)
            return {fan = {optimal = 72, min = 52, max = 92, tolerance = 6}, rotor = {optimal = 67, min = 47, max = 87, tolerance = 6},
                concave = {optimal = 24, min = 10, max = 44, tolerance = 6}, moistureLimit = 14.5}
        end,
        getCombineTrip = function(v) return {harvestedAreaHa = 3.2, harvestedMassKg = 20100, harvestedLiters = 25770,
            lostLiters = 210, fuelUsedL = 41.5, sessionDuration = 1800, fieldId = 12, efficiencyRank = "A"} end,
    }
end

local seederCalls = 0
local function seederApi(planter)
    return {
        version = 2,
        getCapabilities = function(v) if v == planter then return {kind = "planter", seedMonitor = true, depthSensor = false} end return nil, "unsupportedVehicle" end,
        getSnapshot = function(v)
            seederCalls = seederCalls + 1
            if v ~= planter then return nil, "unsupportedVehicle" end
            return {schemaVersion = 1, kind = "planter", crop = "MAIZE", capabilities = {kind = "planter", seedMonitor = true},
                settings = {depthMm = 50, pressurePercent = 55, closingPercent = 50},
                application = {unit = "seedsPerAcre", ratePerAcre = 34000},
                measurements = {skipsPercent = 1.25, doublesPercent = 0.75, actualRatePerAcre = 34170, speedKmh = 9.8},
                controls = {sampleFresh = true},
                estimates = {soil = {moisture = 0.27, compaction = 0.2, moistureSource = "SeasonalCropStress"},
                    population = {targetSeedsPerAcre = 34000, establishedSeedsPerAcre = 33100, yieldPotentialPercent = 97.2}},
                rows = {{row = 1, active = true, targetRatePerAcre = 34000, actualRatePerAcre = 34210, skipsPercent = 1.25, doublesPercent = 0.75},
                        {row = 2, active = false, targetRatePerAcre = 34000, actualRatePerAcre = 0}},
                presets = {{crop = "MAIZE"}}}
        end,
    }
end

local function soilManager()
    return {
        soilSystem = {
            getFieldInfo = function(self, fieldId, x, z)
                return {fieldId = fieldId, nitrogen = {value = 46, status = "Fair"}, phosphorus = {value = 41, status = "Good"},
                    potassium = {value = 18, status = "Poor"}, pH = 6.4, pHStatus = "LOCAL", organicMatter = 3.6,
                    compaction = 24, lastCrop = "SOYBEAN", shownDiseasePressure = nil, note = 'quote " and \\ back\nslash'}
            end,
            hookManager = {getFieldIdAtWorldPosition = function(self, x, z, strict) return 12 end},
        },
    }
end

---------------------------------------------------------------------------
-- Load the mod
---------------------------------------------------------------------------
g_currentModName = "FS25_G5Link"
g_currentMission = {time = 0, environment = {currentDay = 3, currentHour = 7, currentMinute = 5}}
local modDescFile = assert(io.open(MOD .. "/modDesc.xml", "r"), "modDesc.xml not found in " .. MOD)
local modDesc = modDescFile:read("*a")
modDescFile:close()
local sources = {}
for f in string.gmatch(modDesc, '<sourceFile filename="([^"]+)"') do sources[#sources + 1] = f end
check(#sources >= 9, "modDesc lists all source files")
for _, f in ipairs(sources) do dofile(MOD .. "/" .. f) end
eq(#listeners, 1, "exactly one mod event listener (G5Link)")
local mod = listeners[1]

local function readFile(path)
    local f = io.open(path, "r")
    if f == nil then return nil end
    local t = f:read("*a")
    f:close()
    return t
end
local function writeFile(path, text)
    local f = assert(io.open(path, "w"))
    f:write(text)
    f:close()
end

local function newScenario(name, mods)
    PROFILE = OUT .. "/" .. name .. "/"
    os.execute('rm -rf "' .. PROFILE .. '" && mkdir -p "' .. PROFILE .. '"')
    calls = {}
    logLines = {}
    g_time = 0
    g_currentMission = {time = 0, environment = {currentDay = 3, currentHour = 7, currentMinute = 5}}
    g_modManager = {getModByName = function(self, n) return (mods or {})[n] end}
    g_farmlandManager = {getFarmlandIdAtWorldPosition = function(self, x, z) return 23 end}
    g_fillTypeManager = {getFillTypeByIndex = function(self, i) return FILLTYPES[i] end}
    RHM_Api = nil
    print("scenario " .. name)
    return PROFILE .. "modSettings/FS25_G5Link/"
end

local function tick(n, dt)
    for _ = 1, n do
        g_time = g_time + (dt or 250)
        g_currentMission.time = g_time
        mod:update(dt or 250)
    end
end

local function keepLive(dir)
    writeFile(PROFILE .. "telemetry_live.xml", readFile(dir .. "telemetry.xml") or "")
end

local function telemetry(dir)
    local x = XMLFile.saved[dir .. "telemetry.xml"]
    return x and x.values or {}
end

---------------------------------------------------------------------------
-- Scenario 1: vanilla tractor + planter, no other mods; commands
---------------------------------------------------------------------------
do
    local dir = newScenario("vanilla_tractor", {})
    os.execute('mkdir -p "' .. dir .. '"')
    -- a command left over from a previous session must not run
    writeFile(dir .. "commands.xml", '<?xml version="1.0"?>\n<commands>\n    <cmd id="5" name="motorToggle" value="0" index="0"/>\n</commands>\n')
    local tractor, ts = makeVehicle({name = "Test Tractor", speed = 10})
    local planter, ps = makeImplement(12.19, 16)
    tractor.children = {tractor, planter}
    g_localPlayer = {getCurrentVehicle = function(self) return tractor end}
    g_currentMission.missionInfo = {savegameDirectory = "C:/Users/me/Documents/My Games/FarmingSimulator2025/savegame9/"}
    g_currentMission.realisticSeederAPI = seederApi(planter)

    -- map fields (FieldManager) and the farm's machines (VehicleSystem) for the Ops Center files
    local fieldNodes = {addNode(0, 0), addNode(100, 0), addNode(100, 100), addNode(0, 100)}
    g_fieldManager = {fields = {{fieldId = 7, name = "Field 7", areaHa = 1.0, farmland = {id = 23}, posX = 50, posZ = 50,
        getPolygonPoints = function(self) return fieldNodes end}},
        getFieldAtWorldPosition = function(self, x, z) if x >= 0 and x <= 100 and z >= 0 and z <= 100 then return self.fields[1] end return nil end}
    g_farmlandManager.getFarmlandOwner = function(self, id) return id == 23 and 1 or 0 end
    g_localPlayer.getFarmId = function(self) return 1 end
    tractor.spec_motorized = {}
    tractor.uniqueId = "veh-1"
    tractor.getOwnerFarmId = function(self) return 1 end
    local stranger = makeVehicle({name = "Neighbour Tractor"})
    stranger.spec_motorized = {}
    stranger.getOwnerFarmId = function(self) return 2 end
    g_currentMission.vehicleSystem = {vehicles = {tractor, planter, stranger}}
    -- Advanced Damage System surface (as VDTelemetry reads it) and the game economy
    FS25_AdvancedDamageSystem = {AdvancedDamageSystem = {STATUS = {READY = "ads_spec_state_ready", MAINTENANCE = "ads_spec_state_maintenance"}}}
    tractor.spec_AdvancedDamageSystem = {currentState = "ads_spec_state_maintenance"}
    tractor.getIsADSExcluded = function(self) return false end
    tractor.getServiceIntervalElapsedHours = function(self) return 120.54 end
    tractor.getServiceInterval = function(self) return 250 end
    g_currentMission.economyManager = {
        getPricePerLiter = function(self, i) return ({[6] = 0.218, [5] = 0.9})[i] or 0 end,
        getCostPerLiter = function(self, i) return ({[1] = 1.4, [5] = 0.9})[i] or 0 end}
    g_fillTypeManager.getFillTypes = function(self)
        return {{index = 1, name = "DIESEL", title = "Diesel", massPerLiter = 0.00084}, {index = 5, name = "SEEDS", title = "Seeds", massPerLiter = 0.00045},
            {index = 6, name = "WHEAT", title = "Wheat", massPerLiter = 0.00078}, {index = 9, name = "STONE", title = "Stone"}}
    end
    g_farmManager = {getFarmById = function(self, id) return {name = "Test Farm", getBalance = function() return 1000.5 end,
        getLoan = function() return 200 end, getEquity = function() return 5000 end} end}
    -- Farm Finance public API (API.md): dot calls
    g_currentMission.farmFinanceAPI = {
        isReady = function() return true end, getVersion = function() return "1.0.0", "0.3.0.0" end,
        isBankActive = function() return true end, getCreditScore = function(id) return 731, "B" end,
        getFarmSummary = function(id) return {loans = {{id = "L1", balance = 900, payment = 50, rate = 0.07}}, debt = {total = 900}} end,
        getMarket = function() return {baseRate = 0.0625, trend = 1} end,
        getInputAccount = function(id) return {enabled = true, limit = 50000, balance = 1200, available = 48800, pastDue = 0} end,
        getLandContract = function(farmlandId)
            if farmlandId == 23 then return {kind = "in", leaseType = "share", farmId = 1, landownerShare = 0.33, inputShare = 0.25, endCropYear = 2028} end
            return nil
        end}

    mod:loadMap("test")
    seederCalls = 0
    tick(4)
    keepLive(dir)
    check(called("motorToggle") == nil, "old command id 5 ignored")
    local t0 = telemetry(dir)
    eq(t0["g5.game#save"], "savegame9", "savegame key from savegameDirectory")
    eq(t0["g5.implements.implement(0).area(0)#sx"], "92.500000", "area 0 start x")
    near(tonumber(t0["g5.implements.implement(0).area(15)#wz"]), 200 + 12.19 / 2, 0.01, "area 15 width z")
    eq(t0["g5.implements.implement(0).area(16)#sx"], nil, "auxiliary and ridge-marker areas not written")
    eq(t0["g5.implements.implement(0).fill(0)#type"], "SEEDS", "fill type name")
    eq(t0["g5.implements.implement(0).seeder#crop"], "MAIZE", "seeder crop")
    eq(t0["g5.implements.implement(0).seeder#rate"], "34000.000000", "seeder target rate")
    eq(t0["g5.implements.implement(0).seeder#actual"], "34170.000000", "seeder actual rate")
    eq(t0["g5.implements.implement(0).seeder#skips"], "1.250000", "seeder skips")
    eq(t0["g5.implements.implement(0).seeder#doubles"], "0.750000", "seeder doubles")
    eq(t0["g5.implements.implement(0).seeder#moisture"], "0.270000", "seeder soil moisture")
    eq(t0["g5.implements.implement(0).seeder#soilSource"], "SeasonalCropStress", "seeder soil source")
    eq(t0["g5.implements.implement(0).seeder#fresh"], "true", "seeder sample fresh")
    eq(t0["g5.implements.implement(0).seeder.row(1)#on"], "false", "seeder row 2 off")
    eq(t0["g5.implements.implement(0).seeder#cv"], nil, "no CV on a planter")
    check(seederCalls <= 2, "seeder snapshot read at most once per second (" .. seederCalls .. " calls in 1 s)")
    eq(t0["g5.vehicle#name"] ~= nil, true, "tractor not treated as a seeder")
    local fj = readFile(dir .. "fields.json") or ""
    check(string.find(fj, '"id":7', 1, true) ~= nil, "fields.json lists map field 7")
    check(string.find(fj, '"owner":1', 1, true) ~= nil, "fields.json has the owner")
    check(string.find(fj, '[100,100]', 1, true) ~= nil, "fields.json has the polygon")
    writeFile(dir .. "fields.json", "SENTINEL")
    tick(41)                                            -- > 10 s: ownership unchanged, so no rewrite
    eq(readFile(dir .. "fields.json"), "SENTINEL", "fields.json only rewritten on change")
    local ej = readFile(dir .. "equipment.json") or ""
    check(string.find(ej, '"id":"veh-1"', 1, true) ~= nil, "equipment.json lists the farm's tractor")
    check(string.find(ej, "Neighbour", 1, true) == nil, "equipment.json leaves out other farms' machines")
    check(string.find(ej, '"inUse":true', 1, true) ~= nil, "equipment.json marks the machine in use")
    check(string.find(ej, '"implements":["Test Planter"]', 1, true) ~= nil, "equipment.json lists attached implements")
    check(string.find(ej, '"state":"MAINTENANCE"', 1, true) ~= nil, "ADS workshop state resolved through ADS's STATUS table")
    check(string.find(ej, '"hours":120.5', 1, true) ~= nil and string.find(ej, '"interval":250', 1, true) ~= nil, "ADS service interval")
    local econ = readFile(dir .. "economy.json") or ""
    check(string.find(econ, '"balance":1000.5', 1, true) ~= nil, "economy.json farm balance")
    check(string.find(econ, '"WHEAT":{', 1, true) ~= nil and string.find(econ, '"price":0.218', 1, true) ~= nil, "economy.json crop price")
    check(string.find(econ, '"cost":0.9', 1, true) ~= nil, "economy.json input cost")
    check(string.find(econ, "STONE", 1, true) == nil, "fill types without a price or cost left out")
    check(string.find(econ, '"creditGrade":"B"', 1, true) ~= nil, "Farm Finance credit grade")
    check(string.find(econ, '"23":{', 1, true) ~= nil and string.find(econ, '"landownerShare":0.33', 1, true) ~= nil, "Farm Finance lease on the field's farmland")
    check(string.find(econ, '"available":48800', 1, true) ~= nil, "Farm Finance input account")
    check(string.find(econ, '"loans":[{', 1, true) ~= nil and string.find(econ, '"baseRate":0.0625', 1, true) ~= nil, "Farm Finance summary and market")
    check(string.find(fj, '"farmName":"Test Farm"', 1, true) ~= nil, "fields.json farm name")
    local t = telemetry(dir)
    eq(t["g5#state"], "vehicle", "state")
    eq(t["g5.vehicle#name"], "Test Tractor", "vehicle name")
    near(tonumber(t["g5.vehicle#speed"]), 10, 0.01, "speed")
    eq(t["g5.vehicle#heading"], "90.000000", "heading east from direction (1, 0)")
    eq(t["g5.vehicle#farmland"], "23", "farmland")
    eq(t["g5.vehicle#field"], nil, "no field id without Soil & Fertilizer")
    eq(t["g5.vehicle#fuelType"], "DIESEL", "fuel type")
    near(tonumber(t["g5.vehicle#load"]), 62, 0.01, "engine load %")
    eq(t["g5.implements.implement(0)#areas"], "1101111111111111", "section bits (area 3 off)")
    eq(t["g5.implements.implement(0).fill(0)#title"], "Seeds", "fill title")
    eq(t["g5.combine#tank"], nil, "no combine block for a tractor")
    eq(t["g5.rh#version"], nil, "no Realistic Harvesting block")
    near(tonumber(t["g5.work#area"]), 12.19 * 10 / 3.6 * 11.25, 1, "worked area after 11.25 s (45 ticks)")

    -- fuel accounting: burn 0.5 L
    ts.fuel = 499.5
    tick(1)
    near(tonumber(telemetry(dir)["g5.work#totalFuel"]), 0.5, 0.001, "fuel used")

    -- commands written in the bridge's format
    writeFile(dir .. "commands.xml", table.concat({
        '<?xml version="1.0" encoding="utf-8" standalone="no"?>', "<commands>",
        '    <cmd id="5" name="motorToggle" value="0" index="0"/>',
        '    <cmd id="6" name="cruiseSet" value="12.5" index="0"/>',
        '    <cmd id="7" name="cruiseToggle" value="0" index="0"/>',
        '    <cmd id="8" name="implTurnOn" value="0" index="0"/>',
        '    <cmd id="9" name="lowerAll" value="0" index="0"/>',
        '    <cmd id="10" name="resetWork" value="0" index="0"/>',
        "</commands>", ""}, "\n"))
    tick(2)
    local c = called("setCruiseControlMaxSpeed")
    check(c ~= nil and c.args[1] == 12.5, "cruiseSet 12.5 applied")
    eq(ts.cc, 1, "cruiseToggle turned cruise on")
    eq(ps.on, false, "implTurnOn toggled the planter off")
    check(called("lowerAll") ~= nil, "lowerAll ran")
    check(called("motorToggle") == nil, "id 5 still ignored")
    eq(telemetry(dir)["g5#lastCmd"], "10", "lastCmd acknowledged")
    -- planter off -> not recording; after the reset no new area may accumulate
    tick(1)
    near(tonumber(telemetry(dir)["g5.work#area"]), 0, 0.001, "work counters reset")

    -- providers.json exists, every adapter reports missing
    local pj = readFile(dir .. "providers.json")
    check(pj ~= nil and #pj > 10, "providers.json written")
    check(pj and string.find(pj, '"courseKey"', 1, true) == nil, "no courseKey without Courseplay")
    check(readFile(dir .. "course.json") ~= nil, "course.json written once (empty)")

    -- on foot, then unload
    g_localPlayer = {getCurrentVehicle = function(self) return nil end}
    tick(1)
    eq(telemetry(dir)["g5#state"], "onfoot", "on foot state")
    mod:deleteMap()
    eq(telemetry(dir)["g5#state"], "unloaded", "unloaded state after deleteMap")
    eq(g_currentMission.fieldPathPrivateAPI, nil, "own fieldPathPrivateAPI removed on deleteMap")
end

---------------------------------------------------------------------------
-- Scenario 2: combine with Realistic Harvesting, Soil & Fertilizer, Courseplay, AutoDrive
---------------------------------------------------------------------------
do
    local mods = {FS25_SoilFertilizer = {version = "2.6.0.3"}, FS25_AutoDrive = {version = "3.0.1.4"},
        FS25_Courseplay = {version = "8.1.0.3"}}
    local dir = newScenario("combine_all_mods", mods)
    local combine = makeVehicle({name = "Test S7 Combine", combine = true, speed = 6})
    local header = makeImplement(12.19, 1)
    combine.children = {combine, header}
    addCourseplay(combine)
    addAutoDrive(combine)
    g_localPlayer = {getCurrentVehicle = function(self) return combine end}
    RHM_Api = rhApi()

    mod:loadMap("test")
    g_currentMission.soilFertilityManager = soilManager()  -- after loadMap, like a mod loading later
    tick(8)
    keepLive(dir)
    local t = telemetry(dir)
    eq(t["g5.vehicle#field"], "12", "field id from Soil & Fertilizer")
    eq(t["g5.combine#tank"], "5200.000000", "grain tank level")
    eq(t["g5.combine#tankCap"], "14100.000000", "grain tank capacity")
    eq(t["g5.combine#crop"], "WHEAT", "tank crop")
    eq(t["g5.rh#version"], "1.6.5.1-Beta-2", "RH version")
    eq(t["g5.rh#yield"], nil, "NaN yield skipped")
    eq(t["g5.rh#tph"], nil, "infinite throughput skipped")
    eq(t["g5.rh#lossSlope"], nil, "erroring RH call skipped")
    eq(t["g5.rh#lossWear"], "0.050000", "first of three wear values")
    eq(t["g5.rh#rank"], "A", "efficiency rank")
    eq(t["g5.rh#moistureHigh"], "true", "moisture flag")
    eq(t["g5.rh.setting(0)#name"], "concave", "settings sorted by name")
    eq(t["g5.rh.setting(0)#opt"], "24.000000", "concave optimum")
    eq(t["g5.rh.setting(1)#name"], "fan", "second setting")
    eq(t["g5.rh.setting(2)#name"], "feeder", "feeder has no optimum")
    eq(t["g5.rh.setting(2)#opt"], nil, "no optimum for feeder")
    eq(t["g5.rh.trip#field"], "12.000000", "trip field")
    local targetLoadSetting = false
    for k, v in pairs(t) do if string.find(k, "^g5%.rh%.setting") and v == "targetEngineLoad" then targetLoadSetting = true end end
    check(not targetLoadSetting, "targetEngineLoad not listed as a setting")

    local cj = readFile(dir .. "course.json")
    check(cj ~= nil and string.find(cj, '"hash-1|Field 12 course|50|500"', 1, true) ~= nil, "course.json has the course key")
    check(cj and string.find(cj, '"waypoints":[[', 1, true) ~= nil, "course waypoints written")
    -- course.json must only be rewritten when the course changes
    local before = cj
    writeFile(dir .. "course.json", "SENTINEL")
    tick(8)
    eq(readFile(dir .. "course.json"), "SENTINEL", "course.json not rewritten while the course is unchanged")
    writeFile(dir .. "course.json", before)
    local pj = readFile(dir .. "providers.json")
    check(pj and string.find(pj, '"fieldPolygon"', 1, true) == nil, "field polygon kept out of providers.json")
    check(pj and string.find(pj, '"source":"g5link"', 1, true) ~= nil, "built-in adapters used")
    mod:deleteMap()
end

---------------------------------------------------------------------------
-- Scenario 3: another mod already published fieldPathPrivateAPI
---------------------------------------------------------------------------
do
    local dir = newScenario("external_api", {})
    local tractor = makeVehicle({speed = 0})
    g_localPlayer = {getCurrentVehicle = function(self) return tractor end}
    local external = {
        getDisplayFrame = function(ctx)
            return {schemaVersion = 1, fieldId = 7, providers = {["soil-fertilizer"] = {values = {pH = 6.1}}}}
        end,
        listProviders = function() return {{id = "soil-fertilizer", status = {available = true, mode = "public-api"}}} end,
        getSnapshot = function() return nil end,
    }
    g_currentMission.fieldPathPrivateAPI = external
    mod:loadMap("test")
    tick(4)
    keepLive(dir)
    local pj = readFile(dir .. "providers.json") or ""
    check(string.find(pj, '"source":"fieldPathPrivateAPI"', 1, true) ~= nil, "external API used")
    check(string.find(pj, '"pH":6.1', 1, true) ~= nil, "external snapshot passed through")
    mod:deleteMap()
    check(g_currentMission.fieldPathPrivateAPI == external, "external API left in place on deleteMap")
end

---------------------------------------------------------------------------
-- Scenario 4: a broken vehicle must not stop the mod
---------------------------------------------------------------------------
do
    local dir = newScenario("broken_vehicle", {})
    local tractor = makeVehicle({brokenMotor = true})
    tractor.getChildVehicles = function(self) error("children broke") end
    g_localPlayer = {getCurrentVehicle = function(self) return tractor end}
    mod:loadMap("test")
    local ok, err = pcall(tick, 6)
    keepLive(dir)
    check(ok, "update survives a vehicle whose methods throw: " .. tostring(err))
    local t = telemetry(dir)
    eq(t["g5#state"], "vehicle", "still writes telemetry")
    eq(t["g5.vehicle#rpm"], nil, "no motor values from a broken motor")
    mod:deleteMap()
end

---------------------------------------------------------------------------
-- Scenario 5: combine shortcut controls and Harvest Automation
---------------------------------------------------------------------------
do
    local dir = newScenario("combine_controls", {})
    local combine, cs = makeVehicle({name = "Test S7 Combine", combine = true, speed = 6})
    local header = makeImplement(12.19, 1)
    combine.spec_lights = {numLightTypes = 4, lightsTypesMask = 0, turnLightState = 0, beaconLights = {{}}, beaconLightsActive = false}
    combine.getCanToggleLight = function(self) return true end
    combine.setLightsTypesMask = function(self, m) record("setLightsTypesMask", m) self.spec_lights.lightsTypesMask = m end
    combine.spec_pipe = {numStates = 2, currentState = 1, targetState = 1}
    header.spec_foldable = {hasFoldingParts = true, foldMoveDirection = 0}
    header.getIsUnfolded = function(self) return true end
    combine.children = {combine, header}
    g_localPlayer = {getCurrentVehicle = function(self) return combine end}
    RHM_Api = rhApi()
    mod:loadMap("test")
    tick(4)
    local t = telemetry(dir)
    eq(t["g5.controls#beacon"], "false", "beacon state")
    eq(t["g5.controls#hazard"], "false", "hazard state")
    eq(t["g5.controls.pipe#open"], "false", "pipe closed")
    eq(t["g5.controls.fold#unfolded"], "true", "header unfolded")
    eq(t["g5.harvestAuto#on"], "false", "automation off")

    cs.cc = Drivable.CRUISECONTROL_STATE_ACTIVE
    cs.ccSpeed = 8.0
    writeFile(dir .. "commands.xml", table.concat({
        '<?xml version="1.0" encoding="utf-8" standalone="no"?>', "<commands>",
        '    <cmd id="1" name="pipeToggle" value="0" index="0"/>',
        '    <cmd id="2" name="foldToggle" value="0" index="0"/>',
        '    <cmd id="3" name="beaconToggle" value="0" index="0"/>',
        '    <cmd id="4" name="hazardToggle" value="0" index="0"/>',
        '    <cmd id="5" name="workLightsToggle" value="0" index="0"/>',
        '    <cmd id="6" name="harvestAutoMax" value="9" index="0"/>',
        '    <cmd id="7" name="harvestAuto" value="1" index="0"/>',
        "</commands>", ""}, "\n"))
    tick(2)
    local pc = called("pipeToggle")
    check(pc ~= nil and pc.args[1] == combine, "pipeToggle on the combine")
    local fc = called("foldToggle")
    check(fc ~= nil and fc.args[1] == header, "foldToggle on the header")
    check(called("beaconToggle") ~= nil and called("hazardToggle") ~= nil, "beacon and hazard ran")
    eq(combine.spec_lights.lightsTypesMask, 6, "work lights front and back on")
    tick(8)   -- 2 s: two automation steps of at most 0.5 km/h toward RH's 5.8 km/h
    check(cs.ccSpeed < 8 and cs.ccSpeed > 5.8, "automation stepped cruise speed down toward the recommended speed: " .. cs.ccSpeed)
    local steps = 0
    for _, c in ipairs(calls) do if c.name == "setCruiseControlMaxSpeed" then
        steps = steps + 1
        check(math.abs(c.args[1] - 8 + 0.5 * steps) < 0.001, "each step is 0.5 km/h")
    end end
    t = telemetry(dir)
    keepLive(dir)
    eq(t["g5.harvestAuto#state"], "active", "automation active")
    eq(t["g5.harvestAuto#source"], "rh", "automation follows Realistic Harvesting")
    near(tonumber(t["g5.harvestAuto#target"]), 5.8, 0.001, "target is RH recommended speed")
    eq(t["g5.controls.pipe#open"], "true", "pipe opening")
    eq(t["g5.controls#beacon"], "true", "beacon on")
    eq(t["g5.controls#workFront"], "true", "front work lights on")

    tick(12)
    near(cs.ccSpeed, 5.8, 0.001, "settles on the recommended speed")
    -- work lights toggle back off, cruise off puts automation on standby
    writeFile(dir .. "commands.xml", '<?xml version="1.0"?>\n<commands>\n    <cmd id="8" name="workLightsToggle" value="0" index="0"/>\n</commands>\n')
    cs.cc = Drivable.CRUISECONTROL_STATE_OFF
    tick(6)
    eq(combine.spec_lights.lightsTypesMask, 0, "work lights off")
    eq(telemetry(dir)["g5.harvestAuto#state"], "cruiseOff", "standby while cruise is off")
    -- leaving the combine switches automation off
    local tractor = makeVehicle({})
    g_localPlayer = {getCurrentVehicle = function(self) return tractor end}
    tick(6)
    eq(telemetry(dir)["g5.harvestAuto#on"], "false", "automation off after changing vehicle")
    eq(telemetry(dir)["g5.controls.pipe#open"], nil, "no pipe on a plain tractor")
    mod:deleteMap()
end

---------------------------------------------------------------------------
-- Scenario 6: tillage tools (game specs) and FieldPath Realistic Tillage depth
---------------------------------------------------------------------------
do
    local dir = newScenario("tillage", {})
    local tractor = makeVehicle({name = "Test 8R Tractor"})
    local disc = makeImplement(9.1, 1)
    disc.spec_cultivator = {useDeepMode = false}
    local plow = makeImplement(3.0, 1)
    plow.spec_plow = {}
    plow.spec_realisticTillage = {initialized = true, implementClass = "plow", depthCm = 25, targetDepthCm = 25,
        minDepthCm = 2, maxDepthCm = 38, depthLimited = false}
    plow.rtSetTillageDepth = function(self, v) record("rtSetTillageDepth", v) self.spec_realisticTillage.depthCm = v return true end
    plow.rtChangeTillageDepth = function(self, d) record("rtChangeTillageDepth", d)
        self.spec_realisticTillage.depthCm = self.spec_realisticTillage.depthCm + d end
    local ripper = makeImplement(4.5, 1)
    ripper.spec_cultivator = {isSubsoiler = true, useDeepMode = true}
    ripper.spec_realisticTillage = {initialized = true, implementClass = "ripper", depthCm = 0 / 0}  -- NaN depth must not be written
    -- vanilla WorkMode cultivator: state 1 deep, state 2 shallow
    local wmCult = makeImplement(6, 1)
    wmCult.spec_cultivator = {useDeepMode = true}
    wmCult.spec_workMode = {state = 1, workModes = {{name = "Deep", useDeepMode = true}, {name = "Shallow", useDeepMode = false}}}
    wmCult.getIsWorkModeChangeAllowed = function(self) return true end
    wmCult.setWorkMode = function(self, st) record("setWorkMode", st) self.spec_workMode.state = st
        self.spec_cultivator.useDeepMode = self.spec_workMode.workModes[st].useDeepMode end
    -- Cultivator Settings, selectable in game without work modes (config 5)
    local csCult = makeImplement(5, 1)
    csCult.spec_cultivator = {useDeepMode = true, isSubsoiler = false}
    csCult.spec_CultivatorSettings = {mode = 3, config = 5, useWorkModes = false, dirtyFlag = 7}
    csCult.raiseDirtyFlags = function(self, f) record("raiseDirtyFlags", f) end
    -- Cultivator Settings fixed by the shop configuration (config 2 = shallow)
    local csLocked = makeImplement(4, 1)
    csLocked.spec_cultivator = {useDeepMode = false}
    csLocked.spec_CultivatorSettings = {mode = 2, config = 2, useWorkModes = false}
    tractor.children = {tractor, disc, plow, ripper, wmCult, csCult, csLocked}
    g_localPlayer = {getCurrentVehicle = function(self) return tractor end}
    mod:loadMap("test")
    tick(4)
    local t = telemetry(dir)
    eq(t["g5.implements.implement(0).tillage#type"], "disc", "shallow cultivator reads as disc")
    eq(t["g5.implements.implement(0).tillage#deep"], "false", "disc is shallow")
    eq(t["g5.implements.implement(0).tillage#depth"], nil, "no depth without Realistic Tillage")
    eq(t["g5.implements.implement(1).tillage#type"], "plow", "plow type")
    eq(t["g5.implements.implement(1).tillage#depth"], "25.000000", "plow depth from Realistic Tillage")
    eq(t["g5.implements.implement(1).tillage#canSet"], "true", "plow depth settable")
    eq(t["g5.implements.implement(2).tillage#type"], "subsoiler", "subsoiler type")
    eq(t["g5.implements.implement(2).tillage#depth"], nil, "NaN depth skipped")
    eq(t["g5.implements.implement(3).tillage#type"], "cultivator", "WorkMode cultivator stays a cultivator")
    eq(t["g5.implements.implement(3).tillage#levels"], "shallow,normal", "WorkMode levels")
    eq(t["g5.implements.implement(3).tillage#level"], "normal", "WorkMode level now")
    eq(t["g5.implements.implement(4).tillage#modeSource"], "cultivatorSettings", "Cultivator Settings detected")
    eq(t["g5.implements.implement(4).tillage#levels"], "shallow,normal,deep", "Cultivator Settings levels")
    eq(t["g5.implements.implement(5).tillage#locked"], "true", "shop-configured level is locked")
    eq(t["g5.implements.implement(5).tillage#level"], "shallow", "locked level")
    writeFile(dir .. "commands.xml", table.concat({
        '<?xml version="1.0" encoding="utf-8" standalone="no"?>', "<commands>",
        '    <cmd id="1" name="tillageDepth" value="22" index="0"/>',
        '    <cmd id="2" name="tillageDepthAdjust" value="-2" index="0"/>',
        '    <cmd id="3" name="tillageDepth" value="6" index="0"/>',
        '    <cmd id="4" name="tillageLevel" value="4" index="0"/>',
        "</commands>", ""}, "\n"))
    tick(4)
    keepLive(dir)
    eq(plow.spec_realisticTillage.depthCm, 6, "depth set to 22, -2, then 6")
    local wmCalls = {}
    for _, c in ipairs(calls) do if c.name == "setWorkMode" then wmCalls[#wmCalls + 1] = c.args[1] end end
    eq(wmCalls[1], 1, "22 cm puts the WorkMode cultivator in its deep state")
    eq(wmCalls[2], 2, "6 cm puts it in its shallow state")
    eq(wmCalls[3], 1, "deep level on a two-level tool uses its deepest state")
    eq(csCult.spec_CultivatorSettings.mode, 4, "Cultivator Settings mode set to deep")
    check(called("raiseDirtyFlags") ~= nil, "Cultivator Settings dirty flag raised")
    eq(csLocked.spec_CultivatorSettings.mode, 2, "locked Cultivator Settings tool not changed")
    eq(telemetry(dir)["g5.implements.implement(1).tillage#depth"], "6.000000", "new depth reported")
    mod:deleteMap()
end

---------------------------------------------------------------------------
-- Scenario 7: headland automation (boundary band, coverage, steering assist fallback)
---------------------------------------------------------------------------
do
    local dir = newScenario("headland", {})
    local tractor, ts = makeVehicle({name = "Test Tractor", speed = 10})
    local planter, ps = makeImplement(12.19, 4)
    tractor.children = {tractor, planter}
    tractor.movingDirection = 1
    planter.getAttacherVehicle = function(self) return tractor end
    tractor.getAttacherJointIndexFromObject = function(self, obj) return 1 end
    tractor.handleLowerImplementByAttacherJointIndex = function(self, idx, down)
        record("lowerImpl", idx, down) ps.lowered = down end
    ts.ccSpeed = 11.5
    g_localPlayer = {getCurrentVehicle = function(self) return tractor end}
    -- every node of the machine, to drive it around
    local machine = {tractor.rootNode}
    for _, wa in ipairs(planter.spec_workArea.workAreas) do
        machine[#machine + 1] = wa.start machine[#machine + 1] = wa.width machine[#machine + 1] = wa.height
    end
    local function shift(dx, heading)
        for _, id in ipairs(machine) do
            nodes[id].x = nodes[id].x + dx
            if heading then nodes[id].dx = heading end
        end
    end
    local function turnAround()   -- mirror the machine about the tractor, now facing -x
        local cx = nodes[tractor.rootNode].x
        for _, id in ipairs(machine) do nodes[id].x = 2 * cx - nodes[id].x nodes[id].dx = -1 end
    end
    mod:loadMap("test")
    tick(1)
    G5LinkRtk.data.gates = false      -- gates are tested in the RTK scenario
    os.execute('mkdir -p "' .. dir .. '"')
    local function writeHeadland(v, extra, pts)
        writeFile(dir .. "headland.xml", '<?xml version="1.0"?>\n<headland v="' .. v .. '" armed="true" field="23" width="20" raiseLead="0.6" lowerLead="1.0" '
            .. extra .. '>\n' .. (pts or '') .. '</headland>\n')
    end
    local square = '<pt x="0" z="100"/><pt x="200" z="100"/><pt x="200" z="300"/><pt x="0" z="300"/>'
    writeHeadland(1, 'lowerMode="auto" headSpeed="8" workSpeed="0" useBoundary="true" useCoverage="true"', square)
    tick(10)
    local t = telemetry(dir)
    eq(t["g5.headland#armed"], "true", "headland armed from headland.xml")
    eq(t["g5.headland#state"], "work", "working with the planter down")
    eq(t["g5.headland#source"], "boundary", "boundary band is the source")
    near(tonumber(t["g5.headland#dist"]), 88, 1, "distance to the headland band (front edge 92.5, band at 180)")
    -- drive east until the planter lifts
    local liftedAt
    for _ = 1, 60 do
        shift(2)
        tick(1)
        if not ps.lowered then liftedAt = nodes[planter.spec_workArea.workAreas[1].start].x break end
    end
    check(liftedAt ~= nil and liftedAt >= 176 and liftedAt < 180, "lifted just before the 20 m band: " .. tostring(liftedAt))
    near(ts.ccSpeed, 8, 0.001, "headland speed set")
    eq(telemetry(dir)["g5.headland#state"], "headland", "in the headland")
    -- drive into the band, turn, come back
    shift(8) tick(2)
    turnAround() tick(2)
    check(not ps.lowered, "still raised after the turn, inside the band")
    local loweredAt
    for _ = 1, 30 do
        shift(-1.5)
        tick(1)
        if ps.lowered then loweredAt = nodes[tractor.rootNode].x break end
    end
    check(loweredAt ~= nil, "lowered on the way back out of the band")
    near(ts.ccSpeed, 11.5, 0.001, "work speed restored")
    -- the operator raises by hand: automation stands aside
    tick(14)  -- past the own-change window
    ps.lowered = false
    shift(-1.5) tick(2)
    eq(telemetry(dir)["g5.headland#state"], "manual", "manual raise detected")
    ps.lowered = true
    shift(-1.5) tick(2)
    eq(telemetry(dir)["g5.headland#state"], "work", "back to work after a manual lower")

    -- coverage source: covered strip ahead (x 40..60 at z 190..210), boundary off
    local rows = {}
    for z = 190, 210 do rows[#rows + 1] = string.format('<r z="%d" x="40,60"/>', z) end
    writeFile(dir .. "headcov.xml", '<?xml version="1.0"?>\n<headcov v="3" cell="1">\n' .. table.concat(rows, "\n") .. '\n</headcov>\n')
    writeHeadland(2, 'lowerMode="auto" headSpeed="0" workSpeed="0" useBoundary="false" useCoverage="true"', square)
    tick(10)
    t = telemetry(dir)
    eq(t["g5.headland#source"], "coverage", "coverage is the source")
    eq(t["g5.headland#covRuns"], "21", "coverage runs loaded")
    local covLift
    for _ = 1, 200 do
        shift(-1)
        tick(1)
        if not ps.lowered then covLift = nodes[planter.spec_workArea.workAreas[1].start].x break end
    end
    -- facing -x the front edge is the mirrored bar; it lifts as it reaches x = 60
    check(covLift ~= nil, "lifted at previously covered ground")
    local covLower
    for _ = 1, 60 do
        shift(-1)
        tick(1)
        if ps.lowered then covLower = true break end
    end
    check(covLower, "lowered again past the covered strip")

    -- steering assist fallback: no boundary, no coverage; lower when steering is engaged
    os.remove(dir .. "headcov.xml")
    writeHeadland(3, 'lowerMode="steer" headSpeed="0" workSpeed="0" useBoundary="false" useCoverage="false"', '')
    local steerState = AIAutomaticSteering.STATE.ACTIVE
    tractor.spec_aiAutomaticSteering = {lastDistanceToEnd = 30}
    tractor.getAIAutomaticSteeringState = function(self) return steerState end
    tractor.getAIAutomaticSteeringLookAheadDistance = function(self) return 4 end
    tick(10)
    t = telemetry(dir)
    eq(t["g5.headland#steer"], "base", "base game steering assist found")
    eq(t["g5.headland#source"], "base", "steering assist distance is the source")
    check(ps.lowered, "still working while the line end is far")
    tractor.spec_aiAutomaticSteering.lastDistanceToEnd = 0.5   -- 0.5 m past the look-ahead point: 5 m ahead of the tool, at 10 km/h
    G5LinkHeadland.settings.raiseLead = 2.0
    tick(2)
    check(not ps.lowered, "raised at the steering assist line end")
    steerState = AIAutomaticSteering.STATE.AVAILABLE
    tick(2)
    check(not ps.lowered, "stays raised while steering is off")
    steerState = AIAutomaticSteering.STATE.ACTIVE
    tractor.spec_aiAutomaticSteering.lastDistanceToEnd = 200
    tick(2)
    check(ps.lowered, "lowered when steering assist is engaged")
    keepLive(dir)
    mod:deleteMap()
end

---------------------------------------------------------------------------
-- Scenario 8: Courseplay Grain Cart (MMP Farms) remote from the combine
---------------------------------------------------------------------------
do
    local dir = newScenario("grain_cart", {})
    local combine = makeVehicle({name = "Test S7 Combine", combine = true, speed = 5})
    local function makeCart(name, x, level)
        local cart = makeVehicle({name = name, x = x, z = 200})
        local wagon = {getFillUnits = function() return {{}} end, getFillUnitCapacity = function() return 36000 end,
            getFillUnitFillLevel = function() return level end, getFillUnitFillType = function() return FillType.WHEAT end}
        cart.children = {cart, wagon}
        cart.getIsCpCombineUnloaderActive = function() return true end
        cart.getOwnerFarmId = function() return 1 end
        cart.getRootVehicle = function(self) return self end
        cart.strategy = {gcGetStatus = function() return {stateName = "DRIVING_TO_COMBINE", paused = false, nudge = 1, nudgeX = -0.5,
            autoCallsBlocked = false, outOfPosition = false} end}
        cart.getCpDriveStrategy = function(self) return self.strategy end
        return cart
    end
    local near, far = makeCart("Near Cart", 160, 12000), makeCart("Far Cart", 400, 0)
    combine.getOwnerFarmId = function() return 1 end
    combine.getRootVehicle = function(self) return self end
    g_localPlayer = {getCurrentVehicle = function(self) return combine end}
    g_server = {}
    local sent = {}
    local hud = {selectedCart = nil}
    FS25_Courseplay = {
        GrainCartCommandEvent = {sendEvent = function(cart, target, c) sent[#sent + 1] = {cart = cart, target = target, c = c} end},
        AIDriveStrategyUnloadCombine = {GC_COMMANDS = {CALL = 1, NUDGE_FORWARD = 2, NUDGE_BACK = 3, PAUSE = 4, RELEASE = 5,
            UNLOAD = 6, NUDGE_LEFT = 7, NUDGE_RIGHT = 8, MOVE_AWAY = 9}},
        GrainCartAddon = {hud = hud, clientStatus = {}},
        CpGrainCartHud = {stateTexts = {DRIVING_TO_COMBINE = "CP_grainCart_status_driving"}},
    }
    g_modManager.CP_MOD_NAME = "FS25_Courseplay"
    mod:loadMap("test")
    g_currentMission.vehicleSystem = {vehicles = {combine, near, far}}
    tick(1)
    G5LinkRtk.data.gates = false
    tick(4)
    local t = telemetry(dir)
    eq(t["g5.grainCart#carts"], "2", "two carts in range")
    eq(t["g5.grainCart#name"], "Near Cart", "closest cart picked")
    eq(t["g5.grainCart#kind"], "driving", "status kind from the add-on's state texts")
    eq(t["g5.grainCart#fill"], "12000.000000", "cart fill level")
    eq(t["g5.grainCart#dist"], "60.000000", "distance to the cart")
    writeFile(dir .. "commands.xml", table.concat({
        '<?xml version="1.0" encoding="utf-8" standalone="no"?>', "<commands>",
        '    <cmd id="1" name="grainCart" value="0" index="1"/>',
        '    <cmd id="2" name="grainCart" value="0" index="7"/>',
        '    <cmd id="3" name="grainCart" value="0" index="42"/>',
        '    <cmd id="4" name="grainCartNext" value="0" index="0"/>',
        '    <cmd id="5" name="grainCart" value="0" index="4"/>',
        "</commands>", ""}, "\n"))
    tick(4)
    keepLive(dir)
    eq(#sent, 3, "three valid commands sent (unknown index ignored)")
    check(sent[1] and sent[1].cart == near and sent[1].target == combine and sent[1].c == 1, "call: near cart to this combine")
    eq(sent[2] and sent[2].c, 7, "nudge left")
    check(sent[3] and sent[3].cart == far and sent[3].c == 4, "after Next, pause goes to the far cart")
    check(hud.selectedCart == far, "the add-on's panel follows the selected cart")
    eq(telemetry(dir)["g5.grainCart#name"], "Far Cart", "selected cart reported")
    -- without the add-on nothing is written
    FS25_Courseplay = nil
    tick(4)
    eq(telemetry(dir)["g5.grainCart#carts"], nil, "no grain cart block without the add-on")
    g_server = nil
    mod:deleteMap()
end

---------------------------------------------------------------------------
-- Scenario 9: RTK package (receivers, subscriptions, base station, RTK-X, gates, billing, API)
---------------------------------------------------------------------------
do
    local dir = newScenario("rtk", {})
    local money = {}
    local periodHandler
    MoneyType = {OTHER = 1, register = function(stat, l10n, modName) record("moneyType", stat, l10n) return 77 end}
    FinanceStats = {statNames = {}, statNameToIndex = {}, statNamesI18n = {}}
    g_i18n = {getText = function(self, k) return "GPS corrections" end}
    MessageType = {PERIOD_CHANGED = 5}
    g_messageCenter = {subscribe = function(self, mt, fn, target) if mt == 5 then periodHandler = {fn, target} end end,
        unsubscribeAll = function(self, target) periodHandler = nil end}
    g_server = {}
    local tractor, ts = makeVehicle({name = "Test 8R Tractor", x = 500, z = 500})
    tractor.uniqueId = "veh1"
    tractor.spec_motorized = {}
    tractor.getOwnerFarmId = function() return 1 end
    g_localPlayer = {getCurrentVehicle = function(self) return tractor end}
    mod:loadMap("test")
    g_currentMission.missionInfo = {savegameDirectory = "/profile/savegame3"}
    g_currentMission.environment.currentPeriod = 4
    g_currentMission.vehicleSystem = {vehicles = {tractor}}
    storeItem = {name = "RTK Station Standalone", xmlFilename = "mods/fs25_jd_rtkstations/rtkstandalone.xml", species = 2, price = 9900, dailyUpkeep = 15}
    otherItem = {name = "Big Barn", xmlFilename = "data/placeables/barn.xml", species = 2, price = 1234, dailyUpkeep = 5}
    StoreSpecies = {PLACEABLE = 2, VEHICLE = 1}
    g_storeManager = {getItems = function(self) return {storeItem, otherItem} end}
    -- an RTK station already on the map at load counts as surveyed, but this one is far away
    preplaced = {rootNode = addNode(5000, 5000), configFileName = "mods/FS25_JD_RTKStations/rtkRoof.xml",
        getName = function() return "RTK Roof Antenna" end, getUniqueId = function() return "placeable3" end,
        getOwnerFarmId = function() return 1 end}
    g_currentMission.placeableSystem = {placeables = {preplaced}}
    g_currentMission.addMoney = function(self, amount, farmId, mt, addChange, show) money[#money + 1] = {amount = amount, farm = farmId, mt = mt} end
    local api = g_currentMission.g5linkAPI
    check(api ~= nil and api.getVersion() == "1.0.0", "API published with version")
    tick(4)
    check(api.isReady(), "API ready after the first update")
    local t = telemetry(dir)
    eq(t["g5.gnss#receiver"], "SF6000", "default receiver StarFire 6000")
    eq(t["g5.gnss#level"], "SF1", "free SF1")
    eq(t["g5.gnss.gate#headland"], "false", "headland automation needs SF2")
    eq(t["g5.gnss.gate#grainCart"], "false", "grain cart needs SF3")

    local function cmds(list)
        local lines = {'<?xml version="1.0" encoding="utf-8" standalone="no"?>', "<commands>"}
        for i, c in ipairs(list) do lines[#lines + 1] = string.format('    <cmd id="%d" name="rtk" value="0" index="0" arg="%s"/>', c[1], c[2]) end
        lines[#lines + 1] = "</commands>"
        writeFile(dir .. "commands.xml", table.concat(lines, "\n") .. "\n")
        tick(2)
    end
    cmds({{1, "action=sub;vehicle=current;item=SF3;on=1"}})
    t = telemetry(dir)
    eq(t["g5.gnss#src"], "SF3", "SF3 subscribed")
    check(tonumber(t["g5.gnss#accuracy"]) < 100, "SF3 still pulling in")
    eq(t["g5.gnss.gate#headland"], "false", "gates wait for full accuracy")
    tick(1000)                                   -- 250 s
    t = telemetry(dir)
    eq(t["g5.gnss#accuracy"], "100.000000", "SF3 converged")
    eq(t["g5.gnss.gate#headland"], "true", "headland allowed on SF3")
    eq(t["g5.gnss.gate#grainCart"], "true", "grain cart allowed on SF3")
    local subs = api.getSubscriptions(1)
    eq(#subs, 1, "API lists one subscription")
    eq(subs[1] and subs[1].subscriptions[1], "SF3", "API subscription kind")
    eq(api.getMonthlyCost(1), 120, "monthly cost")
    eq(api.isFeatureAllowed("veh1", "headland"), true, "API feature gate")
    cmds({{2, "action=sub;vehicle=current;item=SFRTK;on=1"}})
    eq(telemetry(dir)["g5.gnss.result#error"], "needsSF7000", "SF-RTK needs a StarFire 7000")

    -- Farm Finance-style payer takes the monthly bill
    local paid, billed = {}, nil
    check(api.setPayer("FS25_FarmFinance", function(farmId, amount, info) paid[#paid + 1] = {farmId, amount, info.kind} return true end), "payer set")
    api.subscribe("monthBilled", function(target, farmId, total, lines) billed = {farmId, total, #lines} end, {})
    check(periodHandler ~= nil, "subscribed to PERIOD_CHANGED")
    periodHandler[1](periodHandler[2])
    tick(1)
    eq(#paid, 1, "payer charged once")
    eq(paid[1] and paid[1][2], 120, "payer got the monthly amount")
    eq(#money, 0, "no cash taken while the payer pays")
    check(billed and billed[2] == 120 and billed[3] == 1, "monthBilled event")
    local charges = api.getCharges(1)
    eq(charges[1] and charges[1].paidBy, "FS25_FarmFinance", "ledger shows who paid")
    -- a machine that left the game (sold, lease returned) stops billing
    G5LinkRtk.data.vehicles.goneVeh = {receiver = "SF6000", rtk = false, subs = {SF2 = true}, name = "Sold Tractor", farmId = 1}
    local cancelled, watcher = {}, {}
    api.subscribe("subscriptionChanged", function(target, farmId, uid, sub, on) cancelled[#cancelled + 1] = {uid, sub, on} end, watcher)
    periodHandler[1](periodHandler[2])
    tick(1)
    eq(#paid, 2, "payer charged again next month, only for the machine still here")
    eq(paid[2] and paid[2][2], 120, "no charge for the machine that left")
    eq(next(G5LinkRtk.data.vehicles.goneVeh.subs), nil, "missing machine's subscriptions cancelled")
    check(cancelled[1] and cancelled[1][1] == "goneVeh" and cancelled[1][3] == false, "subscriptionChanged fired for the missing machine")
    api.unsubscribe("subscriptionChanged", watcher)
    check(api.clearPayer("FS25_FarmFinance"), "payer cleared")

    -- RTK activation (cash), then an RTK station built from the construction menu
    cmds({{3, "action=buy;vehicle=current;item=RTK"}})
    eq(#money, 1, "activation charged")
    check(money[1].amount == -2500 and money[1].mt == 77, "activation booked under the G5Link money type")
    eq(FinanceStats.statNames[1], "g5linkRtk", "finance page line registered")
    eq(storeItem.price, 15000, "RTK station shop price set from the G5Link price list")
    eq(storeItem.dailyUpkeep, 10, "RTK station daily upkeep set")
    eq(otherItem.price, 1234, "other shop items untouched")
    local station = {rootNode = addNode(520, 520), configFileName = "mods/FS25_JD_RTKStations/rtkStandalone.xml",
        getName = function() return "John Deere RTK Station" end, getUniqueId = function() return "placeable7" end,
        getOwnerFarmId = function() return 1 end}
    g_currentMission.placeableSystem.placeables = {preplaced, station}
    tick(24)                                   -- next placeable scan (5 s)
    t = telemetry(dir)
    eq(t["g5.gnss#base"], "John Deere RTK Station", "placed RTK station found")
    eq(t["g5.gnss#baseState"], "survey", "base self-surveying")
    eq(t["g5.gnss#src"], "SF3", "still SF3 during the survey")
    g_currentMission.environment.currentHour = 10   -- 3 h later
    tick(60)                                          -- 15 s: survey done, RTK fixed
    t = telemetry(dir)
    eq(t["g5.gnss#level"], "RTK", "RTK from own base")
    eq(t["g5.gnss#src"], "RTK", "radio RTK")
    eq(t["g5.gnss#inRange"], "true", "in radio range")
    cmds({{5, "action=price;item=BASE;value=0"}})
    eq(storeItem.price, 9900, "price 0 gives the mod's own price back")
    -- drive out of range: RTK-X holds
    nodes[tractor.rootNode].x = 4500
    tick(4)
    t = telemetry(dir)
    eq(t["g5.gnss#src"], "RTK-X", "RTK-X after losing the base")
    check(tonumber(t["g5.gnss#rtkxMin"]) > 0, "RTK-X time left")

    -- the error moves reported positions (real noise for a moment)
    nodes[tractor.rootNode].x = 500
    local apiG = api.getVehicleGnss("veh1")
    eq(apiG.level, "RTK", "API live level")
    G5LinkRtk.live.veh1.ex, G5LinkRtk.live.veh1.ez = 0.4, -0.3
    tick(1)
    t = telemetry(dir)
    near(tonumber(t["g5.vehicle#x"]), 500.4, 0.02, "reported x carries the GNSS error")
    near(tonumber(t["g5.vehicle#z"]), 499.7, 0.02, "reported z carries the GNSS error")
    math.random = realRandom
    G5LinkRtk.live.veh1.ex, G5LinkRtk.live.veh1.ez = 0, 0
    tick(40)
    check(G5LinkRtk.live.veh1.ex ~= 0, "error wanders with real noise")
    check(math.abs(G5LinkRtk.live.veh1.ex) < 0.2, "RTK error stays small")
    math.random = function() return 0.25 end

    -- rtk.json for the bridge, then persistence across a reload
    local rj = readFile(dir .. "rtk.json") or ""
    check(string.find(rj, '"receiver":"SF6000"', 1, true) ~= nil and string.find(rj, '"John Deere RTK Station"', 1, true) ~= nil, "rtk.json has machines and bases")
    check(string.find(rj, '"modPrice":9900', 1, true) ~= nil, "rtk.json lists the RTK station shop items")
    keepLive(dir)
    mod:deleteMap()
    eq(g_currentMission.g5linkAPI, nil, "API removed on deleteMap")
    mod:loadMap("test")
    g_currentMission.missionInfo = {savegameDirectory = "/profile/savegame3"}
    tick(2)
    local api2 = g_currentMission.g5linkAPI
    eq(#api2.getSubscriptions(1), 1, "subscription saved")
    tick(24)
    eq(#api2.getBaseStations(1), 2, "both RTK stations found after reload")
    local surveyed = 0
    for _, b in ipairs(api2.getBaseStations(1)) do if b.state == "ok" then surveyed = surveyed + 1 end end
    eq(surveyed, 2, "survey times saved")
    eq(api2.getVehicleGnss("veh1").rtkActivated, true, "RTK activation saved")
    check(#api2.getCharges(1) >= 2, "ledger saved")
    mod:deleteMap()
    g_server = nil
    MoneyType, FinanceStats, MessageType, g_messageCenter, g_storeManager, StoreSpecies = nil, nil, nil, nil, nil, nil
end

---------------------------------------------------------------------------
-- Scenario 10: equipment checks, GPS hardware from shop options, and their prices
---------------------------------------------------------------------------
do
    local dir = newScenario("gps_options", {})
    MessageType = {PERIOD_CHANGED = 5}
    g_messageCenter = {subscribe = function() end, unsubscribeAll = function() end}
    g_server = {}
    g_i18n = {getText = function(self, k) return ({configuration_valueNo = "No", configuration_valueYes = "Yes"})[k] or k end}
    local function opt(name, price) return {name = name, price = price, dailyUpkeep = 0} end
    -- a tractor mod with its own receiver choice (like the Xerion US version)
    local xerion = {name = "Xerion 5000", xmlFilename = "mods/fs25_xerion/xerion.xml", species = 1, price = 400000, configurations = {
        gpsReceiver = {opt("No GPS", 0), opt("StarFire 6000", 5000), opt("StarFire 7000 RTK", 12000)},
        wheel = {opt("Narrow", 0), opt("Wide", 8000)}}}
    -- Buyable GPS style yes/no option
    local tractor2 = {name = "Old Tractor", xmlFilename = "data/vehicles/old.xml", species = 1, price = 90000, configurations = {
        gps = {opt("No", 0), opt("Yes", 3000)}}}
    -- an older mod with a StarFire 3000 and a third-party brand
    local tractor3 = {name = "Mid Tractor", xmlFilename = "mods/fs25_mid/mid.xml", species = 1, price = 150000, configurations = {
        design4 = {opt("StarFire 3000", 2000), opt("Trimble GFX-750", 6500)}}}
    local items = {xerion, tractor2, tractor3}
    local byXml = {}
    for _, it in ipairs(items) do byXml[it.xmlFilename] = it end
    StoreSpecies = {PLACEABLE = 2, VEHICLE = 1}
    g_storeManager = {getItems = function() return items end, getItemByXMLFilename = function(self, f) return byXml[string.lower(f or "")] end}
    local function machine(name, uid, xml, configs)
        local v = makeVehicle({name = name})
        v.uniqueId, v.configFileName, v.configurations, v.spec_motorized = uid, xml, configs, {}
        v.getOwnerFarmId = function() return 1 end
        return v
    end
    local v1 = machine("Xerion 5000", "x1", "mods/FS25_Xerion/xerion.xml", {gpsReceiver = 3, wheel = 2})
    local v2 = machine("Old Tractor", "o1", "data/vehicles/old.xml", {gps = 1})
    local v3 = machine("Mid Tractor", "m1", "mods/fs25_mid/mid.xml", {design4 = 1})
    local current = v1
    g_localPlayer = {getCurrentVehicle = function(self) return current end}
    mod:loadMap("test")
    g_currentMission.missionInfo = {savegameDirectory = "/profile/savegame5"}
    g_currentMission.vehicleSystem = {vehicles = {v1, v2, v3}}
    g_currentMission.placeableSystem = {placeables = {}}
    g_currentMission.addMoney = function() end
    tick(4)
    -- prices
    local gr = xerion.configurations.gpsReceiver
    eq(gr[1].price, 0, "No GPS costs nothing")
    eq(gr[2].price, 7000, "StarFire 6000 option priced from the list")
    eq(gr[3].price, 11500, "StarFire 7000 RTK = receiver + RTK activation")
    eq(xerion.configurations.wheel[2].price, 8000, "other options untouched")
    eq(tractor2.configurations.gps[2].price, 7000, "a plain GPS yes is priced as a StarFire 6000")
    eq(tractor3.configurations.design4[1].price, 4000, "StarFire 3000 option priced")
    eq(tractor3.configurations.design4[2].price, 6500, "third-party brand keeps its price")
    -- equipment check: Xerion with StarFire 7000 RTK
    local t = telemetry(dir)
    eq(t["g5.gnss#receiver"], "SF7000", "receiver from the shop option")
    eq(t["g5.gnss#hwSource"], "shop", "hardware source shown")
    eq(t["g5.gnss#rtkActivated"], "true", "RTK option counts as the activation")
    local function cmd(id, arg)
        writeFile(dir .. "commands.xml", string.format('<?xml version="1.0"?>\n<commands>\n    <cmd id="%d" name="rtk" value="0" index="0" arg="%s"/>\n</commands>\n', id, arg))
        tick(2)
        return telemetry(dir)["g5.gnss.result#error"]
    end
    eq(cmd(1, "action=buy;vehicle=current;item=SF7000"), "changeInShop", "receiver upgrades go through the shop")
    eq(cmd(2, "action=sub;vehicle=current;item=SFRTK;on=1"), nil, "SF-RTK allowed on the StarFire 7000")
    -- no receiver
    current = v2
    tick(4)
    t = telemetry(dir)
    eq(t["g5.gnss#receiver"], "NONE", "GPS: No means no receiver")
    eq(t["g5.gnss#level"], "NONE", "3D-None without a receiver")
    eq(cmd(3, "action=sub;vehicle=current;item=SF2;on=1"), "needsReceiver", "no subscriptions without a receiver")
    -- StarFire 3000: SF2 at most
    current = v3
    tick(4)
    eq(telemetry(dir)["g5.gnss#receiver"], "SF3000", "StarFire 3000 found")
    eq(cmd(4, "action=sub;vehicle=current;item=SF3;on=1"), "needsSF6000", "SF3 needs a StarFire 6000")
    eq(cmd(5, "action=sub;vehicle=current;item=MRTK;on=1"), "needsSF6000", "Mobile RTK needs a StarFire 6000")
    eq(cmd(6, "action=sub;vehicle=current;item=SF2;on=1"), nil, "SF2 works on a StarFire 3000")
    tick(600)
    eq(telemetry(dir)["g5.gnss#level"], "SF2", "StarFire 3000 runs SF2")
    -- shop prices back to the mods' own
    cmd(7, "action=price;item=SHOP_GPS;value=0")
    eq(gr[2].price, 5000, "original StarFire 6000 price back")
    eq(tractor2.configurations.gps[2].price, 3000, "original GPS yes price back")
    local rj = readFile(dir .. "rtk.json") or ""
    check(string.find(rj, '"hwSource":"shop"', 1, true) ~= nil, "rtk.json shows shop hardware")
    keepLive(dir)
    mod:deleteMap()
    g_server, MessageType, g_messageCenter, g_storeManager, StoreSpecies = nil, nil, nil, nil, nil
end

---------------------------------------------------------------------------
-- JSON encoder samples for check_output.js
---------------------------------------------------------------------------
do
    PROFILE = OUT .. "/"
    local samples = {
        {a = 1, b = "two", c = true, d = {1, 2, 3}},
        {},
        {nested = {deep = {deeper = {1.5, -2.25, 1e-7}}}},
        {s = 'quote " back \\ newline \n tab \t ctrl ' .. string.char(1) .. " é"},
        {nan = 0 / 0, inf = math.huge, big = 123456789012},
        {[1] = "x", [3] = "gap"},
    }
    local lines = {}
    for _, s in ipairs(samples) do lines[#lines + 1] = G5Json.encode(s) end
    writeFile(OUT .. "/json_samples.txt", table.concat(lines, "\n") .. "\n")
end

print(string.format("lua checks: %d, failures: %d", checks, failures))
os.exit(failures == 0 and 0 or 1)
