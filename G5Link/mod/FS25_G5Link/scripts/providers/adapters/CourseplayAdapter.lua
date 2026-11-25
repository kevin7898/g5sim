-- From FieldPath Private Integration 0.1.0.0 (kevin7898/Fieldpath-integration), brought into G5Link unchanged.
FPPICourseplayAdapter = {
    id = "courseplay",
    candidates = {"FS25_Courseplay", "Courseplay_FS25", "Courseplay"}
}

function FPPICourseplayAdapter:refresh()
    local mod = FPPIUtil.getMod(self.candidates)
    if mod == nil then return FPPIUtil.providerStatus(self.id, false, "missing", nil) end
    return FPPIUtil.providerStatus(self.id, true, "vehicle-functions",
        FPPIUtil.string(mod.version, 64))
end

local function copyPolygon(polygon, maxPoints)
    local out = {}
    if type(polygon) ~= "table" then return out end
    for _, point in ipairs(polygon) do
        if #out >= maxPoints then break end
        out[#out + 1] = {
            x = FPPIUtil.number(point.x or point[1]),
            y = FPPIUtil.number(point.y or point[2]),
            z = FPPIUtil.number(point.z or point[3])
        }
    end
    return out
end

local function copyCourse(course, maxWaypoints)
    if course == nil then return nil end
    maxWaypoints = math.max(1, math.min(tonumber(maxWaypoints) or 20000, 100000))
    local count = FPPIUtil.call(course, "getNumberOfWaypoints") or 0
    local waypoints = {}
    for index = 1, math.min(count, maxWaypoints) do
        local point = FPPIUtil.call(course, "getWaypoint", index)
        if point ~= nil then
            waypoints[#waypoints + 1] = {
                index = index,
                x = FPPIUtil.number(point.x),
                y = FPPIUtil.number(point.y),
                z = FPPIUtil.number(point.z),
                angle = FPPIUtil.number(point.angle),
                reverse = FPPIUtil.call(course, "isReverseAt", index) == true,
                rowStart = FPPIUtil.call(course, "isTurnEndAtIx", index) == true,
                rowEnd = FPPIUtil.call(course, "isTurnStartAtIx", index) == true,
                connectingPath = FPPIUtil.call(course, "isOnConnectingPath", index) == true,
                headland = FPPIUtil.number(FPPIUtil.call(course, "getHeadlandNumber", index)),
                rowNumber = FPPIUtil.number(FPPIUtil.call(point, "getRowNumber"))
            }
        end
    end
    local remainingDistance, remainingTurns = FPPIUtil.call(course, "getRemainingDistanceAndTurnsFrom",
        FPPIUtil.call(course, "getCurrentWaypointIx") or 1)
    return {
        name = FPPIUtil.string(FPPIUtil.call(course, "getName"), 256),
        hash = FPPIUtil.string(FPPIUtil.call(course, "getHash"), 128),
        workWidth = FPPIUtil.number(FPPIUtil.call(course, "getWorkWidth"), 0),
        headlands = FPPIUtil.number(FPPIUtil.call(course, "getNumberOfHeadlands"), 0),
        waypointCount = FPPIUtil.number(count, 0),
        currentWaypoint = FPPIUtil.number(FPPIUtil.call(course, "getCurrentWaypointIx"), 0),
        lastPassedWaypoint = FPPIUtil.number(FPPIUtil.call(course, "getLastPassedWaypointIx"), 0),
        length = FPPIUtil.number(FPPIUtil.call(course, "getLength"), 0),
        remainingDistance = FPPIUtil.number(remainingDistance, 0),
        remainingTurns = FPPIUtil.number(remainingTurns, 0),
        temporary = FPPIUtil.call(course, "isTemporary") == true,
        truncated = count > maxWaypoints,
        waypoints = waypoints
    }
end

function FPPICourseplayAdapter:getVehicleSnapshot(vehicle, maxWaypoints)
    if vehicle == nil or type(vehicle.getIsCpActive) ~= "function" then return nil end
    local course = FPPIUtil.call(vehicle, "getFieldWorkCourse")
    local islands = {}
    local rawIslands = FPPIUtil.call(vehicle, "cpGetIslandPolygons")
    if type(rawIslands) == "table" then
        for _, polygon in ipairs(rawIslands) do
            if #islands >= 128 then break end
            islands[#islands + 1] = copyPolygon(polygon, 10000)
        end
    end

    local infoTexts = FPPIUtil.call(vehicle, "getCpActiveInfoTexts")
    return {
        sourceMode = "vehicle-functions",
        active = FPPIUtil.call(vehicle, "getIsCpActive") == true,
        drivingToFieldwork = FPPIUtil.call(vehicle, "getIsCpDriveToFieldWorkActive") == true,
        fieldworkActive = FPPIUtil.call(vehicle, "getIsCpFieldWorkActive") == true,
        combineUnloaderActive = FPPIUtil.call(vehicle, "getIsCpCombineUnloaderActive") == true,
        progress = FPPIUtil.number(FPPIUtil.call(vehicle, "getCpFieldWorkProgress"), 0, 1),
        waitingForUnload = FPPIUtil.call(vehicle, "getIsCpHarvesterWaitingForUnload") == true,
        waitingInPocket = FPPIUtil.call(vehicle, "getIsCpHarvesterWaitingForUnloadInPocket") == true,
        waitingAfterPullback = FPPIUtil.call(vehicle, "getIsCpHarvesterWaitingForUnloadAfterPulledBack") == true,
        maneuvering = FPPIUtil.call(vehicle, "getIsCpHarvesterManeuvering") == true,
        courseName = FPPIUtil.string(FPPIUtil.call(vehicle, "getCurrentCpCourseName"), 256),
        course = copyCourse(course, maxWaypoints),
        fieldPolygon = copyPolygon(FPPIUtil.call(vehicle, "cpGetFieldPolygon"), 20000),
        islandPolygons = islands,
        infoTexts = FPPIUtil.copy(infoTexts, 3)
    }
end

function FPPICourseplayAdapter:provider()
    return {
        id = self.id,
        name = "Courseplay",
        apiVersion = 1,
        providerVersion = FPPIUtil.versionFor(self.candidates),
        capabilities = {"course.vehicle", "course.geometry", "course.progress", "field.boundary"},
        getStatus = function() return self:refresh() end,
        getSnapshot = function(context)
            return self:getVehicleSnapshot(context and context.vehicle, context and context.maxWaypoints)
        end
    }
end
