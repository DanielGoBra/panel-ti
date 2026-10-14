import { describe } from "./activity.js";
import { del, get, post, put } from "./api.js";
import { icons } from "./icons.js";
import { PRIORITY, STATUS, TYPES, label, store } from "./store.js";
import {
  avatar, confirmDialog, modal, person, pickAssignee, pickPriority, pickProject, pickStatus, pickType, popMenu,
  prioChip, projectDot, statusChip, toast, toastError, typeIcon,
} from "./ui.js";
import { $, $$, el, esc, fmtDate, timeAgo } from "./util.js";

let state = null; // { id, detail, node }

export const isPanelOpen = () => !!state;

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
  setHash(id);
  renderShell();
  try {
    state.detail = await get(`/api/tasks/${id}`);
    if (state?.id === id) renderDetail();
  } catch (e) { toastError(e); }
}

export function closeTask() {
  if (!state) return;
  const ta = $(".peek-title", state.node);
  ta?.blur();
  $(".notes-area", state.node)?.blur();
  state.node.remove();
  state.scrim.remove();
  state.unsub();
  state = null;
  setHash(null);
}

function mount() {
  const scrim = el(`<div class="scrim"></div>`);
  const node = el(`<aside class="peek" role="dialog" aria-label="Detalle de tarea"></aside>`);
  scrim.onclick = closeTask;
  document.body.append(scrim, node);
  const unsub = store.on((why) => {
    if (!state) return;
    if (!store.task(state.id)) return closeTask();
    if (why === "task" || why === "project" || why === "member") renderProps();
  });
  state = { id: null, detail: null, node, scrim, unsub };
}

function renderShell() {
  const t = store.task(state.id);
  const p = store.project(t.project_id);
  state.node.innerHTML = `
    <div class="peek-bar">
      <div class="crumbs">${p ? `${projectDot(p)}<span>${esc(p.name)}</span><span class="sep">/</span>` : ""}<b class="key" data-key></b></div>
      <button class="icon-btn" data-act="copy" title="Copiar enlace">${icons.link}</button>
      <button class="icon-btn" data-act="more" title="Más acciones">${icons.more}</button>
      <button class="icon-btn" data-act="close" title="Cerrar (Esc)">${icons.close}</button>
    </div>
    <div class="peek-body">
      <textarea class="peek-title" rows="1" spellcheck="false" aria-label="Título"></textarea>
      <div class="props" data-props></div>
      <h4>Descripción</h4>
      <textarea class="notes-area" placeholder="Añade contexto, pasos, criterios de cierre…" aria-label="Descripción"></textarea>
      <div data-checklist></div>
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
    if (!cur) return;
    if (!v) { title.value = cur.title; return; }
    if (v !== cur.title) save({ title: v });
  };
  const notes = $(".notes-area", state.node);
  notes.value = t.notes || "";
  autosize(notes, 96);
  notes.oninput = () => autosize(notes, 96);
  notes.onblur = () => { const cur = store.task(state?.id); if (cur && notes.value !== (cur.notes || "")) save({ notes: notes.value }); };

  $("[data-act=close]", state.node).onclick = closeTask;
  $("[data-act=copy]", state.node).onclick = async () => {
    const url = `${location.origin}${location.pathname}${location.hash}`;
    try { await navigator.clipboard.writeText(url); toast("Enlace copiado"); } catch (e) { toast(url); }
  };
  $("[data-act=more]", state.node).onclick = (e) => {
    popMenu(e.currentTarget, [
      { value: "dup", html: `${icons.copy}Duplicar` },
      { value: "done", html: `${icons.done}${store.task(state.id).status === "done" ? "Reabrir" : "Marcar como hecha"}` },
      { sep: true },
      { value: "del", html: `${icons.trash}Eliminar`, danger: true },
    ], async (v) => {
      const cur = store.task(state.id);
      if (v === "dup") { const n = await store.duplicateTask(cur.id).catch(toastError); if (n) { toast(`${store.taskKey(n)} creada`); openTask(n.id); } }
      if (v === "done") save({ status: cur.status === "done" ? "todo" : "done" });
      if (v === "del") {
        if (await confirmDialog({ title: "Eliminar tarea", text: `Se eliminará «${cur.title}» con su checklist y comentarios. No se puede deshacer.` })) {
          await store.deleteTask(cur.id).catch(toastError);
          toast("Tarea eliminada");
        }
      }
    });
  };
  renderProps();
  $("[data-checklist]", state.node).innerHTML = `<h4>Checklist</h4><div class="skeleton" style="height:28px;width:60%"></div>`;
}

function autosize(ta, min = 0) {
  ta.style.height = "auto";
  ta.style.height = `${Math.max(min, ta.scrollHeight)}px`;
}

async function save(changes) {
  const id = state.id;
  try {
    await store.updateTask(id, changes);
    refreshHistory(id);
  } catch (e) { toastError(e); }
}

async function refreshHistory(id) {
  try {
    const d = await get(`/api/tasks/${id}`);
    if (state?.id === id) { state.detail = d; renderHistory(); }
  } catch (e) { /* sin conexión: se refrescará al reabrir */ }
}

function renderProps() {
  const t = store.task(state.id);
  if (!t) return;
  $("[data-key]", state.node).textContent = store.taskKey(t);
  const p = store.project(t.project_id);
  const over = store.isOverdue(t);
  const row = (ic, lbl, val) => `<div class="pl">${icons[ic]}${lbl}</div><div class="pv">${val}</div>`;
  $("[data-props]", state.node).innerHTML =
    row("status", "Estado", `<button class="prop-btn" data-pick="status">${statusChip(t.status)}</button>`) +
    row("flag", "Prioridad", `<button class="prop-btn" data-pick="priority">${prioChip(t.priority)}</button>`) +
    row("t_task", "Tipo", `<button class="prop-btn" data-pick="type">${typeIcon(t.type)}${label(TYPES, t.type)}</button>`) +
    row("user", "Responsable", `<button class="prop-btn${t.assignee ? "" : " empty"}" data-pick="assignee">${person(t.assignee, "Sin asignar")}</button>`) +
    row("folder", "Proyecto", `<button class="prop-btn${p ? "" : " empty"}" data-pick="project">${p ? projectDot(p) + esc(p.name) : "Sin proyecto"}</button>`) +
    row("play", "Inicio", `<input type="date" class="prop-input" data-date="start_date" value="${esc(t.start_date || "")}">`) +
    row("calendar", "Vence", `<input type="date" class="prop-input" data-date="due_date" value="${esc(t.due_date || "")}"${over ? ' style="color:var(--bad);font-weight:500"' : ""}>${over ? '<span class="due over" style="margin-left:6px">Vencida</span>' : ""}`) +
    row("hourglass", "Estimación", `<input type="number" min="0" step="0.5" class="prop-input" data-num="estimate" placeholder="Horas" value="${t.estimate ?? ""}" style="width:110px">`) +
    row("tag", "Etiquetas", `<input class="prop-input" data-text="tags" placeholder="Vacío" value="${esc(t.tags || "")}" style="width:100%">`) +
    row("clock", "Creada", `<span class="muted" style="font-size:12.5px">${esc(fmtDate(t.created_at.slice(0, 10), { year: true }))}${t.completed_at ? ` · cerrada ${esc(fmtDate(t.completed_at.slice(0, 10), { year: true }))}` : ""}</span>`);

  const pick = { status: pickStatus, priority: pickPriority, type: pickType, assignee: pickAssignee, project: pickProject };
  $$("[data-pick]", state.node).forEach((b) => b.onclick = () => {
    const f = b.dataset.pick;
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
      if (state?.id === id) refreshHistory(id).then(() => renderDetail());
    },
  });
}

function renderDetail() {
  renderChecklist();
  renderComments();
  renderHistory();
}

function renderChecklist() {
  const items = state.detail.checklist;
  const done = items.filter((i) => i.done).length;
  const box = $("[data-checklist]", state.node);
  box.innerHTML = `<h4>Checklist ${items.length ? `<span class="muted">${done}/${items.length}</span>` : ""}</h4>
    ${items.length ? `<div class="check-progress"><div class="meter good"><i style="width:${Math.round((100 * done) / items.length)}%"></i></div></div>` : ""}
    <div>${items.map((i) => `<div class="check-item${i.done ? " done" : ""}" data-id="${i.id}">
      <input type="checkbox" class="chk"${i.done ? " checked" : ""} aria-label="Completar">
      <span class="ct">${esc(i.text)}</span>
      <button class="icon-btn" title="Quitar">${icons.close}</button></div>`).join("")}</div>
    <input class="check-new" placeholder="+ Añadir paso y pulsar Enter">`;
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
      $(".check-new", state.node).focus();
    } catch (err) { toastError(err); }
  };
}

function syncCounts() {
  const t = store.task(state.id);
  if (!t) return;
  t.checklist_total = state.detail.checklist.length;
  t.checklist_done = state.detail.checklist.filter((x) => x.done).length;
  t.comment_count = state.detail.comments.length;
  store.emit("counts");
}

function renderComments() {
  const list = state.detail.comments;
  const box = $("[data-comments]", state.node);
  box.innerHTML = `<h4>Comentarios ${list.length ? `<span class="muted">${list.length}</span>` : ""}</h4>
    ${list.map((c) => `<div class="comment">${avatar(c.author)}<div class="c-body">
      <div class="c-head"><b>${esc(c.author)}</b><time title="${esc(c.created_at)}">${esc(timeAgo(c.created_at))}</time>
      ${c.author === store.user ? `<button data-del="${c.id}">Eliminar</button>` : ""}</div>
      <div class="c-text">${esc(c.body)}</div></div></div>`).join("")}
    <div class="comment-box">${avatar(store.user)}<div class="wrap">
      <textarea rows="2" placeholder="Escribe un comentario…"></textarea>
      <div class="row"><span>Comentas como ${esc(store.user || "—")} · <kbd>Ctrl</kbd>+<kbd>Enter</kbd></span><button class="btn sm primary" type="button">Comentar</button></div>
    </div></div>`;
  const ta = $("textarea", box);
  const send = async () => {
    const body = ta.value.trim();
    if (!body) return;
    try {
      const c = await post(`/api/tasks/${state.id}/comments`, { body });
      state.detail.comments.push(c);
      renderComments();
      syncCounts();
      refreshHistory(state.id);
    } catch (e) { toastError(e); }
  };
  $(".comment-box .btn", box).onclick = send;
  ta.onkeydown = (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } };
  $$("[data-del]", box).forEach((b) => b.onclick = async () => {
    const id = Number(b.dataset.del);
    try {
      await del(`/api/comments/${id}`);
      state.detail.comments = state.detail.comments.filter((c) => c.id !== id);
      renderComments();
      syncCounts();
    } catch (e) { toastError(e); }
  });
}

function renderHistory() {
  const acts = state.detail.activity;
  $("[data-history]", state.node).innerHTML = `<h4>Historial</h4>
    <ul class="hist">${acts.map((a) => `<li><span><b>${esc(a.actor)}</b> ${describe(a)}</span><time title="${esc(a.created_at)}">${esc(timeAgo(a.created_at))}</time></li>`).join("") || '<li class="muted">Sin cambios registrados</li>'}</ul>`;
}

export { STATUS, PRIORITY };
