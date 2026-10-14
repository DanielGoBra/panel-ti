import { bindFilterBar, filterBar, hasFilters } from "../filters.js";
import { icons } from "../icons.js";
import { STATUS, store } from "../store.js";
import { askBlockReason, openTask } from "../taskpanel.js";
import { avatar, dueChip, modal, popMenu, prioChip, projectDot, toast, toastError, typeIcon } from "../ui.js";
import { $, $$, addDays, esc } from "../util.js";

export const title = "Tablero";
const DONE_WINDOW_DAYS = 14;
let showAllDone = false;
let quickAddOpen = null; // estado de la columna con alta rápida abierta

export function card(t, { showProject = true } = {}) {
  const p = store.project(t.project_id);
  const tags = (t.tags || "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 2);
  const chk = t.checklist_total ? `<span class="meta-ic${t.checklist_done === t.checklist_total ? " full" : ""}" title="Checklist">${icons.checklist}${t.checklist_done}/${t.checklist_total}</span>` : "";
  const com = t.comment_count ? `<span class="meta-ic" title="Comentarios">${icons.comment}${t.comment_count}</span>` : "";
  return `<article class="tcard${t.status === "done" ? " is-done" : ""}" draggable="true" tabindex="0" data-id="${t.id}" aria-label="${esc(store.taskKey(t))} ${esc(t.title)}">
    <div class="t-top">${typeIcon(t.type)}<span class="key">${esc(store.taskKey(t))}</span>${showProject && p ? `${projectDot(p)}` : ""}${avatar(t.assignee)}</div>
    <div class="t-title">${esc(t.title)}</div>
    <div class="t-meta">${prioChip(t.priority, t.priority === "critical" || t.priority === "high")}${dueChip(t)}${chk}${com}${tags.map((g) => `<span class="tag">${esc(g)}</span>`).join("")}</div>
  </article>`;
}

export function render(root, params) {
  const tasks = store.filtered();
  const limits = store.settings.wip_limits || {};
  const doneCut = addDays(store.today, -DONE_WINDOW_DAYS);
  const showProject = !store.filters.project;
  const p = store.project(store.filters.project);

  const cols = STATUS.map((s) => {
    let items = tasks.filter((t) => t.status === s.id).sort((a, b) => a.position - b.position);
    let hidden = 0;
    if (s.id === "done" && !showAllDone) {
      const recent = items.filter((t) => (t.completed_at || t.updated_at || "").slice(0, 10) >= doneCut);
      hidden = items.length - recent.length;
      items = recent;
    }
    const lim = limits[s.id];
    const total = tasks.filter((t) => t.status === s.id).length;
    const over = lim && total > lim;
    return `<section class="col" data-status="${s.id}" aria-label="${s.label}">
      <header class="col-head" data-s="${s.id}">
        <span class="status-dot" data-s="${s.id}"></span>${s.label}<span class="n">${total}</span>
        ${lim ? `<span class="wip${over ? " over" : ""}" title="Límite de trabajo en curso">${over ? "Límite superado · " : "máx. "}${lim}</span>` : ""}
        <span class="tools">
          <button class="icon-btn" data-add-top="${s.id}" title="Añadir tarea">${icons.plus}</button>
          <button class="icon-btn" data-col-menu="${s.id}" title="Opciones de columna">${icons.more}</button>
        </span>
      </header>
      <div class="col-body" data-scroll-key="col-${s.id}">
        ${items.map((t) => card(t, { showProject })).join("") || `<div class="col-empty">${hasFilters() ? "Sin coincidencias" : "Arrastra tareas aquí"}</div>`}
        ${hidden ? `<button class="quick-add-btn" data-show-done>${icons.eye}Ver ${hidden} cerradas hace más de ${DONE_WINDOW_DAYS} días</button>` : ""}
        ${s.id === "done" && showAllDone ? `<button class="quick-add-btn" data-hide-done>Ocultar cerradas antiguas</button>` : ""}
      </div>
      <div class="quick-add" data-qa="${s.id}">${quickAddOpen === s.id
        ? `<textarea rows="2" placeholder="Título de la tarea" data-focus-key="qa-${s.id}"></textarea><div class="hint">Enter para crear · Esc para cerrar${p ? ` · en ${esc(p.name)}` : ""}</div>`
        : `<button class="quick-add-btn" data-qa-open="${s.id}">${icons.plus}Nueva</button>`}</div>
    </section>`;
  }).join("");

  root.innerHTML = `<div class="board-wrap">
    <div class="board-bar">${filterBar()}<div class="right"><span class="muted" style="font-size:12.5px">${tasks.length} tareas</span></div></div>
    <div class="board" data-scroll-key="board">${cols}</div>
  </div>`;

  bindFilterBar(root);
  bindCards(root);
  bindDnD(root);

  $$("[data-qa-open]", root).forEach((b) => b.onclick = () => { quickAddOpen = b.dataset.qaOpen; render(root, params); $(`[data-qa="${quickAddOpen}"] textarea`, root)?.focus(); });
  $$("[data-add-top]", root).forEach((b) => b.onclick = () => { quickAddOpen = b.dataset.addTop; render(root, params); $(`[data-qa="${quickAddOpen}"] textarea`, root)?.focus(); });
  const qa = $(".quick-add textarea", root);
  if (qa) {
    qa.onkeydown = async (e) => {
      if (e.key === "Escape") { e.stopPropagation(); quickAddOpen = null; render(root, params); return; }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const titleTxt = qa.value.trim();
        if (!titleTxt) return;
        const status = qa.closest("[data-qa]").dataset.qa;
        const f = store.filters;
        try {
          const t = await store.createTask({
            title: titleTxt, status, project_id: f.project || null,
            assignee: f.mine ? store.user : (f.assignee && f.assignee !== "__none" ? f.assignee : ""),
            priority: f.priority || "medium", type: f.type || "task",
          });
          toast(`${store.taskKey(t)} creada`, { action: "Abrir", onAction: () => openTask(t.id) });
          requestAnimationFrame(() => $(`[data-qa="${status}"] textarea`)?.focus());
        } catch (err) { toastError(err); }
      }
    };
    qa.onblur = () => setTimeout(() => { if (quickAddOpen && !qa.value.trim() && document.activeElement !== qa && qa.isConnected) { quickAddOpen = null; render(root, params); } }, 150);
  }
  $("[data-show-done]", root)?.addEventListener("click", () => { showAllDone = true; render(root, params); });
  $("[data-hide-done]", root)?.addEventListener("click", () => { showAllDone = false; render(root, params); });
  $$("[data-col-menu]", root).forEach((b) => b.onclick = () => colMenu(b, b.dataset.colMenu));
}

function colMenu(anchor, status) {
  const s = STATUS.find((x) => x.id === status);
  const lim = (store.settings.wip_limits || {})[status];
  const doneTasks = store.filtered().filter((t) => t.status === status);
  popMenu(anchor, [
    { value: "wip", html: `${icons.hourglass}${lim ? `Cambiar límite (${lim})` : "Fijar límite de trabajo"}` },
    ...(lim ? [{ value: "nowip", html: `${icons.close}Quitar límite` }] : []),
    { sep: true },
    { value: "sel", html: `${icons.list}Ver ${doneTasks.length} en la lista` },
  ], (v) => {
    if (v === "nowip") return store.saveSettings({ wip_limits: { ...store.settings.wip_limits, [status]: null } }).catch(toastError);
    if (v === "sel") { location.hash = `#/lista?estado=${status}`; return; }
    modal({
      title: `Límite de trabajo · ${s.label}`,
      sub: "Cuando la columna supera el límite se marca en rojo. Ayuda a terminar antes de empezar trabajo nuevo.",
      size: "sm",
      body: `<label class="field"><span>Máximo de tareas</span><input class="input" type="number" min="1" max="99" name="lim" value="${lim || ""}" autofocus></label>`,
      async onSave(form) {
        const n = parseInt(form.lim.value, 10);
        if (!n || n < 1) throw new Error("Indica un número mayor que cero.");
        await store.saveSettings({ wip_limits: { ...store.settings.wip_limits, [status]: n } });
      },
    });
  });
}

function bindCards(root) {
  $$(".tcard", root).forEach((c) => {
    c.addEventListener("click", () => openTask(c.dataset.id));
    c.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openTask(c.dataset.id); } });
  });
}

function bindDnD(root) {
  let dragId = null;
  let line = null;
  const clearLine = () => { line?.remove(); line = null; };

  $$(".tcard", root).forEach((c) => {
    c.addEventListener("dragstart", (e) => {
      dragId = Number(c.dataset.id);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(dragId));
      requestAnimationFrame(() => c.classList.add("dragging"));
    });
    c.addEventListener("dragend", () => { c.classList.remove("dragging"); clearLine(); $$(".col.drop", root).forEach((x) => x.classList.remove("drop")); dragId = null; });
  });

  $$(".col", root).forEach((col) => {
    const body = $(".col-body", col);
    col.addEventListener("dragover", (e) => {
      if (dragId === null) return;
      e.preventDefault();
      $$(".col.drop", root).forEach((x) => x !== col && x.classList.remove("drop"));
      col.classList.add("drop");
      const after = cardAfter(body, e.clientY);
      if (!line) line = document.createElement("div"), line.className = "drop-line";
      if (after) body.insertBefore(line, after);
      else {
        const lastCard = [...body.querySelectorAll(".tcard")].pop();
        if (lastCard) lastCard.after(line); else body.prepend(line);
      }
    });
    col.addEventListener("dragleave", (e) => { if (!col.contains(e.relatedTarget)) { col.classList.remove("drop"); clearLine(); } });
    col.addEventListener("drop", async (e) => {
      e.preventDefault();
      col.classList.remove("drop");
      const id = dragId;
      if (id === null) return;
      const status = col.dataset.status;
      const after = line ? nextCard(line) : null;
      const ordered = $$(".tcard", body).filter((x) => Number(x.dataset.id) !== id);
      clearLine();
      const idx = after ? ordered.indexOf(after) : ordered.length;
      const prev = store.task(ordered[idx - 1]?.dataset.id);
      const next = store.task(ordered[idx]?.dataset.id);
      let position;
      if (prev && next) position = (prev.position + next.position) / 2;
      else if (prev) position = prev.position + 1024;
      else if (next) position = next.position - 1024;
      else position = 1024;
      const t = store.task(id);
      if (t.status === status && Math.abs(t.position - position) < 1e-9) return;
      if (status === "blocked" && t.status !== "blocked") return askBlockReason(id, { position });
      try {
        await store.updateTask(id, { status, position });
        if (status === "done" && t.status !== "done") toast(`${store.taskKey(t)} cerrada`, { action: "Deshacer", onAction: () => store.updateTask(id, { status: t.status, position: t.position }).catch(toastError) });
      } catch (err) { toastError(err); }
    });
  });
}

function nextCard(node) {
  let n = node.nextElementSibling;
  while (n && !n.classList.contains("tcard")) n = n.nextElementSibling;
  return n;
}

function cardAfter(body, y) {
  const cards = [...body.querySelectorAll(".tcard:not(.dragging)")];
  return cards.find((c) => { const r = c.getBoundingClientRect(); return y < r.top + r.height / 2; }) || null;
}
