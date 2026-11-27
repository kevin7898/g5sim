-- Minimal JSON encoder for G5Link (Lua 5.1). Tables with keys 1..n become arrays,
-- empty tables become [], other tables become objects. NaN and infinity become null.

G5Json = {}

local ESCAPES = {['"'] = '\\"', ['\\'] = '\\\\', ['\n'] = '\\n', ['\r'] = '\\r', ['\t'] = '\\t'}

local function encodeString(s)
    s = string.gsub(s, '[%c"\\]', function(c)
        return ESCAPES[c] or string.format('\\u%04x', string.byte(c))
    end)
    return '"' .. s .. '"'
end

local function arrayLength(t)
    local n = 0
    for k in pairs(t) do
        if type(k) ~= "number" or k < 1 or math.floor(k) ~= k then
            return nil
        end
        n = n + 1
    end
    for i = 1, n do
        if t[i] == nil then
            return nil
        end
    end
    return n
end

local function encode(v, out, depth)
    local kind = type(v)
    if kind == "nil" then
        out[#out + 1] = "null"
    elseif kind == "boolean" then
        out[#out + 1] = v and "true" or "false"
    elseif kind == "number" then
        if v ~= v or v == math.huge or v == -math.huge then
            out[#out + 1] = "null"
        elseif math.floor(v) == v and math.abs(v) < 1e15 then
            out[#out + 1] = string.format("%.0f", v == 0 and 0 or v)
        else
            out[#out + 1] = string.format("%.7g", v)
        end
    elseif kind == "string" then
        out[#out + 1] = encodeString(v)
    elseif kind == "table" then
        if depth > 16 then
            out[#out + 1] = "null"
            return
        end
        local n = arrayLength(v)
        if n ~= nil then
            out[#out + 1] = "["
            for i = 1, n do
                if i > 1 then out[#out + 1] = "," end
                encode(v[i], out, depth + 1)
            end
            out[#out + 1] = "]"
        else
            out[#out + 1] = "{"
            local first = true
            for k, item in pairs(v) do
                local kt = type(k)
                if (kt == "string" or kt == "number") and type(item) ~= "function" and type(item) ~= "userdata" then
                    if not first then out[#out + 1] = "," end
                    first = false
                    out[#out + 1] = encodeString(tostring(k))
                    out[#out + 1] = ":"
                    encode(item, out, depth + 1)
                end
            end
            out[#out + 1] = "}"
        end
    else
        out[#out + 1] = "null"
    end
end

function G5Json.encode(value)
    local out = {}
    encode(value, out, 0)
    return table.concat(out)
end
