"use client";

import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type HTMLAttributes } from "react";
import "./workspace-panels.css";

type Side = "left" | "right";
type PanelPreference = { width: number; collapsed: boolean };
type Preferences = Record<Side, PanelPreference>;
const LIMITS = { left: { min: 220, max: 480, initial: 260 }, right: { min: 260, max: 520, initial: 320 } };
const MIN_CANVAS = 320;
const HANDLE = 6;
const defaults = (): Preferences => ({ left: { width: 260, collapsed: false }, right: { width: 320, collapsed: false } });
const clamp = (value: number, minimum: number, maximum: number) => Math.min(Math.max(value, minimum), Math.max(minimum, maximum));

/** UI preferences only. No map data, geometry or editor undo state is involved. */
export function useWorkspacePanels(storageKey: string) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const containerRef = useCallback((element: HTMLDivElement | null) => setContainer(element), []);
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [preferences, setPreferences] = useState<Preferences>(defaults);
  const [containerWidth, setContainerWidth] = useState(1200);
  const [measured, setMeasured] = useState(false);
  const [ready, setReady] = useState(false);
  const [overlaySide, setOverlaySide] = useState<Side | null>(null);
  const compact = containerWidth < MIN_CANVAS + LIMITS.left.min + LIMITS.right.min + HANDLE * 2;
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw), next = defaults();
        for (const side of ["left", "right"] as const) {
          const value = parsed?.[side];
          if (typeof value?.width === "number" && Number.isFinite(value.width)) next[side].width = clamp(value.width, LIMITS[side].min, LIMITS[side].max);
          if (typeof value?.collapsed === "boolean") next[side].collapsed = value.collapsed;
        }
        setPreferences(next);
      }
    } catch { /* A browser that disallows UI preferences still keeps panels usable. */ }
    setReady(true);
  }, [storageKey]);
  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(storageKey, JSON.stringify(preferences)); } catch { /* Session state remains usable. */ }
  }, [preferences, ready, storageKey]);
  useEffect(() => {
    const element = container;
    if (!element) return;
    const measure = () => { setContainerWidth(element.clientWidth); setMeasured(element.clientWidth > 0); };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [container]);
  useEffect(() => { setOverlaySide(null); }, [compact]);

  const collapsed = (side: Side) => compact ? overlaySide !== side : preferences[side].collapsed;
  const widths = { left: collapsed("left") ? 0 : preferences.left.width, right: collapsed("right") ? 0 : preferences.right.width };
  if (!compact) {
    const available = containerWidth - MIN_CANVAS - (widths.left ? HANDLE : 0) - (widths.right ? HANDLE : 0);
    const overflow = Math.max(0, widths.left + widths.right - available);
    const leftRoom = Math.max(0, widths.left - LIMITS.left.min), rightRoom = Math.max(0, widths.right - LIMITS.right.min);
    const totalRoom = leftRoom + rightRoom;
    if (overflow && totalRoom) {
      widths.left -= Math.min(leftRoom, overflow * leftRoom / totalRoom);
      widths.right -= Math.min(rightRoom, overflow * rightRoom / totalRoom);
    }
  } else {
    widths.left = widths.left ? Math.min(widths.left, Math.max(1, containerWidth - 42)) : 0;
    widths.right = widths.right ? Math.min(widths.right, Math.max(1, containerWidth - 42)) : 0;
  }
  const toggle = (side: Side) => compact
    ? setOverlaySide(current => current === side ? null : side)
    : setPreferences(current => ({ ...current, [side]: { ...current[side], collapsed: !current[side].collapsed } }));
  const setOpen = (side: Side, open: boolean) => compact
    ? setOverlaySide(current => open ? side : current === side ? null : current)
    : setPreferences(current => ({ ...current, [side]: { ...current[side], collapsed: !open } }));
  const close = useCallback(() => setOverlaySide(null), []);
  useEffect(() => {
    if (!compact || !overlaySide) return;
    const key = (event: KeyboardEvent) => { if (event.key === "Escape" && !event.defaultPrevented) close(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [compact, overlaySide, close]);
  const limits = (side: Side) => {
    const other = side === "left" ? "right" : "left";
    const max = compact ? Math.max(1, containerWidth - 42)
      : containerWidth - MIN_CANVAS - widths[other] - HANDLE - (widths[other] ? HANDLE : 0);
    return { min: Math.min(LIMITS[side].min, max), max: Math.min(LIMITS[side].max, max) };
  };
  const resize = (side: Side, width: number) => {
    const bound = limits(side);
    setPreferences(current => ({ ...current, [side]: { ...current[side], width: clamp(width, bound.min, bound.max) } }));
  };
  const panel = (side: Side) => ({ id: `${id}-${side}-panel`, collapsed: collapsed(side), width: widths[side], ...limits(side) });
  const panelProps = (side: Side): HTMLAttributes<HTMLElement> => ({
    id: panel(side).id,
    className: `workspace-side-panel workspace-side-panel-${side}`,
    "data-workspace-panel": side,
    style: {
      display: collapsed(side) ? "none" : undefined,
      gridColumn: side === "left" ? 1 : 5, gridRow: 1, minWidth: 0, minHeight: 0,
      ...(compact ? { position: "absolute", top: 0, bottom: 0, [side]: 0, width: widths[side], zIndex: 22 } : {}),
    } as CSSProperties,
  } as HTMLAttributes<HTMLElement>);
  return {
    containerRef, ready, measured, compact, left: panel("left"), right: panel("right"), toggle, setOpen, close, resize,
    reset: (side: Side) => resize(side, LIMITS[side].initial),
    style: { position: "relative", minWidth: 0, overflow: "hidden", gridTemplateColumns: compact ? "0 0 minmax(0, 1fr) 0 0"
      : `${widths.left}px ${widths.left ? HANDLE : 0}px minmax(0, 1fr) ${widths.right ? HANDLE : 0}px ${widths.right}px` } as CSSProperties,
    leftProps: panelProps("left"), rightProps: panelProps("right"),
    centerProps: { className: "workspace-panel-center", style: { gridColumn: 3, gridRow: 1, minWidth: 0, minHeight: 0 } as CSSProperties },
  };
}

type Panels = ReturnType<typeof useWorkspacePanels>;
type PanelProps = { panels: Panels; side: Side; label: string };
export function PanelToggleButton({ panels, side, label }: PanelProps) {
  const closed = panels[side].collapsed;
  return <button type="button" className="workspace-panel-toggle" aria-label={`${closed ? "Показать" : "Скрыть"} панель «${label}»`} aria-expanded={!closed}
    aria-controls={panels[side].id} title={`${closed ? "Показать" : "Скрыть"} панель «${label}»`} onClick={() => panels.toggle(side)}>
    <span aria-hidden="true">{side === "left" ? closed ? "▸" : "◂" : closed ? "◂" : "▸"}</span><span>{label}</span>
  </button>;
}

export function PanelResizeHandle({ panels, side, label }: PanelProps) {
  const drag = useRef<{ x: number; width: number; pointer: number } | null>(null);
  const state = panels[side];
  if (state.collapsed) return null;
  return <div className="workspace-panel-resize" role="separator" tabIndex={0} aria-orientation="vertical" aria-label={`Ширина панели «${label}»`}
    aria-controls={state.id} aria-valuemin={Math.round(state.min)} aria-valuemax={Math.round(state.max)} aria-valuenow={Math.round(state.width)}
    title="Тяните границу. Стрелки ← → меняют ширину; двойной щелчок возвращает стандартную."
    style={panels.compact ? { position: "absolute", top: 0, bottom: 0, [side]: state.width - 3, width: 6, zIndex: 23 }
      : { gridColumn: side === "left" ? 2 : 4, gridRow: 1 }}
    onPointerDown={event => {
      if (event.button !== 0) return;
      event.preventDefault(); event.stopPropagation();
      drag.current = { x: event.clientX, width: state.width, pointer: event.pointerId };
      event.currentTarget.setPointerCapture(event.pointerId);
    }} onPointerMove={event => {
      const current = drag.current;
      if (!current || current.pointer !== event.pointerId) return;
      event.preventDefault(); panels.resize(side, current.width + (event.clientX - current.x) * (side === "left" ? 1 : -1));
    }} onPointerUp={event => { if (drag.current?.pointer === event.pointerId) { drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId); } }}
    onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}
    onDoubleClick={() => panels.reset(side)} onKeyDown={event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const step = event.shiftKey ? 32 : 16;
      const width = event.key === "Home" ? state.min : event.key === "End" ? state.max
        : state.width + (event.key === "ArrowRight" ? step : -step) * (side === "left" ? 1 : -1);
      panels.resize(side, width);
    }} />;
}

export function PanelBackdrop({ panels }: { panels: Panels }) {
  if (!panels.compact || panels.left.collapsed && panels.right.collapsed) return null;
  return <button type="button" className="workspace-panel-backdrop" aria-label="Закрыть открытую панель" onClick={panels.close} />;
}
