import { icon, icons } from "./icons.js";
import { PRIORITY, PROJECT_COLORS, STATUS, TYPES, label, store } from "./store.js";
import { $, $$, avatarTone, diffDays, el, esc, initials, relDue } from "./util.js";

// ---------- Átomos ----------
export const statusDot = (s) => `<span class="status-dot" data-s="${s}"></span>`;
export const statusChip = (s) => `<span class="status" data-s="${s}">${statusDot(s)}${label(STATUS, s)}</span>`;

export function prioIcon(p) {
  if (p === "critical") return `<span class="prio-crit" aria-hidden="true">!</span>`;
  return `<span class="prio-bars" aria-hidden="true"><i></i><i></i><i></i></span>`;
}
export const prioChip = (p, withLabel = true) =>
  `<span class="prio" data-p="${p}" title="Prioridad ${label(PRIORITY, p).toLowerCase()}">${prioIcon(p)}${withLabel ? label(PRIORITY, p) : ""}</span>`;

export const typeIcon = (t) => `<span class="type-ic" data-t="${t}" title="${label(TYPES, t)}">${icons["t_" + t] || icons.t_task}</span>`;

export function avatar(name, cls = "") {
  if (!name) return `<span class="avatar empty ${cls}" title="Sin asignar">${icons.user}</span>`;
  return `<span class="avatar ${cls}" style="--av:${avatarTone(name)}" title="${esc(name)}">${esc(initials(name))}</span>`;
}
export const person = (name, empty = "Sin asignar") =>
  `<span class="person">${avatar(name)}<span${name ? "" : ' class="muted"'}>${esc(name || empty)}</span></span>`;

export function dueChip(t, { long = false } = {}) {
  if (!t.due_date) return "";
  let cls = "";
  if (t.status !== "done") {
    const n = diffDays(t.due_date, store.today);
    if (n < 0) cls = "over";
    else if (n <= 2) cls = "soon";
  }
  const txt = long ? relDue(t.due_date) : relDue(t.due_date);
  return `<span class="due ${cls}" title="Vence ${esc(t.due_date)}">${icons.calendar}${esc(txt)}</span>`;
}

export function projectDot(p) {
  return p ? `<span class="p-dot" style="background:${esc(p.color)}"></span>` : "";
}

export function healthBadge(state) {
  const map = { ok: ["En plazo", "done"], watch: ["Vigilar", "clock"], risk: ["En riesgo", "alert"] };
  const [txt, ic] = map[state] || map.ok;
  return `<span class="health ${state}">${icons[ic]}${txt}</span>`;
}

export function emptyState(ic, title, text, actionHtml = "") {
  return `<div class="empty">${icons[ic] || ""}<h3>${esc(title)}</h3><p>${esc(text)}</p>${actionHtml}</div>`;
}

// ---------- Toast ----------
export function toast(msg, { action, onAction, error = false, ms = 4200 } = {}) {
  const node = el(`<div class="toast${error ? " err" : ""}"><span>${esc(msg)}</span>${action ? `<button type="button">${esc(action)}</button>` : ""}</div>`);
  $("#toasts").appendChild(node);
  const close = () => node.remove();
  if (action) node.querySelector("button").onclick = () => { close(); onAction && onAction(); };
  setTimeout(close, ms);
}
export const toastError = (e) => toast(e?.message || "Algo salió mal", { error: true });

// ---------- Popover genérico ----------
let openPop = null;
export function closePop() {
  if (openPop) { openPop.remove(); openPop = null; document.removeEventListener("mousedown", outside, true); document.removeEventListener("keydown", popKeys, true); }
}
function outside(e) { if (openPop && !openPop.contains(e.target)) closePop(); }
function popKeys(e) {
  if (!openPop) return;
  const items = $$(".pop-item", openPop).filter((x) => x.offsetParent);
  let i = items.findIndex((x) => x.classList.contains("hl"));
  if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); closePop(); }
  else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    i = e.key === "ArrowDown" ? Math.min(items.length - 1, i + 1) : Math.max(0, i - 1);
    items.forEach((x) => x.classList.remove("hl"));
    items[i]?.classList.add("hl");
    items[i]?.scrollIntoView({ block: "nearest" });
  } else if (e.key === "Enter" && i >= 0) { e.preventDefault(); items[i].click(); }
}

/**
 * Menú anclado a un elemento.
 * options: [{ value, html, selected, danger, sep, label }]
 */
export function popMenu(anchor, options, onPick, { search = false, placeholder = "Buscar…" } = {}) {
  closePop();
  const pop = el(`<div class="pop" role="menu"></div>`);
  if (search) pop.appendChild(el(`<input class="pop-search" placeholder="${esc(placeholder)}">`));
  options.forEach((o) => {
    if (o.sep) return pop.appendChild(el(`<div class="pop-sep"></div>`));
    if (o.label) return pop.appendChild(el(`<div class="pop-label">${esc(o.label)}</div>`));
    const b = el(`<button type="button" class="pop-item${o.danger ? " danger" : ""}" role="menuitem">${o.html}${o.selected ? `<span class="tick">${icons.check}</span>` : ""}</button>`);
    b.dataset.search = (o.text || b.textContent).toLowerCase();
    b.onclick = () => { closePop(); onPick(o.value); };
    pop.appendChild(b);
  });
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  let left = Math.min(r.left, window.innerWidth - pw - 8);
  let top = r.bottom + 4;
  if (top + ph > window.innerHeight - 8) top = Math.max(8, r.top - ph - 4);
  pop.style.left = `${Math.max(8, left)}px`;
  pop.style.top = `${top}px`;
  openPop = pop;
  setTimeout(() => { document.addEventListener("mousedown", outside, true); document.addEventListener("keydown", popKeys, true); });
  const input = $(".pop-search", pop);
  if (input) {
    input.focus();
    input.oninput = () => {
      const q = input.value.toLowerCase();
      $$(".pop-item", pop).forEach((b) => { b.style.display = b.dataset.search.includes(q) ? "" : "none"; });
    };
  }
  return pop;
}

export const pickStatus = (anchor, current, cb) =>
  popMenu(anchor, STATUS.map((s) => ({ value: s.id, html: statusDot(s.id) + `<span data-s="${s.id}">${s.label}</span>`, selected: s.id === current, text: s.label })), cb);

export const pickPriority = (anchor, current, cb) =>
  popMenu(anchor, PRIORITY.map((p) => ({ value: p.id, html: prioChip(p.id), selected: p.id === current, text: p.label })), cb);

export const pickType = (anchor, current, cb) =>
  popMenu(anchor, TYPES.map((t) => ({ value: t.id, html: typeIcon(t.id) + t.label, selected: t.id === current, text: t.label })), cb);

export const pickAssignee = (anchor, current, cb) =>
  popMenu(anchor, [
    { value: "", html: avatar("") + "Sin asignar", selected: !current, text: "sin asignar" },
    ...store.members.map((m) => ({ value: m.name, html: avatar(m.name) + esc(m.name), selected: m.name === current, text: m.name })),
  ], cb, { search: true, placeholder: "Asignar a…" });

export const pickProject = (anchor, current, cb) =>
  popMenu(anchor, [
    { value: null, html: `<span class="p-dot" style="background:var(--border-strong)"></span>Sin proyecto`, selected: !current, text: "sin proyecto" },
    ...store.projects.map((p) => ({ value: p.id, html: projectDot(p) + esc(p.name), selected: p.id === current, text: p.name })),
  ], cb, { search: true, placeholder: "Mover a proyecto…" });

// ---------- Modal ----------
let modalStack = [];
export function modal({ title, sub = "", body = "", saveLabel = "Guardar", danger = false, size = "", onSave, footLeft = "", cancelLabel = "Cancelar", hideSave = false }) {
  const node = el(`<div class="modal-scrim" role="dialog" aria-modal="true">
    <form class="modal ${size}" novalidate>
      <div class="modal-head"><h2>${esc(title)}</h2>${sub ? `<p>${sub}</p>` : ""}</div>
      <div class="modal-body">${body}<div class="form-error hidden"></div></div>
      <div class="modal-foot"><span class="left">${footLeft}</span>
        <button type="button" class="btn ghost" data-cancel>${esc(cancelLabel)}</button>
        ${hideSave ? "" : `<button type="submit" class="btn ${danger ? "danger" : "primary"}">${esc(saveLabel)}</button>`}
      </div>
    </form></div>`);
  const form = $("form", node);
  const close = () => { node.remove(); modalStack = modalStack.filter((m) => m !== node); document.removeEventListener("keydown", onKey, true); };
  const onKey = (e) => {
    if (modalStack[modalStack.length - 1] !== node) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); form.requestSubmit(); }
  };
  node.addEventListener("mousedown", (e) => { if (e.target === node) close(); });
  $("[data-cancel]", node).onclick = close;
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (!onSave) return close();
    const btn = $("button[type=submit]", form);
    btn.disabled = true;
    try {
      const keep = await onSave(form, close);
      if (keep !== false) close();
    } catch (err) {
      const box = $(".form-error", form);
      box.textContent = err.message;
      box.classList.remove("hidden");
    } finally { btn.disabled = false; }
  };
  document.body.appendChild(node);
  modalStack.push(node);
  document.addEventListener("keydown", onKey, true);
  setTimeout(() => $("[autofocus]", node)?.focus() || $("input, textarea, select", node)?.focus());
  return { node, close };
}
export const anyModalOpen = () => modalStack.length > 0;

export function confirmDialog({ title, text, okLabel = "Eliminar", danger = true }) {
  return new Promise((resolve) => {
    let ok = false;
    const m = modal({ title, sub: esc(text), saveLabel: okLabel, danger, size: "sm", onSave: () => { ok = true; } });
    const obs = new MutationObserver(() => { if (!m.node.isConnected) { obs.disconnect(); resolve(ok); } });
    obs.observe(document.body, { childList: true });
  });
}

// ---------- Formularios ----------
const opt = (list, cur) => list.map((x) => `<option value="${x.id}"${x.id === cur ? " selected" : ""}>${esc(x.label)}</option>`).join("");
const memberOpts = (cur, emptyLabel = "Sin asignar") =>
  `<option value="">${emptyLabel}</option>` + store.members.map((m) => `<option${m.name === cur ? " selected" : ""}>${esc(m.name)}</option>`).join("") +
  (cur && !store.member(cur) ? `<option selected>${esc(cur)}</option>` : "");

export function openTaskForm(defaults = {}, onCreated) {
  const d = { status: "todo", priority: "medium", type: "task", assignee: "", project_id: "", ...defaults };
  modal({
    title: "Nueva tarea",
    saveLabel: "Crear tarea",
    footLeft: "<kbd>Ctrl</kbd> + <kbd>Enter</kbd> para crear",
    body: `<div class="form-grid">
      <label class="field full"><span>Título</span><input class="input" name="title" autofocus placeholder="Ej.: Renovar certificado SSL del portal de empleados" value="${esc(d.title || "")}"></label>
      <label class="field full"><span>Descripción</span><textarea class="input" name="notes" rows="3" placeholder="Contexto, criterios de cierre, enlaces…"></textarea></label>
      <label class="field"><span>Proyecto</span><select class="select" name="project_id"><option value="">Sin proyecto</option>${store.projects.map((p) => `<option value="${p.id}"${String(p.id) === String(d.project_id) ? " selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label>
      <label class="field"><span>Tipo</span><select class="select" name="type">${opt(TYPES, d.type)}</select></label>
      <label class="field"><span>Estado</span><select class="select" name="status">${opt(STATUS, d.status)}</select></label>
      <label class="field"><span>Prioridad</span><select class="select" name="priority">${opt(PRIORITY, d.priority)}</select></label>
      <label class="field"><span>Responsable</span><select class="select" name="assignee">${memberOpts(d.assignee)}</select></label>
      <label class="field"><span>Estimación (horas)</span><input class="input" name="estimate" type="number" min="0" step="0.5" placeholder="—"></label>
      <label class="field"><span>Inicio</span><input class="input" name="start_date" type="date" value="${esc(d.start_date || "")}"></label>
      <label class="field"><span>Vence</span><input class="input" name="due_date" type="date" value="${esc(d.due_date || "")}"></label>
      <label class="field full"><span>Etiquetas</span><input class="input" name="tags" placeholder="Separadas por comas: red, firewall"></label>
    </div>`,
    async onSave(form) {
      const data = Object.fromEntries(new FormData(form));
      if (!data.title.trim()) throw new Error("Escribe un título para la tarea.");
      const t = await store.createTask(data);
      toast(`${store.taskKey(t)} creada`, { action: "Abrir", onAction: () => onCreated?.(t, true) });
      onCreated?.(t, false);
    },
  });
}

export function openProjectForm(p = null) {
  let color = p?.color || PROJECT_COLORS[store.projects.length % PROJECT_COLORS.length];
  const { node } = modal({
    title: p ? "Editar proyecto" : "Nuevo proyecto",
    saveLabel: p ? "Guardar cambios" : "Crear proyecto",
    body: `<div class="form-grid">
      <label class="field full"><span>Nombre</span><input class="input" name="name" autofocus value="${esc(p?.name || "")}" placeholder="Ej.: Renovación de la red WiFi"></label>
      <label class="field"><span>Clave</span><input class="input" name="key" maxlength="6" value="${esc(p?.key || "")}" placeholder="Se genera sola" style="text-transform:uppercase"></label>
      <label class="field"><span>Área</span><input class="input" name="area" value="${esc(p?.area || "")}" placeholder="Infraestructura, Seguridad…"></label>
      <label class="field full"><span>Descripción</span><textarea class="input" name="description" rows="3">${esc(p?.description || "")}</textarea></label>
      <label class="field"><span>Responsable</span><select class="select" name="owner">${memberOpts(p?.owner || "", "Sin responsable")}</select></label>
      <label class="field"><span>Fecha objetivo</span><input class="input" type="date" name="due_date" value="${esc(p?.due_date || "")}"></label>
      <label class="field"><span>Estado</span><select class="select" name="status">${opt([{ id: "active", label: "Activo" }, { id: "paused", label: "En pausa" }, { id: "closed", label: "Cerrado" }], p?.status || "active")}</select></label>
      <div class="field"><span>Color</span><div class="color-row">${PROJECT_COLORS.map((c) => `<button type="button" class="swatch${c === color ? " on" : ""}" data-c="${c}" style="background:${c}" aria-label="Color ${c}"></button>`).join("")}</div></div>
    </div>`,
    async onSave(form) {
      const data = Object.fromEntries(new FormData(form));
      if (!data.name.trim()) throw new Error("El proyecto necesita un nombre.");
      data.color = color;
      if (!data.key) delete data.key;
      const saved = await store.saveProject(p?.id, data);
      toast(p ? "Proyecto actualizado" : `Proyecto ${saved.key} creado`);
    },
  });
  $$(".swatch", node).forEach((b) => b.onclick = () => {
    color = b.dataset.c;
    $$(".swatch", node).forEach((x) => x.classList.toggle("on", x === b));
  });
}

export function openMemberForm(m = null) {
  modal({
    title: m ? "Editar persona" : "Añadir persona",
    saveLabel: m ? "Guardar cambios" : "Añadir",
    body: `<div class="form-grid">
      <label class="field full"><span>Nombre y apellidos</span><input class="input" name="name" autofocus value="${esc(m?.name || "")}"></label>
      <label class="field"><span>Correo</span><input class="input" type="email" name="email" value="${esc(m?.email || "")}"></label>
      <label class="field"><span>Puesto</span><input class="input" name="role" value="${esc(m?.role || "")}" placeholder="Administrador de sistemas"></label>
      <label class="field"><span>Equipo</span><input class="input" name="team" value="${esc(m?.team || "")}" placeholder="Infraestructura"></label>
      <label class="field"><span>Capacidad (tareas abiertas)</span><input class="input" type="number" min="1" max="50" name="capacity" value="${esc(m?.capacity ?? 8)}"></label>
    </div>`,
    async onSave(form) {
      const data = Object.fromEntries(new FormData(form));
      if (!data.name.trim()) throw new Error("Escribe el nombre.");
      await store.saveMember(m?.id, data);
      toast(m ? "Datos actualizados" : `${data.name} se ha añadido al equipo`);
    },
  });
}

export { icon };
