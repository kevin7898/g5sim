-- G5Link provider host. Adapted from FieldPath Private Integration 0.1.0.0
-- (kevin7898/Fieldpath-integration, src/FieldPathPrivateIntegration.lua).
--
-- Differences from the original:
--   * Not a mod event listener of its own: G5Link calls loadMap/update/deleteMap.
--   * If another mod already published g_currentMission.fieldPathPrivateAPI (the private
--     integration itself, or a FieldPath build), G5Link reads that and installs nothing.
--   * Only publishes its own fieldPathPrivateAPI when none exists, so it never replaces one.
--   * No Realistic Harvesting adapter: G5Link reads Realistic Harvesting's official RHM_Api.

G5LinkProviders = {
    version = "0.1.0.0-g5link",
    registry = nil,
    providers = {},
    registeredProviderIds = {},
    statusFingerprints = {},
    nextStatusRefreshMs = 0,
    ownsRegistry = false,
    api = nil,          -- the API G5Link reads (external or our own)
    external = false    -- true when another mod's API is used
}

local function registryCall(registry, methodName, ...)
    if registry == nil or type(registry[methodName]) ~= "function" then return nil end
    local ok, value = pcall(registry[methodName], registry, ...)
    if ok then return value end
    ok, value = pcall(registry[methodName], ...)
    return ok and value or nil
end

local function providerCall(provider, methodName, ...)
    if provider == nil or type(provider[methodName]) ~= "function" then return nil end
    local ok, value = pcall(provider[methodName], ...)
    if ok then return value end
    ok, value = pcall(provider[methodName], provider, ...)
    return ok and value or nil
end

function G5LinkProviders:getAdapters()
    return {
        FPPIMudSystemPhysicsAdapter,
        FPPISoilFertilizerAdapter,
        FPPIAutoDriveAdapter,
        FPPICourseplayAdapter
    }
end

function G5LinkProviders:installRegistry()
    if g_currentMission == nil then return false end

    local existing = g_currentMission.fieldPathPrivateAPI
    if type(existing) == "table" and type(existing.getDisplayFrame) == "function" then
        self.api = existing
        self.external = true
        return true
    end

    if g_currentMission.fieldPathProviderRegistry == nil then
        g_currentMission.fieldPathProviderRegistry = FPPIProviderRegistry.new()
        self.ownsRegistry = true
    end
    self.registry = g_currentMission.fieldPathProviderRegistry

    for _, adapter in ipairs(self:getAdapters()) do
        if adapter ~= nil then
            local privateProvider = adapter:provider()
            privateProvider.privateAdapter = true
            local provider = registryCall(self.registry, "getProvider", privateProvider.id)
            if provider == nil then
                registryCall(self.registry, "registerProvider", privateProvider)
                provider = registryCall(self.registry, "getProvider", privateProvider.id) or privateProvider
                self.registeredProviderIds[privateProvider.id] = privateProvider
            end
            self.providers[privateProvider.id] = provider
        end
    end

    local owner = self
    self.ownAPI = {
        apiVersion = 1,
        integrationVersion = self.version,
        privateBuild = false,
        listProviders = function() return owner:listProviders() end,
        getProviderStatus = function(providerId) return owner:getProviderStatus(providerId) end,
        getSnapshot = function(providerId, context) return owner:getSnapshot(providerId, context) end,
        getDisplayFrame = function(context) return owner:getDisplayFrame(context) end,
        subscribe = function(listenerId, callback)
            return registryCall(owner.registry, "subscribe", listenerId, callback) == true
        end,
        unsubscribe = function(listenerId) return registryCall(owner.registry, "unsubscribe", listenerId) end
    }
    self.api = self.ownAPI
    self.external = false
    if g_currentMission.fieldPathPrivateAPI == nil then
        g_currentMission.fieldPathPrivateAPI = self.ownAPI
    end
    return true
end

function G5LinkProviders:listProviders()
    local listed = registryCall(self.registry, "listProviders")
    if type(listed) == "table" then return listed end
    local out = {}
    for id, provider in pairs(self.providers) do
        out[#out + 1] = {
            id = id,
            name = provider.name,
            capabilities = FPPIUtil.copy(provider.capabilities, 2),
            status = self:getProviderStatus(id)
        }
    end
    return out
end

function G5LinkProviders:getProviderStatus(providerId)
    local provider = registryCall(self.registry, "getProvider", providerId) or self.providers[providerId]
    if provider == nil or type(provider.getStatus) ~= "function" then return nil end
    return FPPIUtil.copy(providerCall(provider, "getStatus"), 4)
end

function G5LinkProviders:getSnapshot(providerId, context)
    local provider = registryCall(self.registry, "getProvider", providerId) or self.providers[providerId]
    if provider == nil or type(provider.getSnapshot) ~= "function" then return nil end
    local snapshot = providerCall(provider, "getSnapshot", context or {})
    if type(snapshot) ~= "table" then return nil end
    local output = FPPIUtil.copy(snapshot, 8)
    if output == nil then return nil end
    output.providerId = providerId
    output.providerVersion = provider.providerVersion
    output.integrationVersion = self.version
    return output
end

function G5LinkProviders:getDisplayFrame(context)
    context = context or {}
    local fieldId = FPPIUtil.number(context.fieldId)
    if fieldId ~= nil and fieldId <= 0 then fieldId = nil end
    local frame = {
        schemaVersion = 1,
        gameTime = g_currentMission and g_currentMission.time or 0,
        fieldId = fieldId,
        x = FPPIUtil.number(context.x),
        z = FPPIUtil.number(context.z),
        providers = {}
    }
    for id in pairs(self.providers) do
        local snapshot = self:getSnapshot(id, context)
        if snapshot ~= nil then frame.providers[id] = snapshot end
    end
    return frame
end

function G5LinkProviders:refreshStatuses()
    for id, fallbackProvider in pairs(self.providers) do
        local provider = registryCall(self.registry, "getProvider", id) or fallbackProvider
        local status = providerCall(provider, "getStatus")
        if type(status) == "table" then
            local fingerprint = table.concat({
                tostring(status.available), tostring(status.mode),
                tostring(status.version), tostring(status.detail)
            }, "|")
            if self.statusFingerprints[id] ~= fingerprint then
                self.statusFingerprints[id] = fingerprint
                registryCall(self.registry, "publish", id, "statusChanged", FPPIUtil.copy(status, 3))
            end
        end
    end
end

-- Status of every provider, for the display's Status Center: {id = {available, mode, version, detail}}
function G5LinkProviders:getStatuses()
    local out = {}
    local listed = self.api and FPPIUtil.invoke(self.api.listProviders) or nil
    if type(listed) == "table" then
        for _, p in ipairs(listed) do
            if type(p) == "table" and p.id ~= nil then
                out[p.id] = p.status or {}
            end
        end
    end
    return out
end

function G5LinkProviders:loadMap()
    self.providers = {}
    self.registeredProviderIds = {}
    self.statusFingerprints = {}
    self.nextStatusRefreshMs = 0
    if self:installRegistry() then
        if not self.external then
            self:refreshStatuses()
        end
        print(string.format("G5Link: providers ready (%s)",
            self.external and "using existing fieldPathPrivateAPI" or "built-in adapters"))
    end
end

function G5LinkProviders:update(dt)
    if self.external then return end
    local now = g_time or g_currentMission and g_currentMission.time or 0
    if now >= (self.nextStatusRefreshMs or 0) then
        self.nextStatusRefreshMs = now + 2000
        self:refreshStatuses()
    end
end

function G5LinkProviders:deleteMap()
    for id, privateProvider in pairs(self.registeredProviderIds) do
        if registryCall(self.registry, "getProvider", id) == privateProvider then
            registryCall(self.registry, "unregisterProvider", id)
        end
    end
    if g_currentMission ~= nil and self.ownAPI ~= nil and g_currentMission.fieldPathPrivateAPI == self.ownAPI then
        g_currentMission.fieldPathPrivateAPI = nil
    end
    if self.ownsRegistry and g_currentMission ~= nil
        and g_currentMission.fieldPathProviderRegistry == self.registry then
        g_currentMission.fieldPathProviderRegistry = nil
    end
    self.registry = nil
    self.ownAPI = nil
    self.api = nil
    self.external = false
    self.providers = {}
    self.registeredProviderIds = {}
    self.ownsRegistry = false
end
