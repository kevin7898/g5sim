-- G5Link headland automation: raise the implements and change speed at the headland, then lower
-- them again and restore the work speed, either automatically or when steering is engaged.
--
-- The headland is where the implement's front edge is
--   * inside the field boundary but closer to an edge than the headland width (boundary band), or
--   * over ground already worked in this operation (coverage, like the G5 with headland passes done first).
-- Both come from the bridge: headland.xml (settings + boundary) and headcov.xml (covered cells near
-- the machine, 1 m grid, runs per row). Without either it falls back to the steering helpers:
--   * base game steering assist (AIAutomaticSteering): spec.lastDistanceToEnd, state ACTIVE/AVAILABLE
--   * Enhanced Vehicle (ZhooL): vData.is[5] snap on, vData.is[6] snap to track,
--     vData.track.eofDistance (to its headland line), vData.track.isOnField (> 5 = back in the field)
-- Lowering and raising use AttacherJoints:handleLowerImplementByAttacherJointIndex(index, direction).

G5LinkHeadland = {}

G5LinkHeadland.TICK = 100                -- ms between checks
G5LinkHeadland.SETTINGS_INTERVAL = 2000  -- ms between headland.xml reads
G5LinkHeadland.COVERAGE_INTERVAL = 1000  -- ms between headcov.xml reads
G5LinkHeadland.OWN_CHANGE_MS = 3000      -- lowered-state changes this soon after our command are ours
G5LinkHeadland.SCAN_MAX = 100            -- m, distance-to-headland scan for the display

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

local function finite(v) return type(v) == "number" and v == v and v ~= math.huge and v ~= -math.huge end
local function round(v, d) local m = 10 ^ (d or 0) return math.floor(v * m + 0.5) / m end

function G5LinkHeadland:reset()
    self.settings = { armed = false, v = -1 }
    self.poly = nil
    self.cov = nil
    self.covV = -1
    self.state = "off"
    self.source = "none"
    self.timer = 0
    self.settingsTimer = G5LinkHeadland.SETTINGS_INTERVAL
    self.coverageTimer = G5LinkHeadland.COVERAGE_INTERVAL
    self.lastCmdAt = -math.huge
    self.lastLowered = nil
    self.savedSpeed = nil
    self.entered = false
    self.steerWas = false
    self.evWas = false
    self.evFieldWas = false
    self.dist = nil
    self.vehicle = nil
    self.events = 0
end
G5LinkHeadland:reset()

---------------------------------------------------------------------------
-- Files from the bridge
---------------------------------------------------------------------------

function G5LinkHeadland:loadSettings(path)
    if path == nil or not fileExists(path) then
        if self.settings.v ~= -1 then
            self.settings = { armed = false, v = -1 }
            self.poly = nil
        end
        return
    end
    local xml = XMLFile.load("G5LinkHeadland", path)
    if xml == nil then
        return
    end
    local v = xml:getInt("headland#v", 0)
    if v ~= self.settings.v then
        local s = { v = v }
        s.armed = xml:getString("headland#armed", "false") == "true"
        s.field = xml:getString("headland#field", "")
        s.width = xml:getFloat("headland#width", 0)
        s.raiseLead = xml:getFloat("headland#raiseLead", 0.6)
        s.lowerLead = xml:getFloat("headland#lowerLead", 1.0)
        s.lowerMode = xml:getString("headland#lowerMode", "auto")       -- auto | steer | both
        s.headSpeed = xml:getFloat("headland#headSpeed", 0)             -- km/h, 0 = keep
        s.workSpeed = xml:getFloat("headland#workSpeed", 0)             -- km/h, 0 = restore
        s.useBoundary = xml:getString("headland#useBoundary", "true") == "true"
        s.useCoverage = xml:getString("headland#useCoverage", "true") == "true"
        local pts = {}
        xml:iterate("headland.pt", function(_, key)
            local x, z = xml:getFloat(key .. "#x", nil), xml:getFloat(key .. "#z", nil)
            if finite(x) and finite(z) then
                table.insert(pts, { x, z })
            end
        end)
        self.settings = s
        self.poly = #pts >= 3 and pts or nil
        -- a new setup re-arms cleanly
        self.state = "off"
    end
    xml:delete()
end

-- headcov.xml: <headcov v="" cell="1"><r z="12" x="x0,x1,x0,x1"/>...</headcov>, x/z in cells.
function G5LinkHeadland:loadCoverage(path)
    if path == nil or not fileExists(path) then
        self.cov = nil
        return
    end
    local xml = XMLFile.load("G5LinkHeadcov", path)
    if xml == nil then
        return
    end
    local v = xml:getInt("headcov#v", 0)
    if v ~= self.covV then
        self.covV = v
        local cov = { cell = xml:getFloat("headcov#cell", 1), rows = {}, n = 0 }
        if not (cov.cell > 0) then cov.cell = 1 end
        xml:iterate("headcov.r", function(_, key)
            local z = xml:getInt(key .. "#z", nil)
            local list = xml:getString(key .. "#x", "")
            if z ~= nil then
                local runs, nums = {}, {}
                for n in string.gmatch(list, "-?%d+") do table.insert(nums, tonumber(n)) end
                for i = 1, #nums - 1, 2 do table.insert(runs, { nums[i], nums[i + 1] }) end
                cov.rows[z] = runs
                cov.n = cov.n + #runs
            end
        end)
        self.cov = cov.n > 0 and cov or nil
    end
    xml:delete()
end

---------------------------------------------------------------------------
-- Geometry
---------------------------------------------------------------------------

local function insidePoly(poly, x, z)
    local inside = false
    local j = #poly
    for i = 1, #poly do
        local xi, zi, xj, zj = poly[i][1], poly[i][2], poly[j][1], poly[j][2]
        if (zi > z) ~= (zj > z) and x < (xj - xi) * (z - zi) / (zj - zi) + xi then
            inside = not inside
        end
        j = i
    end
    return inside
end

local function edgeDistance(poly, x, z)
    local best = math.huge
    local j = #poly
    for i = 1, #poly do
        local ax, az, bx, bz = poly[j][1], poly[j][2], poly[i][1], poly[i][2]
        local dx, dz = bx - ax, bz - az
        local len2 = dx * dx + dz * dz
        local t = len2 > 0 and ((x - ax) * dx + (z - az) * dz) / len2 or 0
        if t < 0 then t = 0 elseif t > 1 then t = 1 end
        local px, pz = ax + t * dx - x, az + t * dz - z
        local d = px * px + pz * pz
        if d < best then best = d end
        j = i
    end
    return math.sqrt(best)
end

function G5LinkHeadland:isCovered(x, z)
    local cov = self.cov
    if cov == nil then
        return false
    end
    local cx, cz = math.floor(x / cov.cell), math.floor(z / cov.cell)
    local runs = cov.rows[cz]
    if runs == nil then
        return false
    end
    for _, r in ipairs(runs) do
        if cx >= r[1] and cx < r[2] then
            return true
        end
    end
    return false
end

-- "work", "headland" or "outside" (outside the boundary) at a point; nil when nothing is known.
function G5LinkHeadland:zoneAt(x, z)
    local s = self.settings
    local known = false
    if self.poly ~= nil and s.useBoundary then
        known = true
        if not insidePoly(self.poly, x, z) then
            return "outside"
        end
        if s.width > 0 and edgeDistance(self.poly, x, z) < s.width then
            return "headland"
        end
    end
    if self.cov ~= nil and s.useCoverage then
        known = true
        if self:isCovered(x, z) then
            return "headland"
        end
    end
    return known and "work" or nil
end

-- Lowerable implements with their attacher, and the front edge of the first one with work areas.
function G5LinkHeadland:tools(vehicle, host)
    local list = {}
    for _, impl in ipairs(host:getImplements(vehicle)) do
        if call(impl, "getAllowsLowering") == true then
            local attacher = call(impl, "getAttacherVehicle")
            local index = attacher and call(attacher, "getAttacherJointIndexFromObject", impl)
            if attacher ~= nil and index ~= nil then
                table.insert(list, { impl = impl, attacher = attacher, index = index })
            end
        end
    end
    return list
end

-- Front edge of the implement's main work areas: center, lateral unit vector and width.
function G5LinkHeadland:frontEdge(impl, dirX, dirZ)
    local spec = impl.spec_workArea
    if spec == nil or type(spec.workAreas) ~= "table" then
        return nil
    end
    local latX, latZ = dirZ, -dirX
    local minL, maxL, maxF, cx, cz = math.huge, -math.huge, -math.huge, nil, nil
    local pts = {}
    for _, wa in ipairs(spec.workAreas) do
        local main = WorkAreaType == nil or wa.type ~= WorkAreaType.AUXILIARY
        if main and g_workAreaTypeManager ~= nil and g_workAreaTypeManager.getWorkAreaTypeIsAIArea ~= nil then
            local ok, isAi = pcall(g_workAreaTypeManager.getWorkAreaTypeIsAIArea, g_workAreaTypeManager, wa.type)
            main = not ok or isAi ~= false
        end
        if main then
            for _, node in ipairs({ wa.start, wa.width }) do
                local ok, x, _, z = pcall(getWorldTranslation, node)
                if ok and finite(x) and finite(z) then
                    table.insert(pts, { x, z })
                end
            end
        end
    end
    if #pts == 0 then
        return nil
    end
    local ox, oz = pts[1][1], pts[1][2]
    for _, p in ipairs(pts) do
        local l = (p[1] - ox) * latX + (p[2] - oz) * latZ
        local f = (p[1] - ox) * dirX + (p[2] - oz) * dirZ
        if l < minL then minL = l end
        if l > maxL then maxL = l end
        if f > maxF then maxF = f end
    end
    local midL = (minL + maxL) / 2
    cx = ox + latX * midL + dirX * maxF
    cz = oz + latZ * midL + dirZ * maxF
    return { x = cx, z = cz, latX = latX, latZ = latZ, width = maxL - minL }
end

-- How many of three points across the front edge, d metres ahead, are in a zone (headland/outside or work).
function G5LinkHeadland:countAhead(edge, dirX, dirZ, d, wantWork)
    local n, known = 0, false
    for _, f in ipairs({ -0.3, 0, 0.3 }) do
        local x = edge.x + dirX * d + edge.latX * edge.width * f
        local z = edge.z + dirZ * d + edge.latZ * edge.width * f
        local zone = self:zoneAt(x, z)
        if zone ~= nil then
            known = true
            if (zone == "work") == wantWork then
                n = n + 1
            end
        end
    end
    return n, known
end

---------------------------------------------------------------------------
-- Steering helpers (fallback distances and engage triggers)
---------------------------------------------------------------------------

function G5LinkHeadland:steering(vehicle)
    local r = { kind = "", active = false }
    local ev = vehicle.vData
    if type(ev) == "table" and type(ev.is) == "table" and type(ev.track) == "table" then
        r.kind = "ev"
        r.active = ev.is[5] == true and ev.is[6] == true
        if r.active and finite(ev.track.eofDistance) and ev.track.eofDistance > 0 then
            r.distToLine = ev.track.eofDistance                -- from the vehicle to EV's headland line
        end
        r.onField = type(ev.track.isOnField) == "number" and ev.track.isOnField > 5
    end
    local spec = vehicle.spec_aiAutomaticSteering
    if type(spec) == "table" and AIAutomaticSteering ~= nil and AIAutomaticSteering.STATE ~= nil then
        local state = call(vehicle, "getAIAutomaticSteeringState")
        if state == AIAutomaticSteering.STATE.ACTIVE or (r.kind == "" and state ~= nil) then
            r.kind = "base"
            r.active = state == AIAutomaticSteering.STATE.ACTIVE
            r.onField = nil
            r.distToLine = nil
            if r.active and finite(spec.lastDistanceToEnd) and spec.lastDistanceToEnd > 0 then
                -- measured from the steering look-ahead point (AIAutomaticSteering:onUpdate)
                local la = call(vehicle, "getAIAutomaticSteeringLookAheadDistance") or 4
                local kmh = call(vehicle, "getLastSpeed") or 0
                la = math.max(la, 4) + math.min(kmh / 30, 1) ^ 2 * 5
                r.distToLine = spec.lastDistanceToEnd + la   -- from the AI root node
            end
        end
    end
    return r
end

---------------------------------------------------------------------------
-- Actions
---------------------------------------------------------------------------

function G5LinkHeadland:setLowered(tools, down)
    for _, t in ipairs(tools) do
        if (call(t.impl, "getIsLowered", false) == true) ~= down then
            call(t.attacher, "handleLowerImplementByAttacherJointIndex", t.index, down)
        end
    end
    self.lastCmdAt = g_currentMission.time or 0
    self.lastLowered = down
    self.events = self.events + 1
end

function G5LinkHeadland:raise(vehicle, tools, heading)
    self:setLowered(tools, false)
    self.savedSpeed = call(vehicle, "getCruiseControlSpeed")
    local s = self.settings
    if finite(s.headSpeed) and s.headSpeed > 0 then
        call(vehicle, "setCruiseControlMaxSpeed", s.headSpeed, nil)
    end
    self.state = "headland"
    self.entered = false
    self.raiseHeading = heading
end

function G5LinkHeadland:lower(vehicle, tools)
    self:setLowered(tools, true)
    local s = self.settings
    local speed = (finite(s.workSpeed) and s.workSpeed > 0) and s.workSpeed or self.savedSpeed
    if finite(speed) and speed > 0 then
        call(vehicle, "setCruiseControlMaxSpeed", speed, nil)
    end
    self.state = "work"
end

---------------------------------------------------------------------------
-- Update
---------------------------------------------------------------------------

function G5LinkHeadland:update(vehicle, dt, host)
    self.settingsTimer = self.settingsTimer + dt
    if self.settingsTimer >= G5LinkHeadland.SETTINGS_INTERVAL then
        self.settingsTimer = 0
        self:loadSettings(host.dir and host.dir .. "headland.xml")
    end
    self.coverageTimer = self.coverageTimer + dt
    if self.coverageTimer >= G5LinkHeadland.COVERAGE_INTERVAL then
        self.coverageTimer = 0
        self:loadCoverage(host.dir and host.dir .. "headcov.xml")
    end
    self.timer = self.timer + dt
    if self.timer < G5LinkHeadland.TICK then
        return
    end
    self.timer = 0

    local s = self.settings
    if not s.armed or vehicle == nil or vehicle.rootNode == nil then
        self.state = "off"
        self.vehicle = nil
        return
    end
    if call(vehicle, "getIsAIActive") == true then
        self.state = "ai"
        return
    end
    local tools = self:tools(vehicle, host)
    if #tools == 0 then
        self.state = "noImplement"
        return
    end
    -- RTK package gate: headland automation needs SF2 or better (when gates are on)
    if G5LinkRtk ~= nil and G5LinkRtk.data ~= nil then
        local ok, allowed = pcall(G5LinkRtk.allows, G5LinkRtk, vehicle, "headland")
        if ok and allowed == false then
            self.state = "noSignal"
            return
        end
    end
    local dirX, _, dirZ = localDirectionToWorld(vehicle.rootNode, 0, 0, 1)
    local len = math.sqrt(dirX * dirX + dirZ * dirZ)
    if not (len > 0) then
        return
    end
    dirX, dirZ = dirX / len, dirZ / len
    local heading = math.deg(math.atan2(dirX, dirZ))
    local edge = self:frontEdge(tools[1].impl, dirX, dirZ)
    local vx, _, vz = getWorldTranslation(vehicle.rootNode)
    -- the G5 only knows the GNSS position: lift points move with the receiver's error
    local ox, oz = 0, 0
    if G5LinkRtk ~= nil then
        local ok, a, b = pcall(G5LinkRtk.offset, G5LinkRtk, vehicle)
        if ok and type(a) == "number" and type(b) == "number" then ox, oz = a, b end
    end
    vx, vz = vx + ox, vz + oz
    if edge ~= nil then edge.x, edge.z = edge.x + ox, edge.z + oz end
    if edge == nil then
        edge = { x = vx, z = vz, latX = dirZ, latZ = -dirX, width = 0 }
    end
    local kmh = call(vehicle, "getLastSpeed") or 0
    local ms = kmh / 3.6
    local forward = (vehicle.movingDirection or 1) >= 0
    local lowered = false
    for _, t in ipairs(tools) do
        if call(t.impl, "getIsLowered", false) == true then lowered = true end
    end
    local steer = self:steering(vehicle)
    self.steer = steer

    -- (re)start: new vehicle or just armed
    if self.vehicle ~= vehicle or self.state == "off" or self.state == "ai" or self.state == "noImplement" or self.state == "noSignal" then
        self.vehicle = vehicle
        self.state = lowered and "work" or "headland"
        self.entered = false
        self.savedSpeed = nil
        self.lastLowered = lowered
        self.steerWas, self.evFieldWas = steer.active, steer.onField == true
    end
    -- the operator raised or lowered by hand: stand aside until the implements are lowered again
    if lowered ~= self.lastLowered and (g_currentMission.time or 0) - self.lastCmdAt > G5LinkHeadland.OWN_CHANGE_MS then
        self.state = lowered and "work" or "manual"
    end
    self.lastLowered = lowered

    local here = self:zoneAt(edge.x, edge.z)
    self.source = here ~= nil and ((self.poly and s.useBoundary) and (self.cov and s.useCoverage and "boundary+coverage" or "boundary") or "coverage")
        or (steer.distToLine ~= nil and steer.kind) or "none"
    self.scanCount = ((self.scanCount or 0) + 1) % 5
    if self.scanCount == 0 or self.dist == nil then
        self.dist = self:scan(edge, dirX, dirZ, steer, vx, vz)   -- for the display, 2 Hz
    end

    local engaged = steer.active and not self.steerWas
    local evBack = steer.onField == true and not self.evFieldWas
    self.steerWas, self.evFieldWas = steer.active, steer.onField == true

    if self.state == "work" then
        if not forward or kmh < 0.5 then
            return
        end
        local d = math.max(1, ms * s.raiseLead)
        local n, known = self:countAhead(edge, dirX, dirZ, d, false)
        if known then
            -- only on the way in: the front edge itself must still be on work ground (no flip-flop at the edge)
            if n >= 2 and here == "work" then self:raise(vehicle, tools, heading) end
        elseif steer.distToLine ~= nil then
            if self:toolDistance(steer, edge, dirX, dirZ, vx, vz) <= d then self:raise(vehicle, tools, heading) end
        end
    elseif self.state == "headland" then
        if here ~= nil and here ~= "work" then
            self.entered = true
        end
        local mode = s.lowerMode
        if (mode == "steer" or mode == "both") and (engaged or evBack) then
            self:lower(vehicle, tools)
            return
        end
        if mode == "auto" or mode == "both" then
            if forward and kmh >= 0.5 then
                local n, known = self:countAhead(edge, dirX, dirZ, math.max(0.5, ms * s.lowerLead), true)
                if known and self.entered and n >= 2 then
                    self:lower(vehicle, tools)
                elseif not known and evBack then
                    self:lower(vehicle, tools)  -- Enhanced Vehicle saw the field again after the turn
                end
            end
        end
    end
end

-- Steering helper distance as seen from the implement. Base game lines are AI work lines (the tool's
-- line end); Enhanced Vehicle measures from the vehicle, so the implement's distance behind it is added.
function G5LinkHeadland:toolDistance(steer, edge, dirX, dirZ, vx, vz)
    if steer.kind == "ev" then
        return steer.distToLine + (vx - edge.x) * dirX + (vz - edge.z) * dirZ
    end
    return steer.distToLine
end

-- Distance ahead (m) from the front edge to the next zone change the automation will act on.
function G5LinkHeadland:scan(edge, dirX, dirZ, steer, vx, vz)
    local want = self.state == "headland" and "work" or nil
    if self:zoneAt(edge.x, edge.z) == nil then
        if steer.distToLine ~= nil then
            return self:toolDistance(steer, edge, dirX, dirZ, vx, vz)
        end
        return nil
    end
    for d = 0, G5LinkHeadland.SCAN_MAX, 1 do
        local zone = self:zoneAt(edge.x + dirX * d, edge.z + dirZ * d)
        if want == "work" and zone == "work" then return d end
        if want == nil and zone ~= "work" then return d end
    end
    return nil
end

function G5LinkHeadland:write(xml)
    local k = "g5.headland"
    local s = self.settings
    xml:setBool(k .. "#armed", s.armed == true)
    xml:setString(k .. "#state", self.state)
    xml:setString(k .. "#source", self.source or "none")
    xml:setInt(k .. "#v", s.v or -1)
    xml:setInt(k .. "#events", self.events)
    if finite(self.dist) then
        xml:setFloat(k .. "#dist", round(self.dist, 1))
    end
    local st = self.steer
    if st ~= nil and st.kind ~= "" then
        xml:setString(k .. "#steer", st.kind)
        xml:setBool(k .. "#steerOn", st.active == true)
    end
    if self.cov ~= nil then
        xml:setInt(k .. "#covRuns", self.cov.n)
    end
end
