-- From FieldPath Private Integration 0.1.0.0 (kevin7898/Fieldpath-integration), brought into G5Link unchanged.
FPPISoilFertilizerAdapter = {
    id = "soil-fertilizer",
    candidates = {"FS25_SoilFertilizer", "SoilFertilizer"}
}

function FPPISoilFertilizerAdapter:refresh()
    local manager = g_currentMission and g_currentMission.soilFertilityManager
    local system = manager and manager.soilSystem
    if system and type(system.getFieldInfo) == "function" then
        return FPPIUtil.providerStatus(self.id, true, "public-api",
            FPPIUtil.versionFor(self.candidates))
    end
    local mod = FPPIUtil.getMod(self.candidates)
    if mod ~= nil then
        return FPPIUtil.providerStatus(self.id, false, "incompatible",
            FPPIUtil.string(mod.version, 64), "shared mission bridge is missing")
    end
    return FPPIUtil.providerStatus(self.id, false, "missing", nil)
end

function FPPISoilFertilizerAdapter:getSnapshot(context)
    local manager = g_currentMission and g_currentMission.soilFertilityManager
    local system = manager and manager.soilSystem
    if system == nil then return nil end
    local fieldId = context and FPPIUtil.number(tonumber(context.fieldId))
    if fieldId == nil or fieldId <= 0 then return nil end
    local info = FPPIUtil.call(system, "getFieldInfo", fieldId, context.x, context.z)
    if type(info) ~= "table" then return nil end
    local sentry = g_currentMission and g_currentMission.fieldSentry
    return {
        sourceMode = "public-api",
        fieldId = fieldId,
        values = FPPIUtil.copy(info, 5),
        simulationStatus = FPPIUtil.copy(
            sentry and FPPIUtil.invoke(sentry.getUIStatus, fieldId) or nil, 4)
    }
end

function FPPISoilFertilizerAdapter:provider()
    return {
        id = self.id,
        name = "Realistic Soil & Fertilizer",
        apiVersion = 1,
        providerVersion = FPPIUtil.versionFor(self.candidates),
        capabilities = {"soil.field", "soil.at-position", "soil.simulation-status"},
        getStatus = function() return self:refresh() end,
        getSnapshot = function(context) return self:getSnapshot(context or {}) end
    }
end
