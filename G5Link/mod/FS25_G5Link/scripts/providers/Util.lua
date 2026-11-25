-- From FieldPath Private Integration 0.1.0.0 (kevin7898/Fieldpath-integration), brought into G5Link unchanged.
FPPIUtil = {}

function FPPIUtil.isFinite(value)
    return type(value) == "number" and value == value and value ~= math.huge and value ~= -math.huge
end

function FPPIUtil.number(value, minimum, maximum)
    if not FPPIUtil.isFinite(value) then return nil end
    if minimum ~= nil and value < minimum then value = minimum end
    if maximum ~= nil and value > maximum then value = maximum end
    return value
end

function FPPIUtil.bool(value)
    return value == true
end

function FPPIUtil.string(value, maxLength)
    if value == nil then return nil end
    local out = tostring(value)
    local limit = maxLength or 256
    if #out > limit then out = string.sub(out, 1, limit) end
    return out
end

function FPPIUtil.call(object, methodName, ...)
    if object == nil then return nil end
    local fn = object[methodName]
    if type(fn) ~= "function" then return nil end
    local ok, a, b, c, d, e = pcall(fn, object, ...)
    if not ok then return nil end
    return a, b, c, d, e
end

function FPPIUtil.invoke(fn, ...)
    if type(fn) ~= "function" then return nil end
    local ok, a, b, c, d, e = pcall(fn, ...)
    if not ok then return nil end
    return a, b, c, d, e
end

function FPPIUtil.copy(value, depth, seen)
    local kind = type(value)
    if kind == "nil" or kind == "boolean" or kind == "string" then return value end
    if kind == "number" then return FPPIUtil.number(value) end
    if kind ~= "table" then return FPPIUtil.string(value) end

    depth = depth or 4
    if depth <= 0 then return nil end
    seen = seen or {}
    if seen[value] then return nil end
    seen[value] = true

    local out = {}
    local count = 0
    for key, item in pairs(value) do
        if count >= 512 then break end
        local keyType = type(key)
        if keyType == "string" or keyType == "number" then
            local copied = FPPIUtil.copy(item, depth - 1, seen)
            if copied ~= nil then
                out[key] = copied
                count = count + 1
            end
        end
    end
    seen[value] = nil
    return out
end

function FPPIUtil.averageWheelSlip(vehicle)
    local wheels = vehicle and vehicle.spec_wheels and vehicle.spec_wheels.wheels
    if wheels == nil then return 0 end
    local sum, count = 0, 0
    for _, wheel in pairs(wheels) do
        local physics = wheel and wheel.physics
        local slip = physics and physics.netInfo and physics.netInfo.slip or physics and physics.slip
        if FPPIUtil.isFinite(slip) then
            sum = sum + slip
            count = count + 1
        end
    end
    return count > 0 and sum / count or 0
end

function FPPIUtil.getMod(candidates)
    if g_modManager == nil or type(g_modManager.getModByName) ~= "function" then return nil, nil end
    for _, name in ipairs(candidates or {}) do
        local ok, mod = pcall(g_modManager.getModByName, g_modManager, name)
        if ok and mod ~= nil then return mod, name end
    end
    return nil, nil
end

local function lookupEnvironment(name)
    local roots = {_G}
    if type(getfenv) == "function" then
        local ok, env = pcall(getfenv, 0)
        if ok and type(env) == "table" then roots[#roots + 1] = env end
    end
    for _, root in ipairs(roots) do
        local ok, value = pcall(function() return root[name] end)
        if ok and type(value) == "table" then return value end
    end
    return nil
end

-- Private compatibility escape hatch. Official providers should publish their
-- API on g_currentMission instead of requiring this resolver.
function FPPIUtil.resolveModEnvironment(candidates, requiredSymbols)
    for _, name in ipairs(candidates or {}) do
        local env = lookupEnvironment(name)
        if env ~= nil then
            local valid = true
            for _, symbol in ipairs(requiredSymbols or {}) do
                if env[symbol] == nil then valid = false break end
            end
            if valid then return env, name end
        end
    end
    return nil, nil
end

function FPPIUtil.versionFor(candidates)
    local mod = FPPIUtil.getMod(candidates)
    if mod == nil then return nil end
    return FPPIUtil.string(mod.version or mod.modDescVersion or mod.fileHash, 64)
end

function FPPIUtil.providerStatus(id, available, mode, version, detail)
    return {
        id = id,
        available = available == true,
        mode = mode or "unavailable",
        version = version,
        detail = detail
    }
end
