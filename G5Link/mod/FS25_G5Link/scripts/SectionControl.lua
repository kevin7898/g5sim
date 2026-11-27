-- G5Link Section Control: automatic row/section shutoff on planters and drills run by the G5,
-- like the Deere Section Control activation. The shutoff itself happens in FieldPath Realistic
-- Seeder 2.6+ (g_currentMission.realisticSeederAPI): the implement needs row clutches, electric
-- row drives or section shutoff bought in the shop. G5Link checks in as the controller every tick
-- (setSectionController, held 3 s by the seeder), so the seeder follows the G5 master switch and
-- coverage overlap setting while a G5 runs the machine, and falls back to its own monitor otherwise.
--   API used, all pcall'd: api.getSectionControl(impl, geometry) -> table | nil
--                          api.setSectionController(impl, {name, enabled, overlap}) -> ok, reason
-- Needs a GPS receiver and the Section Control activation (StarFire app) when RTK requirements are on.

G5LinkSection = {}
G5LinkSection.TICK = 250
G5LinkSection.NAME = "G5Link"
G5LinkSection.OVERLAP = { [0] = "Minimize Skips", [1] = "50% Covered", [2] = "Minimize Overlap" }

local function finite(v) return type(v) == "number" and v == v and v ~= math.huge and v ~= -math.huge end

function G5LinkSection:reset()
    self.timer = 0
    self.on = true           -- master switch (the G5 starts with Section Control on once activated)
    self.overlap = 0
    self.loadedFrom = nil
    self.held = {}           -- implements we checked in as controller for
    self.last = nil
end
G5LinkSection:reset()

local function api()
    local a = g_currentMission and g_currentMission.realisticSeederAPI
    if type(a) == "table" and type(a.getSectionControl) == "function" and type(a.setSectionController) == "function" then return a end
    return nil
end

---------------------------------------------------------------------------
-- Master switch and overlap, kept in section.xml in the G5Link folder
---------------------------------------------------------------------------

function G5LinkSection:load(dir)
    if dir == nil or self.loadedFrom == dir then return end
    self.loadedFrom = dir
    local path = dir .. "section.xml"
    if not fileExists(path) then return end
    local xml = XMLFile.load("G5LinkSection", path)
    if xml == nil then return end
    self.on = xml:getString("section#on", "true") ~= "false"
    local o = xml:getInt("section#overlap", 0)
    if o == 0 or o == 1 or o == 2 then self.overlap = o end
    xml:delete()
end

function G5LinkSection:save(dir)
    if dir == nil then return end
    local xml = XMLFile.create("G5LinkSection", dir .. "section.xml", "section")
    if xml == nil then return end
    xml:setString("section#on", self.on and "true" or "false")
    xml:setInt("section#overlap", self.overlap)
    xml:save()
    xml:delete()
end

---------------------------------------------------------------------------
-- Per tick: check in as controller for the machine's seeders
---------------------------------------------------------------------------

function G5LinkSection:allowed(vehicle)
    if G5LinkRtk == nil then return true, nil end
    local ok, allowed, need = pcall(G5LinkRtk.allows, G5LinkRtk, vehicle, "section")
    if not ok then return true, nil end
    if allowed == false then return false, need end
    return true, nil
end

function G5LinkSection:release(a, keep)
    for impl, _ in pairs(self.held) do
        if keep == nil or not keep[impl] then
            if a ~= nil then pcall(a.setSectionController, impl, nil) end
            self.held[impl] = nil
        end
    end
end

function G5LinkSection:update(vehicle, dt, host)
    self:load(host and host.dir)
    self.timer = self.timer + dt
    if self.timer < G5LinkSection.TICK then return end
    self.timer = 0
    self.last = nil
    local a = api()
    if vehicle == nil or a == nil then
        self:release(a)
        return
    end
    local allowed, need = self:allowed(vehicle)
    local out = { allowed = allowed, need = need, on = self.on, overlap = self.overlap, implements = {} }
    local keep = {}
    for _, impl in ipairs(host:getImplements(vehicle)) do
        local ok, sc = pcall(a.getSectionControl, impl, false)
        if ok and type(sc) == "table" and sc.hardware then
            if allowed then
                local okSet, accepted = pcall(a.setSectionController, impl, { name = G5LinkSection.NAME, enabled = self.on, overlap = self.overlap })
                if okSet and accepted then keep[impl] = true; self.held[impl] = true end
            end
            table.insert(out.implements, impl)
        end
    end
    self:release(a, keep)
    if #out.implements > 0 then self.last = out end
end

-- Live lanes of one implement for coverage and the display: {kind, lanes, controller, enabled, rows = {...}} or nil.
function G5LinkSection:lanesOf(impl)
    local a = api()
    if a == nil then return nil end
    local ok, sc = pcall(a.getSectionControl, impl, true)
    if not ok or type(sc) ~= "table" or not sc.hardware or not finite(sc.lanes) or sc.lanes < 1 or type(sc.rows) ~= "table" then return nil end
    return sc
end

function G5LinkSection:write(xml)
    local o = self.last
    if o == nil then return end
    local k = "g5.section"
    xml:setBool(k .. "#allowed", o.allowed == true)
    if o.need ~= nil then xml:setString(k .. "#need", tostring(o.need)) end
    xml:setBool(k .. "#on", o.on == true)
    xml:setInt(k .. "#overlap", o.overlap or 0)
    xml:setString(k .. "#overlapName", G5LinkSection.OVERLAP[o.overlap or 0] or "")
    xml:setInt(k .. "#implements", #o.implements)
end

-- "section" (value 1 on, 0 off, else toggle) and "sectionOverlap" (value 0..2)
function G5LinkSection:run(vehicle, cmd, host)
    if cmd.name ~= "section" and cmd.name ~= "sectionOverlap" then return false end
    self:load(host and host.dir)
    if cmd.name == "section" then
        if cmd.value == 1 then self.on = true elseif cmd.value == 0 then self.on = false else self.on = not self.on end
    else
        local o = math.floor(tonumber(cmd.value) or 0)
        if o >= 0 and o <= 2 then self.overlap = o end
    end
    self:save(host and host.dir)
    self.timer = G5LinkSection.TICK     -- apply on the next update
    return true
end
