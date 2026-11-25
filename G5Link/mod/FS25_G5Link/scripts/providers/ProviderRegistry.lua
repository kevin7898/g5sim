-- From FieldPath Private Integration 0.1.0.0 (kevin7898/Fieldpath-integration), brought into G5Link unchanged.
FPPIProviderRegistry = {}
local FPPIProviderRegistry_mt = Class(FPPIProviderRegistry)

function FPPIProviderRegistry.new()
    local self = setmetatable({}, FPPIProviderRegistry_mt)
    self.apiVersion = 1
    self.providers = {}
    self.listeners = {}
    return self
end

function FPPIProviderRegistry:registerProvider(descriptor)
    if type(descriptor) ~= "table" or type(descriptor.id) ~= "string" then return false end
    if type(descriptor.getStatus) ~= "function" and type(descriptor.getSnapshot) ~= "function" then return false end
    local existing = self.providers[descriptor.id]
    if existing ~= nil then
        if existing.privateAdapter == true and descriptor.privateAdapter ~= true then
            self.providers[descriptor.id] = descriptor
            self:publish("fieldpath", "providerReplaced", {
                providerId = descriptor.id,
                previousMode = "private-adapter",
                replacementMode = "official"
            })
            return true
        end
        return false, "already-registered"
    end
    self.providers[descriptor.id] = descriptor
    self:publish("fieldpath", "providerRegistered", {providerId = descriptor.id})
    return true
end

function FPPIProviderRegistry:unregisterProvider(providerId)
    if self.providers[providerId] == nil then return false end
    self.providers[providerId] = nil
    self:publish("fieldpath", "providerUnregistered", {providerId = providerId})
    return true
end

function FPPIProviderRegistry:getProvider(providerId)
    return self.providers[providerId]
end

function FPPIProviderRegistry:listProviders()
    local out = {}
    for id, provider in pairs(self.providers) do
        local status = nil
        if type(provider.getStatus) == "function" then
            status = FPPIUtil.invoke(provider.getStatus)
        end
        out[#out + 1] = {
            id = id,
            name = provider.name,
            apiVersion = provider.apiVersion,
            providerVersion = provider.providerVersion,
            capabilities = FPPIUtil.copy(provider.capabilities, 2),
            status = FPPIUtil.copy(status, 3)
        }
    end
    table.sort(out, function(a, b) return a.id < b.id end)
    return out
end

function FPPIProviderRegistry:subscribe(listenerId, callback)
    if type(listenerId) ~= "string" or type(callback) ~= "function" then return false end
    self.listeners[listenerId] = callback
    return true
end

function FPPIProviderRegistry:unsubscribe(listenerId)
    self.listeners[listenerId] = nil
end

function FPPIProviderRegistry:publish(providerId, eventType, payload)
    for listenerId, callback in pairs(self.listeners) do
        local ok, err = pcall(callback, {
            providerId = providerId,
            eventType = eventType,
            payload = payload,
            gameTime = g_currentMission and g_currentMission.time or 0
        })
        if not ok and Logging ~= nil then
            Logging.warning("[FieldPathPrivate] listener '%s' failed: %s", listenerId, tostring(err))
        end
    end
end
