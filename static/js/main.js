import { icons } from "./icons.js";
import { openPalette, isPaletteOpen } from "./palette.js";
import { store } from "./store.js";
import { closeTask, isPanelOpen, openTask } from "./taskpanel.js";
import { anyModalOpen, avatar, closePop, modal, openProjectForm, openTaskForm, popMenu, toast, toastError } from "./ui.js";
import { $, $$, downloadUrl, esc } from "./util.js";
import * as home from "./views/home.js";
import * as mytasks from "./views/mytasks.js";
import * as board from "./views/board.js";
import * as list from "./views/list.js";
import * as calendar from "./views/calendar.js";
import * as projects from "./views/projects.js";
import * as team from "./views/team.js";
import * as reports from "./views/reports.js";

const ROUTES = [
  { path: "inicio", view: home, icon: "home", label: "Inicio", key: "i" },
  { path: "mis-tareas", view: mytasks, icon: "me", label: "Mis tareas", key: "m" },
  { path: "tablero", view: board, icon: "board", label: "Tablero", key: "t", filtered: true },
  { path: "lista", view: list, icon: "list", label: "Lista", key: "l", filtered: true },
  { path: "calendario", view: calendar, icon: "calendar", label: "Calendario", key: "c", filtered: true },
  { path: "proyectos", view: projects, icon: "folder", label: "Proyectos", key: "p" },
  { path: "equipo", view: team, icon: "team", label: "Equipo", key: "e" },
  { path: "informes", view: reports, icon: "report", label: "Informes", key: "r" },
];
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

let current = null; // { route, params }

function parseHash() {
  const [path, query = ""] = location.hash.replace(/^#\/?/, "").split("?");
  const route = ROUTES.find((r) => r.path === path) || ROUTES[0];
  return { route, params: new URLSearchParams(query) };
}

/** Navega aplicando filtros limpios (útil desde proyectos, equipo, etc.). */
export function nav(hash, filterPatch) {
  if (filterPatch) {
    Object.assign(store.filters, { q: "", project: "", assignee: "", priority: "", type: "", mine: false }, filterPatch);
    store.setFilters({});
  }
  if (location.hash === hash) render();
  else location.hash = hash;
}

// ---------- Render ----------
function render({ keepScroll = false } = {}) {
  const { route, params } = parseHash();
  const root = $("#view");
  const same = current && current.route === route;
  const scroll = keepScroll && same ? snapshot(root) : null;
  current = { route, params };
  closePop();
  route.view.render(root, params, nav);
  if (scroll) restore(root, scroll);
  else if (!same) root.scrollTop = 0;
  renderChrome();
  if (params.get("t") && !isPanelOpen()) openTask(params.get("t"));
}

function snapshot(root) {
  const a = document.activeElement;
  return {
    top: root.scrollTop,
    keyed: $$("[data-scroll-key]", root).map((x) => [x.dataset.scrollKey, x.scrollTop, x.scrollLeft]),
    focus: a && root.contains(a) && a.dataset.focusKey ? [a.dataset.focusKey, a.selectionStart, a.selectionEnd] : null,
  };
}
function restore(root, s) {
  root.scrollTop = s.top;
  s.keyed.forEach(([k, t, l]) => { const x = $(`[data-scroll-key="${k}"]`, root); if (x) { x.scrollTop = t; x.scrollLeft = l; } });
  if (s.focus) {
    const x = $(`[data-focus-key="${s.focus[0]}"]`, root);
    if (x) { x.focus(); try { x.setSelectionRange(s.focus[1], s.focus[2]); } catch (e) { /* tipo sin selección */ } }
  }
}

function renderChrome() {
  const { route } = current;
  const f = store.filters;
  const proj = route.filtered ? store.project(f.project) : null;
  const mine = store.tasks.filter((t) => t.assignee === store.user && t.status !== "done");
  const mineOver = mine.filter((t) => store.isOverdue(t)).length;

  $("#nav").innerHTML = ROUTES.map((r) => {
    let count = "";
    if (r.path === "mis-tareas" && mine.length) count = `<span class="count${mineOver ? " alert" : ""}" title="${mineOver ? mineOver + " vencidas" : ""}">${mine.length}</span>`;
    const active = r === route && !(r.filtered && proj);
    return `<a class="nav-item${active ? " active" : ""}" href="#/${r.path}">${icons[r.icon]}${r.label}${count}</a>`;
  }).join("");
  $$("#nav svg").forEach((s) => s.classList.add("ic"));

  $("#side-projects").innerHTML = store.projects.filter((p) => p.status !== "closed").map((p) => {
    const n = store.openCount(p.id);
    return `<button class="side-project${proj && proj.id === p.id ? " active" : ""}" data-p="${p.id}" title="${esc(p.name)}">${`<span class="p-dot" style="background:${esc(p.color)}"></span>`}<span class="p-name">${esc(p.name)}</span><span class="count">${n || ""}</span></button>`;
  }).join("") || `<div class="muted" style="font-size:12.5px;padding:4px 8px">Sin proyectos</div>`;
  $$("#side-projects [data-p]").forEach((b) => b.onclick = () => {
    const target = route.filtered ? `#/${route.path}` : "#/tablero";
    nav(target, { project: b.dataset.p });
    $("#app").classList.remove("nav-open");
  });

  const me = store.member(store.user);
  $("#me-btn").innerHTML = `${avatar(store.user)}<span style="min-width:0"><div class="me-name">${esc(store.user || "Elegir usuario")}</div><div class="me-role">${esc(me?.role || "")}</div></span>`;
  $("#ws-sub").textContent = store.settings.workspace || "Tecnología";

  $("#crumbs").innerHTML = proj
    ? `<a href="#/proyectos">Proyectos</a><span class="sep">/</span><span class="p-dot" style="background:${esc(proj.color)}"></span><b>${esc(proj.name)}</b><span class="sep">/</span><span>${route.label}</span>`
    : `${icons[route.icon].replace("<svg", '<svg class="ic"')}<b>${route.label}</b>`;

  const acts = [];
  if (route.path === "lista") acts.push(`<button class="btn" data-top="csv" title="Descargar todas las tareas en CSV">${icons.csv}<span class="lbl">Exportar CSV</span></button>`);
  if (route.path === "proyectos") acts.push(`<button class="btn primary" data-top="project">${icons.plus}<span class="lbl">Nuevo proyecto</span></button>`);
  else if (route.path !== "informes" && route.path !== "equipo") acts.push(`<button class="btn primary" data-top="task" title="Nueva tarea (C)">${icons.plus}<span class="lbl">Nueva tarea</span></button>`);
  $("#topbar-actions").innerHTML = acts.join("");
  $$("[data-top]").forEach((b) => b.onclick = () => {
    if (b.dataset.top === "task") newTask();
    if (b.dataset.top === "project") openProjectForm();
    if (b.dataset.top === "csv") downloadUrl("/api/export/tasks.csv");
  });
}

function newTask(extra = {}) {
  const f = store.filters;
  const filtered = current?.route.filtered;
  openTaskForm({
    project_id: filtered ? f.project : "",
    assignee: current?.route.path === "mis-tareas" || (filtered && f.mine) ? store.user : (filtered && f.assignee && f.assignee !== "__none" ? f.assignee : ""),
    ...extra,
  }, (t, open) => open && openTask(t.id));
}

// ---------- Tema y usuario ----------
function themeIcon() {
  const t = document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  $("#theme-btn").innerHTML = t === "dark" ? icons.sun : icons.moon;
  $("#theme-btn").title = t === "dark" ? "Usar tema claro" : "Usar tema oscuro";
}
function toggleTheme() {
  const cur = document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const next = cur === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("pti.theme", next); } catch (e) { /* sin almacenamiento */ }
  themeIcon();
  render({ keepScroll: true }); // los gráficos leen los colores del tema
}

function pickUser(anchor) {
  popMenu(anchor, [
    { label: "Trabajar como" },
    ...store.members.map((m) => ({ value: m.name, html: `${avatar(m.name)}${esc(m.name)}`, selected: m.name === store.user, text: m.name })),
    { sep: true },
    { value: "__team", html: `${icons.team}Gestionar equipo` },
  ], (v) => {
    if (v === "__team") return (location.hash = "#/equipo");
    store.setUser(v);
    toast(`Ahora trabajas como ${v}`);
  }, { search: store.members.length > 6 });
}

function showShortcuts() {
  const k = (s) => s.split("+").map((x) => `<kbd>${x}</kbd>`).join(" ");
  modal({
    title: "Atajos de teclado",
    size: "sm",
    hideSave: true,
    cancelLabel: "Cerrar",
    body: `<div class="shortcuts">
      <span>Buscar o ejecutar una acción</span>${k(isMac ? "⌘+K" : "Ctrl+K")}
      <span>Nueva tarea</span>${k("C")}
      <span>Filtrar la vista actual</span>${k("/")}
      ${ROUTES.map((r) => `<span>Ir a ${r.label}</span><span>${k("G")} ${k(r.key.toUpperCase())}</span>`).join("")}
      <span>Cerrar panel o diálogo</span>${k("Esc")}
      <span>Guardar formulario</span>${k("Ctrl+Enter")}
    </div>`,
  });
}

function paletteActions() {
  const acts = [
    { label: "Nueva tarea", icon: "plus", hint: "C", keywords: "crear añadir", run: () => newTask() },
    { label: "Nuevo proyecto", icon: "folder", keywords: "crear", run: () => openProjectForm() },
    ...ROUTES.map((r) => ({ label: `Ir a ${r.label}`, icon: r.icon, hint: `G ${r.key.toUpperCase()}`, run: () => { location.hash = `#/${r.path}`; } })),
    { label: "Ver tareas vencidas", icon: "calendar", keywords: "retrasos atrasadas", run: () => nav("#/lista?vencidas=1", {}) },
    { label: "Ver tareas bloqueadas", icon: "blocked", keywords: "bloqueos", run: () => nav("#/lista?estado=blocked", {}) },
    { label: "Exportar tareas a CSV", icon: "csv", keywords: "excel descargar", run: () => downloadUrl("/api/export/tasks.csv") },
    { label: "Cambiar tema claro/oscuro", icon: "moon", keywords: "modo noche", run: toggleTheme },
    { label: "Cambiar de usuario", icon: "user", run: () => pickUser($("#me-btn")) },
    { label: "Atajos de teclado", icon: "keyboard", run: showShortcuts },
  ];
  acts.goProject = (id) => nav("#/tablero", { project: id });
  return acts;
}

// ---------- Teclado ----------
let gPending = false;
function onKey(e) {
  const typing = e.target.closest("input, textarea, select, [contenteditable]");
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); closePop(); openPalette(paletteActions()); return; }
  if (e.key === "Escape") {
    if (anyModalOpen() || isPaletteOpen()) return;
    if (isPanelOpen() && !typing) { closeTask(); return; }
    if (typing && e.target.matches(".filter-search input")) { e.target.blur(); }
    return;
  }
  if (typing || e.ctrlKey || e.metaKey || e.altKey || anyModalOpen() || isPaletteOpen()) return;
  if (gPending) {
    gPending = false;
    const r = ROUTES.find((x) => x.key === e.key.toLowerCase());
    if (r) { e.preventDefault(); if (isPanelOpen()) closeTask(); location.hash = `#/${r.path}`; }
    return;
  }
  if (e.key === "g") { gPending = true; setTimeout(() => (gPending = false), 1200); return; }
  if (e.key === "c") { e.preventDefault(); newTask(); }
  if (e.key === "/") { const i = $(".filter-search input"); if (i) { e.preventDefault(); i.focus(); i.select(); } }
  if (e.key === "?") showShortcuts();
}

// ---------- Arranque ----------
let pending = null;
function scheduleRender(reason) {
  if (!current) return;
  const v = current.route.view;
  if (reason === "filters" && !current.route.filtered) return renderChrome();
  if (v.refreshOn && !v.refreshOn.includes(reason)) return renderChrome();
  clearTimeout(pending);
  pending = setTimeout(() => render({ keepScroll: true }), v === home ? 350 : 0);
}

async function boot() {
  $$("[data-icon]").forEach((x) => (x.innerHTML = icons[x.dataset.icon]));
  $("#cmdk-kbd").textContent = isMac ? "⌘K" : "Ctrl K";
  $("#help-btn").innerHTML = icons.keyboard;
  themeIcon();
  $("#theme-btn").onclick = toggleTheme;
  $("#help-btn").onclick = showShortcuts;
  $("#me-btn").onclick = (e) => pickUser(e.currentTarget);
  $("#open-cmdk").onclick = () => openPalette(paletteActions());
  $("#side-new-project").onclick = () => openProjectForm();
  $("#menu-toggle").onclick = () => $("#app").classList.toggle("nav-open");
  $("#app").addEventListener("click", (e) => { if (e.target.closest(".nav-item")) $("#app").classList.remove("nav-open"); });
  document.addEventListener("keydown", onKey);
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (!document.documentElement.dataset.theme) { themeIcon(); render({ keepScroll: true }); } });

  try {
    await store.load();
  } catch (e) {
    $("#view").innerHTML = `<div class="page"><div class="empty">${icons.alert}<h3>No hay conexión con el servidor</h3><p>${esc(e.message)}. Comprueba que <code>python3 app.py</code> está en marcha.</p></div></div>`;
    return;
  }
  store.on(scheduleRender);
  window.addEventListener("hashchange", () => {
    const { route } = parseHash();
    if (current && route === current.route && isPanelOpen()) return; // solo cambió ?t=
    if (isPanelOpen()) closeTask();
    render();
  });
  if (!location.hash) history.replaceState(null, "", "#/inicio");
  render();
}

window.addEventListener("unhandledrejection", (e) => { if (e.reason?.name === "ApiError" || e.reason instanceof Error) toastError(e.reason); });
boot();
