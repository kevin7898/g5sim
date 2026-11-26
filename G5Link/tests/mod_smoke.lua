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
