/** Read-only authoring audit. The trajectory probe is provisional, not engine gameplay physics. */
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { validateDocument, getItemPolygonPixels } from "../../Затихший узел/tools/model-tools.mjs";

const EPS = 1e-6;
const key = value => value?.toLowerCase();
const rectangle = item => ({ left: item.x / 32, top: item.y / 32, right: item.x / 32 + item.w, bottom: item.y / 32 + item.h });
const overlap = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > EPS
  && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > EPS;
const pointOnSegment = (point, a, b) => Math.abs((b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x)) <= EPS
  && point.x >= Math.min(a.x, b.x) - EPS && point.x <= Math.max(a.x, b.x) + EPS
  && point.y >= Math.min(a.y, b.y) - EPS && point.y <= Math.max(a.y, b.y) + EPS;
function inside(point, polygon) {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j], b = polygon[i];
    if (pointOnSegment(point, a, b)) return true;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) result = !result;
  }
  return result;
}
function segmentThroughInterior(a, b, bounds) {
  let lo = 0, hi = 1;
  for (const [start, delta, minimum, maximum] of [[a.x, b.x - a.x, bounds.left + EPS, bounds.right - EPS],
    [a.y, b.y - a.y, bounds.top + EPS, bounds.bottom - EPS]]) {
    if (Math.abs(delta) < EPS) { if (start < minimum || start > maximum) return false; }
    else {
      const t1 = (minimum - start) / delta, t2 = (maximum - start) / delta;
      lo = Math.max(lo, Math.min(t1, t2)); hi = Math.min(hi, Math.max(t1, t2));
      if (lo > hi) return false;
    }
  }
  return lo <= hi;
}
function rectangleInside(bounds, polygon) {
  if (![{ x: bounds.left, y: bounds.top }, { x: bounds.right, y: bounds.top },
    { x: bounds.right, y: bounds.bottom }, { x: bounds.left, y: bounds.bottom }].every(point => inside(point, polygon))) return false;
  return !polygon.some((point, index) => segmentThroughInterior(point, polygon[(index + 1) % polygon.length], bounds));
}
const bodyAt = (x, feet, options) => ({ left: x - options.playerWidth / 2, right: x + options.playerWidth / 2,
  top: feet - options.playerHeight, bottom: feet });
function floorCovers(platforms, landing) {
  const intervals = platforms.filter(p => Math.abs(p.bounds.top - landing.bottom) < EPS)
    .map(p => [Math.max(p.bounds.left, landing.left), Math.min(p.bounds.right, landing.right)])
    .filter(([a, b]) => b - a > EPS).sort((a, b) => a[0] - b[0]);
  let cursor = landing.left;
  for (const [left, right] of intervals) {
    if (left > cursor + EPS) return false;
    cursor = Math.max(cursor, right);
    if (cursor >= landing.right - EPS) return true;
  }
  return false;
}
function roomData(document) {
  return document.world.rooms.map(room => {
    const shape = document.items.find(item => item.id === room.shapeItemId);
    const items = document.items.filter(item => key(item.blocking?.roomId) === key(room.id));
    const platforms = items.filter(item => item.kind === "platform").map(item => ({ item, bounds: rectangle(item), oneWay: item.platformMode === "oneway" }));
    return { room, shape, items, platforms,
      polygon: shape ? getItemPolygonPixels(shape).map(p => ({ x: p.x / 32, y: p.y / 32 })) : [],
      solids: platforms.filter(item => !item.oneWay), oneWays: platforms.filter(item => item.oneWay),
      hazards: items.filter(item => item.kind === "hazard").map(item => ({ item, bounds: rectangle(item) })),
      secrets: items.filter(item => item.kind === "secret").map(item => ({ item, bounds: rectangle(item) })),
    };
  });
}

function portalRecords(data, options, errors, warnings) {
  const records = [];
  for (const room of data) {
    if (!room.shape) continue;
    for (let index = 0; index < room.polygon.length; index++) {
      const binding = room.shape.sideTransitions?.[index];
      if (!binding) continue;
      const a = room.polygon[index], b = room.polygon[(index + 1) % room.polygon.length];
      const endpoint = room.room[binding.kind === "entrance" ? "entrances" : "exits"].find(value => key(value.id) === key(binding.endpointId));
      const base = { roomId: room.room.id, roomName: room.room.name, endpointId: binding.endpointId, endpointName: endpoint?.name, kind: binding.kind };
      if (Math.abs(a.x - b.x) > EPS) {
        warnings.push({ scope: "portal", message: "Horizontal/sloped portal has no automatic landing audit.", ...base }); continue;
      }
      const centerY = (a.y + b.y) / 2;
      const rightInside = inside({ x: a.x + .05, y: centerY }, room.polygon);
      const landing = { left: rightInside ? a.x : a.x - options.portalLandingCells,
        right: rightInside ? a.x + options.portalLandingCells : a.x,
        top: Math.min(a.y, b.y), bottom: Math.max(a.y, b.y) };
      const floor = floorCovers(room.platforms, landing);
      const blockedBy = [...room.solids, ...room.hazards].filter(p => overlap(p.bounds, landing)).map(p => p.item.id);
      const closedSecretWalls = room.secrets.filter(p => overlap(p.bounds, landing)).map(p => p.item.id);
      const clear = blockedBy.length === 0 && rectangleInside(landing, room.polygon);
      const record = { ...base, landing, anchor: { x: (landing.left + landing.right) / 2, feet: landing.bottom }, floor, clear, blockedBy, closedSecretWalls };
      records.push(record);
      if (closedSecretWalls.length) warnings.push({ scope: "secret-portal", message: "Portal is intentionally obstructed while its secret wall remains closed.", ...base, closedSecretWalls });
      if (!floor) errors.push({ scope: "portal-floor", message: "Portal lacks four-cell support at its lower edge (solid or OneWay).", ...base });
      if (!clear) errors.push({ scope: "portal-clearance", message: "Portal landing is blocked or extends outside its room.", ...base, blockedBy });
      if (landing.bottom - landing.top < options.playerHeight - EPS)
        errors.push({ scope: "portal-clearance", message: "Portal is lower than the provisional player body.", ...base });
    }
    for (const marker of room.items.filter(item => item.transition)) {
      const bounds = rectangle(marker);
      records.push({ roomId: room.room.id, roomName: room.room.name, endpointId: marker.transition.endpointId,
        endpointName: marker.label, kind: marker.transition.kind, markerId: marker.id,
        anchor: { x: (bounds.left + bounds.right) / 2, feet: bounds.bottom } });
    }
  }
  return records;
}

function safeBody(room, bounds, obstacles) {
  return !obstacles.some(obstacle => overlap(bounds, obstacle.bounds)) && rectangleInside(bounds, room.polygon);
}
function standingGroups(room, obstacles, options) {
  const result = [];
  for (const platform of room.platforms) {
    const left = platform.bounds.left + options.playerWidth / 2, right = platform.bounds.right - options.playerWidth / 2;
    if (right < left - EPS) continue;
    const samples = [];
    for (let x = left; x < right - EPS; x += options.sampleSpacing) samples.push(x);
    samples.push(right);
    let current = null;
    for (const x of samples) {
      if (!safeBody(room, bodyAt(x, platform.bounds.top, options), obstacles)) { current = null; continue; }
      if (!current) { current = { room, platform, y: platform.bounds.top, xs: [] }; result.push(current); }
      current.xs.push(x);
    }
  }
  return result;
}
const groupLeft = group => group.xs[0];
const groupRight = group => group.xs[group.xs.length - 1];
function candidateAnchors(group, other) {
  const desired = [groupLeft(group), groupRight(group), (groupLeft(group) + groupRight(group)) / 2,
    groupLeft(other), groupRight(other), (groupLeft(other) + groupRight(other)) / 2];
  return [...new Set(desired.map(x => group.xs.reduce((best, current) => Math.abs(current - x) < Math.abs(best - x) ? current : best, group.xs[0])))];
}
function trajectoryClear(from, to, x0, x1, obstacles, options, walking = false, jumpHeight = options.maxJumpHeight) {
  const dy = to.y - from.y;
  if (!walking && dy < -jumpHeight - EPS) return false;
  const initialVelocity = 2 * Math.sqrt(options.maxJumpHeight * jumpHeight);
  const time = walking ? 1 : (initialVelocity + Math.sqrt(Math.max(0, initialVelocity ** 2 + 4 * options.maxJumpHeight * dy))) / (2 * options.maxJumpHeight);
  if (!walking && Math.abs(x1 - x0) > options.horizontalSpeed * time + EPS) return false;
  const maxDrop = Math.max(Math.abs(dy), options.maxJumpHeight);
  const steps = Math.max(12, Math.ceil((Math.abs(x1 - x0) + maxDrop * 2) / options.trajectoryStep));
  if (steps > 2048) return false;
  const arcBounds = { left: Math.min(x0, x1) - options.playerWidth / 2, right: Math.max(x0, x1) + options.playerWidth / 2,
    top: Math.min(from.y, to.y) - (walking ? 0 : jumpHeight) - options.playerHeight, bottom: Math.max(from.y, to.y) };
  const nearby = obstacles.filter(obstacle => overlap(obstacle.bounds, arcBounds));
  const oneWays = from.room.oneWays.filter(platform => overlap(platform.bounds, { ...arcBounds, bottom: arcBounds.bottom + EPS * 2 }));
  let previousFeet = from.y;
  for (let index = 1; index <= steps; index++) {
    const fraction = index / steps, t = time * fraction;
    const x = x0 + (x1 - x0) * fraction;
    const feet = walking ? from.y : from.y + options.maxJumpHeight * t * t - initialVelocity * t;
    const bounds = bodyAt(x, feet, options);
    if (!safeBody(from.room, bounds, nearby)) return false;
    if (walking && !floorCovers(from.room.platforms, bounds)) return false;
    if (!walking && feet > previousFeet + EPS && index < steps) {
      for (const platform of oneWays) {
        const top = platform.bounds.top;
        if (previousFeet <= top + EPS && feet > top + EPS && bounds.right > platform.bounds.left + EPS && bounds.left < platform.bounds.right - EPS)
          return false; // This arc lands earlier; its earlier support is explored as a separate graph node.
      }
    }
    previousFeet = feet;
  }
  return true;
}
function canTravel(from, to, obstacles, options) {
  const dy = to.y - from.y;
  if (dy < -options.maxJumpHeight - EPS) return false;
  const flightTime = 1 + Math.sqrt(Math.max(0, 1 + dy / options.maxJumpHeight));
  const separation = Math.max(0, groupLeft(from) - groupRight(to), groupLeft(to) - groupRight(from));
  if (separation > options.horizontalSpeed * flightTime + EPS) return false;
  const a = candidateAnchors(from, to), b = candidateAnchors(to, from);
  const pairs = a.flatMap(x0 => b.map(x1 => [x0, x1])).sort((p, q) => Math.abs(p[1] - p[0]) - Math.abs(q[1] - q[0]));
  if (Math.abs(dy) < EPS) for (const [x0, x1] of pairs)
    if (trajectoryClear(from, to, x0, x1, obstacles, options, true)) return true;
  const heights = [...new Set([...Array.from({ length: 8 }, (_, index) => options.maxJumpHeight * (8 - index) / 8),
    .1, Math.max(.1, -dy + .1)])].filter(height => height <= options.maxJumpHeight && height >= -dy - EPS);
  for (const height of heights) for (const [x0, x1] of pairs)
    if (trajectoryClear(from, to, x0, x1, obstacles, options, false, height)) return true;
  // The best take-off can be one cell back from a spike edge, not at an interval endpoint.
  // Exhaust the bounded local samples before calling a route unconfirmed.
  const range = options.horizontalSpeed * flightTime;
  const checked = new Set(pairs.map(pair => pair.join(":")));
  for (const x0 of from.xs) for (const x1 of to.xs) {
    if (Math.abs(x1 - x0) > range + EPS || checked.has(`${x0}:${x1}`)) continue;
    for (const height of heights) if (trajectoryClear(from, to, x0, x1, obstacles, options, false, height)) return true;
  }
  return false;
}

function provisionalSimulation(document, data, portals, options, secretsOpen, startOverride) {
  const obstacles = new Map(data.map(room => [room.room.id, [...room.solids, ...room.hazards, ...(secretsOpen ? [] : room.secrets)]]));
  const groups = data.flatMap(room => standingGroups(room, obstacles.get(room.room.id), options));
  groups.forEach((group, index) => { group.id = index; });
  const byRoom = new Map(data.map(room => [room.room.id, groups.filter(group => group.room === room)]));
  const anchors = new Map();
  for (const portal of portals) {
    const found = (!secretsOpen && portal.closedSecretWalls?.length ? [] : byRoom.get(portal.roomId) ?? []).filter(group => Math.abs(group.y - portal.anchor.feet) < EPS
      && portal.anchor.x >= groupLeft(group) - EPS && portal.anchor.x <= groupRight(group) + EPS);
    anchors.set(`${key(portal.roomId)}:${key(portal.endpointId)}`, found);
  }
  const external = new Map(groups.map(group => [group.id, new Set()]));
  const abilities = new Set(options.abilities);
  for (const room of document.world.rooms) for (const exit of room.exits) {
    const link = exit.connection;
    if (!link.enabled || link.requiredAbilities.some(ability => !abilities.has(ability)) || link.requiredTags.length || link.blockedTags.length) continue;
    const from = anchors.get(`${key(room.id)}:${key(exit.id)}`) ?? [];
    const to = anchors.get(`${key(link.targetRoomId)}:${key(link.targetEntranceId)}`) ?? [];
    for (const a of from) for (const b of to) { external.get(a.id).add(b.id); external.get(b.id).add(a.id); }
  }
  const start = startOverride ?? document.world.start;
  let startGroups = start ? anchors.get(`${key(start.roomId)}:${key(start.entranceId)}`) ?? [] : [];
  if (options.startItemId) {
    const marker = document.items.find(item => item.id === options.startItemId);
    const bounds = marker && rectangle(marker);
    const center = bounds && (bounds.left + bounds.right) / 2;
    startGroups = marker ? groups.filter(group => key(group.room.room.id) === key(marker.blocking?.roomId)
      && Math.abs(group.y - bounds.bottom) < EPS && center >= groupLeft(group) - EPS && center <= groupRight(group) + EPS) : [];
  }
  const queue = [...startGroups], reached = new Set();
  let testedArcs = 0;
  for (let index = 0; index < queue.length; index++) {
    const from = queue[index];
    if (reached.has(from.id)) continue;
    reached.add(from.id);
    for (const id of external.get(from.id)) if (!reached.has(id)) queue.push(groups[id]);
    for (const to of byRoom.get(from.room.room.id)) {
      if (reached.has(to.id) || from.id === to.id) continue;
      testedArcs++;
      if (canTravel(from, to, obstacles.get(from.room.room.id), options)) queue.push(to);
    }
  }
  const rooms = data.map(room => {
    const all = byRoom.get(room.room.id), reachedGroups = all.filter(group => reached.has(group.id));
    const reachedPlatforms = new Set(reachedGroups.map(group => group.platform.item.id));
    return { roomId: room.room.id, name: room.room.name, standingGroups: all.length, reachedGroups: reachedGroups.length,
      totalPlatforms: room.platforms.length, reachedPlatforms: reachedPlatforms.size,
      unreachablePlatforms: room.platforms.filter(platform => !reachedPlatforms.has(platform.item.id)).map(platform => ({
        id: platform.item.id, label: platform.item.label, localCells: { x: platform.bounds.left - room.shape.x / 32,
          y: platform.bounds.top - room.shape.y / 32, w: platform.item.w }, oneWay: platform.oneWay,
        safeStandingSamples: all.filter(group => group.platform === platform).reduce((sum, group) => sum + group.xs.length, 0),
      })),
      endpoints: portals.filter(portal => portal.roomId === room.room.id).map(portal => {
        const found = anchors.get(`${key(portal.roomId)}:${key(portal.endpointId)}`) ?? [];
        return { id: portal.endpointId, name: portal.endpointName, anchored: found.length > 0, reached: found.some(group => reached.has(group.id)) };
      }),
      targets: room.items.filter(item => ["goal", "loot", "checkpoint"].includes(item.kind)).map(item => {
        const bounds = rectangle(item), x = (bounds.left + bounds.right) / 2;
        const found = all.filter(group => Math.abs(group.y - bounds.bottom) < EPS && x >= groupLeft(group) - EPS && x <= groupRight(group) + EPS);
        return { id: item.id, kind: item.kind, name: item.label, anchored: found.length > 0, reached: found.some(group => reached.has(group.id)) };
      }),
    };
  });
  return { secretsOpen, startAnchored: startGroups.length > 0, totalStandingGroups: groups.length, reachedGroups: reached.size,
    testedArcs, rooms };
}

export function checkPlatforming(input, suppliedOptions = {}) {
  const options = { playerWidth: 1, playerHeight: 2, maxJumpHeight: 3.2, maxFlatDistance: 7,
    sampleSpacing: .5, trajectoryStep: .12, portalLandingCells: 4, abilities: [], simulate: true, independentRoomEntries: true, ...suppliedOptions };
  options.horizontalSpeed ??= options.maxFlatDistance / 2; // Normalized full-height jump lasts two time units.
  const official = validateDocument(input);
  const report = { ok: false, options, officialValidation: { ok: official.ok, errors: official.errors.length, warnings: official.warnings.length },
    errors: [...official.errors], warnings: [], portalChecks: [], simulations: [], roomEntryChecks: [],
    limitations: ["Provisional authoring metrics, not measured game movement or a runtime physics test.",
      "Sampled standing centers and ballistic arcs may miss valid edge jumps or special traversal; unconfirmed reachability is a review item.",
      "Assumes a controllable shorter jump as well as the maximum-height jump, with a fixed horizontal speed cap; actual input/air-control rules are unknown.",
      "Hazards use their full rectangular bounds. OneWay passes upward and catches downward. Secret-wall opening is a separate optional scenario.",
      "No dash motion, wall grab, double jump, ladders, moving platforms, crumble timing, combat, or reward acquisition is simulated.",
      "Tag-gated transitions are excluded. Abilities only permit graph links; they do not alter the jump trajectory."] };
  for (const name of ["playerWidth", "playerHeight", "maxJumpHeight", "maxFlatDistance", "horizontalSpeed", "sampleSpacing", "trajectoryStep", "portalLandingCells"])
    if (!Number.isFinite(options[name]) || options[name] <= 0)
      report.errors.push({ scope: "probe-settings", message: `${name} must be a finite positive number.` });
  if (!official.document) return report;
  const document = official.document, data = roomData(document);
  for (const room of data) {
    for (const platform of room.platforms) if (platform.item.polygonPoints)
      report.errors.push({ scope: "probe-geometry", roomId: room.room.id, itemId: platform.item.id, message: "This layout probe supports rectangular platforms only." });
    for (const hazard of room.hazards) for (const platform of room.platforms) if (overlap(hazard.bounds, platform.bounds))
      report.errors.push({ scope: "hazard-overlap", roomId: room.room.id, roomName: room.room.name, hazardId: hazard.item.id, platformId: platform.item.id,
        message: "Hazard overlaps platform interior; boundary contact is allowed." });
  }
  report.portalChecks = portalRecords(data, options, report.errors, report.warnings);
  const estimatedSamples = data.reduce((sum, room) => sum + room.platforms.reduce((count, platform) => count + Math.max(1, platform.item.w / options.sampleSpacing), 0), 0);
  if (estimatedSamples > 50000 || data.some(room => room.platforms.length > 300))
    report.errors.push({ scope: "probe-budget", message: "Drawing exceeds this bounded audit's sample budget (50000 standing samples or 300 platforms in one room)." });
  if (options.simulate && !report.errors.length) {
    for (const open of [false, true]) report.simulations.push(provisionalSimulation(document, data, report.portalChecks, options, open));
    if (options.independentRoomEntries) for (const room of data) {
      const entrance = room.room.entrances[0];
      if (!entrance) continue;
      for (const open of [false, true]) {
        const simulation = provisionalSimulation(document, [room], report.portalChecks.filter(portal => portal.roomId === room.room.id), options, open,
          { roomId: room.room.id, entranceId: entrance.id });
        report.roomEntryChecks.push({ secretsOpen: open, startAnchored: simulation.startAnchored, ...simulation.rooms[0] });
      }
    }
  }
  report.ok = report.errors.length === 0;
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2] ?? new URL("../Ржавый водосброс — полный проект.json", import.meta.url);
  const report = checkPlatforming(JSON.parse(await readFile(file, "utf8")));
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}
