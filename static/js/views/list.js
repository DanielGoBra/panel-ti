import { bindFilterBar, filterBar, renderAdvBanner } from "../filters.js";
import { icons } from "../icons.js";
import { PRIORITY, PRIORITY_RANK, STATUS, STATUS_RANK, TYPES, label, store } from "../store.js";
import { askBlockReason, openTask } from "../taskpanel.js";
import {
  approvalChip, confirmDialog, emptyState, person, slaChip, pickAssignee, pickPriority, pickProject, pickStatus, popMenu, prioChip, projectDot,
  statusChip, toast, toastError, typeIcon, dueChip,
} from "../ui.js";
import { $, $$, esc, timeAgo } from "../util.js";

export const title = "Lista";
const selected = new Set();
const collapsed = new Set();

const GROUPS = {
  status: { label: "Estado", key: (t) => t.status, title: (k) => statusChip(k), order: (k) => STATUS_RANK[k] },
  project: { label: "Proyecto", key: (t) => t.project_id || 0, title: (k) => { const p = store.project(k); return p ? `${projectDot(p)}${esc(p.name)}` : "Sin proyecto"; }, order: (k) => store.project(k)?.name || "~" },
  assignee: { label: "Responsable", key: (t) => t.assignee || "", title: (k) => person(k), order: (k) => k || "~" },
  priority: { label: "Prioridad", key: (t) => t.priority, title: (k) => prioChip(k), order: (k) => PRIORITY_RANK[k] },
  none: { label: "Sin agrupar" },
};

const COLS = [
  { key: "key", label: "Clave", val: (t) => [store.project(t.project_id)?.key || "TI", t.number] },
  { key: "title", label: "Título", val: (t) => t.title.toLowerCase() },
  { key: "status", label: "Estado", val: (t) => STATUS_RANK[t.status] },
  { key: "priority", label: "Prioridad", val: (t) => PRIORITY_RANK[t.priority] },
  { key: "assignee", label: "Responsable", val: (t) => t.assignee || "~" },
  { key: "project", label: "Proyecto", val: (t) => store.project(t.project_id)?.name || "~" },
  { key: "due", label: "Vence", val: (t) => t.due_date || "9999" },
  { key: "updated", label: "Actualizada", val: (t) => t.updated_at || "" },
];

function cmp(a, b) {
  if (Array.isArray(a)) return String(a[0]).localeCompare(String(b[0])) || a[1] - b[1];
  return typeof a === "number" ? a - b : String(a).localeCompare(String(b), "es");
}

export function render(root, params) {
  let tasks = store.filtered();
  const notes = [];
  if (params.get("vencidas")) { tasks = tasks.filter((t) => store.isOverdue(t)); notes.push(["vencidas", "Solo vencidas"]); }
  if (params.get("estado")) { tasks = tasks.filter((t) => t.status === params.get("estado")); notes.push(["estado", `Estado: ${label(STATUS, params.get("estado"))}`]); }

  const { key: sortKey, dir } = store.prefs.listSort;
  const col = COLS.find((c) => c.key === sortKey);
  tasks = [...tasks].sort((a, b) => (col ? cmp(col.val(a), col.val(b)) * dir : 0) || cmp(COLS[0].val(a), COLS[0].val(b)));
  for (const id of [...selected]) if (!store.task(id)) selected.delete(id);

  const groupBy = store.prefs.listGroup;
  const g = GROUPS[groupBy] || GROUPS.none;
  let groups;
  if (groupBy === "none") groups = [["", tasks]];
  else {
    const map = new Map();
    tasks.forEach((t) => { const k = g.key(t); if (!map.has(k)) map.set(k, []); map.get(k).push(t); });
    groups = [...map.entries()].sort((a, b) => cmp(g.order(a[0]), g.order(b[0])));
  }

  const head = `<tr><th class="c-chk"><input type="checkbox" class="chk" data-all aria-label="Seleccionar todo"${tasks.length && tasks.every((t) => selected.has(t.id)) ? " checked" : ""}></th>
    ${COLS.map((c) => `<th class="sortable" data-sort="${c.key}">${c.label}${sortKey === c.key ? `<span class="arrow">${dir > 0 ? "▲" : "▼"}</span>` : ""}</th>`).join("")}</tr>`;

  const row = (t) => `<tr class="trow${selected.has(t.id) ? " sel" : ""}" data-id="${t.id}">
    <td class="c-chk"><input type="checkbox" class="chk" data-sel="${t.id}"${selected.has(t.id) ? " checked" : ""} aria-label="Seleccionar"></td>
    <td><span class="key" style="display:inline-flex;gap:6px;align-items:center">${typeIcon(t.type)}${esc(store.taskKey(t))}</span></td>
    <td class="c-title"><button data-open="${t.id}" title="${esc(t.title)}">${esc(t.title)}</button></td>
    <td><button class="cell-btn" data-edit="status"${store.can.edit ? "" : " disabled"}>${statusChip(t.status)}</button>${approvalChip(t)}${t.blocked_by?.length ? `<span class="lock" title="Espera a otras tareas">${icons.lock}</span>` : ""}</td>
    <td><button class="cell-btn" data-edit="priority">${prioChip(t.priority)}</button></td>
    <td><button class="cell-btn" data-edit="assignee">${person(t.assignee, "—")}</button></td>
    <td><button class="cell-btn" data-edit="project">${(() => { const p = store.project(t.project_id); return p ? `<span class="person">${projectDot(p)}<span>${esc(p.name)}</span></span>` : '<span class="muted">—</span>'; })()}</button></td>
    <td><span class="cell-flex">${dueChip(t) || '<span class="muted">—</span>'}${t.status !== "done" ? slaChip(t) : ""}</span></td>
    <td class="muted" style="font-size:12.5px;white-space:nowrap">${esc(timeAgo(t.updated_at))}</td></tr>`;

  const body = groups.map(([k, items]) => {
    const isCol = collapsed.has(`${groupBy}:${k}`);
    return (groupBy === "none" ? "" : `<tr class="group-row"><td colspan="${COLS.length + 1}"><button data-group="${esc(k)}">${isCol ? icons.chevronRight : icons.chevronDown}${g.title(k)}<span class="n">${items.length}</span></button></td></tr>`) +
      (isCol ? "" : items.map(row).join(""));
  }).join("");

  root.innerHTML = `<div class="list-wrap">
    <div class="board-bar">${filterBar()}
      <div class="adv-slot"></div>${notes.map(([k, txt]) => `<button class="chip-btn on" data-unparam="${k}">${txt}<span class="x">${icons.close}</span></button>`).join("")}
      <div class="right">
        <button class="btn sm ghost" data-groupby>${icons.group}Agrupar: ${g.label}</button>
        <span class="muted" style="font-size:12.5px">${tasks.length} tareas</span>
      </div></div>
    ${tasks.length ? `<table class="tbl"><thead>${head}</thead><tbody>${body}</tbody></table>` : emptyState("list", "No hay tareas con estos filtros", "Cambia o quita filtros, o crea una tarea nueva.")}
  </div>
  ${selected.size && store.can.edit ? `<div class="bulk-bar" role="toolbar"><b>${selected.size} seleccionadas</b>
    <button class="btn sm" data-bulk="status">${icons.status}Estado</button>
    <button class="btn sm" data-bulk="priority">${icons.flag}Prioridad</button>
    <button class="btn sm" data-bulk="assignee">${icons.user}Asignar</button>
    <button class="btn sm" data-bulk="project">${icons.folder}Proyecto</button>
    <span class="sep"></span>
    <button class="btn sm" data-bulk="delete">${icons.trash}Eliminar</button>
    <button class="btn sm" data-bulk="clear" title="Quitar selección">${icons.close}</button></div>` : ""}`;

  bindFilterBar(root);
  renderAdvBanner(root);
  const rerender = () => render(root, params);

  $$("[data-unparam]", root).forEach((b) => b.onclick = () => { location.hash = "#/lista"; });
  $("[data-groupby]", root).onclick = (e) => popMenu(e.currentTarget, Object.entries(GROUPS).map(([k, v]) => ({ value: k, html: v.label, selected: k === groupBy })), (v) => { store.setPref("listGroup", v); rerender(); });
  $$("[data-sort]", root).forEach((th) => th.onclick = () => {
    const k = th.dataset.sort;
    const cur = store.prefs.listSort;
    const next = cur.key !== k ? { key: k, dir: 1 } : cur.dir === 1 ? { key: k, dir: -1 } : { key: "", dir: 1 };
    store.setPref("listSort", next);
    rerender();
  });
  $$("[data-group]", root).forEach((b) => b.onclick = () => {
    const k = `${groupBy}:${b.dataset.group}`;
    collapsed.has(k) ? collapsed.delete(k) : collapsed.add(k);
    rerender();
  });
  $$("[data-open]", root).forEach((b) => b.onclick = () => openTask(b.dataset.open));
  $("[data-all]", root)?.addEventListener("change", (e) => { tasks.forEach((t) => e.target.checked ? selected.add(t.id) : selected.delete(t.id)); rerender(); });
  $$("[data-sel]", root).forEach((c) => c.onchange = () => { const id = Number(c.dataset.sel); c.checked ? selected.add(id) : selected.delete(id); rerender(); });

  if (!store.can.edit) { $$("[data-edit]", root).forEach((b) => (b.disabled = true)); $$(".c-chk", root).forEach((c) => (c.style.display = "none")); }
  $$("[data-edit]", root).forEach((b) => b.onclick = () => {
    const t = store.task(b.closest("tr").dataset.id);
    const f = b.dataset.edit;
    const apply = (field) => (v) => {
      if (field === "status" && v === "blocked" && t.status !== "blocked") return askBlockReason(t.id);
      store.updateTask(t.id, { [field]: v }).catch(toastError);
    };
    if (f === "status") pickStatus(b, t.status, apply("status"));
    if (f === "priority") pickPriority(b, t.priority, apply("priority"));
    if (f === "assignee") pickAssignee(b, t.assignee, apply("assignee"));
    if (f === "project") pickProject(b, t.project_id, apply("project_id"));
  });

  $$("[data-bulk]", root).forEach((b) => b.onclick = async () => {
    const ids = [...selected];
    const act = b.dataset.bulk;
    const run = (changes) => store.bulk(ids, { changes }).then((r) => {
      if (r.errors.length) toast(`${r.updated.length} actualizadas · ${r.errors.length} no se pudieron mover: ${r.errors[0].error}`, { error: true, ms: 7000 });
      else toast(`${r.updated.length} tareas actualizadas`);
    }).catch(toastError);
    if (act === "clear") { selected.clear(); return rerender(); }
    if (act === "status") pickStatus(b, null, (v) => run({ status: v }));
    if (act === "priority") pickPriority(b, null, (v) => run({ priority: v }));
    if (act === "assignee") pickAssignee(b, null, (v) => run({ assignee: v }));
    if (act === "project") pickProject(b, null, (v) => run({ project_id: v }));
    if (act === "delete") {
      if (!(await confirmDialog({ title: `Eliminar ${ids.length} tareas`, text: "Se borrarán junto con su checklist y comentarios. No se puede deshacer." }))) return;
      try { await store.bulk(ids, { delete: true }); selected.clear(); toast(`${ids.length} tareas eliminadas`); } catch (e) { toastError(e); }
    }
  });
}

export { TYPES, PRIORITY };
