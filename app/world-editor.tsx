"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type WheelEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { flushSync } from "react-dom";
import WorldInspector, { type WorldSelection } from "./world-inspector";
import { PanelBackdrop, PanelResizeHandle, PanelToggleButton, useWorkspacePanels } from "./workspace-panels";
import {
  connectExit, createEntrance, createRegion, createRoom, removeRoom, ROOM_STATUSES, ROOM_TYPES,
  validateWorld, type WorldData, type WorldIssue, type WorldRoom,
} from "./world-model";
import "./world-editor.css";

type Point = { x: number; y: number };
type Bounds = Point & { width: number; height: number };
type PendingLink = { kind: "exit"; roomId: string; exitId: string } | { kind: "start" };
type Drag = { kind: "room" | "start" | "pan"; id?: string; from: Point; origin: Point; moved: boolean };
type Draft = { kind: "room" | "start"; id?: string; position: Point };
type WireTarget = { kind: "room"; roomId: string } | { kind: "entrance"; roomId: string; entranceId: string };
type WireGesture = { source: PendingLink; world: WorldData; pointerId: number; capture: HTMLElement; from: Point; moved: boolean };
type WirePreview = { source: PendingLink; world: WorldData; point: Point; target: WireTarget | null };
type EntrancePicker = { source: PendingLink; world: WorldData; roomId: string; position: Point };
const endpointKey = (roomId: string, endpointId: string) => `${roomId.toLowerCase()}/${endpointId.toLowerCase()}`;
const sameId = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();

const CARD_WIDTH = 272;
const PIN_TOP = 88;
const PIN_HEIGHT = 30;
const START_WIDTH = 210;
const START_HEIGHT = 110;
const roomHeight = (room: WorldRoom) => PIN_TOP + Math.max(room.entrances.length, room.exits.length, 1) * PIN_HEIGHT + 34;
const typeColors: Record<WorldRoom["roomType"], string> = {
  Normal: "#7eb9d6", Combat: "#ee9174", Secret: "#ba97e5", Boss: "#e57391", Save: "#80c9a2", Passage: "#d5bd7a",
};
const curve = (from: Point, to: Point) => {
  const bend = Math.max(65, Math.min(240, Math.abs(to.x - from.x) * .5));
  return `M ${from.x} ${from.y} C ${from.x + bend} ${from.y}, ${to.x - bend} ${to.y}, ${to.x} ${to.y}`;
};

function resolveSelection(world: WorldData, selection: WorldSelection): WorldSelection {
  if (selection.kind === "region" && !world.regions.some(region => region.id === selection.regionId)) return { kind: "world" };
  if (!("roomId" in selection)) return selection;
  const room = world.rooms.find(entry => entry.id === selection.roomId);
  if (!room) return { kind: "world" };
  if (selection.kind === "entrance" && !room.entrances.some(endpoint => endpoint.id === selection.endpointId)) return { kind: "room", roomId: room.id };
  if (selection.kind === "exit" && !room.exits.some(endpoint => endpoint.id === selection.endpointId)) return { kind: "room", roomId: room.id };
  return selection;
}

export default function WorldEditor({ world, onChange, shapes, onOpenBlockout, onOpenCommonDrawing, initialRoomId, initialRegionId, blockingSettings, renderRoomBlocking }: {
  world: WorldData;
  onChange: (world: WorldData) => void;
  shapes: { id: string; label: string }[];
  onOpenBlockout: (roomId: string) => void;
  onOpenCommonDrawing: () => void;
  initialRoomId?: string;
  initialRegionId?: string;
  blockingSettings?: ReactNode;
  renderRoomBlocking?: (roomId: string) => ReactNode;
}) {
  const initialRoom = world.rooms.find(room => room.id === initialRoomId);
  const initialRegion = world.regions.find(region => region.id === initialRegionId);
  const panels = useWorkspacePanels("mapconstructor-world-panels");
  const [regionFilter, setRegionFilter] = useState<string | null>(initialRegion?.id ?? null);
  const [requestedSelection, setSelection] = useState<WorldSelection>(initialRegion ? { kind: "region", regionId: initialRegion.id } : initialRoom ? { kind: "room", roomId: initialRoom.id } : { kind: "world" });
  const [query, setQuery] = useState("");
  const [pan, setPan] = useState<Point>(initialRoom ? { x: 150 - initialRoom.graphPosition.x, y: 120 - initialRoom.graphPosition.y } : { x: 320, y: 120 });
  const [zoom, setZoom] = useState(1);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [requestedPending, setPending] = useState<PendingLink | null>(null);
  const [requestedWire, setWire] = useState<WirePreview | null>(null);
  const [requestedPicker, setPicker] = useState<EntrancePicker | null>(null);
  const [notice, setNotice] = useState("");
  const [showIssues, setShowIssues] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const gesture = useRef<Drag | null>(null);
  const draftRef = useRef<Draft | null>(null);
  const wireGesture = useRef<WireGesture | null>(null);
  const suppressClick = useRef(false);
  const pickerElement = useRef<HTMLDivElement>(null);
  const cancelConnection = useCallback(() => {
    const current = wireGesture.current;
    wireGesture.current = null;
    if (current) {
      suppressClick.current = true;
      if (current.capture.hasPointerCapture(current.pointerId)) current.capture.releasePointerCapture(current.pointerId);
    }
    setWire(null);
    setPicker(null);
    setPending(null);
  }, []);
  useEffect(() => {
    const cancel = () => {
      gesture.current = null;
      draftRef.current = null;
      setDraft(null);
      cancelConnection();
      setNotice("");
    };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") cancel(); };
    window.addEventListener("keydown", key);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", cancel);
      const current = wireGesture.current;
      wireGesture.current = null;
      if (current?.capture.hasPointerCapture(current.pointerId)) current.capture.releasePointerCapture(current.pointerId);
    };
  }, [cancelConnection]);
  // Invalidate when leaving a snapshot, even if Redo later returns the exact same object.
  useEffect(() => () => cancelConnection(), [world, cancelConnection]);
  const issues = useMemo(() => validateWorld(world), [world]);
  const errorCount = issues.filter(issue => issue.severity === "error").length;
  const worldRooms = useMemo(() => new Map(world.rooms.map(room => [room.id, room])), [world.rooms]);
  const selection = resolveSelection(world, requestedSelection);
  const pending = requestedPending?.kind === "exit" && !worldRooms.get(requestedPending.roomId)?.exits.some(exit => exit.id === requestedPending.exitId) ? null : requestedPending;
  // Undo/import can replace the world while a pointer is held. A gesture never commits across that boundary.
  const wire = requestedWire?.world === world ? requestedWire : null;
  const picker = requestedPicker?.world === world && worldRooms.has(requestedPicker.roomId) ? requestedPicker : null;
  const activeLink = wire?.source ?? picker?.source ?? pending;
  useEffect(() => {
    if (picker) pickerElement.current?.querySelector<HTMLButtonElement>(".we-link-picker-options button:not(:disabled), .we-link-picker-create")?.focus();
  }, [picker]);
  const regionNames = useMemo(() => new Map(world.regions.map(region => [region.id, region.name])), [world.regions]);
  const occupied = useMemo(() => {
    const result = new Map<string, { roomId: string; exitId: string; name: string }>();
    world.rooms.forEach(room => room.exits.forEach(exit => {
      const connection = exit.connection;
      if (connection.enabled && connection.targetRoomId && connection.targetEntranceId) {
        result.set(endpointKey(connection.targetRoomId, connection.targetEntranceId), { roomId: room.id, exitId: exit.id, name: `${room.name} / ${exit.name}` });
      }
    }));
    return result;
  }, [world.rooms]);
  const canUseEntrance = (source: PendingLink, roomId: string, entranceId: string) => {
    const owner = occupied.get(endpointKey(roomId, entranceId));
    return source.kind === "start" || !owner || (sameId(owner.roomId, source.roomId) && sameId(owner.exitId, source.exitId));
  };

  const position = (room: WorldRoom): Point => draft?.kind === "room" && draft.id === room.id ? draft.position : room.graphPosition;
  const startPosition = draft?.kind === "start" ? draft.position : world.startGraphPosition;
  const roomBounds = (room: WorldRoom): Bounds => ({ ...position(room), width: CARD_WIDTH, height: roomHeight(room) });
  const union = (bounds: Bounds[]): Bounds => {
    const left = Math.min(...bounds.map(bound => bound.x));
    const top = Math.min(...bounds.map(bound => bound.y));
    return { x: left, y: top, width: Math.max(...bounds.map(bound => bound.x + bound.width)) - left, height: Math.max(...bounds.map(bound => bound.y + bound.height)) - top };
  };
  const regionBounds = (regionId: string): Bounds => {
    const rooms = world.rooms.filter(room => room.regionId === regionId);
    const region = world.regions.find(entry => entry.id === regionId)!;
    if (!rooms.length) return { ...region.graphPosition, width: 300, height: 130 };
    const bounds = union(rooms.map(roomBounds));
    return { x: bounds.x - 30, y: bounds.y - 54, width: bounds.width + 60, height: bounds.height + 84 };
  };
  const frame = (bounds: Bounds, maxZoom = 1) => {
    if (!viewport.current) return;
    const width = viewport.current.clientWidth;
    const height = viewport.current.clientHeight;
    const nextZoom = Math.max(.2, Math.min(maxZoom, (width - 100) / Math.max(1, bounds.width), (height - 100) / Math.max(1, bounds.height)));
    setZoom(nextZoom);
    setPan({ x: width / 2 - (bounds.x + bounds.width / 2) * nextZoom, y: height / 2 - (bounds.y + bounds.height / 2) * nextZoom });
  };
  const frameAll = () => {
    setRegionFilter(null);
    frame(union([
      { ...startPosition, width: START_WIDTH, height: START_HEIGHT },
      ...world.rooms.map(roomBounds),
      ...world.regions.map(region => regionBounds(region.id)),
    ]));
  };
  const initialViewFrame = useRef<string | null>(null);
  useEffect(() => {
    const target = initialRegion ? `region:${initialRegion.id}` : initialRoom ? `room:${initialRoom.id}` : "world";
    if (!panels.ready || !panels.measured || initialViewFrame.current === target) return;
    const request = requestAnimationFrame(() => {
      initialViewFrame.current = target;
      if (initialRegion) {
        setRegionFilter(initialRegion.id);
        setSelection({ kind: "region", regionId: initialRegion.id });
        frame(regionBounds(initialRegion.id), .9);
      } else if (initialRoom) {
        setSelection({ kind: "room", roomId: initialRoom.id });
        frame(roomBounds(initialRoom));
      } else frameAll();
    });
    return () => cancelAnimationFrame(request);
  }, [initialRegion, initialRoom, panels.ready, panels.measured]);
  const selectRoom = (room: WorldRoom, focus = false) => {
    setSelection({ kind: "room", roomId: room.id });
    if (regionFilter && room.regionId !== regionFilter) setRegionFilter(null);
    if (focus) frame(roomBounds(room));
  };
  const selectRegion = (regionId: string) => {
    setRegionFilter(regionId);
    setSelection({ kind: "region", regionId });
    frame(regionBounds(regionId), .9);
  };
  const addRegion = () => {
    setRegionFilter(null);
    const region = createRegion(`Регион ${world.regions.length + 1}`, { x: 320 + world.regions.length * 380, y: -220 });
    onChange({ ...world, regions: [...world.regions, region] });
    setSelection({ kind: "region", regionId: region.id });
    frame({ ...region.graphPosition, width: 300, height: 130 });
  };
  const addRoom = () => {
    const selectedRoom = "roomId" in selection ? worldRooms.get(selection.roomId) : undefined;
    const regionId = selection.kind === "region" ? selection.regionId : selectedRoom?.regionId ?? null;
    const roomsInGroup = world.rooms.filter(room => room.regionId === regionId);
    const newPosition = roomsInGroup.length
      ? { x: Math.max(...roomsInGroup.map(room => room.graphPosition.x + CARD_WIDTH)) + 110, y: roomsInGroup[0].graphPosition.y }
      : { x: 340, y: world.regions.findIndex(region => region.id === regionId) * 300 + 100 };
    const room = createRoom(`Комната ${world.rooms.length + 1}`, newPosition, regionId);
    onChange({ ...world, rooms: [...world.rooms, room] });
    setSelection({ kind: "room", roomId: room.id });
    frame({ ...room.graphPosition, width: CARD_WIDTH, height: roomHeight(room) });
  };

  const beginDrag = (event: PointerEvent<HTMLElement>, kind: "room" | "start", room?: WorldRoom) => {
    if (event.button !== 0 || wireGesture.current) return;
    event.stopPropagation();
    const origin = room?.graphPosition ?? world.startGraphPosition;
    gesture.current = { kind, id: room?.id, from: { x: event.clientX, y: event.clientY }, origin, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
    if (room) selectRoom(room); else setSelection({ kind: "start" });
  };
  const beginPan = (event: PointerEvent<HTMLDivElement>) => {
    if (wireGesture.current) return;
    if (event.button !== 1 && (event.button !== 0 || event.target !== event.currentTarget)) return;
    event.preventDefault();
    gesture.current = { kind: "pan", from: { x: event.clientX, y: event.clientY }, origin: pan, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const graphPoint = (client: Point): Point => {
    const bounds = viewport.current?.getBoundingClientRect();
    return { x: (client.x - (bounds?.left ?? 0) - pan.x) / zoom, y: (client.y - (bounds?.top ?? 0) - pan.y) / zoom };
  };
  const hitWireTarget = (client: Point): WireTarget | null => {
    const view = viewport.current;
    if (!view) return null;
    const bounds = view.getBoundingClientRect();
    if (client.x < bounds.left || client.x > bounds.right || client.y < bounds.top || client.y > bounds.bottom) return null;
    // Pointer capture keeps delivery reliable, so event.target still refers to the source pin.
    const element = document.elementFromPoint(client.x, client.y);
    if (!element || !view.contains(element)) return null;
    const roomId = element.closest<HTMLElement>("[data-we-room-id]")?.dataset.weRoomId;
    if (!roomId || !worldRooms.has(roomId)) return null;
    const entranceId = element.closest<HTMLElement>("[data-we-entrance-id]")?.dataset.weEntranceId;
    return entranceId ? { kind: "entrance", roomId, entranceId } : { kind: "room", roomId };
  };
  const beginWire = (event: PointerEvent<HTMLButtonElement>, source: PendingLink) => {
    if (event.button !== 0 || !event.isPrimary || gesture.current || wireGesture.current) return;
    event.stopPropagation();
    setPicker(null);
    setNotice("");
    wireGesture.current = { source, world, pointerId: event.pointerId, capture: event.currentTarget,
      from: { x: event.clientX, y: event.clientY }, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const currentWire = wireGesture.current;
    if (currentWire) {
      if (event.pointerId !== currentWire.pointerId) return;
      if (currentWire.world !== world) { cancelConnection(); return; }
      const point = { x: event.clientX, y: event.clientY };
      if (!currentWire.moved && Math.hypot(point.x - currentWire.from.x, point.y - currentWire.from.y) < 4) return;
      if (!currentWire.moved) setSelection(currentWire.source.kind === "start" ? { kind: "start" }
        : { kind: "exit", roomId: currentWire.source.roomId, endpointId: currentWire.source.exitId });
      currentWire.moved = true;
      setPending(null);
      setWire({ source: currentWire.source, world, point: graphPoint(point), target: hitWireTarget(point) });
      return;
    }
    const current = gesture.current;
    if (!current) return;
    const delta = { x: event.clientX - current.from.x, y: event.clientY - current.from.y };
    if (Math.hypot(delta.x, delta.y) < 3 && !current.moved) return;
    current.moved = true;
    if (current.kind === "pan") {
      setPan({ x: current.origin.x + delta.x, y: current.origin.y + delta.y });
      return;
    }
    const next: Draft = { kind: current.kind, id: current.id, position: {
      x: Math.round((current.origin.x + delta.x / zoom) / 16) * 16,
      y: Math.round((current.origin.y + delta.y / zoom) / 16) * 16,
    } };
    draftRef.current = next;
    setDraft(next);
  };
  const finishDrag = (cancelled = false) => {
    const current = gesture.current;
    const latest = draftRef.current;
    gesture.current = null;
    draftRef.current = null;
    setDraft(null);
    if (cancelled || !current?.moved || !latest || current.kind === "pan") return;
    if (latest.position.x === current.origin.x && latest.position.y === current.origin.y) return;
    onChange(latest.kind === "start"
      ? { ...world, startGraphPosition: latest.position }
      : { ...world, rooms: world.rooms.map(room => room.id === latest.id ? { ...room, graphPosition: latest.position } : room) });
  };
  const changeZoom = (next: number, anchor?: Point) => {
    const nextZoom = Math.max(.2, Math.min(1.8, next));
    const point = anchor ?? { x: (viewport.current?.clientWidth ?? 800) / 2, y: (viewport.current?.clientHeight ?? 500) / 2 };
    setPan({ x: point.x - (point.x - pan.x) / zoom * nextZoom, y: point.y - (point.y - pan.y) / zoom * nextZoom });
    setZoom(nextZoom);
  };
  const wheel = (event: WheelEvent<HTMLDivElement>) => {
    if (gesture.current || wireGesture.current || picker) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    changeZoom(zoom * Math.exp(-event.deltaY * .001), { x: event.clientX - bounds.left, y: event.clientY - bounds.top });
  };
  const connectToEntrance = (source: PendingLink, roomId: string, entranceId: string, base = world) => {
    try {
      const destination = base.rooms.find(room => sameId(room.id, roomId));
      const entrance = destination?.entrances.find(entry => sameId(entry.id, entranceId));
      if (!destination || !entrance) throw new Error("Целевой вход не найден.");
      const previous = source.kind === "exit" ? base.rooms.find(room => sameId(room.id, source.roomId))?.exits.find(exit => sameId(exit.id, source.exitId))?.connection : null;
      const unchanged = base === world && (source.kind === "start"
        ? world.start && sameId(world.start.roomId, destination.id) && sameId(world.start.entranceId, entrance.id)
        : previous?.enabled && previous.targetRoomId && previous.targetEntranceId && sameId(previous.targetRoomId, destination.id) && sameId(previous.targetEntranceId, entrance.id));
      if (source.kind === "start") {
        if (!unchanged) onChange({ ...base, start: { roomId: destination.id, entranceId: entrance.id } });
      } else {
        const connected = connectExit(base, source.roomId, source.exitId, destination.id, entrance.id);
        if (!unchanged) onChange(connected);
      }
      setSelection({ kind: "entrance", roomId: destination.id, endpointId: entrance.id });
      setNotice("");
      cancelConnection();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Не удалось соединить комнаты.");
    }
  };
  const chooseEntrance = (roomId: string, entranceId: string) => {
    setSelection({ kind: "entrance", roomId, endpointId: entranceId });
    if (pending) connectToEntrance(pending, roomId, entranceId);
  };
  const finishWire = (event: PointerEvent<HTMLDivElement>, cancelled = false) => {
    const current = wireGesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    wireGesture.current = null;
    setWire(null);
    if (current.capture.hasPointerCapture(current.pointerId)) current.capture.releasePointerCapture(current.pointerId);
    if (cancelled || current.world !== world) {
      suppressClick.current = true;
      cancelConnection();
      return;
    }
    if (!current.moved) return;
    suppressClick.current = true;
    setPending(null);
    const client = { x: event.clientX, y: event.clientY };
    const target = hitWireTarget(client);
    if (!target) { cancelConnection(); return; }
    if (target.kind === "entrance") {
      connectToEntrance(current.source, target.roomId, target.entranceId);
      return;
    }
    const room = worldRooms.get(target.roomId)!;
    const available = room.entrances.filter(entrance => canUseEntrance(current.source, room.id, entrance.id));
    if (available.length === 1) {
      connectToEntrance(current.source, room.id, available[0].id);
      return;
    }
    const bounds = viewport.current!.getBoundingClientRect();
    setPicker({ source: current.source, world, roomId: room.id, position: {
      x: Math.max(12, Math.min(client.x - bounds.left + 12, bounds.width - 292)),
      y: Math.max(12, Math.min(client.y - bounds.top + 12, bounds.height - 280)),
    } });
  };
  const addEntranceAndConnect = () => {
    if (!picker || picker.world !== world) return;
    const room = worldRooms.get(picker.roomId);
    if (!room) return;
    let number = room.entrances.length + 1;
    while (room.entrances.some(entrance => entrance.name === `Вход ${number}`)) number += 1;
    const entrance = createEntrance(`Вход ${number}`);
    const next = { ...world, rooms: world.rooms.map(entry => entry.id === room.id ? { ...entry, entrances: [...entry.entrances, entrance] } : entry) };
    connectToEntrance(picker.source, room.id, entrance.id, next);
  };
  const chooseExit = (roomId: string, exitId: string) => {
    setPicker(null);
    setSelection({ kind: "exit", roomId, endpointId: exitId });
    setPending(pending?.kind === "exit" && pending.roomId === roomId && pending.exitId === exitId ? null : { kind: "exit", roomId, exitId });
    setNotice("");
  };
  const showIssue = (issue: WorldIssue) => {
    if (issue.roomId) {
      const room = worldRooms.get(issue.roomId);
      if (room) {
        if (regionFilter && room.regionId !== regionFilter) setRegionFilter(null);
        frame(roomBounds(room));
        setSelection(issue.exitId ? { kind: "exit", roomId: room.id, endpointId: issue.exitId }
          : issue.entranceId ? { kind: "entrance", roomId: room.id, endpointId: issue.entranceId }
            : { kind: "room", roomId: room.id });
      }
    } else if (issue.regionId) selectRegion(issue.regionId);
    else setSelection({ kind: "world" });
  };
  const deleteRoom = (roomId: string) => {
    const room = worldRooms.get(roomId);
    if (!room) return;
    gesture.current = null;
    draftRef.current = null;
    setDraft(null);
    cancelConnection();
    onChange(removeRoom(world, roomId));
    setSelection({ kind: "world" });
    setNotice(`Комната «${room.name}» удалена из мира; связи и старт очищены. Рисунок сохранён в «Общем рисунке». Действие можно отменить.`);
  };
  const keyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Delete" || event.defaultPrevented || selection.kind !== "room") return;
    const target = event.target as HTMLElement;
    if (target.closest("input, textarea, select, [contenteditable='true']") || document.querySelector("dialog[open]")) return;
    event.preventDefault();
    event.stopPropagation();
    deleteRoom(selection.roomId);
  };
  const filteredRooms = world.rooms.filter(room => `${room.name} ${room.description} ${ROOM_TYPES[room.roomType]} ${room.tags.join(" ")}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const passageCount = world.rooms.reduce((sum, room) => sum + room.exits.filter(exit => exit.connection.enabled && exit.connection.targetRoomId && exit.connection.targetEntranceId).length, 0);
  const currentRoomId = "roomId" in selection ? selection.roomId : null;
  const connectedStartRoom = world.start ? world.rooms.find(room => sameId(room.id, world.start!.roomId)) : undefined;
  const filteredRegion = world.regions.find(region => region.id === regionFilter);
  const graphRooms = filteredRegion ? world.rooms.filter(room => room.regionId === filteredRegion.id) : world.rooms;
  const graphRoomIds = new Set(graphRooms.map(room => room.id));
  const graphRegions = filteredRegion ? [filteredRegion] : world.regions;
  const showStart = !filteredRegion || connectedStartRoom?.regionId === filteredRegion.id;
  const wireSourceRoom = wire?.source.kind === "exit" ? worldRooms.get(wire.source.roomId) : undefined;
  const wireExitId = wire?.source.kind === "exit" ? wire.source.exitId : null;
  const wireSource = wire?.source.kind === "start" ? { x: startPosition.x + START_WIDTH + 4, y: startPosition.y + 81 }
    : wireSourceRoom && wire?.source.kind === "exit" ? {
      x: position(wireSourceRoom).x + CARD_WIDTH + 4,
      y: position(wireSourceRoom).y + PIN_TOP + wireSourceRoom.exits.findIndex(exit => exit.id === wireExitId) * PIN_HEIGHT + PIN_HEIGHT / 2,
    } : null;
  const wireTargetRoom = wire?.target ? worldRooms.get(wire.target.roomId) : undefined;
  const wireTargetEntrance = wire?.target?.kind === "entrance" ? wire.target.entranceId : null;
  const wireEnd = wireTargetRoom && wireTargetEntrance ? {
    x: position(wireTargetRoom).x - 4,
    y: position(wireTargetRoom).y + PIN_TOP + wireTargetRoom.entrances.findIndex(entrance => entrance.id === wireTargetEntrance) * PIN_HEIGHT + PIN_HEIGHT / 2,
  } : wire?.point;
  const blockedWireTarget = wire?.target?.kind === "entrance" && !canUseEntrance(wire.source, wire.target.roomId, wire.target.entranceId);
  const pickerRoom = picker ? worldRooms.get(picker.roomId) : undefined;

  return <div ref={panels.containerRef} style={panels.style} className="world-editor workspace-panel-layout" role="application" aria-label="Редактор мира" onKeyDownCapture={keyDown}
    onPointerDownCapture={event => {
      // Inspector edits commit on blur. Finish that edit before the source captures its world snapshot.
      if ((event.target as Element).closest(".we-exit, .we-start-pin")) {
        const focused = document.activeElement;
        if (focused instanceof HTMLElement && focused.matches("input, textarea, select, [contenteditable='true']")) flushSync(() => focused.blur());
      }
      suppressClick.current = false;
      if (picker && !(event.target as Element).closest(".we-link-picker")) cancelConnection();
    }}
    onClickCapture={event => {
      if (!suppressClick.current || event.detail === 0) return;
      suppressClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    }}>
    <aside {...panels.leftProps} className="we-library" aria-label="Структура мира">
      <div className="we-library-heading"><span>Структура мира</span><button className={selection.kind === "world" ? "active" : ""} onClick={() => setSelection({ kind: "world" })} title="Свойства мира" aria-label="Свойства мира">⚙</button><PanelToggleButton panels={panels} side="left" label="Структура" /></div>
      <div className="we-search"><span aria-hidden="true">⌕</span><input aria-label="Найти комнату" placeholder="Найти комнату…" value={query} onChange={event => setQuery(event.target.value)} /></div>
      <div className="we-library-scroll">
        <button className={`we-start-list ${selection.kind === "start" ? "active" : ""}`} onClick={() => { setRegionFilter(null); setSelection({ kind: "start" }); frame({ ...startPosition, width: START_WIDTH, height: START_HEIGHT }); }}><span>▶</span><span><b>GameStart</b><small>{connectedStartRoom?.name ?? "Выберите точку старта"}</small></span></button>
        {[...world.regions.map(region => ({ id: region.id, name: region.name, color: region.color })), { id: null, name: "Без региона", color: "#697b91" }].map(region => {
          const rooms = filteredRooms.filter(room => room.regionId === region.id);
          const count = world.rooms.filter(room => room.regionId === region.id).length;
          return <section className="we-tree-group" key={region.id ?? "ungrouped"}>
            <button className={`we-region-list ${selection.kind === "region" && selection.regionId === region.id ? "active" : ""}`} onClick={() => {
              if (region.id) selectRegion(region.id);
              else { setRegionFilter(null); setSelection({ kind: "world" }); if (rooms.length) frame(union(rooms.map(roomBounds))); }
            }}><span className="we-region-dot" style={{ background: region.color }} /><b>{region.name}</b><small>{count}</small></button>
            {rooms.map(room => <button key={room.id} className={`we-room-list ${currentRoomId === room.id ? "active" : ""}`} onClick={() => selectRoom(room, true)} onDoubleClick={() => onOpenBlockout(room.id)} title="Двойной щелчок — открыть комнату">
              <span className="we-room-type-dot" style={{ color: typeColors[room.roomType] }}>▱</span><span><b>{room.name || "Без названия"}</b><small>{ROOM_STATUSES[room.status]}</small></span>
              {world.start?.roomId === room.id && <span className="we-tree-start" title="Стартовая комната">▶</span>}
            </button>)}
            {!rooms.length && <p className="we-tree-empty">{query ? "Нет совпадений" : "Пока нет комнат"}</p>}
          </section>;
        })}
      </div>
      <div className="we-library-footer"><b>{world.rooms.length} комнат · {passageCount} проходов</b><span>Двойной щелчок по комнате открывает её блокинг.</span><button onClick={onOpenCommonDrawing}>Общий рисунок</button></div>
    </aside>
    <PanelResizeHandle panels={panels} side="left" label="Структура" />
    <section {...panels.centerProps} className="we-workspace" aria-label="Граф мира">
      <div className="we-toolbar">
        {panels.left.collapsed && <PanelToggleButton panels={panels} side="left" label="Структура" />}
        {panels.right.collapsed && <PanelToggleButton panels={panels} side="right" label="Свойства" />}
        <button className="we-primary" onClick={addRoom}>+ Комната</button><button onClick={addRegion}>+ Регион</button><span className="we-toolbar-divider" />
        <button onClick={frameAll} title="Показать весь мир">Весь мир</button>
        {filteredRegion && <button className="we-region-filter" onClick={frameAll} title="Снять фильтр региона">{filteredRegion.name} ×</button>}
        <button className="we-delete-room" disabled={selection.kind !== "room"} onClick={() => selection.kind === "room" && deleteRoom(selection.roomId)} title="Удалить выбранную комнату (Del), сохранив рисунок">Удалить <kbd>Del</kbd></button>
        <button className={`we-validation-toggle ${errorCount ? "has-errors" : issues.length ? "has-warnings" : "is-valid"}`} onClick={() => setShowIssues(value => !value)} aria-expanded={showIssues}>{errorCount ? `● Ошибки: ${errorCount}` : issues.length ? `○ Проверка: ${issues.length}` : "✓ Связи в порядке"}</button>
      </div>
      <div className={`we-viewport ${activeLink ? "is-connecting" : ""} ${wire ? "is-wiring" : ""}`} ref={viewport} onWheel={wheel} onPointerDown={beginPan} onPointerMove={move}
        onPointerUp={event => { if (wireGesture.current) finishWire(event); else finishDrag(); }}
        onPointerCancel={event => { if (wireGesture.current) finishWire(event, true); else finishDrag(true); }}
        onLostPointerCapture={event => { if (wireGesture.current?.pointerId === event.pointerId) cancelConnection(); else if (gesture.current) finishDrag(true); }}
        style={{ backgroundSize: `${32 * zoom}px ${32 * zoom}px`, backgroundPosition: `${pan.x}px ${pan.y}px` }}>
        <div className="we-canvas" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
          {graphRegions.map(region => {
            const bounds = regionBounds(region.id);
            return <div key={region.id} className="we-region-area" style={{ left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height, "--region-color": region.color } as CSSProperties}><span>{region.name}<small>{world.rooms.filter(room => room.regionId === region.id).length} комнат</small></span></div>;
          })}
          <svg className="we-connections" aria-label="Переходы между комнатами">
            <defs>
              <marker id="we-link-end" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" /></marker>
            </defs>
            {graphRooms.flatMap(room => room.exits.map((exit, exitIndex) => {
              const connection = exit.connection;
              const target = connection.targetRoomId ? world.rooms.find(entry => sameId(entry.id, connection.targetRoomId!)) : undefined;
              const entranceIndex = target?.entrances.findIndex(entrance => connection.targetEntranceId && sameId(entrance.id, connection.targetEntranceId)) ?? -1;
              if (!target || !graphRoomIds.has(target.id) || entranceIndex < 0) return null;
              const from = { x: position(room).x + CARD_WIDTH + 4, y: position(room).y + PIN_TOP + exitIndex * PIN_HEIGHT + PIN_HEIGHT / 2 };
              const to = { x: position(target).x - 4, y: position(target).y + PIN_TOP + entranceIndex * PIN_HEIGHT + PIN_HEIGHT / 2 };
              const gated = connection.requiredAbilities.length + connection.requiredTags.length + connection.blockedTags.length > 0;
              const selected = selection.kind === "exit" && selection.roomId === room.id && selection.endpointId === exit.id;
              const rewiring = wire?.source.kind === "exit" && wire.source.roomId === room.id && wire.source.exitId === exit.id;
              return <g key={exit.id} className={`${connection.enabled ? "" : "is-disabled"} ${gated ? "is-gated" : ""} ${selected ? "is-selected" : ""} ${rewiring ? "is-rewiring" : ""}`}>
                <path className="we-edge" d={curve(from, to)}
                  style={exit.graphStyle ? { stroke: exit.graphStyle.color, strokeDasharray: exit.graphStyle.lineStyle === "dashed" ? "8 4" : "none" } : undefined}
                  markerStart="url(#we-link-end)" markerEnd="url(#we-link-end)" />
                <path className="we-edge-hit" d={curve(from, to)} role="button" tabIndex={0} aria-label={`Проход: ${room.name}, ${exit.name} ↔ ${target.name}`} onClick={() => setSelection({ kind: "exit", roomId: room.id, endpointId: exit.id })} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelection({ kind: "exit", roomId: room.id, endpointId: exit.id }); } }} />
              </g>;
            }))}
            {showStart && world.start && connectedStartRoom && (() => {
              const index = connectedStartRoom.entrances.findIndex(entrance => sameId(entrance.id, world.start!.entranceId));
              if (index < 0) return null;
              return <path className="we-start-edge" d={curve({ x: startPosition.x + START_WIDTH + 4, y: startPosition.y + 81 }, { x: position(connectedStartRoom).x - 4, y: position(connectedStartRoom).y + PIN_TOP + index * PIN_HEIGHT + PIN_HEIGHT / 2 })} markerEnd="url(#we-link-end)" />;
            })()}
            {wireSource && wireEnd && <path className={`we-wire-preview ${blockedWireTarget ? "is-blocked" : wire?.target ? "has-target" : ""} ${wire?.source.kind === "start" ? "is-start" : ""}`} d={curve(wireSource, wireEnd)} markerEnd="url(#we-link-end)" />}
          </svg>
          {showStart && <div className={`we-start-card ${selection.kind === "start" ? "is-selected" : ""}`} style={{ left: startPosition.x, top: startPosition.y, width: START_WIDTH, height: START_HEIGHT }}>
            <button className="we-card-drag we-start-title" onPointerDown={event => beginDrag(event, "start")} onClick={() => setSelection({ kind: "start" })}><span>▶</span><span><b>GameStart</b><small>Начало новой игры</small></span><span className="we-grip">⠿</span></button>
            <button className={`we-start-pin ${activeLink?.kind === "start" ? "is-pending" : ""}`} onPointerDown={event => beginWire(event, { kind: "start" })} onClick={() => { setPicker(null); setPending(pending?.kind === "start" ? null : { kind: "start" }); setSelection({ kind: "start" }); setNotice(""); }} title="Перетащите к входу или комнате. Можно также нажать, затем выбрать вход." aria-label="Соединить GameStart со входом"><span>{connectedStartRoom?.name ?? "Назначить вход"}</span><span className="we-pin-circle" /></button>
          </div>}
          {graphRooms.map(room => {
            const regionName = room.regionId ? regionNames.get(room.regionId) : null;
            const maxPins = Math.max(room.entrances.length, room.exits.length, 1);
            const roomDrop = wire?.target?.kind === "room" && wire.target.roomId === room.id;
            return <article className={`we-room-card ${currentRoomId === room.id ? "is-selected" : ""} ${roomDrop ? "is-wire-room-target" : ""}`} data-we-room-id={room.id} key={room.id} style={{ left: position(room).x, top: position(room).y, width: CARD_WIDTH, height: roomHeight(room), "--room-color": typeColors[room.roomType] } as CSSProperties}>
              <button className="we-card-drag we-room-header" onPointerDown={event => beginDrag(event, "room", room)} onClick={() => selectRoom(room)} onDoubleClick={() => onOpenBlockout(room.id)} title="Двойной щелчок — открыть комнату" aria-label={`Выбрать комнату ${room.name}`}>
                <span className="we-room-category">{ROOM_TYPES[room.roomType]}<span className="we-grip">⠿</span></span>
                <strong>{room.name || "Без названия"}</strong><span className="we-card-region">{regionName ?? "Без региона"}</span>
              </button>
              <div className="we-card-pins">
                {Array.from({ length: maxPins }, (_, index) => {
                  const entrance = room.entrances[index];
                  const exit = room.exits[index];
                  const occupiedBy = entrance ? occupied.get(endpointKey(room.id, entrance.id)) : undefined;
                  const selectedEntrance = selection.kind === "entrance" && selection.roomId === room.id && selection.endpointId === entrance?.id;
                  const selectedExit = selection.kind === "exit" && selection.roomId === room.id && selection.endpointId === exit?.id;
                  const pendingExit = activeLink?.kind === "exit" && activeLink.roomId === room.id && activeLink.exitId === exit?.id;
                  const available = entrance && activeLink ? canUseEntrance(activeLink, room.id, entrance.id) : false;
                  const hovered = wire?.target?.kind === "entrance" && wire.target.roomId === room.id && wire.target.entranceId === entrance?.id;
                  return <div className="we-pin-row" key={index}>
                    {entrance ? <button className={`we-pin we-entrance ${occupiedBy ? "is-connected" : ""} ${selectedEntrance ? "is-selected" : ""} ${activeLink ? available ? "is-target" : "is-unavailable" : ""} ${hovered ? "is-drop-target" : ""}`} data-we-entrance-id={entrance.id} title={occupiedBy ? `${entrance.name} ↔ ${occupiedBy.name}${activeLink && !available ? ". Вход занят, прежний проход сохранится." : ""}` : `${entrance.name}: свободный вход`} aria-label={`Вход ${entrance.name}, комната ${room.name}`} onClick={() => chooseEntrance(room.id, entrance.id)}><span className="we-pin-circle" /><span>{entrance.name || "Вход"}</span></button> : <span className="we-pin-placeholder" />}
                    {exit ? <button className={`we-pin we-exit ${exit.connection.enabled ? "is-connected" : ""} ${selectedExit ? "is-selected" : ""} ${pendingExit ? "is-pending" : ""}`} aria-label={`Выход ${exit.name}, комната ${room.name}`} title="Перетащите к входу или комнате. Можно также нажать выход, затем вход." onPointerDown={event => beginWire(event, { kind: "exit", roomId: room.id, exitId: exit.id })} onClick={() => chooseExit(room.id, exit.id)}><span>{exit.name || "Выход"}</span><span className="we-pin-circle" /></button> : <span className="we-pin-placeholder" />}
                  </div>;
                })}
                {!room.entrances.length && !room.exits.length && <button className="we-no-pins" title="Откройте комнату и задайте переходы в блокинге" onClick={() => selectRoom(room)}>Добавьте переходы в блокинге</button>}
              </div>
              <button className="we-room-footer" onClick={() => onOpenBlockout(room.id)} title="Открыть комнату"><span className={`we-status we-status-${room.status}`}>{ROOM_STATUSES[room.status]}</span><span>{roomDrop ? "Отпустите: подключить вход" : "Открыть комнату →"}</span>{world.start?.roomId === room.id && <span className="we-card-start" title="Стартовая комната">▶</span>}</button>
            </article>;
          })}
        </div>
        {!world.rooms.length && <div className="we-empty"><span className="we-empty-symbol">▱</span><h2>Начните с первой комнаты</h2><p>Соберите структуру мира, объедините комнаты в регионы и наметьте проходы.</p><button className="we-primary" onClick={addRoom}>+ Создать комнату</button><small>Регионы можно добавить в любой момент.</small></div>}
        {picker && pickerRoom && <div className="we-link-picker" role="dialog" aria-label={`Выбрать вход: ${pickerRoom.name}`} ref={pickerElement} style={{ left: picker.position.x, top: picker.position.y, maxHeight: `calc(100% - ${picker.position.y + 12}px)` }}>
          <div className="we-link-picker-heading"><span><small>Подключить к комнате</small><strong>{pickerRoom.name || "Без названия"}</strong></span><button onClick={cancelConnection} aria-label="Отменить подключение">×</button></div>
          <p>{pickerRoom.entrances.some(entrance => canUseEntrance(picker.source, pickerRoom.id, entrance.id)) ? "Выберите вход для этого соединения." : pickerRoom.entrances.length ? "Все входы заняты. Можно создать новый." : "В комнате пока нет входов. Создайте первый."}</p>
          <div className="we-link-picker-options">
            {pickerRoom.entrances.map(entrance => {
              const available = canUseEntrance(picker.source, pickerRoom.id, entrance.id);
              const owner = occupied.get(endpointKey(pickerRoom.id, entrance.id));
              return <button key={entrance.id} disabled={!available} onClick={() => connectToEntrance(picker.source, pickerRoom.id, entrance.id)}><span>○</span><span><b>{entrance.name || "Вход"}</b><small>{available ? "Подключить" : `Занят: ${owner?.name ?? "другой проход"}`}</small></span></button>;
            })}
          </div>
          <button className="we-link-picker-create" onClick={addEntranceAndConnect}>+ Новый вход и соединить</button>
          <small className="we-link-picker-hint">Прежняя связь сохранится до выбора. <kbd>Esc</kbd> — отмена.</small>
        </div>}
        <div className="we-zoom"><button onClick={() => changeZoom(zoom / 1.2)} aria-label="Уменьшить масштаб">−</button><button onClick={() => changeZoom(1)} aria-label="Масштаб 100 процентов">{Math.round(zoom * 100)}%</button><button onClick={() => changeZoom(zoom * 1.2)} aria-label="Увеличить масштаб">+</button></div>
      </div>
      {notice && <div className="we-notice" role="alert"><span>{notice}</span><button onClick={() => setNotice("")} aria-label="Закрыть сообщение">×</button></div>}
      <div className={`we-statusbar ${activeLink ? "is-connecting" : ""}`}><span>{activeLink ? blockedWireTarget ? "Этот вход занят. Выберите свободный вход или отпустите на комнате для создания нового." : activeLink.kind === "start" ? "Перетащите к входу или комнате. Старт может использовать вход с обычным проходом." : "Перетащите к входу или комнате; можно выбрать вход щелчком. Прежняя связь сохранится до подключения." : "Выход → вход или комната — протянуть связь · Колесо — масштаб · Двойной щелчок — открыть комнату"}</span>{activeLink && <button onClick={() => { cancelConnection(); setNotice(""); }}>Отмена <kbd>Esc</kbd></button>}</div>
      {showIssues && <div className="we-issues" aria-label="Проверка мира"><div className="we-issues-heading"><b>Проверка структуры мира</b><button onClick={() => setShowIssues(false)} aria-label="Закрыть проверку">×</button></div><p>Связность проверяется по включённым проходам, без учёта получения способностей и выполнения условий.</p>{issues.length ? <ul>{issues.map((issue, index) => <li key={index}><button className={`we-issue-${issue.severity}`} onClick={() => showIssue(issue)}><span>{issue.severity === "error" ? "!" : "○"}</span>{issue.message}</button></li>)}</ul> : <div className="we-no-issues">✓ Все комнаты связаны, ссылки корректны.</div>}</div>}
    </section>
    <PanelResizeHandle panels={panels} side="right" label="Свойства" />
    <div {...panels.rightProps} className="we-properties-panel">
      <div className="we-properties-heading"><span>Свойства</span><PanelToggleButton panels={panels} side="right" label="Свойства" /></div>
      <WorldInspector world={world} selection={selection} onChange={onChange} onSelect={setSelection} shapes={shapes} onOpenBlockout={onOpenBlockout} onDeleteRoom={deleteRoom}
        blockingSettings={blockingSettings} renderRoomBlocking={renderRoomBlocking} />
    </div>
    <PanelBackdrop panels={panels} />
  </div>;
}
