import { bindFilterBar, filterBar } from "../filters.js";
import { icons } from "../icons.js";
import { PRIORITY_RANK, store } from "../store.js";
import { openTask } from "../taskpanel.js";
import { openTaskForm, popMenu, statusDot, toast, toastError } from "../ui.js";
import { $, $$, esc, fmtDate, isoDate, monthName, parseISO } from "../util.js";

export const title = "Calendario";
let cursor = null; // primer día del mes visible
const MAX_PER_DAY = 3;

export function render(root, params) {
  if (!cursor) { const d = parseISO(store.today); cursor = new Date(d.getFullYear(), d.getMonth(), 1); }
  const y = cursor.getFullYear(), m = cursor.getMonth();
  const first = new Date(y, m, 1);
  const start = new Date(first);
  start.setDate(1 - ((first.getDay() + 6) % 7)); // lunes
  const last = new Date(y, m + 1, 0);
  const weeks = Math.ceil((((first.getDay() + 6) % 7) + last.getDate()) / 7);

  const tasks = store.filtered();
  const byDay = new Map();
  tasks.forEach((t) => { if (t.due_date) { if (!byDay.has(t.due_date)) byDay.set(t.due_date, []); byDay.get(t.due_date).push(t); } });
  byDay.forEach((list) => list.sort((a, b) => (a.status === "done") - (b.status === "done") || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]));
  const undated = tasks.filter((t) => !t.due_date && t.status !== "done").length;
  const monthStart = isoDate(first), monthEnd = isoDate(last);
  const inMonth = tasks.filter((t) => t.due_date >= monthStart && t.due_date <= monthEnd);
  const overdueMonth = inMonth.filter((t) => store.isOverdue(t)).length;

  const item = (t) => {
    const p = store.project(t.project_id);
    return `<button class="cal-item${t.status === "done" ? " done" : ""}" draggable="true" data-id="${t.id}" style="--pc:${p ? esc(p.color) : "var(--border-strong)"}" title="${esc(store.taskKey(t))} ${esc(t.title)}">${statusDot(t.status)}<span>${esc(t.title)}</span></button>`;
  };

  let cells = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((d) => `<div class="cal-dow">${d}</div>`).join("");
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const iso = isoDate(d);
    const list = byDay.get(iso) || [];
    const cls = [d.getMonth() !== m && "out", iso === store.today && "today"].filter(Boolean).join(" ");
    cells += `<div class="cal-day ${cls}" data-day="${iso}">
      <span class="cal-num">${d.getDate()}</span>
      <button class="icon-btn cal-add" data-new="${iso}" title="Nueva tarea para el ${esc(fmtDate(iso))}">${icons.plus}</button>
      ${list.slice(0, MAX_PER_DAY).map(item).join("")}
      ${list.length > MAX_PER_DAY ? `<button class="cal-more" data-more="${iso}">+${list.length - MAX_PER_DAY} más</button>` : ""}
    </div>`;
  }

  root.innerHTML = `<div class="cal-wrap">
    <div class="board-bar">${filterBar()}</div>
    <div class="cal-bar">
      <h2>${monthName(y, m)}</h2>
      <button class="icon-btn" data-nav="-1" title="Mes anterior">${icons.chevronLeft}</button>
      <button class="btn sm" data-nav="0">Hoy</button>
      <button class="icon-btn" data-nav="1" title="Mes siguiente">${icons.chevronRight}</button>
      <span class="muted" style="margin-left:auto;font-size:12.5px">${inMonth.length} con vencimiento este mes${overdueMonth ? ` · <span style="color:var(--bad);font-weight:500">${overdueMonth} vencidas</span>` : ""}${undated ? ` · ${undated} ${undated === 1 ? "abierta" : "abiertas"} sin fecha` : ""}</span>
    </div>
    <div class="cal">${cells}</div>
    <p class="muted" style="font-size:12px;margin-top:10px">Arrastra una tarea a otro día para cambiar su vencimiento. El borde de color indica el proyecto.</p>
  </div>`;

  bindFilterBar(root);
  const rerender = () => render(root, params);
  $$("[data-nav]", root).forEach((b) => b.onclick = () => {
    const n = Number(b.dataset.nav);
    if (n === 0) { const d = parseISO(store.today); cursor = new Date(d.getFullYear(), d.getMonth(), 1); }
    else cursor = new Date(y, m + n, 1);
    rerender();
  });
  $$(".cal-item", root).forEach((b) => {
    b.onclick = () => openTask(b.dataset.id);
    b.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/plain", b.dataset.id); e.dataTransfer.effectAllowed = "move"; });
  });
  $$("[data-more]", root).forEach((b) => b.onclick = () => {
    const list = byDay.get(b.dataset.more);
    popMenu(b, [{ label: fmtDate(b.dataset.more, { year: true }) }, ...list.map((t) => ({ value: t.id, html: `${statusDot(t.status)}<span>${esc(t.title)}</span>` }))], (id) => openTask(id));
  });
  $$("[data-new]", root).forEach((b) => b.onclick = (e) => {
    e.stopPropagation();
    const f = store.filters;
    openTaskForm({ due_date: b.dataset.new, project_id: f.project, assignee: f.mine ? store.user : "" }, (t, open) => open && openTask(t.id));
  });
  $$(".cal-day", root).forEach((day) => {
    day.addEventListener("dragover", (e) => { e.preventDefault(); day.classList.add("drop"); });
    day.addEventListener("dragleave", () => day.classList.remove("drop"));
    day.addEventListener("drop", async (e) => {
      e.preventDefault();
      day.classList.remove("drop");
      const id = Number(e.dataTransfer.getData("text/plain"));
      const t = store.task(id);
      if (!t || t.due_date === day.dataset.day) return;
      const prev = t.due_date;
      try {
        await store.updateTask(id, { due_date: day.dataset.day });
        toast(`${store.taskKey(t)} vence el ${fmtDate(day.dataset.day)}`, { action: "Deshacer", onAction: () => store.updateTask(id, { due_date: prev }).catch(toastError) });
      } catch (err) { toastError(err); }
    });
  });
}
