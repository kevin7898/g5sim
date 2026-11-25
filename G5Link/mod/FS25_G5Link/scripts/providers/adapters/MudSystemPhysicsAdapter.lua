-- From FieldPath Private Integration 0.1.0.0 (kevin7898/Fieldpath-integration), brought into G5Link unchanged.
FPPIMudSystemPhysicsAdapter = {
    id = "mud-system-physics",
    candidates = {"FS25_MudSystemPhysics", "MudSystemPhysics"},
    env = nil,
    status = nil
}

local function mudPublicCall(api, name, ...)
    if api == nil or type(api[name]) ~= "function" then return nil end
    local ok, value = pcall(api[name], ...)
    if ok and value ~= nil then return value end
    ok, value = pcall(api[name], api, ...)
    return ok and value or nil
end

local function currentGroundWetness()
    local weather = g_currentMission and g_currentMission.environment and g_currentMission.environment.weather
    return FPPIUtil.number(FPPIUtil.call(weather, "getGroundWetness"), 0, 1) or 0
end

function FPPIMudSystemPhysicsAdapter:refresh()
    local public = g_currentMission and g_currentMission.mudSystemPhysicsAPI
    if public ~= nil then
        self.status = FPPIUtil.providerStatus(self.id, true, "public-api",
            FPPIUtil.string(public.providerVersion or public.version, 64))
        return self.status
    end

    local env, name = FPPIUtil.resolveModEnvironment(self.candidates, {"FieldGroundMudPhysics"})
    self.env = env
    local mod, modName = FPPIUtil.getMod(self.candidates)
    if env ~= nil then
        self.status = FPPIUtil.providerStatus(self.id, true, "private-internal",
            FPPIUtil.versionFor(self.candidates), "resolved " .. tostring(name))
    elseif mod ~= nil then
        self.status = FPPIUtil.providerStatus(self.id, false, "incompatible",
            FPPIUtil.string(mod.version, 64), "mod loaded but its environment was not resolvable")
    else
        self.status = FPPIUtil.providerStatus(self.id, false, "missing", nil,
            "expected " .. table.concat(self.candidates, " or "))
    end
    return self.status
end

function FPPIMudSystemPhysicsAdapter:getConditionsAt(x, z)
    x, z = FPPIUtil.number(x), FPPIUtil.number(z)
    if x == nil or z == nil then return nil end

    local public = g_currentMission and g_currentMission.mudSystemPhysicsAPI
    local publicValue = mudPublicCall(public, "getConditionsAt", x, z)
    if type(publicValue) == "table" then
        local copied = FPPIUtil.copy(publicValue, 4)
        copied.sourceMode = "public-api"
        return copied
    end

    if self.env == nil then self:refresh() end
    local env = self.env
    if env == nil then return nil end

    local fg = env.FieldGroundMudPhysics
    local localWetness = env.FieldLocalWetness
    local mudPhysics = env.MudPhysics
    local baseMud, groundType, profile = FPPIUtil.call(fg, "getProfileAtWorldPos", x, z)
    local wetness, cell = FPPIUtil.call(localWetness, "getWetnessAt", x, z, 0)
    local fallback = currentGroundWetness()
    local effective = FPPIUtil.call(localWetness, "getEffectiveWetnessAt", x, z, fallback, 0, profile)
    if effective == nil then effective = fallback end

    local frozen = FPPIUtil.call(fg, "isHardWinterFrozen")
    if frozen == nil then frozen = FPPIUtil.call(mudPhysics, "isHardWinterFrozen") end

    return {
        sourceMode = "private-internal",
        x = x,
        z = z,
        wetnessIndex = FPPIUtil.number(wetness, 0, 1),
        effectiveWetness = FPPIUtil.number(effective, 0, 1),
        baseMudFactor = FPPIUtil.number(baseMud, 0, 1),
        groundType = FPPIUtil.string(groundType, 64),
        profileName = profile and FPPIUtil.string(profile.name, 64) or nil,
        profile = profile and {
            wetMultiplier = FPPIUtil.number(profile.wetMul, 0, 20),
            sinkMultiplier = FPPIUtil.number(profile.sinkMul, 0, 20),
            brakeMultiplier = FPPIUtil.number(profile.brakeMul, 0, 20),
            motorMultiplier = FPPIUtil.number(profile.motorMul, 0, 20),
            tractionMultiplier = FPPIUtil.number(profile.slip, 0, 4)
        } or nil,
        retention = cell and FPPIUtil.number(cell.retention, 0, 4) or nil,
        lowland = cell and FPPIUtil.number(cell.lowland, 0, 1) or nil,
        pocket = cell and FPPIUtil.number(cell.pocket, 0, 1) or nil,
        ridge = cell and FPPIUtil.number(cell.ridge, 0, 1) or nil,
        slope = cell and FPPIUtil.number(cell.slope, 0, 1) or nil,
        frozen = frozen == true
    }
end

function FPPIMudSystemPhysicsAdapter:getVehicleSnapshot(vehicle)
    if vehicle == nil then return nil end
    local public = g_currentMission and g_currentMission.mudSystemPhysicsAPI
    local publicValue = mudPublicCall(public, "getVehicleSnapshot", vehicle)
    if type(publicValue) == "table" then
        local copied = FPPIUtil.copy(publicValue, 4)
        copied.sourceMode = "public-api"
        return copied
    end

    if self.env == nil then self:refresh() end
    local env = self.env
    if env == nil then
        return {sourceMode = "game-fallback", slip = FPPIUtil.averageWheelSlip(vehicle)}
    end

    local fg, mp, tire = env.FieldGroundMudPhysics, env.MudPhysics, env.TirePressureSystem
    local fieldMud, fieldSlip, groundType, profile = FPPIUtil.call(fg, "computeVehicleFieldMudCached", vehicle)
    local brushMud, brushSlip = FPPIUtil.call(mp, "computeVehicleMud", vehicle)
    local fieldState = fg and fg.vehicleState and fg.vehicleState[vehicle]
    local brushState = mp and mp.vehicleState and mp.vehicleState[vehicle]
    local pressure, targetPressure, wheelCount = FPPIUtil.call(tire, "getCombinationPressureAverage", vehicle)

    local sink = fieldState and fieldState.sink or brushState and brushState.sink
    local stuck = fieldState and fieldState.stuck or brushState and brushState.stuck
    return {
        sourceMode = "private-internal",
        fieldMudFactor = FPPIUtil.number(fieldMud, 0, 1),
        brushMudFactor = FPPIUtil.number(brushMud, 0, 1),
        slip = FPPIUtil.number(fieldSlip or brushSlip or FPPIUtil.averageWheelSlip(vehicle), 0, 10),
        sink = FPPIUtil.number(sink, 0, 1),
        stuck = stuck == true,
        permanentStuck = fieldState and fieldState.permaActive == true
            or brushState and brushState.permaStuckActive == true or false,
        groundType = FPPIUtil.string(groundType, 64),
        profileName = profile and FPPIUtil.string(profile.name, 64) or nil,
        motorLoadMultiplier = FPPIUtil.number(
            fieldState and fieldState.lastAppliedMotorLoad or brushState and brushState.lastAppliedMotorLoad, 0, 100),
        tirePressure = FPPIUtil.number(pressure, 0, 20),
        targetTirePressure = FPPIUtil.number(targetPressure, 0, 20),
        wheelCount = FPPIUtil.number(wheelCount, 0, 256)
    }
end

function FPPIMudSystemPhysicsAdapter:provider()
    return {
        id = self.id,
        name = "Mud System Physics",
        apiVersion = 1,
        providerVersion = FPPIUtil.versionFor(self.candidates),
        capabilities = {"conditions.at-position", "vehicle.mud", "vehicle.tire-pressure"},
        getStatus = function() return self:refresh() end,
        getSnapshot = function(context)
            if context and context.vehicle then return self:getVehicleSnapshot(context.vehicle) end
            return self:getConditionsAt(context and context.x, context and context.z)
        end
    }
end
