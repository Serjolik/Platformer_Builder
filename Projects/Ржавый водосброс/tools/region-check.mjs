/** Bounded read-only geometry audit. This is not a gameplay movement simulator. */
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { mapDocument, validateDocument, getItemPolygonPixels, polygonContainsPolygon } from "../../Затихший узел/tools/model-tools.mjs";
import { checkPlatforming } from "./platforming-check.mjs";

const C = 32, EPS = 1e-6;
const key = value => value?.toLowerCase();
const bounds = item => ({ x: item.x, y: item.y, width: item.w * C, height: item.h * C });
const right = box => box.x + box.width;
const bottom = box => box.y + box.height;
const overlap = (a, b) => Math.min(right(a), right(b)) - Math.max(a.x, b.x) > EPS && Math.min(bottom(a), bottom(b)) - Math.max(a.y, b.y) > EPS;
const polygon = box => [{ x: box.x, y: box.y }, { x: right(box), y: box.y }, { x: right(box), y: bottom(box) }, { x: box.x, y: bottom(box) }];
const union = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.max(right(a), right(b)) - Math.min(a.x, b.x), height: Math.max(bottom(a), bottom(b)) - Math.min(a.y, b.y) });
const body = (centerX, feet) => ({ x: centerX - C / 2, y: feet - 2 * C, width: C, height: 2 * C });
const local = (box, shape) => ({ x: (box.x - shape.x) / C, y: (box.y - shape.y) / C, w: box.width / C, h: box.height / C });
const summary = item => ({ id: item.id, kind: item.kind, label: item.label });
function coveredFloor(platforms, box) {
  const segments = platforms.filter(item => Math.abs(item.y - bottom(box)) < EPS)
    .map(item => [Math.max(item.x, box.x), Math.min(item.x + item.w * C, right(box))]).filter(([a, b]) => b - a > EPS).sort((a, b) => a[0] - b[0]);
  let cursor = box.x;
  for (const [a, b] of segments) { if (a > cursor + EPS) return false; cursor = Math.max(cursor, b); }
  return cursor >= right(box) - EPS;
}

export function checkRegion(input) {
  const official = validateDocument(input);
  const report = { ok: false, errors: [...official.errors], warnings: [], stats: official.stats, portalChecks: [], movingChecks: [], actorChecks: [], ladderChecks: [], secretChecks: [], connections: [],
    limitations: [
      "Static authoring audit only; no live engine, movement timing, combat, animation or Blueprint behavior was tested.",
      "Standing rider is a provisional 1x2-cell rectangle. A central standing position is checked throughout each straight platform route; arbitrary rider positions are not certified.",
      "Dock candidates use physical bounds, maximum 3.2-cell height change and a 4-cell horizontal gap. Clear approach bounds identify boarding opportunities, not successful timed jumps.",
      "Moving-platform sweep intersections are conservative: overlapping routes would need timing verification. OneWay crossings are reported separately because collision behavior is not specified.",
      "Secret-wall end contacts are inspected geometrically; no closed/open gameplay reachability or gravity-based bypass proof is performed.",
      "Room graph reachability ignores gates. No whole-region platforming trajectory graph is claimed for moving-platform and ladder routes.",
    ] };
  if (!official.document) return report;
  const doc = official.document;
  const staticChecks = checkPlatforming(doc, { simulate: false });
  report.errors = staticChecks.errors;
  report.warnings = staticChecks.warnings;
  report.portalChecks = staticChecks.portalChecks;
  for (const room of doc.world.rooms) {
    const shape = doc.items.find(item => item.id === room.shapeItemId);
    if (!shape) continue;
    const contour = getItemPolygonPixels(shape);
    const items = doc.items.filter(item => key(item.blocking?.roomId) === key(room.id));
    const platforms = items.filter(item => item.kind === "platform");
    const solids = platforms.filter(item => item.platformMode !== "oneway");
    const hazards = items.filter(item => item.kind === "hazard");
    const secrets = items.filter(item => item.kind === "secret");
    const movers = items.filter(item => item.kind === "moving");
    const obstacles = [...solids, ...hazards, ...secrets];
    const collisionIds = (box, source = obstacles) => source.filter(item => overlap(box, bounds(item))).map(item => item.id);
    const within = box => polygonContainsPolygon(contour, polygon(box));
    const fail = (scope, message, itemId, extra = {}) => report.errors.push({ scope, roomId: room.id, roomName: room.name, itemId, message, ...extra });
    for (const actor of items.filter(item => ["enemy", "boss", "loot", "checkpoint", "goal", "player"].includes(item.kind))) {
      const box = bounds(actor), standing = body(box.x + box.width / 2, bottom(box));
      const support = coveredFloor(platforms, box);
      const collisions = collisionIds(box);
      const riderCollisions = collisionIds(standing);
      report.actorChecks.push({ roomId: room.id, ...summary(actor), localCells: local(box, shape), supported: support, collisions, standingPlayerClear: !riderCollisions.length && within(standing) });
      if (!support) fail("actor-support", "Actor footprint has no continuous fixed/OneWay floor at its bottom.", actor.id);
      if (collisions.length) fail("actor-overlap", "Actor intersects a fixed block, hazard or closed secret wall.", actor.id, { collisions });
      if (riderCollisions.length || !within(standing)) fail("actor-approach", "Provisional standing player does not fit at actor center.", actor.id, { collisions: riderCollisions });
    }
    for (const mover of movers) {
      const layout = mapDocument.getMovingPlatformLayout(mover);
      const topA = layout.start.y - layout.platformBounds.height / 2, topB = layout.end.y - layout.platformBounds.height / 2;
      const riderSweep = union(body(layout.start.x, topA), body(layout.end.x, topB));
      const collision = collisionIds(layout.sweptBounds);
      const oneWayCrossings = platforms.filter(item => item.platformMode === "oneway" && overlap(layout.sweptBounds, bounds(item))).map(item => item.id);
      const otherMoving = movers.filter(item => item.id !== mover.id && overlap(layout.sweptBounds, mapDocument.getMovingPlatformLayout(item).sweptBounds)).map(item => item.id);
      const riderCollisions = collisionIds(riderSweep);
      const record = { roomId: room.id, roomName: room.name, ...summary(mover), startCells: { x: (layout.start.x - shape.x) / C, y: (layout.start.y - shape.y) / C }, endCells: { x: (layout.end.x - shape.x) / C, y: (layout.end.y - shape.y) / C },
        footprintCells: { w: layout.widthCells, h: layout.heightCells }, sweepCells: local(layout.sweptBounds, shape), riderSweepCells: local(riderSweep, shape), contained: within(layout.sweptBounds), collisions: collision, oneWayCrossings, otherMoving, riderContained: within(riderSweep), riderCollisions, dockCandidates: [] };
      if (!record.contained || collision.length || otherMoving.length) fail("moving-sweep", "Moving platform sweep leaves its room or intersects fixed geometry, hazards, secret walls or another sweep.", mover.id, { collisions: [...collision, ...otherMoving] });
      if (!record.riderContained || riderCollisions.length) fail("moving-rider", "Central 1x2 standing rider is obstructed along the platform route.", mover.id, { collisions: riderCollisions });
      if (oneWayCrossings.length) report.warnings.push({ scope: "moving-oneway", roomId: room.id, itemId: mover.id, collisions: oneWayCrossings, message: "Moving footprint crosses OneWay; interaction needs an explicit gameplay rule." });
      for (const dock of platforms) {
        const db = bounds(dock);
        const vertical = mover.trackOrientation === "vertical";
        const feet = vertical ? Math.max(topA, Math.min(topB, db.y)) : topA;
        const platformX = vertical ? layout.start.x : Math.max(layout.start.x, Math.min(layout.end.x, db.x + db.width / 2));
        const platform = { x: platformX - layout.platformBounds.width / 2, y: feet, width: layout.platformBounds.width, height: layout.platformBounds.height };
        const gap = Math.max(0, db.x - right(platform), platform.x - right(db));
        if (gap > 4 * C + EPS || Math.abs(feet - db.y) > 3.2 * C + EPS) continue;
        const dockX = Math.max(db.x + C / 2, Math.min(right(db) - C / 2, platformX));
        const platformStandingX = Math.max(platform.x + C / 2, Math.min(right(platform) - C / 2, dockX));
        const approach = union(body(dockX, db.y), body(platformStandingX, feet));
        const blockedBy = collisionIds(approach, obstacles.filter(item => item.id !== dock.id));
        record.dockCandidates.push({ platformId: dock.id, platformLabel: dock.label, floorCells: local({ ...db, height: 0 }, shape), horizontalGapCells: gap / C, heightDifferenceCells: (db.y - feet) / C,
          approachCells: local(approach, shape), approachClear: !blockedBy.length && within(approach), blockedBy });
      }
      if (!record.dockCandidates.some(dock => dock.approachClear)) fail("moving-boarding", "No bounded clear boarding approach was found on a real support.", mover.id);
      report.movingChecks.push(record);
    }
    for (const ladder of items.filter(item => item.kind === "ladder")) {
      const box = bounds(ladder), riderSweep = { x: box.x + box.width / 2 - C / 2, y: box.y - 2 * C, width: C, height: box.height + 2 * C };
      const collisions = collisionIds(box), riderCollisions = collisionIds(riderSweep);
      report.ladderChecks.push({ roomId: room.id, ...summary(ladder), localCells: local(box, shape), collisions, riderCollisions, riderContained: within(riderSweep) });
      if (collisions.length || riderCollisions.length || !within(riderSweep)) fail("ladder-clearance", "Ladder body or central climbing player intersects fixed geometry/hazards or leaves the room.", ladder.id, { collisions: [...new Set([...collisions, ...riderCollisions])] });
    }
    for (const wall of secrets) {
      const box = bounds(wall);
      const touching = obstacles.filter(item => item.id !== wall.id).filter(item => {
        const other = bounds(item);
        return Math.min(right(box), right(other)) >= Math.max(box.x, other.x) - EPS && Math.min(bottom(box), bottom(other)) >= Math.max(box.y, other.y) - EPS;
      });
      report.secretChecks.push({ roomId: room.id, ...summary(wall), localCells: local(box, shape), touchingGeometry: touching.map(summary), note: "Contacts include boundary/corner touch; this is not a bypass proof." });
    }
    for (const exit of room.exits) if (exit.connection.enabled) report.connections.push({ roomId: room.id, roomName: room.name, exitId: exit.id, exitName: exit.name, targetRoomId: exit.connection.targetRoomId, targetEntranceId: exit.connection.targetEntranceId, type: exit.connection.type, bidirectional: true });
  }
  report.ok = report.errors.length === 0;
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const source = process.argv[2] ?? new URL("../Ржавый водосброс — полный проект.json", import.meta.url);
  const output = process.argv[3] ?? new URL("../routes-validation.json", import.meta.url);
  const text = await readFile(source, "utf8");
  const report = checkRegion(JSON.parse(text));
  report.sourceSha256 = createHash("sha256").update(text).digest("hex");
  report.sourceUnchanged = await readFile(source, "utf8") === text;
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ ok: report.ok, errors: report.errors, items: report.stats?.items, moving: report.movingChecks.map(item => ({ name: item.label, sweep: item.sweepCells, docks: item.dockCandidates.filter(dock => dock.approachClear).length })), actors: report.actorChecks.length, portals: report.portalChecks.length, sourceUnchanged: report.sourceUnchanged }, null, 2));
  if (!report.ok) process.exitCode = 1;
}
