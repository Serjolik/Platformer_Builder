/** Standalone authoring tools. Uses the application's actual parsers; never edits the source. */
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const projectRoot = new URL("../../../", import.meta.url);
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText).toString("base64")}`;
const readSource = name => readFile(new URL(`app/${name}.ts`, projectRoot), "utf8");
const worldUrl = moduleUrl(await readSource("world-model"));
const blockingUrl = moduleUrl(await readSource("blocking-model"));
const transitionsUrl = moduleUrl(await readSource("room-transitions"));
const documentUrl = moduleUrl((await readSource("map-document"))
  .replace('"./world-model"', JSON.stringify(worldUrl))
  .replace('"./blocking-model"', JSON.stringify(blockingUrl))
  .replace('"./room-transitions"', JSON.stringify(transitionsUrl)));

export const worldModel = await import(worldUrl);
export const blockingModel = await import(blockingUrl);
export const roomTransitions = await import(transitionsUrl);
export const mapDocument = await import(documentUrl);
export const { normalizeDocument, emptyDocument, CELL, defaultLayers } = mapDocument;
export const { createWorld, createRegion, createRoom, createEntrance, createExit, connectExit, validateWorld } = worldModel;
export const { prepareBlocking, getItemPolygonPixels, polygonContainsPolygon, isSimplePolygon, createBlockingSettings, defaultItemBlockingMode } = blockingModel;

/** Compatible with both namespace imports and the application's named factory functions. */
export async function loadOfficialModel() {
  return { mapDocument, worldModel, blockingModel, roomTransitions,
    ...mapDocument, ...worldModel, ...blockingModel, ...roomTransitions };
}

const key = value => typeof value === "string" ? value.toLowerCase() : value;
const countBy = (values, getKey) => values.reduce((result, value) => {
  const name = getKey(value);
  result[name] = (result[name] ?? 0) + 1;
  return result;
}, {});
const annotationKinds = new Set(["note", "comment"]);
const nonPhysicalKinds = new Set(["note", "comment", "transition"]);

/** World links are bidirectional. This is structural reachability, deliberately ignoring gates. */
function reachableRoomIds(world) {
  const rooms = new Map(world.rooms.map(room => [key(room.id), room]));
  const adjacency = new Map(world.rooms.map(room => [key(room.id), new Set()]));
  for (const room of world.rooms) for (const exit of room.exits) {
    const connection = exit.connection;
    if (!connection.enabled || !rooms.has(key(connection.targetRoomId))) continue;
    const target = rooms.get(key(connection.targetRoomId));
    if (!target.entrances.some(entrance => key(entrance.id) === key(connection.targetEntranceId))) continue;
    adjacency.get(key(room.id)).add(key(target.id));
    adjacency.get(key(target.id)).add(key(room.id));
  }
  const startRoom = world.start && rooms.get(key(world.start.roomId));
  const visited = new Set();
  if (!startRoom || !startRoom.entrances.some(entrance => key(entrance.id) === key(world.start.entranceId))) return visited;
  const queue = [key(startRoom.id)];
  for (let index = 0; index < queue.length; index++) {
    const roomId = queue[index];
    if (visited.has(roomId)) continue;
    visited.add(roomId);
    for (const next of adjacency.get(roomId)) if (!visited.has(next)) queue.push(next);
  }
  return visited;
}

export function describeDocument(document) {
  const { world, items, paths } = document;
  const exits = world.rooms.flatMap(room => room.exits);
  const reachable = reachableRoomIds(world);
  return {
    name: document.name, version: document.version, grid: document.grid,
    regions: world.regions.length, rooms: world.rooms.length, items: items.length,
    paths: paths.length, railPaths: paths.filter(path => path.pathMode === "rail").length,
    layers: document.layers.map(layer => ({ ...layer, itemCount: items.filter(item => item.layerId === layer.id).length })),
    kinds: countBy(items, item => item.kind),
    entrances: world.rooms.reduce((sum, room) => sum + room.entrances.length, 0), exits: exits.length,
    enabledConnections: exits.filter(exit => exit.connection.enabled).length,
    gatedConnections: exits.filter(exit => exit.connection.enabled && (exit.connection.requiredTags.length
      || exit.connection.blockedTags.length || exit.connection.requiredAbilities.length)).length,
    hasStart: world.start !== null, reachableRoomsIgnoringGates: reachable.size,
    explicitOwnerships: items.filter(item => item.blocking?.roomId).length,
    blockingModes: countBy(items, item => item.blocking?.mode ?? "none"),
    boundMarkers: items.filter(item => item.transition).length,
    boundSides: items.reduce((sum, item) => sum + (item.sideTransitions?.filter(Boolean).length ?? 0), 0),
    roomDetails: world.rooms.map(room => {
      const shape = items.find(item => item.id === room.shapeItemId);
      return { id: room.id, name: room.name, type: room.roomType, status: room.status,
        shapeItemId: room.shapeItemId ?? null, sizeCells: shape ? { x: shape.w, y: shape.h } : null,
        vertices: shape ? getItemPolygonPixels(shape).length : 0,
        doorSides: shape?.sideTypes?.filter(type => type === "door" || type === "opening").length ?? 0,
        ownedItems: items.filter(item => key(item.blocking?.roomId) === key(room.id)).length,
        entrances: room.entrances.length, exits: room.exits.length,
        enabledExits: room.exits.filter(exit => exit.connection.enabled).length,
        reachableIgnoringGates: reachable.has(key(room.id)) };
    }),
  };
}

/**
 * Validate a generated full v2 authoring project without changing it or minting identities.
 * Relax ownership/shape requirements for an audit of a legacy draft. Annotation overlap is allowed.
 * Blocking preparation runs on an enabled clone only; it never changes the saved toggle or bindings.
 */
export function validateDocument(input, options = {}) {
  const settings = { requireCompleteWorld: true, requireRoomShapes: true,
    requireOwnedPhysicalItems: true, requireContainment: true, ...options };
  const errors = [], warnings = [];
  const issue = (severity, scope, message, fields = {}) => {
    (severity === "error" ? errors : warnings).push({ severity, scope, message, ...fields });
  };
  if (input?.version !== 2) {
    issue("error", "parser", "Expected a full authoring project, version 2. Legacy migration and partial engine files are not accepted by this authoring validator.");
    return { ok: false, document: null, errors, warnings, stats: null, blocking: null };
  }
  let document;
  try { document = normalizeDocument(input); }
  catch (error) {
    issue("error", "parser", error instanceof Error ? error.message : String(error));
    return { ok: false, document: null, errors, warnings, stats: null, blocking: null };
  }
  for (const problem of validateWorld(document.world)) issue(problem.severity, "world", problem.message, problem);
  const rooms = new Map(document.world.rooms.map(room => [key(room.id), room]));
  const items = new Map(document.items.map(item => [item.id, item]));
  const roomByShape = new Map();
  const shapes = new Map();
  for (const room of document.world.rooms) {
    const shape = items.get(room.shapeItemId);
    if (!shape || shape.kind !== "room") {
      issue(settings.requireRoomShapes ? "error" : "warning", "room-shape", "Room has no existing main room contour.", { roomId: room.id });
      continue;
    }
    roomByShape.set(shape.id, room);
    shapes.set(key(room.id), shape);
    if (shape.blocking?.roomId && key(shape.blocking.roomId) !== key(room.id))
      issue("error", "ownership", "Main contour is explicitly owned by another room.", { roomId: room.id, itemId: shape.id });
  }
  if (settings.requireCompleteWorld && document.world.rooms.length) {
    if (!document.world.start) issue("error", "world-completeness", "The authored world requires an explicit GameStart entrance.");
    const reachable = reachableRoomIds(document.world);
    for (const room of document.world.rooms) if (!reachable.has(key(room.id)))
      issue("error", "world-completeness", "Room is unreachable from GameStart even when gates are ignored.", { roomId: room.id });
  }
  for (const item of document.items) {
    const polygon = getItemPolygonPixels(item);
    const fields = { itemId: item.id };
    if ((item.kind === "room" || item.kind === "liquid" || item.polygonPoints) && !isSimplePolygon(polygon))
      issue("error", "geometry", "Contour is not a simple, nondegenerate polygon.", fields);
    if (item.sideTypes && item.sideTypes.length !== polygon.length)
      issue("error", "geometry", "sideTypes count must equal the number of contour vertices.", fields);
    if (item.polygonPoints) {
      const xs = item.polygonPoints.map(point => point.x), ys = item.polygonPoints.map(point => point.y);
      if (Math.abs(Math.min(...xs)) > 1e-6 || Math.abs(Math.min(...ys)) > 1e-6
        || Math.abs(Math.max(...xs) - item.w * document.grid) > 1e-6
        || Math.abs(Math.max(...ys) - item.h * document.grid) > 1e-6)
        issue("error", "render-bounds", "Local polygon bounds must match (0,0) to (w*32,h*32) for consistent selection and resizing.", fields);
      if (item.kind !== "room" && item.kind !== "liquid")
        issue("warning", "render-bounds", "Only room and liquid primitives render polygonPoints as a polygon in the constructor.", fields);
    }
    const ownerId = item.blocking?.roomId;
    const owner = ownerId ? rooms.get(key(ownerId)) : roomByShape.get(item.id);
    if (ownerId && !owner) issue("error", "ownership", "Explicit owning room does not exist.", fields);
    if (!owner && !ownerId && !nonPhysicalKinds.has(item.kind))
      issue(settings.requireOwnedPhysicalItems ? "error" : "warning", "ownership", "Physical/gameplay drawing has no explicit room ownership.", fields);
    if (owner && !annotationKinds.has(item.kind) && settings.requireContainment) {
      const outline = shapes.get(key(owner.id));
      if (outline && outline.id !== item.id && !polygonContainsPolygon(getItemPolygonPixels(outline), polygon))
        issue("error", "containment", "Owned object extends beyond its room contour.", { ...fields, roomId: owner.id });
    }
  }
  const physicalDocument = structuredClone(document);
  physicalDocument.blocking = { ...(document.blocking ?? createBlockingSettings()), enabled: true };
  const blocking = prepareBlocking(physicalDocument);
  for (const problem of blocking.issues) issue(problem.severity, "blocking", problem.message, problem);
  const stats = describeDocument(document);
  stats.preparedGeometry = blocking.objects.length;
  stats.preparedEntities = blocking.entities.length;
  return { ok: errors.length === 0, document, errors, warnings, stats, blocking };
}

export const validateProject = validateDocument;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.argv[2]) {
  const input = JSON.parse(await readFile(process.argv[2], "utf8"));
  const legacy = process.argv.includes("--allow-legacy");
  const report = validateDocument(input, legacy ? { requireCompleteWorld: false, requireRoomShapes: false,
    requireOwnedPhysicalItems: false, requireContainment: false } : {});
  const { document: _document, blocking: _blocking, ...summary } = report;
  console.log(JSON.stringify(summary, null, 2));
  if (!report.ok) process.exitCode = 1;
}
