"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { WorldData, WorldRoom } from "./world-model";
import "./project-navigation.css";

type ProjectNavigationProps = {
  world: WorldData;
  roomId: string | null;
  mode: "world" | "blockout";
  onWorld: (regionId?: string) => void;
  onRoom: (id: string) => void;
};
type RoomGroup = { id: string; label: string; rooms: WorldRoom[] };
const sameId = (left: string | null | undefined, right: string | null | undefined) => Boolean(left && right && left.toLowerCase() === right.toLowerCase());

function roomGroups(world: WorldData, current?: WorldRoom): RoomGroup[] {
  const neighbors = new Set<string>();
  if (current) {
    for (const source of world.rooms) for (const exit of source.exits) {
      const connection = exit.connection;
      if (!connection.enabled) continue;
      const destination = world.rooms.find(room => sameId(room.id, connection.targetRoomId));
      if (!destination?.entrances.some(entrance => sameId(entrance.id, connection.targetEntranceId))) continue;
      if (sameId(source.id, current.id)) neighbors.add(destination.id.toLowerCase());
      if (sameId(destination.id, current.id)) neighbors.add(source.id.toLowerCase());
    }
  }
  const remaining = world.rooms.filter(room => !sameId(room.id, current?.id));
  const result: RoomGroup[] = [];
  const take = (id: string, label: string, matches: (room: WorldRoom) => boolean) => {
    const rooms = remaining.filter(matches);
    if (!rooms.length) return;
    result.push({ id, label, rooms });
    for (const room of rooms) remaining.splice(remaining.indexOf(room), 1);
  };
  if (current) {
    take("neighbors", "Связанные комнаты", room => neighbors.has(room.id.toLowerCase()));
    take("same-region", current.regionId ? "Другие комнаты региона" : "Другие комнаты без региона", room => sameId(room.regionId, current.regionId) || room.regionId === null && current.regionId === null);
  }
  for (const region of world.regions) take(region.id, region.name, room => sameId(room.regionId, region.id));
  take("unassigned", "Без региона", () => true);
  return result;
}

export default function ProjectNavigation({ world, roomId, mode, onWorld, onRoom }: ProjectNavigationProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const currentRoom = mode === "blockout" ? world.rooms.find(room => sameId(room.id, roomId)) : undefined;
  const region = world.regions.find(entry => sameId(entry.id, currentRoom?.regionId));
  const groups = useMemo(() => roomGroups(world, currentRoom), [world, currentRoom]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => menu.current?.querySelector<HTMLButtonElement>("[role='menuitem']")?.focus());
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => { window.cancelAnimationFrame(frame); document.removeEventListener("pointerdown", outside); };
  }, [open]);

  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  };
  const navigateMenu = (event: KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.key === "Escape") { event.preventDefault(); close(true); return; }
    if (event.key === "Tab") { close(true); return; }
    const buttons = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']") ?? []);
    if (!buttons.length || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const index = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
      : event.key === "ArrowDown" ? (current + 1) % buttons.length : (current - 1 + buttons.length) % buttons.length;
    buttons[index]?.focus();
  };

  return <nav className="project-navigation" data-editor-menu aria-label="Навигация по проекту" ref={root} onBlur={event => {
    if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) close();
  }}>
    {mode === "world" ? <span className="project-navigation-world" aria-current="page">Мир</span>
      : <button type="button" className="project-navigation-crumb" onClick={() => { close(); onWorld(); }} title="Открыть карту мира">Мир</button>}
    {currentRoom && <>
      <span className="project-navigation-separator" aria-hidden="true">›</span>
      <button type="button" className="project-navigation-crumb project-navigation-region" title={region?.name ?? "Без региона"}
        onClick={() => { close(); onWorld(region?.id); }}>{region?.name ?? "Без региона"}</button>
    </>}
    {mode === "blockout" && !currentRoom && <>
      <span className="project-navigation-separator" aria-hidden="true">›</span>
      <span className="project-navigation-common" aria-current="page">Общий рисунок</span>
    </>}
    <span className="project-navigation-separator" aria-hidden="true">›</span>
    <div className="project-navigation-picker">
      <button ref={trigger} type="button" className={`project-navigation-trigger ${open ? "is-open" : ""}`} aria-haspopup="menu"
        aria-expanded={open} aria-controls={menuId} aria-label={currentRoom ? `Комната: ${currentRoom.name}. Открыть другую комнату` : "Открыть комнату"}
        title={currentRoom?.name ?? "Открыть комнату"} onClick={() => setOpen(value => !value)} onKeyDown={event => {
          if (open) event.stopPropagation();
          if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); event.stopPropagation(); setOpen(true); }
          if (event.key === "Escape" && open) { event.preventDefault(); close(); }
        }}>
        <span className="project-navigation-room-name">{currentRoom?.name ?? "Комнаты"}</span><span aria-hidden="true">▾</span>
      </button>
      {open && <div id={menuId} ref={menu} role="menu" aria-label="Открыть комнату" className="project-navigation-menu" onKeyDown={navigateMenu}>
        {groups.length ? groups.map(group => <div key={group.id} role="group" aria-label={group.label} className="project-navigation-group">
          <div className="project-navigation-group-title" aria-hidden="true">{group.label}</div>
          {group.rooms.map(room => <button type="button" role="menuitem" tabIndex={-1} key={room.id} title={room.name} onClick={() => { close(true); onRoom(room.id); }}>
            <span className="project-navigation-room-icon" aria-hidden="true">▱</span><span>{room.name}</span>
          </button>)}
        </div>) : <p className="project-navigation-empty">{currentRoom ? "Других комнат пока нет." : "Создайте комнату на карте мира."}</p>}
      </div>}
    </div>
  </nav>;
}
