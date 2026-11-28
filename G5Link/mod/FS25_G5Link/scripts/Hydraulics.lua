-- G5Link support for Realistic Hydraulics (FS25_RealHydraulicsSCV, planned companion mod, optional).
-- The hydraulics mod publishes g_currentMission.realHydraulicsAPI with the same conventions as g5linkAPI
-- (dot calls, isReady(), semver getVersion(), reads return copies, writes return ok, reason). It is looked
-- up lazily, since mods load alphabetically. The contract G5Link relies on (NOTES.md "Realistic Hydraulics"):
--   api.getVersion()                        "1.0.0"
--   api.isReady()                           true once the mission is loaded
--   api.getState(vehicle)                   {circuit = {...}, scvs = {{...}, ...}, epg = {...} | nil, warnings = {...}} | nil
--   api.getFunctions(vehicle)               {{id, label, implementName, kind}, ...}
--   api.setScv(vehicle, index, cfg)         ok, reason   (cfg holds only the fields to change)
--   api.assign(vehicle, index, functionId)  ok, reason   (nil unassigns)
--   api.setEpgMode(vehicle, mode)           ok, reason   ("off" | "auto" | "icm")
-- Writes the g5.hyd block (4 Hz) and runs the scvSet, scvAssign, scvFloat and epgMode commands.
-- Every call is pcall-wrapped; nothing here runs unless the hydraulics mod is loaded.

G5LinkHyd = {}

G5LinkHyd.MAX_SCV = 8          -- 4 rear + front on most tractors; 8R/9R can have up to 6 rear
G5LinkHyd.MAX_FUNCS = 40
G5LinkHyd.MAX_USES = 12
G5LinkHyd.MAX_WARN = 8
G5LinkHyd.MAX_TIMER = 120      -- s; the G5 offers 0 to 120 s, then continuous
G5LinkHyd.DETENT = { none = true, timed = true, continuous = true }
G5LinkHyd.MODES = { standard = true, independent = true, feature = true }
G5LinkHyd.STATES = { neutral = true, extend = true, retract = true, float = true }
G5LinkHyd.EPG_MODES = { off = true, auto = true, icm = true }
G5LinkHyd.SOURCES = { pto_generator = true, hyd_generator = true, tractor_epg = true }

local function finite(v) return type(v) == "number" and v == v and v ~= math.huge and v ~= -math.huge end
local function round(v, d)
    local m = 10 ^ (d or 0)
    return math.floor(v * m + 0.5) / m
end
local function setNum(xml, key, v, digits)
    if finite(v) then
        xml:setFloat(key, round(v, digits or 1))
    end
end
local function setText(xml, key, v, maxLen)
    if v == nil then
        return
    end
    local s = tostring(v)
    if maxLen ~= nil and #s > maxLen then
        s = string.sub(s, 1, maxLen)
    end
    xml:setString(key, s)
end
-- Only one of a known set of words, or nothing.
local function setWord(xml, key, v, allowed)
    if type(v) == "string" and allowed[v] then
        xml:setString(key, v)
    end
end
local function clamp(v, lo, hi)
    if v < lo then return lo end
    if v > hi then return hi end
    return v
end

function G5LinkHyd:reset()
    self.lastResult = nil
    self.errorLogged = false
end
G5LinkHyd:reset()

-- The hydraulics API, or nil when the mod is absent or not ready yet.
function G5LinkHyd:api()
    local api = g_currentMission ~= nil and g_currentMission.realHydraulicsAPI or nil
    if type(api) ~= "table" or type(api.getState) ~= "function" then
        return nil
    end
    if type(api.isReady) == "function" then
        local ok, ready = pcall(api.isReady)
        if not ok or ready ~= true then
            return nil
        end
    end
    return api
end

local function get(api, fname, ...)
    local fn = api[fname]
    if type(fn) ~= "function" then
        return nil
    end
    local ok, a, b = pcall(fn, ...)
    if ok then
        return a, b
    end
    return nil
end

function G5LinkHyd:write(xml, vehicle)
    local api = self:api()
    if api == nil or vehicle == nil then
        return
    end
    local state = get(api, "getState", vehicle)
    if type(state) ~= "table" then
        return                                    -- this machine has no hydraulics model (e.g. on foot, a car)
    end
    local k = "g5.hyd"
    setText(xml, k .. "#version", get(api, "getVersion") or "", 16)

    local c = type(state.circuit) == "table" and state.circuit or {}
    setNum(xml, k .. "#pumpLpm", c.pumpLpm, 0)          -- flow the pump gives at this engine rpm
    setNum(xml, k .. "#maxLpm", c.maxPumpLpm, 0)        -- rated flow at rated rpm
    setNum(xml, k .. "#usedLpm", c.usedLpm, 0)
    setNum(xml, k .. "#pressureBar", c.pressureBar, 0)
    setNum(xml, k .. "#maxBar", c.maxPressureBar, 0)
    setNum(xml, k .. "#oilTempC", c.oilTempC, 0)
    setNum(xml, k .. "#hitchLpm", c.hitchLpm, 0)        -- 3-point hitch and steering take flow first
    if c.flowShared ~= nil then
        xml:setBool(k .. "#shared", c.flowShared == true)   -- demand is over the pump: flow is being shared
    end

    local n = 0
    for _, s in ipairs(type(state.scvs) == "table" and state.scvs or {}) do
        if n >= G5LinkHyd.MAX_SCV then
            break
        end
        if type(s) == "table" then
            local sk = string.format("%s.scv(%d)", k, n)
            n = n + 1
            xml:setInt(sk .. "#index", finite(s.index) and math.floor(s.index) or n)
            setText(xml, sk .. "#label", s.label, 40)
            setText(xml, sk .. "#bound", s.bound, 80)               -- function id
            setText(xml, sk .. "#boundLabel", s.boundLabel, 60)
            setWord(xml, sk .. "#state", s.state, G5LinkHyd.STATES)
            setWord(xml, sk .. "#mode", s.mode, G5LinkHyd.MODES)
            setWord(xml, sk .. "#detent", s.detent, G5LinkHyd.DETENT)
            setNum(xml, sk .. "#flowExt", s.flowExt, 0)             -- % of the valve's maximum
            setNum(xml, sk .. "#flowRet", s.flowRet, 0)
            setNum(xml, sk .. "#timer", s.timer, 1)                 -- s
            setNum(xml, sk .. "#timerLeft", s.timerLeft, 1)
            setNum(xml, sk .. "#prio", s.prio, 0)
            setNum(xml, sk .. "#lpm", s.allottedLpm, 0)
            setNum(xml, sk .. "#demandLpm", s.demandLpm, 0)
            setNum(xml, sk .. "#pos", s.position, 2)                -- 0..1 of the cylinder stroke, if known
            xml:setBool(sk .. "#float", s.float == true)
            if s.front == true then
                xml:setBool(sk .. "#front", true)
            end
        end
    end

    local fns = get(api, "getFunctions", vehicle)
    local fi = 0
    for _, f in ipairs(type(fns) == "table" and fns or {}) do
        if fi >= G5LinkHyd.MAX_FUNCS then
            break
        end
        if type(f) == "table" and f.id ~= nil then
            local fk = string.format("%s.func(%d)", k, fi)
            fi = fi + 1
            setText(xml, fk .. "#id", f.id, 80)
            setText(xml, fk .. "#label", f.label or f.id, 60)
            setText(xml, fk .. "#impl", f.implementName, 60)
            setText(xml, fk .. "#kind", f.kind, 20)
        end
    end

    local e = state.epg
    if type(e) == "table" then
        local ek = k .. ".epg"
        setWord(xml, ek .. "#source", e.source, G5LinkHyd.SOURCES)
        setWord(xml, ek .. "#mode", e.mode, G5LinkHyd.EPG_MODES)
        setNum(xml, ek .. "#capKw", e.capKw, 1)
        setNum(xml, ek .. "#availKw", e.availableKw, 1)     -- capacity after engine, PTO or SCV-flow headroom
        setNum(xml, ek .. "#usedKw", e.usedKw, 1)
        setNum(xml, ek .. "#busV", e.busV, 1)
        setNum(xml, ek .. "#nominalV", e.nominalV, 0)
        if type(e.fault) == "string" and e.fault ~= "" then
            setText(xml, ek .. "#fault", e.fault, 40)
        end
        local ui = 0
        for _, u in ipairs(type(e.uses) == "table" and e.uses or {}) do
            if ui >= G5LinkHyd.MAX_USES then
                break
            end
            if type(u) == "table" then
                local uk = string.format("%s.use(%d)", ek, ui)
                ui = ui + 1
                setText(xml, uk .. "#name", u.name or "?", 40)
                setNum(xml, uk .. "#kw", u.kw, 2)
                setNum(xml, uk .. "#demandKw", u.demandKw, 2)
            end
        end
    end

    local wi = 0
    for _, w in ipairs(type(state.warnings) == "table" and state.warnings or {}) do
        if wi >= G5LinkHyd.MAX_WARN then
            break
        end
        local code = type(w) == "table" and w.code or w
        if type(code) == "string" and code ~= "" then
            local wk = string.format("%s.warn(%d)", k, wi)
            wi = wi + 1
            setText(xml, wk .. "#code", code, 32)
            if type(w) == "table" and w.text ~= nil then
                setText(xml, wk .. "#text", w.text, 80)
            end
        end
    end

    local r = self.lastResult
    if r ~= nil then
        xml:setBool(k .. ".result#ok", r.ok == true)
        xml:setString(k .. ".result#cmd", r.cmd)
        xml:setInt(k .. ".result#id", r.id)
        if r.reason ~= nil then
            setText(xml, k .. ".result#reason", r.reason, 60)
        end
    end
end

-- "flowExt=80;flowRet=60;detent=timed" -> {flowExt = "80", ...}
function G5LinkHyd.parseArg(arg)
    local t = {}
    for pair in string.gmatch(tostring(arg or ""), "[^;]+") do
        local key, v = string.match(pair, "^%s*([%w_]+)%s*=%s*(.-)%s*$")
        if key ~= nil then
            t[key] = v
        end
    end
    return t
end

-- The SCV settings in a scvSet arg, checked and clamped; unknown or bad values are left out.
function G5LinkHyd.scvConfig(a)
    local cfg, any = {}, false
    local function num(key, lo, hi)
        local v = tonumber(a[key])
        if finite(v) then
            cfg[key] = clamp(v, lo, hi)
            any = true
        end
    end
    num("flowExt", 0, 100)
    num("flowRet", 0, 100)
    num("timer", 0, G5LinkHyd.MAX_TIMER)
    num("prio", 1, G5LinkHyd.MAX_SCV)
    if cfg.prio ~= nil then
        cfg.prio = math.floor(cfg.prio + 0.5)
    end
    if G5LinkHyd.DETENT[a.detent] then
        cfg.detent = a.detent
        any = true
    end
    if G5LinkHyd.MODES[a.mode] then
        cfg.mode = a.mode
        any = true
    end
    if a.float == "1" or a.float == "0" then
        cfg.float = a.float == "1"
        any = true
    end
    if any then
        return cfg
    end
    return nil
end

local HANDLED = { scvSet = true, scvAssign = true, scvFloat = true, epgMode = true }

function G5LinkHyd:run(vehicle, cmd)
    if not HANDLED[cmd.name] then
        return false
    end
    local function done(ok, reason)
        self.lastResult = { ok = ok == true, reason = reason ~= nil and tostring(reason) or nil, cmd = cmd.name, id = cmd.id or 0 }
        return true
    end
    local api = self:api()
    if api == nil then
        return done(false, "noHydraulicsMod")
    end
    if vehicle == nil then
        return done(false, "noVehicle")
    end
    local a = G5LinkHyd.parseArg(cmd.arg)
    local index = tonumber(cmd.index) or 0
    if cmd.name ~= "epgMode" and (index < 1 or index > G5LinkHyd.MAX_SCV) then
        return done(false, "badIndex")
    end
    local fname, p2, p3
    if cmd.name == "scvSet" then
        local cfg = G5LinkHyd.scvConfig(a)
        if cfg == nil then
            return done(false, "badConfig")
        end
        fname, p2, p3 = "setScv", index, cfg
    elseif cmd.name == "scvFloat" then
        fname, p2, p3 = "setScv", index, { float = cmd.value == 1 }
    elseif cmd.name == "scvAssign" then
        local fn = a.fn
        if fn == "" then
            fn = nil                                -- unassign
        end
        fname, p2, p3 = "assign", index, fn
    else
        if not G5LinkHyd.EPG_MODES[a.mode] then
            return done(false, "badMode")
        end
        fname, p2 = "setEpgMode", a.mode
    end
    if type(api[fname]) ~= "function" then
        return done(false, "notSupported")
    end
    local ok, res, reason = pcall(api[fname], vehicle, p2, p3)
    if not ok then
        if not self.errorLogged then
            self.errorLogged = true
            print("G5Link: Realistic Hydraulics " .. fname .. " failed: " .. tostring(res))
        end
        return done(false, "error")
    end
    return done(res ~= false, res == false and (reason or "refused") or nil)
end
