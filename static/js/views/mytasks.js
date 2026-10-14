import { icons } from "../icons.js";
import { PRIORITY_RANK, store } from "../store.js";
import { openTask } from "../taskpanel.js";
import { dueChip, emptyState, prioChip, projectDot, statusChip, toast, toastError } from "../ui.js";
import { $, $$, addDays, esc } from "../util.js";

export const title = "Mis tareas";

export function render(root) {
  const me = store.user;
  const mine = store.tasks.filter((t) => t.assignee === me);
  const open = mine.filter((t) => t.status !== "done");
  const today = store.today;
  const week = addDays(today, 7);
  const recentDone = mine.filter((t) => t.status === "done" && (t.completed_at || "").slice(0, 10) >= addDays(today, -7));
  const sortFn = (a, b) => (a.due_date || "9").localeCompare(b.due_date || "9") || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];

  const groups = [
    { id: "over", title: "Vencidas", items: open.filter((t) => t.due_date && t.due_date < today), over: true },
    { id: "today", title: "Hoy", items: open.filter((t) => t.due_date === today) },
    { id: "week", title: "Próximos 7 días", items: open.filter((t) => t.due_date > today && t.due_date <= week) },
    { id: "later", title: "Más adelante", items: open.filter((t) => t.due_date > week) },
    { id: "nodate", title: "Sin fecha", items: open.filter((t) => !t.due_date) },
    { id: "done", title: "Cerradas esta semana", items: recentDone },
  ].filter((g) => g.items.length);

  const row = (t) => {
    const p = store.project(t.project_id);
    return `<div class="my-row${t.status === "done" ? " done" : ""}" data-id="${t.id}">
      <button class="round-chk${t.status === "done" ? " on" : ""}" data-toggle title="${t.status === "done" ? "Reabrir" : "Marcar como hecha"}">${icons.check}</button>
      <span class="key">${esc(store.taskKey(t))}</span>
      <button class="t" data-open>${esc(t.title)}</button>
      <span class="hide-sm">${statusChip(t.status)}</span>
      <span class="hide-sm">${p ? `<span class="person" style="font-size:12.5px;color:var(--text-2)">${projectDot(p)}<span>${esc(p.name)}</span></span>` : ""}</span>
      <span style="display:flex;gap:8px;align-items:center;justify-content:flex-end">${prioChip(t.priority, false)}${dueChip(t)}</span>
    </div>`;
  };

  const hours = open.reduce((a, t) => a + (t.estimate || 0), 0);
  const cap = store.member(me)?.capacity;
  root.innerHTML = `<div class="page">
    <div class="page-head"><div><div class="page-title">Mis tareas</div>
      <div class="page-sub">${esc(me || "Elige tu usuario abajo a la izquierda")} · ${open.length} abiertas${cap ? ` de una capacidad de ${cap}` : ""}${hours ? ` · ${hours} h estimadas` : ""}</div></div>
</div>
    ${groups.length ? groups.map((g) => `<section class="my-group"><h3 class="${g.over ? "over" : ""}">${g.title}<span class="n">${g.items.length}</span></h3>
      <div class="card">${g.items.sort(sortFn).map(row).join("")}</div></section>`).join("")
      : `<div class="card">${emptyState("me", "No tienes tareas asignadas", "Cuando alguien te asigne una tarea aparecerá aquí, ordenada por vencimiento.")}</div>`}
  </div>`;

  $$(".my-row", root).forEach((r) => {
    const id = Number(r.dataset.id);
    $("[data-open]", r).onclick = () => openTask(id);
    $("[data-toggle]", r).onclick = async () => {
      const t = store.task(id);
      const prev = t.status;
      const next = prev === "done" ? "todo" : "done";
      try {
        await store.updateTask(id, { status: next });
        if (next === "done") toast(`${store.taskKey(t)} cerrada`, { action: "Deshacer", onAction: () => store.updateTask(id, { status: prev }).catch(toastError) });
      } catch (e) { toastError(e); }
    };
  });
}
