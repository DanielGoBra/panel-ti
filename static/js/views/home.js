import { describe } from "../activity.js";
import { get } from "../api.js";
import { dataTable, lineChart, stackedBars } from "../charts.js";
import { icons } from "../icons.js";
import { store } from "../store.js";
import { openTask } from "../taskpanel.js";
import { approvalChip, avatar, dueChip, healthBadge, prioChip, projectDot, slaChip, statusChip } from "../ui.js";
import { $, $$, esc, fmtDate, fmtLongDate, parseISO, plural, shortMonth, timeAgo } from "../util.js";

export const title = "Inicio";

const WORK_KEYS = [
  { key: "blocked", label: "Bloqueada", color: "--st-blocked" },
  { key: "in_progress", label: "En curso", color: "--st-in_progress" },
  { key: "review", label: "En revisión", color: "--st-review" },
  { key: "todo", label: "Por hacer", color: "--st-todo" },
];

export async function render(root, _params, nav) {
  root.innerHTML = `<div class="page"><div class="page-head"><div>
      <div class="page-title">Resumen</div><div class="page-sub">${esc(fmtLongDate(store.today).replace(/^./, (c) => c.toUpperCase()))}</div></div></div>
    <div class="tiles">${Array.from({ length: 6 }, () => '<div class="card tile"><div class="skeleton" style="height:64px"></div></div>').join("")}</div></div>`;
  let m, acts;
  try {
    [m, acts] = await Promise.all([get("/api/metrics?weeks=12"), get("/api/activity?limit=14")]);
  } catch (e) {
    root.innerHTML = `<div class="page"><div class="empty">${icons.alert}<h3>No se pudieron cargar las métricas</h3><p>${esc(e.message)}</p></div></div>`;
    return;
  }
  if (!root.isConnected) return;
  const k = m.kpis;
  const delta = k.done_7d - k.done_prev_7d;
  const mineOpen = store.tasks.filter((t) => t.assignee === store.user && t.status !== "done").length;
  const attention = store.tasks
    .filter((t) => t.status === "blocked" || store.isOverdue(t))
    .sort((a, b) => (a.status === "blocked" ? -1 : 0) - (b.status === "blocked" ? -1 : 0) || (a.due_date || "9").localeCompare(b.due_date || "9"));
  const approvals = store.tasks.filter((t) => t.approval_status === "pending");
  const incidents = store.tasks.filter((t) => t.type === "incident" && t.status !== "done")
    .sort((a, b) => (a.sla?.remaining_min ?? 1e9) - (b.sla?.remaining_min ?? 1e9)).slice(0, 7);
  const upcoming = store.tasks
    .filter((t) => t.status !== "done" && t.due_date && t.due_date >= store.today)
    .sort((a, b) => a.due_date.localeCompare(b.due_date)).slice(0, 7);

  const tile = (lbl, ic, value, foot, { alert = false, go = "" } = {}) =>
    `<button class="card tile${alert ? " alert" : ""}" ${go ? `data-go="${go}"` : ""} type="button">
      <span class="tile-label">${icons[ic]}${lbl}</span><span class="tile-value">${value}</span><span class="tile-foot">${foot}</span></button>`;

  root.innerHTML = `<div class="page">
    <div class="page-head"><div>
      <div class="page-title">Resumen</div>
      <div class="page-sub">${esc(fmtLongDate(store.today).replace(/^./, (c) => c.toUpperCase()))} · ${store.user ? `${esc(store.user.split(" ")[0])}, tienes ${plural(mineOpen, "tarea abierta", "tareas abiertas")}` : ""}</div>
    </div></div>

    <div class="tiles">
      ${tile("Abiertas", "layers", k.open, `${k.critical_open} críticas`, { go: "#/lista" })}
      ${tile("Cerradas 7 días", "done", k.done_7d, delta === 0 ? "igual que la semana previa" : `<span class="${delta > 0 ? "up" : "down"}">${delta > 0 ? "+" : ""}${delta}</span> vs. semana previa`)}
      ${tile("Vencidas", "calendar", k.overdue, `${k.due_soon} vencen esta semana`, { alert: k.overdue > 0, go: "#/lista?vencidas=1" })}
      ${tile("Bloqueadas", "blocked", k.blocked, k.blocked ? "esperan una decisión" : "sin bloqueos", { alert: k.blocked > 0, go: "#/lista?estado=blocked" })}
      ${tile("SLA cumplido", "timer", m.sla.compliance_pct != null ? `${m.sla.compliance_pct}<small>%</small>` : "—", m.sla.open_breached ? `<span class="down">${m.sla.open_breached} superados</span> · ${m.sla.open_risk} en riesgo` : m.sla.open_risk ? `${m.sla.open_risk} en riesgo ahora` : `${m.sla.closed} cerrados en 30 días`, { alert: m.sla.open_breached > 0, go: "sla" })}
      ${tile("Riesgo de retraso", "trend", k.delay_risk, k.median_cycle_days != null ? `ciclo típico ${k.median_cycle_days} días` : "según el ritmo del equipo", { go: "delay" })}
    </div>

    <div class="grid-2">
      <section class="card">
        <div class="card-head"><div><h3>Flujo semanal</h3><div class="sub">Tareas creadas y cerradas en las últimas 12 semanas</div></div>
          <button class="table-toggle" data-toggle="flow">Ver tabla</button></div>
        <div class="chart" id="c-flow">
          <div class="legend" style="margin:6px 0 8px"><span><i class="line" style="background:var(--series-1)"></i>Cerradas</span><span><i class="line" style="background:var(--series-2)"></i>Creadas</span></div>
        </div>
        <div class="chart hidden" data-table="flow">${dataTable(["Semana", "Creadas", "Cerradas"], m.flow.map((f) => [fmtDate(f.week), f.created, f.completed]))}</div>
      </section>
      <section class="card">
        <div class="card-head"><div><h3>Carga por persona</h3><div class="sub">Tareas abiertas según estado · clic para ver su tablero</div></div>
          <button class="table-toggle" data-toggle="load">Ver tabla</button></div>
        <div class="chart" id="c-load">
          <div class="legend" style="margin:6px 0 10px">${WORK_KEYS.map((w) => `<span><i style="background:var(${w.color})"></i>${w.label}</span>`).join("")}</div>
        </div>
        <div class="chart hidden" data-table="load">${dataTable(["Persona", "Bloq.", "En curso", "Revisión", "Por hacer", "Vencidas"], m.workload.map((w) => [w.name, w.blocked, w.in_progress, w.review, w.todo, w.overdue]))}</div>
      </section>
    </div>

    <div class="grid-2">
      <section class="card">
        <div class="card-head"><div><h3>Salud de proyectos</h3><div class="sub">Avance, retrasos y bloqueos</div></div><a class="btn sm ghost" href="#/proyectos">Ver todos</a></div>
        <div style="overflow-x:auto"><table class="ph-table"><thead><tr><th>Proyecto</th><th>Estado</th><th style="width:28%">Avance</th><th>Vencidas</th><th>Objetivo</th></tr></thead><tbody>
        ${m.projects.map((p) => `<tr class="click" data-project="${p.id}">
          <td><div class="ph-pname">${projectDot(p)}${esc(p.name)}</div></td>
          <td>${healthBadge(p.state)}</td>
          <td><div class="load"><div class="meter${p.progress >= 100 ? " good" : ""}" style="flex:1"><i style="width:${p.progress}%"></i></div><span class="num">${p.progress}%</span></div></td>
          <td class="num"${p.overdue ? ' style="color:var(--bad);font-weight:600"' : ""}>${p.overdue}</td>
          <td class="muted">${p.due_date ? esc(fmtDate(p.due_date)) : "—"}</td></tr>`).join("") || `<tr><td colspan="5" class="muted">Sin proyectos.</td></tr>`}
        </tbody></table></div>
      </section>
      <section class="card">
        <div class="card-head"><div><h3>Requiere atención</h3><div class="sub">Bloqueos y tareas vencidas</div></div></div>
        <div class="list-rows" style="margin-top:8px">
        ${attention.slice(0, 7).map((t) => `<button class="row-item" data-task="${t.id}">
            ${statusChip(t.status)}
            <span class="grow"><span class="key">${esc(store.taskKey(t))}</span> ${esc(t.title)}
              ${t.status === "blocked" && t.notes ? `<span class="reason">${esc(t.notes)}</span>` : ""}</span>
            ${dueChip(t)}${avatar(t.assignee)}</button>`).join("") || `<div class="row-item muted">Nada bloqueado ni vencido.</div>`}
        </div>
      </section>
    </div>

    <div class="grid-2 even">
      <section class="card">
        <div class="card-head"><div><h3>Probablemente se retrasen</h3><div class="sub">Comparando lo que falta con lo que suele tardar este tipo de trabajo</div></div></div>
        <div class="list-rows" style="margin-top:8px">
        ${m.delays.map((d) => { const t = store.task(d.id); return t ? `<button class="row-item" data-task="${t.id}">
          ${prioChip(t.priority, false)}<span class="grow"><span class="key">${esc(store.taskKey(t))}</span> ${esc(t.title)}<span class="reason">Vence ${esc(fmtDate(t.due_date))} · terminaría hacia el ${esc(fmtDate(d.expected))}</span></span><span class="risk">~${d.late_days} d</span>${avatar(t.assignee)}</button>` : ""; }).join("") || `<div class="row-item muted">Nada apunta a retrasarse.</div>`}
        </div>
      </section>
      ${approvals.length ? `<section class="card">
        <div class="card-head"><div><h3>Cambios pendientes del CAB</h3><div class="sub">${store.can.cab ? "Necesitan tu decisión o la de otra persona del comité" : "Esperan la aprobación del comité"}</div></div></div>
        <div class="list-rows" style="margin-top:8px">${approvals.map((t) => `<button class="row-item" data-task="${t.id}">${approvalChip(t)}<span class="grow"><span class="key">${esc(store.taskKey(t))}</span> ${esc(t.title)}</span>${avatar(t.assignee)}</button>`).join("")}</div>
      </section>` : `<section class="card">
        <div class="card-head"><div><h3>Incidentes abiertos</h3><div class="sub">Con su tiempo restante de SLA</div></div></div>
        <div class="list-rows" style="margin-top:8px">${incidents.map((t) => `<button class="row-item" data-task="${t.id}">${statusChip(t.status)}<span class="grow"><span class="key">${esc(store.taskKey(t))}</span> ${esc(t.title)}</span>${slaChip(t)}${avatar(t.assignee)}</button>`).join("") || `<div class="row-item muted">Sin incidentes abiertos.</div>`}</div>
      </section>`}
    </div>

    <div class="grid-2 even">
      <section class="card">
        <div class="card-head"><div><h3>Próximos vencimientos</h3><div class="sub">Abiertas con fecha</div></div><a class="btn sm ghost" href="#/calendario">Calendario</a></div>
        <div class="list-rows" style="margin-top:8px">
        ${upcoming.map((t) => `<button class="row-item" data-task="${t.id}">
          ${prioChip(t.priority, false)}<span class="grow"><span class="key">${esc(store.taskKey(t))}</span> ${esc(t.title)}</span>${dueChip(t)}${avatar(t.assignee)}</button>`).join("") || `<div class="row-item muted">Sin vencimientos próximos.</div>`}
        </div>
      </section>
      <section class="card">
        <div class="card-head"><div><h3>Actividad reciente</h3><div class="sub">Cambios del equipo</div></div></div>
        <div class="feed">${acts.map((a) => `<div class="feed-item">${avatar(a.actor)}<div><b>${esc(a.actor)}</b> ${describe(a, { withTask: true })}<time title="${esc(a.created_at)}">${esc(timeAgo(a.created_at))}</time></div></div>`).join("") || '<div class="feed-item muted">Sin actividad todavía.</div>'}</div>
      </section>
    </div>
  </div>`;

  const weekLabel = (iso) => { const d = parseISO(iso); return `${d.getDate()} ${shortMonth(d.getMonth())}`; };
  lineChart($("#c-flow", root), {
    series: [{ key: "completed", label: "Cerradas", color: "--series-1", area: true }, { key: "created", label: "Creadas", color: "--series-2" }],
    points: m.flow.map((f, i) => ({ label: weekLabel(f.week), tooltipTitle: i === m.flow.length - 1 ? `Semana actual (en curso)` : `Semana del ${fmtDate(f.week)}`, created: f.created, completed: f.completed })),
  });
  const rows = m.workload.filter((w) => w.name !== "Sin asignar" || WORK_KEYS.some((k2) => w[k2.key]));
  stackedBars($("#c-load", root), {
    keys: WORK_KEYS,
    rows: rows.map((w) => ({ ...w, label: w.name, onClick: () => nav(`#/tablero`, { assignee: w.name === "Sin asignar" ? "__none" : w.name }) })),
    extra: (r) => (r.capacity ? `<div class="tt-row">Capacidad<b>${r.capacity}</b></div>` : "") + (r.overdue ? `<div class="tt-row">Vencidas<b>${r.overdue}</b></div>` : ""),
  });

  $$("[data-go]", root).forEach((b) => b.onclick = () => {
    const g = b.dataset.go;
    if (g === "sla") return nav("#/lista", { adv: { sla: "risk", statuses: [], types: [], question: "SLA en riesgo o superado", explanation: "Incidentes con el SLA en riesgo o superado" } });
    if (g === "delay") return nav("#/lista", { adv: { delayed: true, statuses: [], types: [], question: "Riesgo de retraso", explanation: "Tareas que probablemente no lleguen a su fecha" } });
    location.hash = g;
  });
  $$("[data-task]", root).forEach((b) => b.onclick = () => openTask(b.dataset.task));
  $$("[data-project]", root).forEach((r) => r.onclick = () => nav("#/tablero", { project: r.dataset.project }));
  $$("[data-toggle]", root).forEach((b) => b.onclick = () => {
    const tbl = $(`[data-table="${b.dataset.toggle}"]`, root);
    const chart = b.closest(".card").querySelector(".chart:not([data-table])");
    const showTable = tbl.classList.contains("hidden");
    tbl.classList.toggle("hidden", !showTable);
    chart.classList.toggle("hidden", showTable);
    b.textContent = showTable ? "Ver gráfico" : "Ver tabla";
  });
}

// Solo se vuelve a pedir métricas cuando cambian datos de tareas.
export const refreshOn = ["task", "project", "member", "load", "remote"];
