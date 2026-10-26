"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { CELL, type MapDocument, type Point, type RoomRoute } from "./map-document";
import "./route-editor.css";

const kinds = { main: "Основной путь", optional: "Ответвление", secret: "Секрет", return: "Возврат" };
const colors = { main: "#e3c27c", optional: "#7db8ee", secret: "#ba8edb", return: "#75c4bb" };
const MAX_POINTS = 2048;
const samePoint = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
export function useRouteEditor(document: MapDocument, roomId: string | null, active: boolean, onChange: (update: (doc: MapDocument) => MapDocument) => void) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pointIndex, setPointIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState<Point[] | null>(null);
  const interaction = useRef(0);
  const routes = (document.routes ?? []).filter(route => route.roomId === roomId);
  const selected = routes.find(route => route.id === selectedId);
  const room = document.world.rooms.find(room => room.id === roomId);
  const shape = document.items.find(item => item.id === room?.shapeItemId);
  const origin = shape ? { x: shape.x, y: shape.y } : room?.blockingOrigin ?? { x: 0, y: 0 };
  const update = useCallback((routeId: string, changes: Partial<RoomRoute>) => {
    onChange(doc => {
      const current = doc.routes?.find(route => route.id === routeId);
      if (!current || changes.points && (changes.points.length < 2 || changes.points.length > MAX_POINTS)) return doc;
      const unchanged = (Object.keys(changes) as (keyof RoomRoute)[]).every(key => key === "points"
        ? current.points.length === changes.points!.length && current.points.every((point, index) => samePoint(point, changes.points![index]))
        : current[key] === changes[key]);
      return unchanged ? doc : { ...doc, routes: doc.routes!.map(route => route.id === routeId ? { ...route, ...changes } : route) };
    });
  }, [onChange]);
  const select = (id: string | null) => { interaction.current += 1; setSelectedId(id); setPointIndex(null); setDraft(null); };
  const finish = useCallback(() => {
    if (!roomId || !draft || draft.length < 2) return;
    const route: RoomRoute = { id: crypto.randomUUID(), roomId, name: `Маршрут ${routes.length + 1}`, kind: "main", color: colors.main, points: draft, visible: true };
    onChange(doc => ({ ...doc, routes: [...(doc.routes ?? []), route] }));
    setSelectedId(route.id); setDraft(null); setPointIndex(null);
  }, [draft, onChange, roomId, routes.length]);
  const remove = useCallback(() => {
    if (!selected) return;
    onChange(doc => ({ ...doc, routes: (doc.routes ?? []).filter(route => route.id !== selected.id) }));
    setSelectedId(null); setPointIndex(null);
  }, [selected, onChange]);
  const removePoint = useCallback(() => {
    if (!selected || pointIndex === null || selected.points.length <= 2) return;
    update(selected.id, { points: selected.points.filter((_, index) => index !== pointIndex) });
    setPointIndex(null);
  }, [selected, pointIndex, update]);
  useEffect(() => { interaction.current += 1; setSelectedId(null); setPointIndex(null); setDraft(null); }, [roomId, active]);
  useEffect(() => {
    if (!active) return;
    const key = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable=true], dialog") || window.document.querySelector("dialog[open]")) return;
      if (event.ctrlKey || event.metaKey) { if (event.code === "KeyZ" || event.code === "KeyY") { interaction.current += 1; setDraft(null); setPointIndex(null); } return; }
      if (event.key === "Enter") { event.preventDefault(); if (!event.repeat) finish(); }
      if (event.key === "Escape") { event.preventDefault(); interaction.current += 1; setDraft(null); setSelectedId(null); setPointIndex(null); }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        if (draft) setDraft(draft.slice(0, -1)); else if (pointIndex !== null) removePoint(); else remove();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [active, draft, finish, pointIndex, remove, removePoint]);
  return { routes, selected, selectedId, pointIndex, setPointIndex, draft, setDraft, origin, update, select, finish, remove, removePoint, interaction };
}
type Editor = ReturnType<typeof useRouteEditor>;

export function RouteInspector({ editor }: { editor: Editor }) {
  const { routes, selected, draft } = editor;
  return <div className="route-inspector">
    <b>МАРШРУТЫ КОМНАТЫ</b>
    <p>Связная разметка пути через точки. Она сохраняется в проекте и не создаёт объекты в игре.</p>
    <button className="wide" onClick={() => { editor.select(null); editor.setDraft([]); }}>＋ Построить маршрут</button>
    {draft && <div className="route-draft-help" role="status"><b>Поставлено точек: {draft.length}</b><p>Щёлкайте по карте. Enter — завершить, Backspace — убрать последнюю точку, Esc — отменить.</p><button disabled={draft.length < 2} onClick={editor.finish}>Завершить маршрут</button><button onClick={() => editor.setDraft(null)}>Отменить построение</button></div>}
    <div className="route-list">{routes.map(route => <div className="route-row" key={route.id}>
      <input type="checkbox" aria-label={`Показать маршрут ${route.name}`} checked={route.visible} onChange={event => editor.update(route.id, { visible: event.target.checked })} />
      <button className={route.id === selected?.id ? "active" : ""} onClick={() => editor.select(route.id)}><i style={{ background: route.color }} /><span>{route.name}<small>{kinds[route.kind]} · {route.points.length} точек</small></span></button>
    </div>)}</div>
    {!routes.length && !draft && <p>Создайте основной путь, затем добавьте отдельные ответвления к секретам и маршруты возврата.</p>}
    {selected && !draft && <div className="route-properties" key={selected.id}>
      <label>Название маршрута<input key={selected.name} defaultValue={selected.name} maxLength={120} onBlur={event => { const name = event.target.value.trim(); if (name && name !== selected.name) editor.update(selected.id, { name }); else event.target.value = selected.name; }} onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} /></label>
      <label>Назначение маршрута<select value={selected.kind} onChange={event => { const kind = event.target.value as RoomRoute["kind"]; editor.update(selected.id, { kind, color: colors[kind] }); }}>{Object.entries(kinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Цвет маршрута<input type="color" value={selected.color} onChange={event => editor.update(selected.id, { color: event.target.value })} /></label>
      <p>Тяните пронумерованные точки. Щёлкните по линии, чтобы добавить точку. Выберите точку и нажмите Del для её удаления.</p>
      <button disabled={editor.pointIndex === null || selected.points.length <= 2} onClick={editor.removePoint}>Удалить выбранную точку</button>
      <button onClick={() => { editor.update(selected.id, { points: [...selected.points].reverse() }); editor.setPointIndex(null); }}>Обратить порядок точек</button>
      <button className="danger-tool" onClick={editor.remove}>Удалить маршрут</button>
    </div>}
  </div>;
}

export function RouteCanvas({ editor, active, pan, zoom }: { editor: Editor; active: boolean; pan: Point; zoom: number }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ route: RoomRoute; index: number; points: Point[]; pointerId: number; interaction: number } | null>(null);
  const [preview, setPreview] = useState<{ routeId: string; points: Point[] } | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null);
  const local = (event: ReactPointerEvent) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: Math.round(((event.clientX - rect.left - pan.x) / zoom - editor.origin.x) / (CELL / 2)) * (CELL / 2),
      y: Math.round(((event.clientY - rect.top - pan.y) / zoom - editor.origin.y) / (CELL / 2)) * (CELL / 2) };
  };
  const position = (point: Point) => ({ x: pan.x + (editor.origin.x + point.x) * zoom, y: pan.y + (editor.origin.y + point.y) * zoom });
  const pointsString = (points: Point[]) => points.map(point => { const p = position(point); return `${p.x},${p.y}`; }).join(" ");
  const cancelDrag = useCallback(() => {
    const value = drag.current; drag.current = null; setPreview(null);
    if (value && svgRef.current?.hasPointerCapture(value.pointerId)) svgRef.current.releasePointerCapture(value.pointerId);
  }, []);
  useEffect(() => { cancelDrag(); setCursor(null); }, [active, editor.selected, editor.origin.x, editor.origin.y, cancelDrag]);
  useEffect(() => { if (!editor.draft?.length) setCursor(null); }, [editor.draft]);
  const endDrag = (event: ReactPointerEvent) => {
    const value = drag.current;
    if (!value || value.pointerId !== event.pointerId) return;
    // Undo, room switches and another selection invalidate the original transaction.
    if (active && value.route === editor.selected && value.interaction === editor.interaction.current)
      editor.update(value.route.id, { points: value.points });
    cancelDrag();
  };
  return <svg ref={svgRef} className={`route-canvas ${active ? "is-editing" : ""}`} aria-label="Разметка маршрутов" onPointerDown={event => {
    if (!active || event.button !== 0) return;
    event.stopPropagation();
    if (editor.draft) { const p = local(event); const last = editor.draft.at(-1); if (editor.draft.length < MAX_POINTS && (!last || !samePoint(last, p))) editor.setDraft([...editor.draft, p]); }
    else editor.select(null);
  }} onPointerMove={event => {
    if (editor.draft) setCursor(local(event));
    const value = drag.current; if (!value || value.pointerId !== event.pointerId) return;
    if (!active || value.route !== editor.selected || value.interaction !== editor.interaction.current || !(event.buttons & 1)) { cancelDrag(); return; }
    value.points = value.points.map((point, index) => index === value.index ? local(event) : point);
    setPreview({ routeId: value.route.id, points: value.points });
  }} onPointerUp={endDrag} onPointerCancel={cancelDrag} onLostPointerCapture={cancelDrag}>
    {editor.routes.filter(route => route.visible).map(route => {
      const selected = active && route.id === editor.selectedId && !editor.draft;
      const points = preview?.routeId === route.id ? preview.points : route.points;
      const start = position(points[0]), end = position(points[points.length - 1]);
      return <g key={route.id} className={`route-drawing ${selected ? "is-selected" : ""}`} style={{ color: route.color }}>
        <title>{route.name}</title>
        <polyline className="route-stroke-shadow" points={pointsString(points)} />
        <polyline className={`route-stroke route-${route.kind}`} points={pointsString(points)} />
        {active && !editor.draft && points.slice(1).map((point, index) => <line key={index} className="route-segment-hit" aria-label={`${route.name}: участок ${index + 1}`} x1={position(points[index]).x} y1={position(points[index]).y} x2={position(point).x} y2={position(point).y} onPointerDown={event => {
          if (event.button !== 0) return; event.stopPropagation();
          if (!selected) { editor.select(route.id); return; }
          const p = local(event);
          if (samePoint(p, points[index])) { editor.setPointIndex(index); return; }
          if (samePoint(p, point)) { editor.setPointIndex(index + 1); return; }
          if (points.length >= MAX_POINTS) return;
          const next = [...points]; next.splice(index + 1, 0, p); editor.update(route.id, { points: next }); editor.setPointIndex(index + 1);
        }} />)}
        <circle className="route-start" cx={start.x} cy={start.y} r={4} /><rect className="route-end" x={end.x - 4} y={end.y - 4} width={8} height={8} />
        {selected && <text className="route-label" x={start.x + 9} y={start.y - 14}>{route.name}</text>}
        {selected && points.map((point, index) => { const p = position(point); return <g key={index} className="route-waypoint" role="button" aria-label={`Точка маршрута ${index + 1}`} onPointerDown={event => {
          if (event.button !== 0) return; event.stopPropagation(); editor.setPointIndex(index);
          drag.current = { route, index, points: [...points], pointerId: event.pointerId, interaction: editor.interaction.current }; svgRef.current?.setPointerCapture(event.pointerId);
        }}><circle cx={p.x} cy={p.y} r={editor.pointIndex === index ? 10 : 8} /><text x={p.x} y={p.y + 3}>{index + 1}</text></g>; })}
      </g>;
    })}
    {active && editor.draft && <g className="route-draft"><polyline points={pointsString(cursor && editor.draft.length ? [...editor.draft, cursor] : editor.draft)} />{editor.draft.map((point, index) => { const p = position(point); return <circle key={index} cx={p.x} cy={p.y} r={5} />; })}</g>}
  </svg>;
}
