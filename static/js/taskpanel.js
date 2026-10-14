import { describe } from "./activity.js";
import { del, get, post, put, upload } from "./api.js";
import { icons } from "./icons.js";
import { multiline } from "./rich.js";
import { RECURRENCE, TYPES, label, store } from "./store.js";
import {
  approvalChip, assetIcon, avatar, closePop, confirmDialog, delayChip, fmtMinutes, modal, person, pickAssignee, pickPriority,
  pickProject, pickStatus, pickType, popMenu, prioChip, projectDot, slaChip, slaRemaining, statusChip, statusDot, toast,
  toastError, typeIcon,
} from "./ui.js";
import { $, $$, el, esc, fmtDate, timeAgo } from "./util.js";

let state = null; // { id, detail, node, scrim, unsub }

export const isPanelOpen = () => !!state;
export const currentTaskId = () => state?.id || null;

function setHash(id) {
  const [path, query = ""] = location.hash.split("?");
  const params = new URLSearchParams(query);
  if (id) params.set("t", id); else params.delete("t");
  const qs = params.toString();
  history.replaceState(null, "", `${path || "#/inicio"}${qs ? "?" + qs : ""}`);
}

export async function openTask(id) {
  id = Number(id);
  if (!store.task(id)) {
    try { await store.refreshTask(id); } catch (e) { return toast("La tarea ya no existe", { error: true }); }
  }
  if (!state) mount();
  state.id = id;
  state.detail = null;
  setHash(id);
  renderShell();
  await loadDetail(id);
}

async function loadDetail(id) {
  try {
    const d = await get(`/api/tasks/${id}`);
    if (state?.id !== id) return;
    state.detail = d;
    renderDetail();
  } catch (e) { toastError(e); }
}

export function closeTask() {
  if (!state) return;
  $(".peek-title", state.node)?.blur();
  $(".notes-area", state.node)?.blur();
  state.node.remove();
  state.scrim.remove();
  state.unsub();
  clearInterval(state.tick);
  state = null;
  setHash(null);
}

/** Recarga el detalle si otra persona cambió la tarea abierta. */
export function refreshOpenTask() {
  if (!state || !state.detail) return;
  const editing = state.node.contains(document.activeElement) && document.activeElement.matches("textarea, input");
  if (!editing) loadDetail(state.id);
}

function mount() {
  const scrim = el(`<div class="scrim"></div>`);
  const node = el(`<aside class="peek" role="dialog" aria-label="Detalle de tarea"></aside>`);
  scrim.onclick = closeTask;
  document.body.append(scrim, node);
  const unsub = store.on((why) => {
    if (!state) return;
    if (!store.task(state.id)) return closeTask();
    if (["task", "project", "member", "asset", "remote"].includes(why)) { renderProps(); renderBanners(); }
  });
  // El contador de SLA avanza solo
  const tick = setInterval(() => state && renderBanners(), 30000);
  node.addEventListener("dragover", (e) => { if (e.dataTransfer?.types.includes("Files")) { e.preventDefault(); node.classList.add("dropping"); } });
  node.addEventListener("dragleave", (e) => { if (!node.contains(e.relatedTarget)) node.classList.remove("dropping"); });
  node.addEventListener("drop", (e) => {
    node.classList.remove("dropping");
    if (!e.dataTransfer?.files.length || !store.can.edit) return;
    e.preventDefault();
    [...e.dataTransfer.files].forEach(uploadFile);
  });
  node.addEventListener("paste", (e) => {
    if (!store.can.edit) return;
    const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith("image/"));
    if (files.length) { e.preventDefault(); files.forEach(uploadFile); }
  });
  state = { id: null, detail: null, node, scrim, unsub, tick };
}

function renderShell() {
  const t = store.task(state.id);
  const ro = !store.can.edit;
  state.node.innerHTML = `
    <div class="peek-bar">
      <div class="crumbs" data-crumbs></div>
      <button class="icon-btn" data-act="copy" title="Copiar enlace">${icons.link}</button>
      ${ro ? "" : `<button class="icon-btn" data-act="more" title="Más acciones">${icons.more}</button>`}
      <button class="icon-btn" data-act="close" title="Cerrar (Esc)">${icons.close}</button>
    </div>
    <div class="peek-body">
      <textarea class="peek-title" rows="1" spellcheck="false" aria-label="Título"${ro ? " readonly" : ""}></textarea>
      <div data-banners></div>
      <div class="props" data-props></div>
      <h4>Descripción</h4>
      <textarea class="notes-area" placeholder="${ro ? "Sin descripción" : "Añade contexto, pasos, criterios de cierre…"}" aria-label="Descripción"${ro ? " readonly" : ""}></textarea>
      <div data-subtasks></div>
      <div data-deps></div>
      <div data-checklist><h4>Checklist</h4><div class="skeleton" style="height:28px;width:60%"></div></div>
      <div data-files></div>
      <div data-pages></div>
      <div data-comments></div>
      <div data-history></div>
    </div>`;
  const title = $(".peek-title", state.node);
  title.value = t.title;
  autosize(title);
  title.oninput = () => autosize(title);
  title.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); title.blur(); } };
  title.onblur = () => {
    const v = title.value.trim();
    const cur = store.task(state?.id);
    if (!cur || ro) return;
    if (!v) { title.value = cur.title; return; }
    if (v !== cur.title) save({ title: v });
  };
  const notes = $(".notes-area", state.node);
  notes.value = t.notes || "";
  autosize(notes, 96);
  notes.oninput = () => autosize(notes, 96);
  notes.onblur = () => { const cur = store.task(state?.id); if (!ro && cur && notes.value !== (cur.notes || "")) save({ notes: notes.value }); };

  $("[data-act=close]", state.node).onclick = closeTask;
  $("[data-act=copy]", state.node).onclick = async () => {
    const url = `${location.origin}${location.pathname}${location.hash}`;
    try { await navigator.clipboard.writeText(url); toast("Enlace copiado"); } catch (e) { toast(url); }
  };
  $("[data-act=more]", state.node)?.addEventListener("click", (e) => moreMenu(e.currentTarget));
  renderProps();
  renderBanners();
}

function moreMenu(anchor) {
  const cur = store.task(state.id);
  const canKb = cur.status === "done" && ["incident", "request"].includes(cur.type);
  popMenu(anchor, [
    { value: "sub", html: `${icons.subtask}Añadir subtarea`, hidden: !!cur.parent_id },
    { value: "dup", html: `${icons.copy}Duplicar` },
    { value: "tpl", html: `${icons.layers}Guardar como plantilla` },
    ...(canKb ? [{ value: "kb", html: `${icons.book}Crear artículo de conocimiento` }] : []),
    { value: "done", html: `${icons.done}${cur.status === "done" ? "Reabrir" : "Marcar como hecha"}` },
    { sep: true },
    { value: "del", html: `${icons.trash}Eliminar`, danger: true },
  ].filter((o) => !o.hidden), async (v) => {
    if (v === "sub") return $("[data-sub-new]", state.node)?.focus();
    if (v === "dup") { const n = await store.duplicateTask(cur.id).catch(toastError); if (n) { toast(`${store.taskKey(n)} creada`); openTask(n.id); } }
    if (v === "tpl") saveAsTemplate(cur);
    if (v === "kb") createKb(cur);
    if (v === "done") save({ status: cur.status === "done" ? "todo" : "done" });
    if (v === "del") {
      const subs = store.subtasks(cur.id).length;
      if (await confirmDialog({ title: "Eliminar tarea", text: `Se eliminará «${cur.title}» con su checklist, comentarios y adjuntos${subs ? ` y sus ${subs} subtareas` : ""}. No se puede deshacer.` })) {
        try { await store.deleteTask(cur.id); toast("Tarea eliminada"); } catch (e) { toastError(e); }
      }
    }
  });
}

function saveAsTemplate(t) {
  modal({
    title: "Guardar como plantilla",
    sub: "La plantilla copia tipo, prioridad, proyecto, responsable, etiquetas, checklist y subtareas.",
    size: "sm", saveLabel: "Guardar plantilla",
    body: `<label class="field"><span>Nombre</span><input class="input" name="name" autofocus value="${esc(t.title)}"></label>
      <label class="field" style="margin-top:12px"><span>Descripción</span><input class="input" name="description" placeholder="Cuándo usarla"></label>`,
    async onSave(form) {
      if (!form.name.value.trim()) throw new Error("Pon un nombre a la plantilla.");
      const tpl = await post("/api/templates", { name: form.name.value, description: form.description.value, kind: "task", from_task: t.id });
      store.templates.push(tpl);
      toast("Plantilla guardada. Aparecerá al crear una tarea.");
    },
  });
}

async function createKb(t) {
  toast(store.features.ai ? "Redactando el artículo…" : "Creando borrador…");
  try {
    const r = await post(`/api/ai/kb/${t.id}`, {});
    store._putPage(r.page);
    store.emit("page");
    toast("Artículo creado en la base de conocimiento", { action: "Abrir", onAction: () => { closeTask(); location.hash = `#/pagina/${r.page.id}`; } });
    loadDetail(t.id);
  } catch (e) { toastError(e); }
}

function autosize(ta, min = 0) {
  ta.style.height = "auto";
  ta.style.height = `${Math.max(min, ta.scrollHeight)}px`;
}

async function save(changes) {
  const id = state.id;
  try {
    await store.updateTask(id, changes);
    loadDetail(id);
  } catch (e) { toastError(e); }
}

// ---------- Avisos superiores: SLA, dependencias y aprobación ----------
function renderBanners() {
  const t = store.task(state?.id);
  const box = state && $("[data-banners]", state.node);
  if (!t || !box) return;
  let html = "";
  if (t.sla) {
    const s = t.sla;
    const rem = slaRemaining(t);
    const resp = s.responded_at ? `Respondida ${fmtDate(s.responded_at.slice(0, 10))} ${s.responded_at.slice(11, 16)}${s.response_met === false ? " (fuera de plazo)" : ""}`
      : s.response_met === false ? "Sin respuesta: plazo superado" : `Responder antes de las ${s.response_due.slice(11, 16)}${s.response_due.slice(0, 10) !== store.today ? ` del ${fmtDate(s.response_due.slice(0, 10))}` : ""}`;
    const res = s.state === "met" ? "Resuelta dentro de plazo" : s.state === "missed" ? "Resuelta fuera de plazo"
      : rem < 0 ? `Plazo de resolución superado hace ${fmtMinutes(rem)}` : `Quedan ${fmtMinutes(rem)} para resolver`;
    const cls = s.state === "met" ? "ok" : s.state === "missed" || rem < 0 ? "bad" : s.state === "risk" ? "warn" : "ok";
    html += `<div class="banner ${cls}">${icons.timer}<div><b>SLA ${label(TYPES, t.type).toLowerCase()} · prioridad ${esc(prioName(t.priority))}</b>
      <span>${esc(resp)} · ${esc(res)} (límite ${esc(s.resolve_due.slice(11, 16))}${s.resolve_due.slice(0, 10) !== store.today ? ` del ${esc(fmtDate(s.resolve_due.slice(0, 10)))}` : ""})</span></div></div>`;
  }
  if (t.blocked_by?.length) {
    const deps = t.blocked_by.map((id) => store.task(id)).filter(Boolean);
    html += `<div class="banner warn">${icons.lock}<div><b>Esperando a otras tareas</b><span>No puede empezar hasta que terminen: ${deps.map((d) => `<a class="task-ref" data-task="${d.id}">${statusDot(d.status)}${esc(store.taskKey(d))} ${esc(d.title)}</a>`).join(", ")}</span></div></div>`;
  }
  if ((store.settings.approval_types || []).includes(t.type)) html += approvalBox(t);
  box.innerHTML = html;
  $$("[data-task]", box).forEach((a) => a.onclick = (e) => { e.preventDefault(); openTask(a.dataset.task); });
  bindApproval(box, t);
}
const prioName = (p) => ({ critical: "crítica", high: "alta", medium: "media", low: "baja" }[p]);

function approvalBox(t) {
  const hist = state.detail?.approvals || [];
  const last = [...hist].reverse().find((a) => a.decision !== "requested");
  const req = [...hist].reverse().find((a) => a.decision === "requested");
  const st = t.approval_status || "";
  const can = store.can;
  const mine = req && req.actor === store.user;
  const map = {
    "": ["warn", "Necesita aprobación del CAB", "Un cambio no puede pasar a «En curso» hasta que el comité lo apruebe."],
    pending: ["warn", "Pendiente de aprobación", req ? `Solicitada por ${req.actor} ${timeAgo(req.created_at)}${req.comment ? `: «${req.comment}»` : ""}` : ""],
    approved: ["ok", "Cambio aprobado", last ? `${last.actor} lo aprobó ${timeAgo(last.created_at)}${last.comment ? `: «${last.comment}»` : ""}` : ""],
    rejected: ["bad", "Cambio rechazado", last ? `${last.actor}: «${last.comment}». Corrige y vuelve a solicitarla.` : ""],
  };
  const [cls, ttl, txt] = map[st] || map[""];
  let actions = "";
  if (can.edit && (st === "" || st === "rejected")) actions = `<button class="btn sm" data-appr="request">${icons.approve}Solicitar aprobación</button>`;
  if (st === "pending" && can.cab && !mine) actions = `<button class="btn sm primary" data-appr="approve">Aprobar</button><button class="btn sm" data-appr="reject">Rechazar</button>`;
  if (st === "pending" && can.cab && mine) actions = `<span class="muted" style="font-size:12px">Debe decidir otra persona del CAB</span>`;
  return `<div class="banner ${cls}">${icons.approve}<div><b>${esc(ttl)}</b><span>${esc(txt)}</span></div><div class="banner-actions">${actions}</div></div>`;
}

function bindApproval(box, t) {
  $$("[data-appr]", box).forEach((b) => b.onclick = () => {
    const action = b.dataset.appr;
    const titles = { request: "Solicitar aprobación del CAB", approve: "Aprobar cambio", reject: "Rechazar cambio" };
    modal({
      title: titles[action], size: "sm",
      sub: action === "request" ? "Describe la ventana, el impacto y el plan de vuelta atrás. Se avisará a las personas del CAB." : `${esc(store.taskKey(t))} · ${esc(t.title)}`,
      saveLabel: action === "approve" ? "Aprobar" : action === "reject" ? "Rechazar" : "Solicitar", danger: action === "reject",
      body: `<label class="field"><span>${action === "reject" ? "Motivo (obligatorio)" : "Comentario"}</span><textarea class="input" name="comment" rows="3" autofocus></textarea></label>`,
      async onSave(form) {
        if (action === "reject" && !form.comment.value.trim()) throw new Error("Indica el motivo del rechazo.");
        await store.taskAction(t.id, `/api/tasks/${t.id}/approval`, "POST", { action, comment: form.comment.value });
        await loadDetail(t.id);
        renderBanners();
        toast(action === "request" ? "Solicitud enviada al CAB" : action === "approve" ? "Cambio aprobado" : "Cambio rechazado");
      },
    });
  });
}

// ---------- Propiedades ----------
function renderProps() {
  const t = store.task(state?.id);
  if (!t) return;
  const ro = !store.can.edit;
  const p = store.project(t.project_id);
  const parent = t.parent_id ? store.task(t.parent_id) : null;
  $("[data-crumbs]", state.node).innerHTML = `${p ? `${projectDot(p)}<span>${esc(p.name)}</span><span class="sep">/</span>` : ""}${parent ? `<a class="task-ref" data-task="${parent.id}">${esc(store.taskKey(parent))}</a><span class="sep">/</span>` : ""}<b class="key">${esc(store.taskKey(t))}</b>`;
  $$("[data-crumbs] [data-task]", state.node).forEach((a) => a.onclick = () => openTask(a.dataset.task));
  const over = store.isOverdue(t);
  const dis = ro ? " disabled" : "";
  const row = (ic, lbl, val) => `<div class="pl">${icons[ic] || ""}${esc(lbl)}</div><div class="pv">${val}</div>`;
  const assets = (t.asset_ids || []).map((id) => store.asset(id)).filter(Boolean);
  const rule = t.recurrence_rule || "none";
  let html =
    row("status", "Estado", `<button class="prop-btn" data-pick="status"${dis}>${statusChip(t.status)}</button>${approvalChip(t)}`) +
    row("flag", "Prioridad", `<button class="prop-btn" data-pick="priority"${dis}>${prioChip(t.priority)}</button>`) +
    row("t_task", "Tipo", `<button class="prop-btn" data-pick="type"${dis}>${typeIcon(t.type)}${label(TYPES, t.type)}</button>${slaChip(t)}`) +
    row("user", "Responsable", `<button class="prop-btn${t.assignee ? "" : " empty"}" data-pick="assignee"${dis}>${person(t.assignee, "Sin asignar")}</button>`) +
    row("folder", "Proyecto", `<button class="prop-btn${p ? "" : " empty"}" data-pick="project"${dis}>${p ? projectDot(p) + esc(p.name) : "Sin proyecto"}</button>`) +
    row("play", "Inicio", `<input type="date" class="prop-input" data-date="start_date" value="${esc(t.start_date || "")}"${dis}>`) +
    row("calendar", "Vence", `<input type="date" class="prop-input" data-date="due_date" value="${esc(t.due_date || "")}"${over ? ' style="color:var(--bad);font-weight:500"' : ""}${dis}>${over ? '<span class="due over" style="margin-left:6px">Vencida</span>' : delayChip(t)}`) +
    row("repeat", "Repetición", `<button class="prop-btn${rule === "none" ? " empty" : ""}" data-pick="recurrence"${dis}>${esc(label(RECURRENCE, rule))}</button>`) +
    row("hourglass", "Estimación", `<input type="number" min="0" step="0.5" class="prop-input" data-num="estimate" placeholder="Horas" value="${t.estimate ?? ""}" style="width:110px"${dis}>`) +
    row("tag", "Etiquetas", `<input class="prop-input" data-text="tags" placeholder="Vacío" value="${esc(t.tags || "")}" style="width:100%"${dis}>`) +
    row("asset", "Activos", `<div class="asset-chips">${assets.map((a) => `<a class="asset-chip" href="#/activos?a=${a.id}" title="${esc(a.identifier || "")}">${assetIcon(a.kind)}${esc(a.name)}</a>`).join("")}${ro ? (assets.length ? "" : '<span class="muted">—</span>') : `<button class="prop-btn empty" data-pick="assets">${assets.length ? icons.edit : "Vincular"}</button>`}</div>`);
  for (const f of store.customFields.filter((cf) => !cf.project_id || cf.project_id === t.project_id)) {
    const v = (t.custom || {})[f.id] ?? "";
    let input;
    if (f.type === "select") input = `<select class="prop-input" data-cf="${f.id}"${dis}><option value="">Vacío</option>${f.options.map((o) => `<option${o === v ? " selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
    else if (f.type === "checkbox") input = `<input type="checkbox" class="chk" data-cf="${f.id}"${v ? " checked" : ""}${dis}>`;
    else if (f.type === "url" && ro) input = v ? `<a href="${esc(v)}" target="_blank" rel="noopener noreferrer">${esc(v)}</a>` : "—";
    else input = `<input class="prop-input" data-cf="${f.id}" type="${f.type === "number" ? "number" : f.type === "date" ? "date" : f.type === "url" ? "url" : "text"}" value="${esc(v)}" placeholder="Vacío" style="width:100%"${dis}>`;
    html += row("filter", f.name, input);
  }
  html += row("clock", "Creada", `<span class="muted" style="font-size:12.5px">${esc(fmtDate(t.created_at.slice(0, 10), { year: true }))}${t.created_by ? ` por ${esc(t.created_by)}` : ""}${t.completed_at ? ` · cerrada ${esc(fmtDate(t.completed_at.slice(0, 10), { year: true }))}` : ""}</span>`);
  $("[data-props]", state.node).innerHTML = html;
  if (ro) return;

  const pick = { status: pickStatus, priority: pickPriority, type: pickType, assignee: pickAssignee, project: pickProject };
  $$("[data-pick]", state.node).forEach((b) => b.onclick = () => {
    const f = b.dataset.pick;
    if (f === "recurrence") return popMenu(b, RECURRENCE.map((r) => ({ value: r.id, html: r.label, selected: r.id === rule })), async (v) => {
      try { await store.taskAction(t.id, `/api/tasks/${t.id}/recurrence`, "PUT", { rule: v }); toast(v === "none" ? "Ya no se repite" : `Se creará una nueva tarea ${label(RECURRENCE, v).toLowerCase()} antes de su vencimiento`); } catch (e) { toastError(e); }
    });
    if (f === "assets") return pickAssets(b, t);
    const field = f === "project" ? "project_id" : f;
    pick[f](b, t[field], (v) => {
      if (field === "status" && v === "blocked" && t.status !== "blocked") return askBlockReason(t.id);
      save({ [field]: v });
    });
  });
  $$("[data-date]", state.node).forEach((i) => i.onchange = () => save({ [i.dataset.date]: i.value }));
  $$("[data-num]", state.node).forEach((i) => i.onchange = () => save({ [i.dataset.num]: i.value === "" ? null : i.value }));
  $$("[data-text]", state.node).forEach((i) => {
    i.onkeydown = (e) => { if (e.key === "Enter") i.blur(); };
    i.onblur = () => { if (i.value !== (store.task(state.id)?.tags || "")) save({ tags: i.value }); };
  });
  $$("[data-cf]", state.node).forEach((i) => {
    const commit = () => {
      const cur = store.task(state.id);
      const custom = { ...(cur.custom || {}) };
      const v = i.type === "checkbox" ? i.checked : i.type === "number" ? (i.value === "" ? "" : Number(i.value)) : i.value;
      if (v === "" || v === false) delete custom[i.dataset.cf]; else custom[i.dataset.cf] = v;
      if (JSON.stringify(custom) !== JSON.stringify(cur.custom || {})) save({ custom });
    };
    if (i.tagName === "SELECT" || i.type === "checkbox" || i.type === "date") i.onchange = commit;
    else { i.onblur = commit; i.onkeydown = (e) => { if (e.key === "Enter") i.blur(); }; }
  });
}

function pickAssets(anchor, t) {
  const sel = new Set(t.asset_ids || []);
  const opts = store.assets.map((a) => ({ value: a.id, html: `${assetIcon(a.kind)}<span>${esc(a.name)}</span><span class="muted" style="margin-left:6px;font-size:12px">${esc(a.identifier || "")}</span>`, selected: sel.has(a.id), text: `${a.name} ${a.identifier}` }));
  if (!opts.length) return toast("Aún no hay activos. Créalos en la sección Activos.");
  popMenu(anchor, opts, async (id) => {
    sel.has(id) ? sel.delete(id) : sel.add(id);
    try { await store.taskAction(t.id, `/api/tasks/${t.id}/assets`, "PUT", { asset_ids: [...sel] }); } catch (e) { toastError(e); }
  }, { search: true, placeholder: "Buscar activo…" });
}

export function askBlockReason(id, extra = {}) {
  const t = store.task(id);
  modal({
    title: "Marcar como bloqueada",
    sub: `Indica qué impide avanzar con <b>${esc(store.taskKey(t))}</b>. El motivo queda como comentario y aparece en el informe de comité.`,
    size: "sm",
    saveLabel: "Bloquear",
    body: `<label class="field"><span>Motivo del bloqueo</span><textarea class="input" name="reason" rows="3" autofocus placeholder="Ej.: pendiente de aprobación de la ventana de mantenimiento"></textarea></label>`,
    async onSave(form) {
      const reason = form.reason.value.trim();
      await store.updateTask(id, { status: "blocked", ...extra });
      if (reason) {
        await post(`/api/tasks/${id}/comments`, { body: `Bloqueo: ${reason}` });
        const cur = store.task(id);
        if (!cur.notes) await store.updateTask(id, { notes: `Bloqueado: ${reason}` });
      }
      await store.refreshTask(id);
      if (state?.id === id) loadDetail(id);
    },
  });
}

// ---------- Secciones con datos del detalle ----------
function renderDetail() {
  renderSubtasks();
  renderDeps();
  renderChecklist();
  renderFiles();
  renderPages();
  renderComments();
  renderHistory();
  renderBanners();
}

function renderSubtasks() {
  const t = store.task(state.id);
  const box = $("[data-subtasks]", state.node);
  if (t.parent_id) { box.innerHTML = ""; return; }
  const subs = state.detail.subtasks || [];
  const done = subs.filter((s) => s.status === "done").length;
  const ro = !store.can.edit;
  if (ro && !subs.length) { box.innerHTML = ""; return; }
  box.innerHTML = `<h4>Subtareas ${subs.length ? `<span class="muted">${done}/${subs.length}</span>` : ""}</h4>
    ${subs.length ? `<div class="check-progress"><div class="meter good"><i style="width:${Math.round((100 * done) / subs.length)}%"></i></div></div>` : ""}
    <div class="sub-list">${subs.map((s) => `<div class="sub-row" data-id="${s.id}">
      <button class="round-chk sm${s.status === "done" ? " on" : ""}" data-toggle${ro ? " disabled" : ""} title="${s.status === "done" ? "Reabrir" : "Marcar como hecha"}">${icons.check}</button>
      <span class="key">${esc(store.taskKey(s))}</span>
      <button class="sub-title" data-open>${esc(s.title)}</button>
      ${statusChip(s.status)}${avatar(s.assignee)}</div>`).join("")}</div>
    ${ro ? "" : `<input class="check-new" data-sub-new placeholder="+ Añadir subtarea y pulsar Enter">`}`;
  $$(".sub-row", box).forEach((r) => {
    const id = Number(r.dataset.id);
    $("[data-open]", r).onclick = () => openTask(id);
    $("[data-toggle]", r).onclick = async () => {
      const s = store.task(id) || subs.find((x) => x.id === id);
      try { await store.updateTask(id, { status: s.status === "done" ? "todo" : "done" }); loadDetail(state.id); } catch (e) { toastError(e); }
    };
  });
  const input = $("[data-sub-new]", box);
  if (input) input.onkeydown = async (e) => {
    if (e.key !== "Enter" || !input.value.trim()) return;
    try {
      await store.createTask({ title: input.value.trim(), parent_id: t.id, assignee: t.assignee, type: t.type === "change" ? "task" : t.type });
      await loadDetail(t.id);
      $("[data-sub-new]", state.node)?.focus();
    } catch (er) { toastError(er); }
  };
}

function renderDeps() {
  const t = store.task(state.id);
  const box = $("[data-deps]", state.node);
  const deps = (t.depends_on || []).map((id) => store.task(id)).filter(Boolean);
  const blocking = store.tasks.filter((x) => (x.depends_on || []).includes(t.id));
  const ro = !store.can.edit;
  if (ro && !deps.length && !blocking.length) { box.innerHTML = ""; return; }
  box.innerHTML = `<h4>Dependencias</h4>
    ${deps.length ? `<div class="dep-group"><span class="muted">Espera a</span>${deps.map((d) => `<div class="dep-row"><a class="task-ref" data-task="${d.id}">${statusDot(d.status)}${esc(store.taskKey(d))}</a><span class="grow">${esc(d.title)}</span>${ro ? "" : `<button class="icon-btn" data-undep="${d.id}" title="Quitar dependencia">${icons.close}</button>`}</div>`).join("")}</div>` : ""}
    ${blocking.length ? `<div class="dep-group"><span class="muted">Bloquea a</span>${blocking.map((d) => `<div class="dep-row"><a class="task-ref" data-task="${d.id}">${statusDot(d.status)}${esc(store.taskKey(d))}</a><span class="grow">${esc(d.title)}</span></div>`).join("")}</div>` : ""}
    ${ro ? "" : `<button class="btn sm ghost" data-add-dep>${icons.plus}Añadir «espera a…»</button>`}`;
  $$("[data-task]", box).forEach((a) => a.onclick = () => openTask(a.dataset.task));
  $$("[data-undep]", box).forEach((b) => b.onclick = async () => {
    try { await store.taskAction(t.id, `/api/tasks/${t.id}/deps/${b.dataset.undep}`, "DELETE"); renderDeps(); } catch (e) { toastError(e); }
  });
  $("[data-add-dep]", box)?.addEventListener("click", (e) => {
    const options = store.tasks.filter((x) => x.id !== t.id && !(t.depends_on || []).includes(x.id) && x.status !== "done")
      .map((x) => ({ value: x.id, html: `${statusDot(x.status)}<span class="key">${esc(store.taskKey(x))}</span><span>${esc(x.title)}</span>`, text: `${store.taskKey(x)} ${x.title}` }));
    popMenu(e.currentTarget, options, async (id) => {
      try { await store.taskAction(t.id, `/api/tasks/${t.id}/deps`, "POST", { depends_on: id }); renderDeps(); renderBanners(); } catch (er) { toastError(er); }
    }, { search: true, placeholder: "Buscar tarea por clave o título…" });
  });
}

function renderChecklist() {
  const items = state.detail.checklist;
  const ro = !store.can.edit;
  const done = items.filter((i) => i.done).length;
  const box = $("[data-checklist]", state.node);
  if (ro && !items.length) { box.innerHTML = ""; return; }
  box.innerHTML = `<h4>Checklist ${items.length ? `<span class="muted">${done}/${items.length}</span>` : ""}</h4>
    ${items.length ? `<div class="check-progress"><div class="meter good"><i style="width:${Math.round((100 * done) / items.length)}%"></i></div></div>` : ""}
    <div>${items.map((i) => `<div class="check-item${i.done ? " done" : ""}" data-id="${i.id}">
      <input type="checkbox" class="chk"${i.done ? " checked" : ""}${ro ? " disabled" : ""} aria-label="Completar">
      <span class="ct">${esc(i.text)}</span>
      ${ro ? "" : `<button class="icon-btn" title="Quitar">${icons.close}</button>`}</div>`).join("")}</div>
    ${ro ? "" : `<input class="check-new" placeholder="+ Añadir paso y pulsar Enter">`}`;
  if (ro) return;
  $$(".check-item", box).forEach((row) => {
    const id = Number(row.dataset.id);
    $("input", row).onchange = async (e) => {
      try {
        await put(`/api/checklist/${id}`, { done: e.target.checked });
        state.detail.checklist.find((x) => x.id === id).done = e.target.checked ? 1 : 0;
        renderChecklist();
        syncCounts();
      } catch (err) { toastError(err); }
    };
    $("button", row).onclick = async () => {
      try {
        await del(`/api/checklist/${id}`);
        state.detail.checklist = state.detail.checklist.filter((x) => x.id !== id);
        renderChecklist();
        syncCounts();
      } catch (err) { toastError(err); }
    };
  });
  const input = $(".check-new", box);
  input.onkeydown = async (e) => {
    if (e.key !== "Enter" || !input.value.trim()) return;
    try {
      const item = await post(`/api/tasks/${state.id}/checklist`, { text: input.value.trim() });
      state.detail.checklist.push(item);
      renderChecklist();
      syncCounts();
      $("[data-checklist] .check-new", state.node).focus();
    } catch (err) { toastError(err); }
  };
}

const fmtSize = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);

function renderFiles() {
  const files = state.detail.attachments || [];
  const ro = !store.can.edit;
  const box = $("[data-files]", state.node);
  if (ro && !files.length) { box.innerHTML = ""; return; }
  box.innerHTML = `<h4>Adjuntos ${files.length ? `<span class="muted">${files.length}</span>` : ""}</h4>
    <div class="files">${files.map((f) => {
      const img = f.mime.startsWith("image/");
      return `<div class="file" data-id="${f.id}">
        ${img ? `<a class="file-thumb" href="/api/files/${f.id}" target="_blank" rel="noopener"><img src="/api/files/${f.id}" alt="${esc(f.filename)}" loading="lazy"></a>` : `<a class="file-icon" href="/api/files/${f.id}?download=1">${icons.doc}</a>`}
        <div class="file-meta"><a href="/api/files/${f.id}${img || f.mime === "application/pdf" ? "" : "?download=1"}" target="_blank" rel="noopener" title="${esc(f.filename)}">${esc(f.filename)}</a>
        <span class="muted">${fmtSize(f.size)} · ${esc(f.uploaded_by)} · ${esc(timeAgo(f.created_at))}</span></div>
        ${!ro && (f.uploaded_by === store.user || store.can.admin) ? `<button class="icon-btn" data-del-file="${f.id}" title="Eliminar">${icons.trash}</button>` : ""}
      </div>`;
    }).join("")}
    ${ro ? "" : `<label class="file-drop">${icons.upload}<span>Arrastra archivos, pega una captura o <u>elige un archivo</u></span><input type="file" multiple hidden></label>`}</div>
    <div class="upload-progress hidden"><div class="meter"><i style="width:0%"></i></div></div>`;
  $("input[type=file]", box)?.addEventListener("change", (e) => { [...e.target.files].forEach(uploadFile); e.target.value = ""; });
  $$("[data-del-file]", box).forEach((b) => b.onclick = async () => {
    if (!(await confirmDialog({ title: "Eliminar adjunto", text: "El archivo se borrará del servidor." }))) return;
    try {
      await del(`/api/files/${b.dataset.delFile}`);
      state.detail.attachments = state.detail.attachments.filter((f) => f.id !== Number(b.dataset.delFile));
      renderFiles();
      syncCounts();
    } catch (e) { toastError(e); }
  });
}

async function uploadFile(file) {
  if (!state) return;
  const id = state.id;
  const bar = $(".upload-progress", state.node);
  bar?.classList.remove("hidden");
  try {
    const f = await upload(`/api/tasks/${id}/attachments`, file, (p) => { const i = $(".upload-progress i", state?.node || document); if (i) i.style.width = `${Math.round(p * 100)}%`; });
    if (state?.id === id) {
      state.detail.attachments.push(f);
      renderFiles();
      syncCounts();
    }
    toast(`${file.name || "Captura"} adjuntado`);
  } catch (e) { toastError(e); }
  finally { $(".upload-progress", state?.node || document)?.classList.add("hidden"); }
}

function renderPages() {
  const pages = state.detail.pages || [];
  $("[data-pages]", state.node).innerHTML = pages.length ? `<h4>Páginas relacionadas</h4><div class="page-links">${pages.map((p) => `<a class="page-link" href="#/pagina/${p.id}">${p.icon ? `<span class="pico">${esc(p.icon)}</span>` : icons.page}${esc(p.title || "Sin título")}</a>`).join("")}</div>` : "";
  $$("[data-pages] a", state.node).forEach((a) => a.addEventListener("click", () => closeTask()));
}

function syncCounts() {
  const t = store.task(state.id);
  if (!t) return;
  t.checklist_total = state.detail.checklist.length;
  t.checklist_done = state.detail.checklist.filter((x) => x.done).length;
  t.comment_count = state.detail.comments.length;
  t.attachment_count = (state.detail.attachments || []).length;
  store.emit("counts");
}

function renderComments() {
  const list = state.detail.comments;
  const ro = !store.can.edit;
  const box = $("[data-comments]", state.node);
  box.innerHTML = `<h4>Comentarios ${list.length ? `<span class="muted">${list.length}</span>` : ""}</h4>
    ${list.map((c) => `<div class="comment">${avatar(c.author)}<div class="c-body">
      <div class="c-head"><b>${esc(c.author)}</b><time title="${esc(c.created_at)}">${esc(timeAgo(c.created_at))}</time>
      ${c.author === store.user || store.can.admin ? `<button data-del="${c.id}">Eliminar</button>` : ""}</div>
      <div class="c-text">${multiline(c.body)}</div></div></div>`).join("") || (ro ? '<p class="muted" style="font-size:13px">Sin comentarios.</p>' : "")}
    ${ro ? "" : `<div class="comment-box">${avatar(store.user)}<div class="wrap">
      <textarea rows="2" placeholder="Escribe un comentario. Usa @ para mencionar a alguien."></textarea>
      <div class="row"><span><kbd>Ctrl</kbd>+<kbd>Enter</kbd> para enviar</span><button class="btn sm primary" type="button">Comentar</button></div>
    </div></div>`}`;
  $$(".c-text [data-task]", box).forEach((a) => a.onclick = (e) => { e.preventDefault(); openTask(a.dataset.task); });
  $$("[data-del]", box).forEach((b) => b.onclick = async () => {
    const id = Number(b.dataset.del);
    try {
      await del(`/api/comments/${id}`);
      state.detail.comments = state.detail.comments.filter((c) => c.id !== id);
      renderComments();
      syncCounts();
    } catch (e) { toastError(e); }
  });
  if (ro) return;
  const ta = $("textarea", box);
  const send = async () => {
    const body = ta.value.trim();
    if (!body) return;
    try {
      const c = await post(`/api/tasks/${state.id}/comments`, { body });
      state.detail.comments.push(c);
      renderComments();
      syncCounts();
      loadDetail(state.id);
    } catch (e) { toastError(e); }
  };
  $(".comment-box .btn", box).onclick = send;
  ta.onkeydown = (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } };
  attachMentions(ta);
}

/** Autocompletado de @menciones en un textarea. */
export function attachMentions(ta) {
  ta.addEventListener("input", () => {
    const upto = ta.value.slice(0, ta.selectionStart);
    const m = /(^|\s)@([\wÁÉÍÓÚÜÑáéíóúüñ]*)$/.exec(upto);
    if (!m) return closePop();
    const q = m[2].toLowerCase();
    const opts = store.members.filter((x) => x.active !== false && x.name.toLowerCase().split(" ").some((w) => w.startsWith(q)))
      .slice(0, 6).map((x) => ({ value: x.name, html: `${avatar(x.name)}${esc(x.name)}` }));
    if (!opts.length) return closePop();
    const pop = popMenu(ta, opts, (name) => {
      const start = ta.selectionStart - m[2].length - 1;
      ta.value = ta.value.slice(0, start) + `@${name} ` + ta.value.slice(ta.selectionStart);
      const pos = start + name.length + 2;
      ta.focus();
      ta.setSelectionRange(pos, pos);
    });
    pop.querySelector(".pop-item")?.classList.add("hl");
    ta.focus();
  });
}

function renderHistory() {
  const acts = state.detail.activity;
  $("[data-history]", state.node).innerHTML = `<h4>Historial</h4>
    <ul class="hist">${acts.map((a) => `<li><span><b>${esc(a.actor)}</b> ${describe(a)}</span><time title="${esc(a.created_at)}">${esc(timeAgo(a.created_at))}</time></li>`).join("") || '<li class="muted">Sin cambios registrados</li>'}</ul>`;
}
