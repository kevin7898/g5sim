-- G5Link AutoTrac (RTK package): steers the machine along the G5's own A-B tracks, and Turn Automation
-- turns it onto the next pass at the headland.
--
-- Steering follows the base game's steering assist (AIAutomaticSteering.lua, read from the LUADOC):
--   * the look-ahead point in the AI root node's local frame gives the curvature (circle through the node,
--     tangent to its heading): c = 2 x / (x^2 + z^2); getSteeringRotTimeByCurvature(c) gives the wheel angle,
--     inverted when getReverserDirection() < 0, limited to minRotTime..maxRotTime and to getAISteeringSpeed()
--   * updateVehiclePhysics is wrapped: axisSide = -value / maxRotTime (value < 0) or value / minRotTime,
--     then rotatedTime = value, as AIAutomaticSteering:updateVehiclePhysics does
--   * setSteeringInput is wrapped: steering by hand disengages, as AIAutomaticSteering:setSteeringInput does
-- The track comes from the bridge (guidance.xml: the G5's selected track, spacing and shift). The G5 only knows
-- the GNSS position, so AutoTrac steers the *reported* position onto the line: a low correction level (Rtk.lua)
-- now shows up as real skips and overlaps in the field.

G5LinkSteer = {}

G5LinkSteer.GUIDANCE_INTERVAL = 1000   -- ms between guidance.xml reads
G5LinkSteer.MAX_XTE = 1.0              -- x spacing: farther off the line than this and AutoTrac lets go
G5LinkSteer.MAX_HEADING = 75           -- degrees off the line heading before it lets go
G5LinkSteer.TURN_MARGIN = 2.0          -- m between the end of a turn and the field edge
G5LinkSteer.DEFAULT_RADIUS = 7.0       -- m turning radius when the machine does not report one
G5LinkSteer.PATH_STEP = 0.5            -- m between points of a turn path

local function call(obj, fname, ...)
    if obj == nil then return nil end
    local fn = obj[fname]
    if type(fn) ~= "function" then return nil end
    local ok, a, b, c = pcall(fn, obj, ...)
    if ok then return a, b, c end
    return nil
end
local function finite(v) return type(v) == "number" and v == v and v ~= math.huge and v ~= -math.huge end
local function clamp(v, lo, hi) if v < lo then return lo elseif v > hi then return hi end return v end

-- display heading convention: 0 = north (-z), clockwise; forward (sin h, -cos h), right (cos h, sin h)
local function fwdOf(h) local r = math.rad(h) return math.sin(r), -math.cos(r) end
local function rightOf(h) local r = math.rad(h) return math.cos(r), math.sin(r) end

function G5LinkSteer:reset()
    self.guidance = { v = -1 }
    self.timer = G5LinkSteer.GUIDANCE_INTERVAL
    self.engaged = false
    self.vehicle = nil
    self.mode = "line"
    self.reason = nil
    self.value = 0
    self.k, self.s = nil, 1
    self.path, self.pathIdx = nil, 1
    self.turns = 0
    self.lastSide = nil
    self.xte = nil
end
G5LinkSteer:reset()

---------------------------------------------------------------------------
-- guidance.xml from the bridge
---------------------------------------------------------------------------

function G5LinkSteer:loadGuidance(path)
    if path == nil or not fileExists(path) then
        if self.guidance.v ~= -1 then self.guidance = { v = -1 } end
        return
    end
    local xml = XMLFile.load("G5LinkGuidance", path)
    if xml == nil then return end
    local v = xml:getInt("guidance#v", 0)
    if v ~= self.guidance.v then
        local g = { v = v }
        g.trackId = xml:getString("guidance.track#id", nil)
        g.name = xml:getString("guidance.track#name", "")
        g.ax = xml:getFloat("guidance.track#ax", nil)
        g.az = xml:getFloat("guidance.track#az", nil)
        g.h = xml:getFloat("guidance.track#h", nil)
        g.spacing = xml:getFloat("guidance#spacing", 0)
        g.shift = xml:getFloat("guidance#shift", 0)
        g.turnOn = xml:getString("guidance.turn#on", "false") == "true"
        g.skip = math.max(0, xml:getInt("guidance.turn#skip", 0))
        g.dir = xml:getString("guidance.turn#dir", "auto")            -- auto | left | right
        g.radius = xml:getFloat("guidance.turn#radius", 0)              -- 0 = from the machine
        local ok = finite(g.ax) and finite(g.az) and finite(g.h) and finite(g.spacing) and g.spacing > 0.5
        g.valid = ok
        local old = self.guidance
        self.guidance = g
        -- a different track or a shift: re-acquire the nearest pass
        if self.engaged and (old.trackId ~= g.trackId or old.shift ~= g.shift or old.spacing ~= g.spacing) then
            self.k = nil
            self.mode, self.path = "line", nil
        end
    end
    xml:delete()
end

---------------------------------------------------------------------------
-- Position as the G5 knows it (GNSS), lines and readiness
---------------------------------------------------------------------------

function G5LinkSteer:node(vehicle)
    return call(vehicle, "getAIRootNode") or vehicle.rootNode
end

-- believed position (true + receiver error), true position, heading vector, error
function G5LinkSteer:pose(vehicle)
    local node = self:node(vehicle)
    if node == nil then return nil end
    local x, y, z = getWorldTranslation(node)
    local dx, _, dz = localDirectionToWorld(node, 0, 0, 1)
    local len = math.sqrt(dx * dx + dz * dz)
    if not (len > 0) then return nil end
    local ex, ez = 0, 0
    if G5LinkRtk ~= nil then
        local ok, a, b = pcall(G5LinkRtk.offset, G5LinkRtk, vehicle)
        if ok and finite(a) and finite(b) then ex, ez = a, b end
    end
    return { x = x + ex, z = z + ez, tx = x, ty = y, tz = z, dx = dx / len, dz = dz / len, ex = ex, ez = ez, node = node }
end

-- Is AutoTrac allowed and possible on this machine now? ok, reason
function G5LinkSteer:ready(vehicle)
    local g = self.guidance
    if vehicle == nil then return false, "noVehicle" end
    if not g.valid then return false, "noTrack" end
    if call(vehicle, "getIsAIActive") == true then return false, "aiActive" end
    if type(vehicle.updateVehiclePhysics) ~= "function" then return false, "notSteerable" end
    if G5LinkRtk ~= nil and G5LinkRtk.data ~= nil then
        local ok, allowed, need = pcall(G5LinkRtk.allows, G5LinkRtk, vehicle, "autotrac")
        if ok and allowed == false then return false, need == "activation" and "needsActivation" or "needsReceiver" end
    end
    return true
end

-- Line k of the track: origin point and unit vectors (believed frame)
function G5LinkSteer:line(k)
    local g = self.guidance
    local fx, fz = fwdOf(g.h)
    local nx, nz = rightOf(g.h)
    local off = g.shift + k * g.spacing
    return g.ax + nx * off, g.az + nz * off, fx, fz, nx, nz
end

function G5LinkSteer:nearestPass(p)
    local g = self.guidance
    local nx, nz = rightOf(g.h)
    local off = (p.x - g.ax) * nx + (p.z - g.az) * nz - g.shift
    return math.floor(off / g.spacing + 0.5)
end

---------------------------------------------------------------------------
-- Engage / disengage
---------------------------------------------------------------------------

local function warn(text)
    if g_currentMission ~= nil and g_currentMission.showBlinkingWarning ~= nil then
        pcall(g_currentMission.showBlinkingWarning, g_currentMission, text, 2500)
    end
end
G5LinkSteer.REASON_TEXT = {
    noTrack = "G5Link AutoTrac: set a guidance track on the G5 first",
    aiActive = "G5Link AutoTrac: an AI worker is driving",
    needsActivation = "G5Link AutoTrac: buy the AutoTrac activation in StarFire",
    needsReceiver = "G5Link AutoTrac: this machine has no GPS receiver",
    notSteerable = "G5Link AutoTrac: this machine cannot be steered",
    lost = "G5Link AutoTrac: too far off the track",
    heading = "G5Link AutoTrac: heading too far off the track",
    manual = "G5Link AutoTrac: steering by hand, disengaged",
}

function G5LinkSteer:hook(vehicle)
    if vehicle.g5SteerHooked then return end
    vehicle.g5SteerHooked = true
    local physics = vehicle.updateVehiclePhysics
    vehicle.updateVehiclePhysics = function(v, axisForward, axisSide, doHandbrake, dt)
        if G5LinkSteer.engaged and G5LinkSteer.vehicle == v then
            local value = G5LinkSteer.value
            if value < 0 then axisSide = -value / v.maxRotTime else axisSide = value / v.minRotTime end
            local acceleration = physics(v, axisForward, axisSide, doHandbrake, dt)
            v.rotatedTime = value
            if v.spec_drivable ~= nil then v.spec_drivable.axisSide = axisSide end
            return acceleration
        end
        return physics(v, axisForward, axisSide, doHandbrake, dt)
    end
    local steerInput = vehicle.setSteeringInput
    if type(steerInput) == "function" then
        vehicle.setSteeringInput = function(v, inputValue, isAnalog, deviceCategory)
            if G5LinkSteer.engaged and G5LinkSteer.vehicle == v then
                local keyboard = InputDevice ~= nil and InputDevice.CATEGORY ~= nil and deviceCategory == InputDevice.CATEGORY.KEYBOARD_MOUSE
                local settled = ((g_time or 0) - (G5LinkSteer.engagedAt or 0)) > 2500
                if (keyboard and inputValue ~= 0) or (not keyboard and settled and math.abs(inputValue - (G5LinkSteer.lastInput or 0)) > 0.1) then
                    G5LinkSteer:disengage("manual")
                elseif not settled then
                    G5LinkSteer.lastInput = inputValue
                end
            end
            return steerInput(v, inputValue, isAnalog, deviceCategory)
        end
    end
end

function G5LinkSteer:engage(vehicle)
    local ok, reason = self:ready(vehicle)
    if not ok then
        self.reason = reason
        warn(G5LinkSteer.REASON_TEXT[reason] or ("G5Link AutoTrac: " .. tostring(reason)))
        return false, reason
    end
    -- the base game's steering assist would fight us
    if call(vehicle, "getAIAutomaticSteeringState") == (AIAutomaticSteering and AIAutomaticSteering.STATE and AIAutomaticSteering.STATE.ACTIVE) then
        call(vehicle, "setAIAutomaticSteeringEnabled", false)
    end
    self:hook(vehicle)
    self.engaged, self.vehicle, self.reason = true, vehicle, nil
    self.k, self.mode, self.path = nil, "line", nil
    self.value = vehicle.rotatedTime or 0
    self.engagedAt = g_time or 0
    self.lastInput = 0
    return true
end

function G5LinkSteer:disengage(reason)
    if not self.engaged then return end
    self.engaged = false
    self.reason = reason
    self.mode, self.path = "line", nil
    if reason ~= nil and reason ~= "off" then warn(G5LinkSteer.REASON_TEXT[reason] or "G5Link AutoTrac disengaged") end
end

function G5LinkSteer:toggle(vehicle)
    if self.engaged and self.vehicle == vehicle then
        self:disengage("off")
        return true
    end
    return self:engage(vehicle)
end

-- the Resume key (input action G5LINK_RESUME), bound in the game's controls like any key or button
function G5LinkSteer.actionResume(vehicle, actionName, inputValue, callbackState, isAnalog)
    G5LinkSteer:toggle(vehicle)
end

---------------------------------------------------------------------------
-- Steering
---------------------------------------------------------------------------

-- Steer toward a point given in the G5's (GNSS) frame.
function G5LinkSteer:steerToward(vehicle, p, bx, bz, dt)
    local wx, wz = bx - p.ex, bz - p.ez                 -- the same point in the true frame
    local lx, _, lz = worldToLocal(p.node, wx, p.ty, wz)
    local d2 = lx * lx + lz * lz
    local target = 0
    if d2 > 0.01 and lz > 0.1 then
        local curvature = 2 * lx / d2
        target = call(vehicle, "getSteeringRotTimeByCurvature", curvature) or 0
        if (call(vehicle, "getReverserDirection") or 1) < 0 then target = -target end
    end
    local maxR, minR = vehicle.maxRotTime or 1, vehicle.minRotTime or -1
    if target >= 0 then target = math.min(target, maxR) else target = math.max(target, minR) end
    local speed = call(vehicle, "getAISteeringSpeed") or 0.001
    local step = speed * dt
    if target > self.value then self.value = math.min(self.value + step, target)
    else self.value = math.max(self.value - step, target) end
end

function G5LinkSteer:lookAhead(vehicle)
    local kmh = call(vehicle, "getLastSpeed") or 0
    return clamp(kmh / 3.6 * 1.8, 4, 12)
end

-- Turning radius of the machine: the setting, the machine's own value, or the default.
function G5LinkSteer:radius(vehicle)
    local r = self.guidance.radius
    if finite(r) and r > 1 then return r end
    if finite(vehicle.maxTurningRadius) and vehicle.maxTurningRadius > 1 then return vehicle.maxTurningRadius end
    return G5LinkSteer.DEFAULT_RADIUS
end

-- U-turn from pose (x, z, heading ux,uz) to a line D metres to the side (side +1 = right of travel).
-- A plain half circle when D >= 2R, else an omega (bulb) turn of three arcs of radius R.
function G5LinkSteer.turnPath(x, z, ux, uz, side, D, R)
    local pts = {}
    local hx, hz, px, pz = ux, uz, x, z
    local function arc(angle, dir, rad)
        -- dir +1 turns right (clockwise in the display frame), -1 left
        local n = math.max(2, math.ceil(math.abs(angle) * rad / G5LinkSteer.PATH_STEP))
        local da = angle / n
        for _ = 1, n do
            local step = 2 * rad * math.sin(da / 2)
            local mid = dir * da / 2
            local c, s = math.cos(mid), math.sin(mid)
            local mx, mz = hx * c - hz * s, hx * s + hz * c   -- rotate heading by mid (clockwise positive)
            px, pz = px + mx * step, pz + mz * step
            c, s = math.cos(dir * da), math.sin(dir * da)
            hx, hz = hx * c - hz * s, hx * s + hz * c
            table.insert(pts, { px, pz })
        end
    end
    local function lateral(qx, qz)
        -- right of the start heading: (-uz, ux) is right in the display frame
        return ((qx - x) * (-uz) + (qz - z) * ux) * side
    end
    if D >= 2 * R - 0.01 then
        arc(math.pi, side, D / 2)
    else
        -- find the away angle t so the omega turn ends D to the side
        local function sim(t)
            pts, hx, hz, px, pz = {}, ux, uz, x, z
            arc(t, -side, R); arc(math.pi + 2 * t, side, R); arc(t, -side, R)
            return lateral(px, pz)
        end
        local lo, hi = 0, 1.5
        for _ = 1, 40 do
            local mid = (lo + hi) / 2
            if sim(mid) > D then lo = mid else hi = mid end
        end
        sim((lo + hi) / 2)
    end
    -- a few metres straight on the new line to settle
    for i = 1, 6 do table.insert(pts, { px + hx * i, pz + hz * i }) end
    return pts
end

-- distance ahead (m, believed frame) to ground outside the field; nil if unknown within 60 m
function G5LinkSteer:distanceToOutside(p, ux, uz)
    if G5LinkHeadland == nil or G5LinkHeadland.poly == nil then return nil end
    for d = 0, 60, 1 do
        if G5LinkHeadland:zoneAt(p.x + ux * d, p.z + uz * d) == "outside" then return d end
    end
    return nil
end

function G5LinkSteer:startTurn(vehicle, p, ux, uz)
    local g = self.guidance
    local side
    if g.dir == "left" then side = -1 elseif g.dir == "right" then side = 1
    else side = self.lastSide and -self.lastSide or 1 end
    self.lastSide = side
    local D = (g.skip + 1) * g.spacing
    -- start from the point on the current line, heading along it
    local ox, oz, fx, fz = self:line(self.k)
    local along = (p.x - ox) * fx + (p.z - oz) * fz
    local sx, sz = ox + fx * along, oz + fz * along
    self.path = G5LinkSteer.turnPath(sx, sz, ux, uz, side, D, self:radius(vehicle))
    self.pathIdx = 1
    -- right of travel is +n when driving +f, -n when driving -f
    self.nextK = self.k + side * self.s * (g.skip + 1)
    self.mode = "turn"
    self.turnedAtRaise = true
end

function G5LinkSteer:followPath(vehicle, p, dt)
    local path = self.path
    -- nearest point, searching forward only
    local best, bi = math.huge, self.pathIdx
    for i = self.pathIdx, math.min(#path, self.pathIdx + 40) do
        local d = (path[i][1] - p.x) ^ 2 + (path[i][2] - p.z) ^ 2
        if d < best then best, bi = d, i end
    end
    self.pathIdx = bi
    if bi >= #path - 3 then
        -- turn done: follow the new pass the other way
        self.k, self.s = self.nextK, -self.s
        self.mode, self.path = "line", nil
        self.turns = self.turns + 1
        return
    end
    local ahead = math.min(#path, bi + math.floor(3 / G5LinkSteer.PATH_STEP))
    self:steerToward(vehicle, p, path[ahead][1], path[ahead][2], dt)
end

function G5LinkSteer:update(vehicle, dt, host)
    self.timer = self.timer + dt
    if self.timer >= G5LinkSteer.GUIDANCE_INTERVAL then
        self.timer = 0
        self:loadGuidance(host.dir and host.dir .. "guidance.xml")
    end
    if not self.engaged then
        self.xte = nil
        return
    end
    if vehicle ~= self.vehicle then self:disengage("off") return end
    local ok, reason = self:ready(vehicle)
    if not ok then self:disengage(reason) return end
    local p = self:pose(vehicle)
    if p == nil then return end
    local g = self.guidance

    if self.k == nil then
        self.k = self:nearestPass(p)
        local fx, fz = fwdOf(g.h)
        self.s = (p.dx * fx + p.dz * fz) >= 0 and 1 or -1
    end
    if self.mode == "turn" and self.path ~= nil then
        self:followPath(vehicle, p, dt)
        return
    end

    local ox, oz, fx, fz, nx, nz = self:line(self.k)
    local ux, uz = fx * self.s, fz * self.s
    self.xte = (p.x - ox) * nx + (p.z - oz) * nz         -- + = right of the line (display frame)
    if math.abs(self.xte) > g.spacing * G5LinkSteer.MAX_XTE + 1 then self:disengage("lost") return end
    local cosH = clamp(p.dx * ux + p.dz * uz, -1, 1)
    if math.deg(math.acos(cosH)) > G5LinkSteer.MAX_HEADING then self:disengage("heading") return end

    -- Turn Automation: at the headland, once the implement is up, turn onto the next pass
    if g.turnOn and (vehicle.movingDirection or 1) >= 0 then
        local raised = G5LinkHeadland ~= nil and G5LinkHeadland.state == "headland"
        local toEdge = self:distanceToOutside(p, ux, uz)
        local R = self:radius(vehicle)
        local D = (g.skip + 1) * g.spacing
        local need = (D >= 2 * R) and (D / 2) or (R * 2)  -- room the turn needs ahead
        if raised and toEdge ~= nil and toEdge <= need + G5LinkSteer.TURN_MARGIN then
            self:startTurn(vehicle, p, ux, uz)
            self:followPath(vehicle, p, dt)
            return
        end
    end

    local along = (p.x - ox) * ux + (p.z - oz) * uz
    local L = self:lookAhead(vehicle)
    local bx, bz = ox + ux * (along + L), oz + uz * (along + L)
    self:steerToward(vehicle, p, bx, bz, dt)
end

function G5LinkSteer:write(xml, vehicle)
    local k = "g5.autotrac"
    local state
    if self.engaged and self.vehicle == vehicle then
        state = self.mode == "turn" and "turning" or "engaged"
    else
        local ok, reason = self:ready(vehicle)
        state = ok and "ready" or "notReady"
        if not ok then xml:setString(k .. "#reason", reason) end
    end
    xml:setString(k .. "#state", state)
    if self.reason ~= nil and state ~= "engaged" and state ~= "turning" then xml:setString(k .. "#last", self.reason) end
    if self.guidance.trackId ~= nil then xml:setString(k .. "#track", self.guidance.trackId) end
    if self.k ~= nil and self.engaged then xml:setInt(k .. "#pass", self.k) end
    if finite(self.xte) then xml:setFloat(k .. "#xte", math.floor(self.xte * 1000 + 0.5) / 1000) end
    xml:setBool(k .. "#turnOn", self.guidance.turnOn == true)
    xml:setInt(k .. "#turns", self.turns)
    if self.mode == "turn" and self.nextK ~= nil then xml:setInt(k .. "#nextPass", self.nextK) end
end

-- "autotrac" command from the display: value 1 engage, 0 disengage, else toggle
function G5LinkSteer:run(vehicle, cmd)
    if cmd.name ~= "autotrac" then return false end
    if vehicle == nil then return true end
    if cmd.value == 1 then self:engage(vehicle)
    elseif cmd.value == 0 then self:disengage("off")
    else self:toggle(vehicle) end
    return true
end

-- Resume key: added to every drivable's input when its driver is in it (like the Grain Cart add-on adds
-- its keys to CpHud). Bind it in the game's controls: keyboard, joystick, wheel or a Stream Deck key.
if Drivable ~= nil and type(Drivable.onRegisterActionEvents) == "function" and Utils ~= nil and Utils.appendedFunction ~= nil then
    Drivable.onRegisterActionEvents = Utils.appendedFunction(Drivable.onRegisterActionEvents, function(self, isActiveForInput, isActiveForInputIgnoreSelection)
        if self.isClient and InputAction ~= nil and InputAction.G5LINK_RESUME ~= nil and self.spec_drivable ~= nil
            and call(self, "getIsActiveForInput", true, true) == true then
            local _, id = self:addActionEvent(self.spec_drivable.actionEvents, InputAction.G5LINK_RESUME, self, G5LinkSteer.actionResume, false, true, false, true, nil)
            if id ~= nil and g_inputBinding ~= nil and GS_PRIO_NORMAL ~= nil then
                pcall(g_inputBinding.setActionEventTextPriority, g_inputBinding, id, GS_PRIO_NORMAL)
            end
        end
    end)
end
