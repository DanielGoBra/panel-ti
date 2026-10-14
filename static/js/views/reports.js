import { del, get, post } from "../api.js";
import { simpleBars } from "../charts.js";
import { icons } from "../icons.js";
import { PRIORITY, label } from "../store.js";
import { store } from "../store.js";
import { confirmDialog, emptyState, toast, toastError } from "../ui.js";
import { $, $$, addDays, downloadUrl, esc, fmtDate, isoDate, parseISO, timeAgo } from "../util.js";

export const title = "Informes";
let period = null;
let current = null;
let savedView = false;

const PRESETS = [
  ["month", "Este mes"],
  ["30", "Últimos 30 días"],
  ["quarter", "Trimestre"],
  ["prev", "Mes anterior"],
];

function presetRange(k) {
  const t = parseISO(store.today);
  if (k === "month") return [isoDate(new Date(t.getFullYear(), t.getMonth(), 1)), store.today];
  if (k === "30") return [addDays(store.today, -29), store.today];
  if (k === "quarter") return [isoDate(new Date(t.getFullYear(), Math.floor(t.getMonth() / 3) * 3, 1)), store.today];
  if (k === "prev") return [isoDate(new Date(t.getFullYear(), t.getMonth() - 1, 1)), isoDate(new Date(t.getFullYear(), t.getMonth(), 0))];
}

function summary(r) {
  const k = r.kpis;
  const byBlocked = [...r.by_project].sort((a, b) => b.blocked - a.blocked);
  const worst = byBlocked[0] && byBlocked[0].blocked >= 2 && byBlocked[0].blocked > (byBlocked[1]?.blocked || 0) ? byBlocked[0] : null;
  const parts = [
    `En el período del <b>${fmtDate(r.period.start, { year: true })}</b> al <b>${fmtDate(r.period.end, { year: true })}</b> se cerraron <b>${k.closed_in_period ?? k.done}</b> tareas.`,
    `La cartera suma <b>${k.total_tasks}</b> tareas en ${k.projects_tracked} proyectos, con un <b>${k.completion_pct}%</b> completado.`,
    `Quedan ${k.in_progress} en curso, ${k.review ?? 0} en revisión y ${k.todo} pendientes de iniciar.`,
  ];
  if (k.blocked) parts.push(`Hay <b>${k.blocked} ${k.blocked === 1 ? "tarea bloqueada" : "tareas bloqueadas"}</b> que necesitan una decisión del comité${worst ? `, ${worst.blocked} de ellas en ${esc(worst.name)}` : ""}.`);
  if (k.overdue) parts.push(`<b>${k.overdue}</b> ${k.overdue === 1 ? "tarea ha superado" : "tareas han superado"} su fecha de vencimiento.`);
  if (!k.blocked && !k.overdue) parts.push("No hay bloqueos ni tareas vencidas.");
  return parts.join(" ");
}

function paper(r) {
  const k = r.kpis;
  const pri = { low: "Baja", medium: "Media", high: "Alta", critical: "Crítica" };
  return `<article class="paper" id="report-paper">
    <h1>${esc(r.title)}</h1>
    <p class="meta-line">${esc(store.settings.workspace || "")} · Período ${esc(fmtDate(r.period.start, { year: true }))} – ${esc(fmtDate(r.period.end, { year: true }))} · Generado ${esc(r.generated_at.replace("T", " ").slice(0, 16))}</p>
    <p class="summary">${summary(r)}</p>
    <div class="rkpis">
      <div class="rkpi"><b>${k.total_tasks}</b><span>Tareas</span></div>
      <div class="rkpi"><b>${k.completion_pct}%</b><span>Completado</span></div>
      <div class="rkpi"><b>${k.closed_in_period ?? k.done}</b><span>Cerradas en período</span></div>
      <div class="rkpi"><b>${k.in_progress}</b><span>En curso</span></div>
      <div class="rkpi"><b>${k.review ?? 0}</b><span>En revisión</span></div>
      <div class="rkpi"><b${k.blocked ? ' style="color:var(--bad)"' : ""}>${k.blocked}</b><span>Bloqueadas</span></div>
      <div class="rkpi"><b${k.overdue ? ' style="color:var(--bad)"' : ""}>${k.overdue}</b><span>Vencidas</span></div>
    </div>
    <div class="rep-charts">
      <div><h3>Tareas por estado</h3><div class="chart" id="r-status"></div></div>
      <div><h3>Tareas por prioridad</h3><div class="chart" id="r-prio"></div></div>
    </div>
    <h3>Avance por proyecto</h3>
    <div style="overflow-x:auto"><table class="rtable"><thead><tr><th>Proyecto</th><th class="n">Total</th><th class="n">Hechas</th><th class="n">Abiertas</th><th class="n">Bloqueadas</th><th style="width:30%">Avance</th></tr></thead><tbody>
      ${r.by_project.map((p) => { const pct = p.total ? Math.round((100 * p.done) / p.total) : 0; return `<tr><td>${esc(p.name)}</td><td class="n">${p.total}</td><td class="n">${p.done}</td><td class="n">${p.open}</td><td class="n"${p.blocked ? ' style="color:var(--bad);font-weight:600"' : ""}>${p.blocked}</td><td><div class="load"><div class="meter" style="flex:1"><i style="width:${pct}%"></i></div><span class="num">${pct}%</span></div></td></tr>`; }).join("") || '<tr><td colspan="6" class="muted">Sin datos en el período.</td></tr>'}
    </tbody></table></div>
    ${r.blocked_tasks.length ? `<h3>Bloqueos que requieren decisión</h3><ul class="rlist">${r.blocked_tasks.map((t) => `<li><span class="key">${esc(t.key || "")}</span><span class="grow">${esc(t.title)}${t.notes ? `<span class="note">${esc(t.notes)}</span>` : ""}</span><span class="muted">${esc(t.assignee || "Sin asignar")}</span></li>`).join("")}</ul>` : ""}
    ${r.overdue_tasks.length ? `<h3>Tareas vencidas</h3><ul class="rlist">${r.overdue_tasks.map((t) => `<li><span class="key">${esc(t.key || "")}</span><span class="grow">${esc(t.title)}</span><span class="muted">${esc(pri[t.priority] || t.priority)} · ${esc(t.assignee || "Sin asignar")}</span><span style="color:var(--bad);white-space:nowrap">${esc(fmtDate(t.due_date))}</span></li>`).join("")}</ul>` : ""}
  </article>`;
}

export async function render(root) {
  if (!period) period = { preset: "month", range: presetRange("month") };
  const [start, end] = period.range;
  root.innerHTML = `<div class="page">
    <div class="page-head"><div><div class="page-title">Informes de comité</div>
      <div class="page-sub">Resumen ejecutivo del período para el comité de tecnología, exportable a Word, Excel o PDF</div></div></div>
    <div class="rep-bar">
      <div class="seg">${PRESETS.map(([k, l]) => `<button class="${period.preset === k ? "on" : ""}" data-preset="${k}">${l}</button>`).join("")}</div>
      <label class="field"><span>Desde</span><input class="input" type="date" id="rep-start" value="${start}"></label>
      <label class="field"><span>Hasta</span><input class="input" type="date" id="rep-end" value="${end}"></label>
    </div>
    <div id="rep-out"><div class="paper"><div class="skeleton" style="height:280px"></div></div></div>
    <div class="saved-reports">
      <h2 class="section">Informes guardados</h2>
      <div class="card" id="rep-saved"><div class="skeleton" style="height:60px;margin:12px"></div></div>
    </div>
  </div>`;

  $$("[data-preset]", root).forEach((b) => b.onclick = () => { period = { preset: b.dataset.preset, range: presetRange(b.dataset.preset) }; savedView = false; render(root); });
  ["rep-start", "rep-end"].forEach((id) => $(`#${id}`, root).onchange = () => {
    const s = $("#rep-start", root).value, e = $("#rep-end", root).value;
    if (s && e && s <= e) { period = { preset: "", range: [s, e] }; savedView = false; render(root); }
    else toast("La fecha inicial debe ser anterior a la final", { error: true });
  });

  try {
    if (!savedView) current = await get(`/api/report?start=${start}&end=${end}`);
    if (!root.isConnected) return;
    drawReport(root);
  } catch (e) { $("#rep-out", root).innerHTML = `<div class="card">${emptyState("alert", "No se pudo generar el informe", e.message)}</div>`; }
  loadSaved(root);
}

function drawReport(root) {
  const r = current;
  $("#rep-out", root).innerHTML = paper(r) + `<div class="rep-actions">
    ${savedView ? `<button class="btn" data-act="live">${icons.arrowRight}Volver al informe actual</button>` : `<button class="btn primary" data-act="save">${icons.save}Guardar en histórico</button>`}
    <button class="btn" data-act="docx">${icons.doc}Word</button>
    <button class="btn" data-act="xlsx">${icons.sheet}Excel</button>
    <button class="btn" data-act="print">${icons.print}Imprimir o PDF</button>
  </div>`;
  const k = r.kpis;
  simpleBars($("#r-status", root), {
    rows: [
      { label: "Hechas", value: k.done, color: "--st-done" },
      { label: "En curso", value: k.in_progress, color: "--st-in_progress" },
      { label: "En revisión", value: k.review ?? 0, color: "--st-review" },
      { label: "Bloqueadas", value: k.blocked, color: "--st-blocked" },
      { label: "Por hacer", value: k.todo, color: "--st-todo" },
    ],
  });
  const tot = k.total_tasks || 1;
  simpleBars($("#r-prio", root), {
    rows: PRIORITY.map((p) => ({ label: label(PRIORITY, p.id), value: r.by_priority[p.id] || 0 })),
    fmt: (v) => `${v} · ${Math.round((100 * v) / tot)}%`,
  });
  $$("[data-act]", root).forEach((b) => b.onclick = async () => {
    const a = b.dataset.act;
    const q = `start=${r.period.start}&end=${r.period.end}`;
    if (a === "save") { try { await post("/api/reports", r); toast("Informe guardado en el histórico"); loadSaved(root); } catch (e) { toastError(e); } }
    if (a === "docx" || a === "xlsx") downloadUrl(`/api/export/${a}?${q}`);
    if (a === "print") window.print();
    if (a === "live") { savedView = false; render(root); }
  });
}

async function loadSaved(root) {
  const box = $("#rep-saved", root);
  try {
    const list = await get("/api/reports");
    if (!box.isConnected) return;
    box.innerHTML = list.length ? `<div class="list-rows">${list.map((r) => `<div class="row-item">
        <span class="ic" style="color:var(--muted)">${icons.doc}</span>
        <span class="grow">${esc(r.title)} · ${esc(fmtDate(r.period_start, { year: true }))} – ${esc(fmtDate(r.period_end, { year: true }))}</span>
        <span class="muted" style="font-size:12px">${esc(timeAgo(r.created_at))}</span>
        <button class="btn sm ghost" data-view="${r.id}">${icons.eye}Ver</button>
        <button class="icon-btn" data-del="${r.id}" title="Eliminar">${icons.trash}</button></div>`).join("")}</div>`
      : emptyState("doc", "Sin informes guardados", "Guarda el informe del período para conservar la foto que se presentó al comité.");
    $$("[data-view]", box).forEach((b) => b.onclick = async () => {
      try { current = await get(`/api/reports/${b.dataset.view}`); savedView = true; drawReport(root); $("#rep-out", root).scrollIntoView({ behavior: "smooth" }); } catch (e) { toastError(e); }
    });
    $$("[data-del]", box).forEach((b) => b.onclick = async () => {
      if (!(await confirmDialog({ title: "Eliminar informe guardado", text: "Se borrará del histórico." }))) return;
      try { await del(`/api/reports/${b.dataset.del}`); loadSaved(root); } catch (e) { toastError(e); }
    });
  } catch (e) { box.innerHTML = `<div class="row-item muted">${esc(e.message)}</div>`; }
}

export const refreshOn = [];
