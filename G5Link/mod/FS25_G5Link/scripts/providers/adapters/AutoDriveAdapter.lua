-- From FieldPath Private Integration 0.1.0.0 (kevin7898/Fieldpath-integration), brought into G5Link unchanged.
FPPIAutoDriveAdapter = {
    id = "autodrive",
    candidates = {"FS25_AutoDrive", "AutoDrive"},
    env = nil
}

function FPPIAutoDriveAdapter:refresh()
    local mod = FPPIUtil.getMod(self.candidates)
    if mod == nil then return FPPIUtil.providerStatus(self.id, false, "missing", nil) end
    self.env = FPPIUtil.resolveModEnvironment(self.candidates, {"ADGraphManager"})
    local detail = self.env and "graph environment resolved" or "vehicle state only; graph environment unavailable"
    return FPPIUtil.providerStatus(self.id, true,
        self.env and "private-internal" or "vehicle-state",
        FPPIUtil.string(mod.version, 64), detail)
end

function FPPIAutoDriveAdapter:getVehicleSnapshot(vehicle)
    local ad = vehicle and vehicle.ad
    local state = ad and ad.stateModule
    if state == nil then return nil end
    local drive = ad.drivePathModule
    local path, pathIndex = FPPIUtil.call(drive, "getWayPoints")
    local activePath = {}
    if type(path) == "table" then
        for index = math.max(1, tonumber(pathIndex) or 1), math.min(#path, (tonumber(pathIndex) or 1) + 255) do
            local point = path[index]
            if point ~= nil then
                activePath[#activePath + 1] = {
                    id = FPPIUtil.number(point.id),
                    x = FPPIUtil.number(point.x),
                    y = FPPIUtil.number(point.y),
                    z = FPPIUtil.number(point.z),
                    pathfinder = point.isPathFinderPoint == true
                }
            end
        end
    end

    return {
        sourceMode = "vehicle-state",
        active = FPPIUtil.call(state, "isActive") == true,
        mode = FPPIUtil.number(FPPIUtil.call(state, "getMode")),
        task = FPPIUtil.string(FPPIUtil.call(state, "getCurrentLocalizedTaskInfo"), 256),
        driverName = FPPIUtil.string(FPPIUtil.call(state, "getName"), 128),
        destination = FPPIUtil.string(FPPIUtil.call(state, "getFirstMarkerName"), 128),
        secondaryDestination = FPPIUtil.string(FPPIUtil.call(state, "getSecondMarkerName"), 128),
        destinationId = FPPIUtil.number(FPPIUtil.call(state, "getFirstMarkerId")),
        secondaryDestinationId = FPPIUtil.number(FPPIUtil.call(state, "getSecondMarkerId")),
        currentWaypointId = FPPIUtil.number(FPPIUtil.call(state, "getCurrentWayPointId")),
        nextWaypointId = FPPIUtil.number(FPPIUtil.call(state, "getNextWayPointId")),
        remainingDriveTime = FPPIUtil.number(
            FPPIUtil.call(vehicle, "adGetRemainingDriveTime") or FPPIUtil.call(state, "getRemainingDriveTime"), 0),
        speedLimit = FPPIUtil.number(FPPIUtil.call(state, "getSpeedLimit"), 0),
        fieldSpeedLimit = FPPIUtil.number(FPPIUtil.call(state, "getFieldSpeedLimit"), 0),
        fillType = FPPIUtil.number(FPPIUtil.call(state, "getFillType")),
        selectedFillTypes = FPPIUtil.copy(FPPIUtil.call(state, "getSelectedFillTypes"), 2),
        reversing = FPPIUtil.call(drive, "getIsReversing") == true,
        onRoadNetwork = FPPIUtil.call(drive, "isOnRoadNetwork") == true,
        targetReached = FPPIUtil.call(drive, "isTargetReached") == true,
        pathIndex = FPPIUtil.number(pathIndex, 0),
        activePath = activePath
    }
end

local function copyConnections(values, limit)
    local out = {}
    if type(values) ~= "table" then return out end
    for _, id in pairs(values) do
        if #out >= limit then break end
        local value = FPPIUtil.number(id)
        if value ~= nil then out[#out + 1] = value end
    end
    return out
end

function FPPIAutoDriveAdapter:getGraphSnapshot(maxNodes)
    if self.env == nil then self:refresh() end
    local graph = self.env and self.env.ADGraphManager
    if graph == nil then return nil end
    maxNodes = math.max(1, math.min(tonumber(maxNodes) or 200000, 250000))

    local nodes = {}
    local waypoints = FPPIUtil.call(graph, "getWayPoints") or {}
    for _, point in pairs(waypoints) do
        if #nodes >= maxNodes then break end
        if type(point) == "table" then
            nodes[#nodes + 1] = {
                id = FPPIUtil.number(point.id),
                x = FPPIUtil.number(point.x),
                y = FPPIUtil.number(point.y),
                z = FPPIUtil.number(point.z),
                outgoing = copyConnections(point.out, 64),
                incoming = copyConnections(point.incoming, 64),
                flags = FPPIUtil.number(point.flags)
            }
        end
    end

    local destinations = {}
    local markers = FPPIUtil.call(graph, "getMapMarkers") or {}
    for markerIndex, marker in pairs(markers) do
        if type(marker) == "table" then
            local point = FPPIUtil.call(graph, "getWayPointById", marker.id)
            destinations[#destinations + 1] = {
                markerIndex = FPPIUtil.number(marker.markerIndex or markerIndex),
                waypointId = FPPIUtil.number(marker.id),
                name = FPPIUtil.string(marker.name, 128),
                group = FPPIUtil.string(marker.group, 128),
                x = point and FPPIUtil.number(point.x) or nil,
                y = point and FPPIUtil.number(point.y) or nil,
                z = point and FPPIUtil.number(point.z) or nil
            }
        end
    end

    local nodeCount = FPPIUtil.number(FPPIUtil.call(graph, "getWayPointsCount"), 0) or #nodes
    return {
        sourceMode = "private-internal",
        truncated = nodeCount > #nodes,
        nodeCount = nodeCount,
        hasChanges = FPPIUtil.call(graph, "hasChanges") == true,
        nodes = nodes,
        destinations = destinations,
        groups = FPPIUtil.copy(FPPIUtil.call(graph, "getGroups"), 2)
    }
end

function FPPIAutoDriveAdapter:provider()
    return {
        id = self.id,
        name = "AutoDrive",
        apiVersion = 1,
        providerVersion = FPPIUtil.versionFor(self.candidates),
        capabilities = {"route.vehicle", "route.active-path", "route.graph", "route.destinations"},
        getStatus = function() return self:refresh() end,
        getSnapshot = function(context)
            if context and context.kind == "graph" then return self:getGraphSnapshot(context.maxNodes) end
            return self:getVehicleSnapshot(context and context.vehicle)
        end
    }
end
