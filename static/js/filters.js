import { icons } from "./icons.js";
import { PRIORITY, TYPES, label, store } from "./store.js";
import { avatar, popMenu, prioChip, projectDot, typeIcon } from "./ui.js";
import { $, $$, debounce, esc } from "./util.js";

/** Barra de filtros común a tablero, lista y calendario. */
export function filterBar({ project = true } = {}) {
  const f = store.filters;
  const p = store.project(f.project);
  const chip = (key, on, txt, ic) =>
    `<button type="button" class="chip-btn${on ? " on" : ""}" data-f="${key}">${ic || icons.filter}${txt}${on ? `<span class="x" data-clear="${key}" title="Quitar filtro">${icons.close}</span>` : ""}</button>`;
  return `<div class="filters">
    <label class="filter-search">${'<span class="ic">' + icons.search + "</span>"}<input type="search" placeholder="Filtrar por texto o clave" value="${esc(f.q)}" data-focus-key="filter-q" aria-label="Filtrar"></label>
    ${project ? chip("project", !!p, p ? esc(p.name) : "Proyecto", p ? projectDot(p) : icons.folder) : ""}
    ${chip("assignee", !!f.assignee, f.assignee ? esc(f.assignee === "__none" ? "Sin asignar" : f.assignee) : "Responsable", f.assignee && f.assignee !== "__none" ? avatar(f.assignee) : icons.user)}
    ${chip("priority", !!f.priority, f.priority ? label(PRIORITY, f.priority) : "Prioridad", icons.flag)}
    ${chip("type", !!f.type, f.type ? label(TYPES, f.type) : "Tipo", f.type ? typeIcon(f.type) : icons.layers)}
    <button type="button" class="chip-btn${f.mine ? " on" : ""}" data-f="mine">${icons.me}Mis tareas</button>
  </div>`;
}

export function bindFilterBar(root) {
  const input = $(".filter-search input", root);
  if (input) input.oninput = debounce(() => store.setFilters({ q: input.value }), 160);
  $$("[data-clear]", root).forEach((x) => x.onclick = (e) => { e.stopPropagation(); store.setFilters({ [x.dataset.clear]: "" }); });
  $$("[data-f]", root).forEach((b) => b.onclick = () => {
    const k = b.dataset.f;
    const f = store.filters;
    if (k === "mine") return store.setFilters({ mine: !f.mine });
    const set = (v) => store.setFilters({ [k]: v });
    if (k === "project") popMenu(b, [{ value: "", html: "Todos los proyectos", selected: !f.project }, ...store.projects.map((p) => ({ value: String(p.id), html: projectDot(p) + esc(p.name), selected: String(p.id) === String(f.project), text: p.name }))], set, { search: true });
    if (k === "assignee") popMenu(b, [{ value: "", html: "Cualquiera", selected: !f.assignee }, { value: "__none", html: avatar("") + "Sin asignar", selected: f.assignee === "__none" }, ...store.members.map((m) => ({ value: m.name, html: avatar(m.name) + esc(m.name), selected: f.assignee === m.name, text: m.name }))], set, { search: true });
    if (k === "priority") popMenu(b, [{ value: "", html: "Todas", selected: !f.priority }, ...PRIORITY.map((p) => ({ value: p.id, html: prioChip(p.id), selected: f.priority === p.id }))], set);
    if (k === "type") popMenu(b, [{ value: "", html: "Todos", selected: !f.type }, ...TYPES.map((t) => ({ value: t.id, html: typeIcon(t.id) + t.label, selected: f.type === t.id }))], set);
  });
}

export const hasFilters = () => { const f = store.filters; return !!(f.q || f.project || f.assignee || f.priority || f.type || f.mine); };

/** Muestra el filtro procedente de una pregunta en lenguaje natural y permite quitarlo. */
export function renderAdvBanner(root) {
  const slot = $(".adv-slot", root);
  const a = store.filters.adv;
  if (!slot) return;
  if (!a) { slot.innerHTML = ""; return; }
  slot.innerHTML = `<button type="button" class="chip-btn on adv-chip" title="Quitar filtro">${icons.question}<span>${esc(a.question ? `«${a.question}»` : a.explanation)}</span><span class="x">${icons.close}</span></button>`;
  $("button", slot).title = a.explanation || "";
  $("button", slot).onclick = () => store.setFilters({ adv: null });
}
