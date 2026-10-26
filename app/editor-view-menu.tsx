"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import "./editor-view-menu.css";

export type ViewOption = { id: string; label: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean; hint?: string };
export type ViewAction = { id: string; label: string; onClick: () => void; disabled?: boolean; hint?: string };
type EditorViewMenuProps = { options: ViewOption[]; actions?: ViewAction[] };

export default function EditorViewMenu({ options, actions = [] }: EditorViewMenuProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => menu.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus());
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
    // Keep editor shortcuts from acting on the drawing while this menu has focus.
    event.stopPropagation();
    if (event.key === "Escape") { event.preventDefault(); close(true); return; }
    if (event.key === "Tab") { close(true); return; }
    const buttons = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
    if (!buttons.length || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const index = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
      : event.key === "ArrowDown" ? (current + 1) % buttons.length : (current - 1 + buttons.length) % buttons.length;
    buttons[index]?.focus();
  };

  return <div className="editor-view-menu" data-editor-menu ref={root} onBlur={event => {
    if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) close();
  }}>
    <button ref={trigger} type="button" className={`editor-view-trigger ${open ? "is-open" : ""}`} aria-haspopup="menu"
      aria-expanded={open} aria-controls={menuId} onClick={() => setOpen(value => !value)} onKeyDown={event => {
        if (open) event.stopPropagation();
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); event.stopPropagation(); setOpen(true); }
        if (event.key === "Escape" && open) { event.preventDefault(); close(); }
      }}>Вид <span aria-hidden="true">▾</span></button>
    {open && <div id={menuId} ref={menu} role="menu" aria-label="Вид редактора" className="editor-view-popup" onKeyDown={navigateMenu}>
      {options.map(option => <button type="button" key={option.id} role="menuitemcheckbox" tabIndex={-1} aria-checked={option.checked} disabled={option.disabled}
        title={option.hint} onClick={() => option.onChange(!option.checked)}>
        <span className={`editor-view-check ${option.checked ? "is-checked" : ""}`} aria-hidden="true">{option.checked ? "✓" : ""}</span>
        <span className="editor-view-copy"><span>{option.label}</span>{option.hint && <small>{option.hint}</small>}</span>
      </button>)}
      {!!options.length && !!actions.length && <div role="separator" className="editor-view-divider" />}
      {actions.map(action => <button type="button" key={action.id} role="menuitem" tabIndex={-1} disabled={action.disabled} title={action.hint}
        onClick={() => { close(true); action.onClick(); }}>
        <span className="editor-view-action-mark" aria-hidden="true">↔</span>
        <span className="editor-view-copy"><span>{action.label}</span>{action.hint && <small>{action.hint}</small>}</span>
      </button>)}
      {!options.length && !actions.length && <p className="editor-view-empty">Нет доступных настроек вида.</p>}
    </div>}
  </div>;
}
