import { get } from "../api.js";
import { icons } from "../icons.js";
import { store } from "../store.js";
import { openTask } from "../taskpanel.js";
import { assetIcon, confirmDialog, emptyState, memberOpts, modal, person, popMenu, statusChip, toast, toastError, typeIcon } from "../ui.js";
import { $, $$, debounce, esc, fmtDate } from "../util.js";

export const title = "Activos";
export const KINDS = [
  { id: "server", label: "Servidor" }, { id: "laptop", label: "Portátil" }, { id: "desktop", label: "Sobremesa" },
  { id: "application", label: "Aplicación" }, { id: "database", label: "Base de datos" }, { id: "network", label: "Red" },
  { id: "cloud", label: "Servicio en la nube" }, { id: "mobile", label: "Móvil" }, { id: "printer", label: "Impresora" }, { id: "other", label: "Otro" },
];
const CRIT = [{ id: "critical", label: "Crítica" }, { id: "high", label: "Alta" }, { id: "medium", label: "Media" }, { id: "low", label: "Baja" }];
const STATUS = [{ id: "active", label: "En servicio" }, { id: "maintenance", label: "Mantenimiento" }, { id: "retired", label: "Retirado" }];
const lbl = (list, id) => (list.find((x) => x.id === id) || {}).label || id;
let q = "";
let kind = "";
let counts = null;

export async function render(root, params) {
  if (!counts) {
    try { counts = Object.fromEntries((await get("/api/assets")).map((a) => [a.id, a])); } catch (e) { counts = {}; }
  }
  const list = store.assets.filter((a) => (!kind || a.kind === kind) && (!q || `${a.name} ${a.identifier} ${a.owner} ${a.location}`.toLowerCase().includes(q.toLowerCase())));
  root.innerHTML = `<div class="page">
    <div class="page-head"><div><div class="page-title">Activos</div>
      <div class="page-sub">Servidores, equipos y aplicaciones con su historial de incidentes y cambios</div></div>
      ${store.can.edit ? `<button class="btn primary" data-new>${icons.plus}Nuevo activo</button>` : ""}</div>
    <div class="board-bar">
      <label class="filter-search"><span class="ic">${icons.search}</span><input type="search" placeholder="Buscar por nombre, identificador o ubicación" value="${esc(q)}" data-focus-key="asset-q"></label>
      <button class="chip-btn${kind ? " on" : ""}" data-kind>${kind ? assetIcon(kind) + lbl(KINDS, kind) : icons.layers + "Tipo"}</button>
      <span class="muted" style="margin-left:auto;font-size:12.5px">${list.length} activos</span>
    </div>
    <div class="card" style="overflow-x:auto">
    ${list.length ? `<table class="ph-table"><thead><tr><th>Activo</th><th>Tipo</th><th>Criticidad</th><th>Responsable</th><th>Ubicación</th><th>Abiertas</th><th>Incidentes</th><th>Estado</th></tr></thead><tbody>
      ${list.map((a) => {
        const c = counts[a.id] || {};
        return `<tr class="click" data-id="${a.id}">
          <td><div class="ph-pname"><span class="asset-ic">${assetIcon(a.kind)}</span><div><div>${esc(a.name)}</div><div class="muted" style="font-size:12px;font-weight:400">${esc(a.identifier || "")}</div></div></div></td>
          <td class="muted">${esc(lbl(KINDS, a.kind))}</td>
          <td><span class="crit ${a.criticality}">${esc(lbl(CRIT, a.criticality))}</span></td>
          <td>${a.owner ? person(a.owner) : '<span class="muted">—</span>'}</td>
          <td class="muted">${esc(a.location || "—")}</td>
          <td class="num">${c.open_tasks ?? 0}</td>
          <td class="num">${c.incidents ?? 0}</td>
          <td class="muted">${esc(lbl(STATUS, a.status))}</td></tr>`;
      }).join("")}</tbody></table>` : emptyState("asset", q || kind ? "Sin coincidencias" : "Aún no hay activos", "Registra servidores, aplicaciones y equipos para vincularlos a incidentes y cambios.")}
    </div></div>`;
  const input = $(".filter-search input", root);
  input.oninput = debounce(() => { q = input.value; render(root, params); }, 200);
  $("[data-kind]", root).onclick = (e) => popMenu(e.currentTarget, [{ value: "", html: "Todos", selected: !kind }, ...KINDS.map((k) => ({ value: k.id, html: assetIcon(k.id) + k.label, selected: k.id === kind }))], (v) => { kind = v; render(root, params); });
  $("[data-new]", root)?.addEventListener("click", () => assetForm(null, () => { counts = null; render(root, params); }));
  $$("tr[data-id]", root).forEach((tr) => tr.onclick = () => showAsset(Number(tr.dataset.id), () => { counts = null; render(root, params); }));
  if (params.get("a")) showAsset(Number(params.get("a")), () => { counts = null; render(root, params); });
}

export const refreshOn = ["asset", "load", "remote", "member"];

function assetForm(a, done) {
  const opt = (list, cur) => list.map((x) => `<option value="${x.id}"${x.id === cur ? " selected" : ""}>${x.label}</option>`).join("");
  modal({
    title: a ? "Editar activo" : "Nuevo activo",
    saveLabel: a ? "Guardar" : "Crear activo",
    body: `<div class="form-grid">
      <label class="field full"><span>Nombre</span><input class="input" name="name" autofocus value="${esc(a?.name || "")}" placeholder="SRV-DB-01, Portal de empleados…"></label>
      <label class="field"><span>Tipo</span><select class="select" name="kind">${opt(KINDS, a?.kind || "server")}</select></label>
      <label class="field"><span>Identificador</span><input class="input" name="identifier" value="${esc(a?.identifier || "")}" placeholder="Hostname, nº de serie o URL"></label>
      <label class="field"><span>Criticidad</span><select class="select" name="criticality">${opt(CRIT, a?.criticality || "medium")}</select></label>
      <label class="field"><span>Estado</span><select class="select" name="status">${opt(STATUS, a?.status || "active")}</select></label>
      <label class="field"><span>Responsable</span><select class="select" name="owner">${memberOpts(a?.owner || "", "Sin responsable")}</select></label>
      <label class="field"><span>Ubicación</span><input class="input" name="location" value="${esc(a?.location || "")}" placeholder="CPD, planta, región cloud…"></label>
      <label class="field full"><span>Notas</span><textarea class="input" name="notes" rows="2">${esc(a?.notes || "")}</textarea></label>
    </div>`,
    async onSave(form) {
      const data = Object.fromEntries(new FormData(form));
      if (!data.name.trim()) throw new Error("El activo necesita un nombre.");
      await store.saveAsset(a?.id, data);
      toast(a ? "Activo actualizado" : "Activo creado");
      done?.();
    },
  });
}

async function showAsset(id, done) {
  let a;
  try { a = await get(`/api/assets/${id}`); } catch (e) { return toastError(e); }
  const incidents = a.tasks.filter((t) => t.type === "incident");
  const { node, close } = modal({
    title: a.name, size: "", hideSave: true, cancelLabel: "Cerrar",
    sub: `${esc(lbl(KINDS, a.kind))}${a.identifier ? ` · ${esc(a.identifier)}` : ""} · criticidad ${esc(lbl(CRIT, a.criticality).toLowerCase())}`,
    body: `<div class="asset-detail">
      <div class="asset-facts">
        <div><span>Responsable</span>${a.owner ? person(a.owner) : "—"}</div>
        <div><span>Ubicación</span>${esc(a.location || "—")}</div>
        <div><span>Estado</span>${esc(lbl(STATUS, a.status))}</div>
        <div><span>Incidentes registrados</span><b>${incidents.length}</b></div>
      </div>
      ${a.notes ? `<p class="muted" style="font-size:13px;margin:6px 0 12px">${esc(a.notes)}</p>` : ""}
      <h4 style="margin:14px 0 6px">Historial de tareas</h4>
      <div class="list-rows">${a.tasks.map((t) => `<button class="row-item" data-task="${t.id}">${typeIcon(t.type)}${statusChip(t.status)}<span class="key">${esc(store.taskKey(t))}</span><span class="grow">${esc(t.title)}</span><span class="muted" style="font-size:12px">${esc(fmtDate(t.created_at.slice(0, 10)))}</span></button>`).join("") || '<div class="row-item muted">Ninguna tarea vinculada.</div>'}</div>
    </div>`,
    footLeft: store.can.edit ? `<button type="button" class="btn sm" data-edit>${icons.edit}Editar</button>${store.can.admin ? `<button type="button" class="btn sm danger" data-del>${icons.trash}Eliminar</button>` : ""}` : "",
  });
  $$("[data-task]", node).forEach((b) => b.onclick = () => { close(); openTask(b.dataset.task); });
  $("[data-edit]", node)?.addEventListener("click", () => { close(); assetForm(store.asset(id), done); });
  $("[data-del]", node)?.addEventListener("click", async () => {
    if (!(await confirmDialog({ title: `Eliminar ${a.name}`, text: "Se desvinculará de sus tareas, que no se borran." }))) return;
    try { await store.deleteAsset(id); close(); toast("Activo eliminado"); done?.(); } catch (e) { toastError(e); }
  });
}
