import { get, post, setApiHooks } from "./api.js";
import { icons } from "./icons.js";
import { showAuth } from "./login.js";
import { closeNotifications, toggleNotifications } from "./notifications.js";
import { isPaletteOpen, openPalette } from "./palette.js";
import { ROLES, label, store } from "./store.js";
import { closeTask, isPanelOpen, openTask, refreshOpenTask } from "./taskpanel.js";
import { anyModalOpen, avatar, closePop, modal, openProfile, openProjectForm, openTaskForm, popMenu, toast, toastError } from "./ui.js";
import { $, $$, downloadUrl, esc } from "./util.js";
import * as assets from "./views/assets.js";
import * as board from "./views/board.js";
import * as calendar from "./views/calendar.js";
import * as home from "./views/home.js";
import * as list from "./views/list.js";
import * as mytasks from "./views/mytasks.js";
import * as pages from "./views/pages.js";
import * as projects from "./views/projects.js";
import * as reports from "./views/reports.js";
import * as settings from "./views/settings.js";
import * as team from "./views/team.js";

const pageIndex = { render: (root) => pages.renderIndex(root), refreshOn: ["page", "load", "remote"] };
const pageView = { render: (root, params, navFn) => pages.renderPage(root, params.get("id"), navFn), refreshOn: ["page-reload"] };

const ROUTES = [
  { path: "inicio", view: home, icon: "home", label: "Inicio", key: "i" },
  { path: "mis-tareas", view: mytasks, icon: "me", label: "Mis tareas", key: "m" },
  { path: "tablero", view: board, icon: "board", label: "Tablero", key: "t", filtered: true },
  { path: "lista", view: list, icon: "list", label: "Lista", key: "l", filtered: true },
  { path: "calendario", view: calendar, icon: "calendar", label: "Calendario", key: "c", filtered: true },
  { path: "paginas", view: pageIndex, icon: "book", label: "Páginas", key: "w" },
  { path: "proyectos", view: projects, icon: "folder", label: "Proyectos", key: "p" },
  { path: "activos", view: assets, icon: "asset", label: "Activos", key: "a" },
  { path: "equipo", view: team, icon: "team", label: "Equipo", key: "e" },
  { path: "informes", view: reports, icon: "report", label: "Informes", key: "r" },
  { path: "ajustes", view: settings, icon: "gear", label: "Ajustes", key: "s", admin: true },
  { path: "pagina", view: pageView, icon: "page", label: "Página", hidden: true },
];
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const SYNC_MS = 5000;

let current = null; // { route, params }

function parseHash() {
  const [rawPath, query = ""] = location.hash.replace(/^#\/?/, "").split("?");
  const [path, id] = rawPath.split("/");
  const route = ROUTES.find((r) => r.path === path && (!r.admin || store.can.admin)) || ROUTES[0];
  const params = new URLSearchParams(query);
  if (id) params.set("id", id);
  return { route, params, key: rawPath };
}

/** Navega aplicando filtros limpios (útil desde proyectos, equipo, etc.). */
export function nav(hash, filterPatch) {
  if (filterPatch) store.resetFilters(filterPatch);
  if (location.hash === hash) render();
  else location.hash = hash;
}

// ---------- Render ----------
function render({ keepScroll = false } = {}) {
  const parsed = parseHash();
  const root = $("#view");
  const same = current && current.route === parsed.route && current.key === parsed.key;
  const scroll = keepScroll && same ? snapshot(root) : null;
  current = parsed;
  closePop();
  parsed.route.view.render(root, parsed.params, nav);
  if (scroll) restore(root, scroll);
  else if (!same) root.scrollTop = 0;
  renderChrome();
  const t = parsed.params.get("t");
  if (t && !isPanelOpen()) openTask(t);
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

let expanded = new Set((() => { try { return JSON.parse(localStorage.getItem("pti.tree") || "[]"); } catch (e) { return []; } })());
const saveExpanded = () => { try { localStorage.setItem("pti.tree", JSON.stringify([...expanded])); } catch (e) { /* sin almacenamiento */ } };

function pageTree(parent, depth, activeId) {
  const kids = store.pages.filter((p) => (p.parent_id || null) === parent).sort((a, b) => a.position - b.position || a.id - b.id);
  return kids.map((p) => {
    const hasKids = store.pages.some((x) => x.parent_id === p.id);
    const open = expanded.has(p.id);
    return `<div class="tree-row${p.id === activeId ? " active" : ""}" style="--d:${depth}">
        <button class="tree-toggle${hasKids ? "" : " leaf"}" data-toggle-page="${p.id}" tabindex="-1" aria-label="${open ? "Contraer" : "Expandir"}">${hasKids ? (open ? icons.chevronDown : icons.chevronRight) : ""}</button>
        <a class="tree-link" href="#/pagina/${p.id}" title="${esc(pages.pageTitle(p))}">${pages.pageIcon(p)}<span>${esc(pages.pageTitle(p))}</span></a>
        ${store.can.edit ? `<button class="tree-add" data-add-child="${p.id}" title="Añadir subpágina">${icons.plus}</button>` : ""}
      </div>${hasKids && open ? pageTree(p.id, depth + 1, activeId) : ""}`;
  }).join("");
}

function renderChrome() {
  const { route, params } = current;
  const f = store.filters;
  const proj = route.filtered ? store.project(f.project) : null;
  const mine = store.tasks.filter((t) => t.assignee === store.user && t.status !== "done");
  const mineOver = mine.filter((t) => store.isOverdue(t)).length;
  const pendingCab = store.can.cab ? store.tasks.filter((t) => t.approval_status === "pending").length : 0;

  $("#nav").innerHTML = ROUTES.filter((r) => !r.hidden && (!r.admin || store.can.admin)).map((r) => {
    let count = "";
    if (r.path === "mis-tareas" && mine.length) count = `<span class="count${mineOver ? " alert" : ""}" title="${mineOver ? mineOver + " vencidas" : ""}">${mine.length}</span>`;
    if (r.path === "lista" && pendingCab) count = `<span class="count alert" title="Cambios pendientes de tu aprobación">${pendingCab}</span>`;
    const active = r === route && !(r.filtered && proj);
    return `<a class="nav-item${active || (route.path === "pagina" && r.path === "paginas") ? " active" : ""}" href="#/${r.path}${r.path === "lista" && pendingCab ? "" : ""}">${icons[r.icon]}${r.label}${count}</a>`;
  }).join("");
  $$("#nav svg").forEach((s) => s.classList.add("ic"));

  // Árbol de páginas: se expanden los antecesores de la página abierta
  const activePage = route.path === "pagina" ? Number(params.get("id")) : null;
  for (let p = store.page(activePage); p && p.parent_id; p = store.page(p.parent_id)) expanded.add(p.parent_id);
  $("#side-pages").innerHTML = pageTree(null, 0, activePage) || `<div class="muted side-empty">Sin páginas</div>`;
  $$("#side-pages [data-toggle-page]").forEach((b) => b.onclick = () => { const id = Number(b.dataset.togglePage); expanded.has(id) ? expanded.delete(id) : expanded.add(id); saveExpanded(); renderChrome(); });
  $$("#side-pages [data-add-child]").forEach((b) => b.onclick = () => { expanded.add(Number(b.dataset.addChild)); saveExpanded(); pages.newPage({ parent_id: Number(b.dataset.addChild) }); });
  $("#side-new-page").classList.toggle("hidden", !store.can.edit);
  $("#side-new-project").classList.toggle("hidden", !store.can.edit);

  $("#side-projects").innerHTML = store.projects.filter((p) => p.status !== "closed").map((p) => {
    const n = store.openCount(p.id);
    return `<button class="side-project${proj && proj.id === p.id ? " active" : ""}" data-p="${p.id}" title="${esc(p.name)}"><span class="p-dot" style="background:${esc(p.color)}"></span><span class="p-name">${esc(p.name)}</span><span class="count">${n || ""}</span></button>`;
  }).join("") || `<div class="muted side-empty">Sin proyectos</div>`;
  $$("#side-projects [data-p]").forEach((b) => b.onclick = () => {
    nav(route.filtered ? `#/${route.path}` : "#/tablero", { project: b.dataset.p });
    $("#app").classList.remove("nav-open");
  });

  const me = store.me;
  $("#me-btn").innerHTML = `${avatar(me.name)}<span style="min-width:0"><div class="me-name">${esc(me.name)}</div><div class="me-role">${esc(label(ROLES, me.role))}${me.title ? ` · ${esc(me.title)}` : ""}</div></span>`;
  $("#ws-sub").textContent = store.settings.workspace || "Tecnología";
  const badge = $("#bell-badge");
  badge.textContent = store.unread > 99 ? "99+" : store.unread;
  badge.classList.toggle("hidden", !store.unread);
  document.title = `${store.unread ? `(${store.unread}) ` : ""}Panel TI`;

  if (route.path === "pagina") $("#crumbs").innerHTML = pages.pageCrumbs(params.get("id"));
  else $("#crumbs").innerHTML = proj
    ? `<a href="#/proyectos">Proyectos</a><span class="sep">/</span><span class="p-dot" style="background:${esc(proj.color)}"></span><b>${esc(proj.name)}</b><span class="sep">/</span><span>${route.label}</span>`
    : `${icons[route.icon].replace("<svg", '<svg class="ic"')}<b>${route.label}</b>`;

  const acts = [];
  const ed = store.can.edit;
  if (route.path === "lista") acts.push(`<button class="btn" data-top="csv" title="Descargar todas las tareas en CSV">${icons.csv}<span class="lbl">Exportar CSV</span></button>`);
  if (route.path === "pagina") acts.push(`<button class="btn ghost" data-top="page-more" title="Opciones de la página">${icons.more}</button>`);
  if (ed && route.path === "proyectos") acts.push(`<button class="btn primary" data-top="project">${icons.plus}<span class="lbl">Nuevo proyecto</span></button>`);
  else if (ed && ["paginas", "pagina"].includes(route.path)) acts.push(`<button class="btn primary" data-top="page">${icons.plus}<span class="lbl">Nueva página</span></button>`);
  else if (ed && !["informes", "equipo", "ajustes", "activos"].includes(route.path)) acts.push(`<button class="btn primary" data-top="task" title="Nueva tarea (C)">${icons.plus}<span class="lbl">Nueva tarea</span></button>`);
  $("#topbar-actions").innerHTML = acts.join("");
  $$("[data-top]").forEach((b) => b.onclick = () => {
    const a = b.dataset.top;
    if (a === "task") newTask();
    if (a === "project") openProjectForm();
    if (a === "page") pages.newPage({ parent_id: route.path === "pagina" ? Number(params.get("id")) : null });
    if (a === "csv") downloadUrl("/api/export/tasks.csv");
    if (a === "page-more") {
      const id = Number(params.get("id"));
      const actions = pages.pageActions(id).filter((o) => store.can.edit || ["md", "link"].includes(o.value) || o.label);
      popMenu(b, store.can.edit ? actions : actions.filter((o) => !o.sep && !o.danger), (v) => pages.runPageAction(v, id, b));
    }
  });
}

function newTask(extra = {}) {
  if (!store.can.edit) return;
  const f = store.filters;
  const filtered = current?.route.filtered;
  openTaskForm({
    project_id: filtered ? f.project : "",
    assignee: current?.route.path === "mis-tareas" || (filtered && f.mine) ? store.user : (filtered && f.assignee && f.assignee !== "__none" ? f.assignee : ""),
    ...extra,
  }, (t, open) => open && openTask(t.id));
}

// ---------- Tema y cuenta ----------
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
  if (current?.route.path !== "pagina") render({ keepScroll: true }); // los gráficos leen los colores del tema
}

async function logout() {
  try { await pages.flush(); await post("/api/auth/logout", {}); } catch (e) { /* la sesión ya no existe */ }
  location.hash = "#/inicio";
  location.reload();
}

function accountMenu(anchor) {
  popMenu(anchor, [
    { label: `${store.me.email || store.me.name}` },
    { value: "profile", html: `${icons.user}Tu cuenta y contraseña` },
    { value: "keys", html: `${icons.keyboard}Atajos de teclado` },
    ...(store.can.admin ? [{ value: "settings", html: `${icons.gear}Ajustes del espacio` }] : []),
    { sep: true },
    { value: "logout", html: `${icons.logout}Cerrar sesión` },
  ], (v) => {
    if (v === "profile") openProfile();
    if (v === "keys") showShortcuts();
    if (v === "settings") location.hash = "#/ajustes";
    if (v === "logout") logout();
  });
}

function showShortcuts() {
  const k = (s) => s.split("+").map((x) => `<kbd>${x}</kbd>`).join(" ");
  modal({
    title: "Atajos de teclado", size: "sm", hideSave: true, cancelLabel: "Cerrar",
    body: `<div class="shortcuts">
      <span>Buscar, preguntar o ejecutar una acción</span>${k(isMac ? "⌘+K" : "Ctrl+K")}
      <span>Nueva tarea</span>${k("C")}
      <span>Filtrar la vista actual</span>${k("/")}
      ${ROUTES.filter((r) => !r.hidden && (!r.admin || store.can.admin)).map((r) => `<span>Ir a ${r.label}</span><span>${k("G")} ${k(r.key.toUpperCase())}</span>`).join("")}
      <span>Cerrar panel o diálogo</span>${k("Esc")}
      <span>Guardar formulario o enviar comentario</span>${k("Ctrl+Enter")}
      <span>Negrita / cursiva en páginas</span><span>${k("Ctrl+B")} ${k("Ctrl+I")}</span>
      <span>Insertar bloque en páginas</span>${k("/")}
    </div>`,
  });
}

function paletteActions() {
  const acts = [
    ...(store.can.edit ? [
      { label: "Nueva tarea", icon: "plus", hint: "C", keywords: "crear añadir", run: () => newTask() },
      { label: "Nueva página", icon: "page", keywords: "crear documento wiki acta", run: () => pages.newPage() },
      { label: "Nuevo proyecto", icon: "folder", keywords: "crear", run: () => openProjectForm() },
    ] : []),
    ...ROUTES.filter((r) => !r.hidden && (!r.admin || store.can.admin)).map((r) => ({ label: `Ir a ${r.label}`, icon: r.icon, hint: `G ${r.key.toUpperCase()}`, run: () => { location.hash = `#/${r.path}`; } })),
    { label: "Ver tareas vencidas", icon: "calendar", keywords: "retrasos atrasadas", run: () => nav("#/lista?vencidas=1", {}) },
    { label: "Ver tareas bloqueadas", icon: "blocked", keywords: "bloqueos", run: () => nav("#/lista?estado=blocked", {}) },
    { label: "Incidentes con el SLA en riesgo", icon: "timer", keywords: "sla incumplido", run: () => applyQuestion({ sla: "risk", explanation: "Incidentes con SLA en riesgo o superado", statuses: [], types: [] }, "SLA en riesgo") },
    { label: "Cambios pendientes de aprobación", icon: "approve", keywords: "cab aprobar", run: () => applyQuestion({ approval: "pending", explanation: "Cambios pendientes del CAB", statuses: [], types: ["change"] }, "Pendientes del CAB") },
    { label: "Exportar tareas a CSV", icon: "csv", keywords: "excel descargar", run: () => downloadUrl("/api/export/tasks.csv") },
    { label: "Cambiar tema claro/oscuro", icon: "moon", keywords: "modo noche", run: toggleTheme },
    { label: "Tu cuenta y contraseña", icon: "user", keywords: "perfil", run: openProfile },
    { label: "Atajos de teclado", icon: "keyboard", run: showShortcuts },
    { label: "Cerrar sesión", icon: "logout", keywords: "salir", run: logout },
  ];
  acts.goProject = (id) => nav("#/tablero", { project: id });
  acts.ask = askQuestion;
  return acts;
}

function applyQuestion(filters, question) {
  store.resetFilters({ adv: { ...filters, question } });
  if (current?.route.path !== "lista") location.hash = "#/lista";
  else render();
}

async function askQuestion(q) {
  try {
    const r = await post("/api/ai/query", { q });
    applyQuestion(r.filters, q);
    toast(r.filters.explanation || "Filtro aplicado");
  } catch (e) { toastError(e); }
}

// ---------- Teclado ----------
let gPending = false;
function onKey(e) {
  const typing = e.target.closest("input, textarea, select, [contenteditable]");
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); closePop(); closeNotifications(); openPalette(paletteActions()); return; }
  if (e.key === "Escape") {
    if (anyModalOpen() || isPaletteOpen()) return;
    closeNotifications();
    if (isPanelOpen() && !typing) { closeTask(); return; }
    if (typing && e.target.matches(".filter-search input")) e.target.blur();
    return;
  }
  if (typing || e.ctrlKey || e.metaKey || e.altKey || anyModalOpen() || isPaletteOpen()) return;
  if (gPending) {
    gPending = false;
    const r = ROUTES.find((x) => x.key === e.key.toLowerCase() && !x.hidden && (!x.admin || store.can.admin));
    if (r) { e.preventDefault(); if (isPanelOpen()) closeTask(); location.hash = `#/${r.path}`; }
    return;
  }
  if (e.key === "g") { gPending = true; setTimeout(() => (gPending = false), 1200); return; }
  if (e.key === "c") { e.preventDefault(); newTask(); }
  if (e.key === "/") { const i = $(".filter-search input"); if (i) { e.preventDefault(); i.focus(); i.select(); } }
  if (e.key === "?") showShortcuts();
}

// ---------- Actualización en vivo ----------
let pending = null;
function scheduleRender(reason) {
  if (!current) return;
  const v = current.route.view;
  if (reason === "unread") return renderChrome();
  if (reason === "filters" && !current.route.filtered) return renderChrome();
  if (reason === "page-meta") return renderChrome();
  if (current.route.path === "pagina" && reason !== "page-reload") return renderChrome();
  if (v.refreshOn && !v.refreshOn.includes(reason)) return renderChrome();
  clearTimeout(pending);
  pending = setTimeout(() => render({ keepScroll: true }), v === home ? 350 : 0);
}

let syncing = false;
async function syncTick() {
  if (syncing || document.hidden) return;
  syncing = true;
  try {
    const s = await get("/api/sync");
    if (s.unread !== store.unread) { store.unread = s.unread; renderChrome(); }
    if (s.revision > store.revision) {
      const quiet = anyModalOpen() || pages.isEditingPage();
      if (!quiet) {
        await store.load("remote");
        refreshOpenTask();
        if (current?.route.path === "pagina") store.emit("page-reload");
        flashLive();
      }
    }
  } catch (e) { /* sin conexión: se reintenta en el siguiente ciclo */ }
  finally { syncing = false; }
}
function flashLive() {
  const d = $("#live-dot");
  d.classList.remove("pulse");
  void d.offsetWidth;
  d.classList.add("pulse");
}

// ---------- Arranque ----------
async function boot() {
  $$("[data-icon]").forEach((x) => (x.innerHTML = icons[x.dataset.icon]));
  $("#cmdk-kbd").textContent = isMac ? "⌘K" : "Ctrl K";
  $("#help-btn").innerHTML = icons.keyboard;
  themeIcon();
  setApiHooks({
    onUnauthorized: () => { if (store.me) location.reload(); },
    onRevision: (rev) => { if (rev === store.revision + 1) store.revision = rev; },
  });

  let status;
  try { status = await get("/api/auth/status"); } catch (e) {
    document.body.innerHTML = `<div class="page"><div class="empty">${icons.alert}<h3>No hay conexión con el servidor</h3><p>${esc(e.message)}. Comprueba que el servidor está en marcha.</p></div></div>`;
    return;
  }
  if (!status.authenticated) await showAuth(status);

  try { await store.load(); } catch (e) { return toastError(e); }
  $("#app").classList.remove("hidden");
  $("#theme-btn").onclick = toggleTheme;
  $("#help-btn").onclick = showShortcuts;
  $("#me-btn").onclick = (e) => accountMenu(e.currentTarget);
  $("#bell-btn").onclick = (e) => toggleNotifications(e.currentTarget);
  $("#open-cmdk").onclick = () => openPalette(paletteActions());
  $("#side-new-project").onclick = () => openProjectForm();
  $("#side-new-page").onclick = () => pages.newPage();
  $("#menu-toggle").onclick = () => $("#app").classList.toggle("nav-open");
  $("#app").addEventListener("click", (e) => { if (e.target.closest(".nav-item, .tree-link")) $("#app").classList.remove("nav-open"); });
  document.addEventListener("keydown", onKey);
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (!document.documentElement.dataset.theme) { themeIcon(); render({ keepScroll: true }); } });
  window.addEventListener("beforeunload", () => { pages.flush(); });

  store.on(scheduleRender);
  window.addEventListener("hashchange", async () => {
    const next = parseHash();
    if (current && next.route === current.route && next.key === current.key && isPanelOpen()) return; // solo cambió ?t=
    if (isPanelOpen()) closeTask();
    if (current?.route.path === "pagina") await pages.flush();
    render();
  });
  if (!location.hash || location.hash.startsWith("#/login")) history.replaceState(null, "", "#/inicio");
  render();
  get("/api/sync").then((s) => { store.unread = s.unread; renderChrome(); }).catch(() => {});
  setInterval(syncTick, SYNC_MS);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) syncTick(); });
}

window.addEventListener("unhandledrejection", (e) => { if (e.reason?.name === "ApiError") toastError(e.reason); });
boot();
