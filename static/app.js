const I = {
  dashboard: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>',
  projects: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/></svg>',
  tasks: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2.5"/><path d="m8.5 12.5 2.4 2.4 4.6-5.3"/></svg>',
  reports: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2.5H6.5a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8L14 2.5z"/><path d="M14 2.5V8h5.5"/><path d="M9 13h6M9 17h4"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="8" r="3.5"/><path d="M5 20c1.2-3.5 4-5 7-5s5.8 1.5 7 5"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round"><rect x="3.5" y="5" width="17" height="16" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4.5L20 8.5a2.1 2.1 0 0 0-3-3L5.5 17 4 20z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9.5 7V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v2M6.5 7l1 13h9l1-13"/><path d="M10 11v6M14 11v6"/></svg>',
  doc: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2.5H6.5a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8L14 2.5z"/><path d="M14 2.5V8h5.5"/></svg>',
  sheet: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="17" height="17" rx="2"/><path d="M3.5 9.5h17M3.5 15.5h17M9.5 3.5v17M15.5 3.5v17"/></svg>',
  print: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 8V3.5h10V8M7 17H5a1.5 1.5 0 0 1-1.5-1.5v-6A1.5 1.5 0 0 1 5 8h14a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 19 17h-2"/><rect x="7" y="14" width="10" height="6.5" rx="1"/></svg>',
  save: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3.5h11L20.5 8v12a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 20V5A1.5 1.5 0 0 1 5 3.5z"/><path d="M8 3.5V9h7V3.5M8 20.5v-6h8v6"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  blocked: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m5.5 5.5 13 13"/></svg>',
  inbox: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>',
};

const STATUS_LABEL = { todo: "Por hacer", in_progress: "En curso", done: "Hecha", blocked: "Bloqueada" };
const PRI_LABEL = { low: "Baja", medium: "Media", high: "Alta", critical: "Crítica" };
let projects = [], tasks = [], currentReport = null, editingTask = null, editingProject = null;

const api = (url, opts) => fetch(url, { headers: { "Content-Type": "application/json" }, ...opts }).then(r => r.json());

document.querySelectorAll(".nav-btn").forEach(btn => {
  btn.querySelector(".ic").innerHTML = I[btn.dataset.view];
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll(".view").forEach(v => v.classList.add("hidden"));
    const view = document.getElementById(`view-${btn.dataset.view}`);
    view.classList.remove("hidden");
    view.style.animation = "none";
    void view.offsetWidth;
    view.style.animation = "";
    if (btn.dataset.view === "dashboard") loadDashboard();
    if (btn.dataset.view === "projects") loadProjects();
    if (btn.dataset.view === "tasks") loadTasks();
    if (btn.dataset.view === "reports") loadSavedReports();
  });
});

// ---------- Dashboard ----------
async function loadDashboard() {
  const rep = await api("/api/report");
  const k = rep.kpis;
  const cards = [
    { num: k.total_tasks, lbl: "Tareas totales", sub: `${k.projects_tracked} proyectos`, cls: "", icon: I.tasks },
    { num: `${k.completion_pct}%`, lbl: "Completado", sub: `${k.done} hechas`, cls: "green", icon: I.check },
    { num: k.in_progress, lbl: "En curso", cls: "accent", sub: "en marcha", icon: I.dashboard },
    { num: k.blocked, lbl: "Bloqueadas", sub: k.blocked > 0 ? "requieren atención" : "sin bloqueos", cls: "amber", icon: I.blocked },
    { num: k.overdue, lbl: "Vencidas", sub: k.overdue > 0 ? "fuera de plazo" : "al día", cls: "red", icon: I.calendar },
  ];
  document.getElementById("kpi-cards").innerHTML = cards.map(c =>
    `<div class="kpi-card ${c.cls}"><div class="kpi-icon">${c.icon}</div><div class="num">${c.num}</div><div class="lbl">${c.lbl}</div><div class="sub">${c.sub}</div></div>`).join("");
  document.getElementById("project-progress").innerHTML = rep.by_project.length
    ? rep.by_project.map(p => {
        const pct = p.total ? Math.round(100 * p.done / p.total) : 0;
        return `<div class="progress-row"><div class="name">${esc(p.name)}<span>${p.done}/${p.total} hechas · ${p.blocked} bloqueadas</span></div><div class="bar"><div style="width:${pct}%"></div></div></div>`;
      }).join("")
    : `<div class="empty-state"><span class="es-icon">${I.inbox}</span>Aún no hay proyectos con tareas.<br>Crea un proyecto y añade tareas para ver el avance aquí.</div>`;
}

// ---------- Projects ----------
async function loadProjects() {
  projects = await api("/api/projects");
  document.getElementById("project-list").innerHTML = projects.length
    ? projects.map(p => `
      <div class="card" style="--card-accent:${p.color}">
        <h3><span class="proj-color" style="background:${p.color};color:${p.color}"></span>${esc(p.name)}</h3>
        <div class="desc">${esc(p.description || "Sin descripción")}</div>
        <div class="meta">
          <span>${I.user}${esc(p.owner || "—")}</span>
          <span>Estado: ${p.status === "active" ? "Activo" : p.status}</span>
        </div>
        <div class="actions">
          <button class="btn ghost" onclick="openProjectModal(${p.id})">${I.edit} Editar</button>
          <button class="btn ghost danger" onclick="deleteProject(${p.id})">${I.trash} Eliminar</button>
        </div>
      </div>`).join("")
    : `<div class="empty-state"><span class="es-icon">${I.projects}</span>Sin proyectos todavía.<br>Pulsa «Nuevo proyecto» para crear el primero.</div>`;
  const sel = document.getElementById("filter-project");
  sel.innerHTML = `<option value="">Todos los proyectos</option>` + projects.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join("");
}

function openProjectModal(id = null) {
  editingProject = id;
  const p = id ? projects.find(x => x.id === id) : null;
  document.getElementById("modal-title").textContent = p ? "Editar proyecto" : "Nuevo proyecto";
  document.getElementById("modal-body").innerHTML = `
    <label>Nombre</label><input id="f-name" value="${p ? esc(p.name) : ""}">
    <label>Descripción</label><textarea id="f-desc" rows="3">${p ? esc(p.description) : ""}</textarea>
    <label>Responsable</label><input id="f-owner" value="${p ? esc(p.owner) : ""}">
    <label>Color</label><input id="f-color" type="color" value="${p ? p.color : "#7c7cf0"}">`;
  document.getElementById("modal-save").onclick = saveProject;
  showModal();
}

async function saveProject() {
  const body = {
    name: document.getElementById("f-name").value,
    description: document.getElementById("f-desc").value,
    owner: document.getElementById("f-owner").value,
    color: document.getElementById("f-color").value,
  };
  if (editingProject) await api(`/api/projects/${editingProject}`, { method: "PUT", body: JSON.stringify(body) });
  else await api("/api/projects", { method: "POST", body: JSON.stringify(body) });
  hideModal(); loadProjects();
}

async function deleteProject(id) {
  if (!confirm("¿Eliminar el proyecto y todas sus tareas?")) return;
  await api(`/api/projects/${id}`, { method: "DELETE" });
  loadProjects();
}

// ---------- Tasks ----------
async function loadTasks() {
  [tasks, projects] = await Promise.all([api("/api/tasks"), api("/api/projects")]);
  if (!document.getElementById("filter-project").options.length) {
    document.getElementById("filter-project").innerHTML = `<option value="">Todos los proyectos</option>` +
      projects.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join("");
  }
  renderTasks();
}

function renderTasks() {
  const pid = document.getElementById("filter-project").value;
  const st = document.getElementById("filter-status").value;
  const filtered = tasks.filter(t => (!pid || String(t.project_id) === pid) && (!st || t.status === st));
  const cols = ["todo", "in_progress", "blocked", "done"];
  document.getElementById("board").innerHTML = cols.map(c => {
    const items = filtered.filter(t => t.status === c);
    return `<div class="col" data-status="${c}" ondragover="dragOver(event)" ondragleave="dragLeave(event)" ondrop="dropTask(event)">
      <div class="col-head"><span><span class="dot"></span>${STATUS_LABEL[c]}</span><span class="count">${items.length}</span></div>
      ${items.map(t => taskCard(t)).join("")}
    </div>`;
  }).join("");
}

function taskCard(t) {
  const proj = projects.find(p => p.id === t.project_id);
  return `<div class="task-card${t.status === "done" ? " is-done" : ""}" draggable="true" ondragstart="dragStart(event, ${t.id})" ondragend="dragEnd(event)">
    <div class="title">${esc(t.title)}</div>
    <div class="sub">
      <span class="pill ${t.priority}">${PRI_LABEL[t.priority]}</span>
      ${proj ? `<span>${I.doc}${esc(proj.name)}</span>` : ""}
      ${t.assignee ? `<span>${I.user}${esc(t.assignee)}</span>` : ""}
      ${t.due_date ? `<span>${I.calendar}${t.due_date}</span>` : ""}
      ${t.tags ? `<span class="tag-pill">${esc(t.tags)}</span>` : ""}
    </div>
    <div class="row-actions">
      <button onclick="quickDone(${t.id})">${I.check} ${t.status === "done" ? "Reabrir" : "Marcar hecha"}</button>
      <button onclick="openTaskModal(null, ${t.id})">${I.edit} Editar</button>
      <button onclick="deleteTask(${t.id})">${I.trash}</button>
    </div>
  </div>`;
}

function dragStart(e, id) {
  e.dataTransfer.setData("text/plain", id);
  e.currentTarget.classList.add("dragging");
}
function dragEnd(e) { e.currentTarget.classList.remove("dragging"); }
function dragOver(e) { e.preventDefault(); e.currentTarget.classList.add("drag-over"); }
function dragLeave(e) { e.currentTarget.classList.remove("drag-over"); }
async function dropTask(e) {
  e.preventDefault(); e.currentTarget.classList.remove("drag-over");
  const id = e.dataTransfer.getData("text/plain");
  const status = e.currentTarget.dataset.status;
  await api(`/api/tasks/${id}`, { method: "PUT", body: JSON.stringify({ status }) });
  loadTasks();
}

async function quickDone(id) {
  const t = tasks.find(x => x.id === id);
  const status = t.status === "done" ? "todo" : "done";
  await api(`/api/tasks/${id}`, { method: "PUT", body: JSON.stringify({ status }) });
  loadTasks();
}

async function deleteTask(id) {
  if (!confirm("¿Eliminar la tarea?")) return;
  await api(`/api/tasks/${id}`, { method: "DELETE" });
  loadTasks();
}

function openTaskModal(projectId = null, id = null) {
  editingTask = id;
  const t = id ? tasks.find(x => x.id === id) : null;
  document.getElementById("modal-title").textContent = t ? "Editar tarea" : "Nueva tarea";
  const projOptions = projects.map(p => `<option value="${p.id}" ${t && t.project_id === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("");
  document.getElementById("modal-body").innerHTML = `
    <label>Título</label><input id="f-title" value="${t ? esc(t.title) : ""}">
    <label>Proyecto</label><select id="f-project"><option value="">—</option>${projOptions}</select>
    <label>Estado</label><select id="f-status">${Object.entries(STATUS_LABEL).map(([k, v]) => `<option value="${k}" ${t && t.status === k ? "selected" : ""}>${v}</option>`).join("")}</select>
    <label>Prioridad</label><select id="f-priority">${Object.entries(PRI_LABEL).map(([k, v]) => `<option value="${k}" ${t && t.priority === k ? "selected" : ""}>${v}</option>`).join("")}</select>
    <label>Responsable</label><input id="f-assignee" value="${t ? esc(t.assignee) : ""}">
    <label>Fecha límite</label><input id="f-due" type="date" value="${t ? (t.due_date || "") : ""}">
    <label>Etiquetas</label><input id="f-tags" placeholder="infra, seguridad" value="${t ? esc(t.tags) : ""}">
    <label>Notas</label><textarea id="f-notes" rows="3">${t ? esc(t.notes) : ""}</textarea>`;
  if (projectId) document.getElementById("f-project").value = projectId;
  document.getElementById("modal-save").onclick = saveTask;
  showModal();
}

async function saveTask() {
  const body = {
    project_id: document.getElementById("f-project").value || null,
    title: document.getElementById("f-title").value,
    status: document.getElementById("f-status").value,
    priority: document.getElementById("f-priority").value,
    assignee: document.getElementById("f-assignee").value,
    due_date: document.getElementById("f-due").value,
    tags: document.getElementById("f-tags").value,
    notes: document.getElementById("f-notes").value,
  };
  if (editingTask) await api(`/api/tasks/${editingTask}`, { method: "PUT", body: JSON.stringify(body) });
  else await api("/api/tasks", { method: "POST", body: JSON.stringify(body) });
  hideModal(); loadTasks();
}

// ---------- Report charts ----------
function donutChart(done, total) {
  const pct = total ? done / total : 0;
  const r = 52, c = 2 * Math.PI * r;
  const dash = (pct * c).toFixed(1);
  return `<div class="chart-box"><svg viewBox="0 0 140 140" width="150" height="150">
    <circle cx="70" cy="70" r="${r}" fill="none" stroke="#e0e0dd" stroke-width="15"/>
    <circle cx="70" cy="70" r="${r}" fill="none" stroke="#4d8a66" stroke-width="15"
      stroke-dasharray="${dash} ${c.toFixed(1)}" stroke-dashoffset="${(c / 4).toFixed(1)}" stroke-linecap="round"
      style="transition: stroke-dasharray 0.8s ease">
      <animate attributeName="stroke-dasharray" from="0 ${c.toFixed(1)}" to="${dash} ${c.toFixed(1)}" dur="0.8s" fill="freeze" calcMode="spline" keySplines="0.22 1 0.36 1"/>
    </circle>
    <text x="70" y="67" text-anchor="middle" font-size="25" font-weight="700" fill="#33333a" font-family="Inter, sans-serif">${Math.round(pct * 100)}%</text>
    <text x="70" y="88" text-anchor="middle" font-size="10" fill="#8a8a92" font-family="Inter, sans-serif">completado</text>
  </svg></div>`;
}

function statusBars(rep) {
  const items = [
    ["Hechas", rep.kpis.done, "#4d8a66"],
    ["En curso", rep.kpis.in_progress, "#6a9ec9"],
    ["Bloqueadas", rep.kpis.blocked, "#c96a6a"],
    ["Por hacer", rep.kpis.todo, "#c99a4a"],
  ];
  const max = Math.max(...items.map(i => i[1]), 1);
  const bw = 34, gap = 40, x0 = 22, h = 140;
  let bars = "", labels = "";
  items.forEach(([lbl, val, color], i) => {
    const bh = Math.round((val / max) * (h - 34));
    const x = x0 + i * (bw + gap);
    bars += `<rect x="${x}" y="${h - 20 - bh}" width="${bw}" height="${bh}" rx="4" fill="${color}"><animate attributeName="height" from="0" to="${bh}" dur="0.7s" begin="${i * 0.08}s" fill="freeze" calcMode="spline" keySplines="0.22 1 0.36 1"/><animate attributeName="y" from="${h - 20}" to="${h - 20 - bh}" dur="0.7s" begin="${i * 0.08}s" fill="freeze" calcMode="spline" keySplines="0.22 1 0.36 1"/></rect>`;
    bars += `<text x="${x + bw / 2}" y="${h - 27 - bh}" text-anchor="middle" font-size="12" font-weight="600" fill="#33333a" font-family="Inter, sans-serif">${val}</text>`;
    labels += `<text x="${x + bw / 2}" y="${h - 4}" text-anchor="middle" font-size="10.5" fill="#8a8a92" font-family="Inter, sans-serif">${lbl}</text>`;
  });
  return `<div class="chart-box"><svg viewBox="0 0 260 145" width="270" height="150">${bars}${labels}</svg></div>`;
}

function priorityBars(rep) {
  const pr = rep.by_priority;
  const items = [["Crítica", pr.critical || 0, "#c96a6a"], ["Alta", pr.high || 0, "#c99a4a"], ["Media", pr.medium || 0, "#6a9ec9"], ["Baja", pr.low || 0, "#4d8a66"]];
  const total = rep.kpis.total_tasks || 1;
  const rows = items.map(([lbl, v, color], i) => {
    const pct = Math.round((v / total) * 100);
    return `<div class="hbar-row"><span class="hbar-lbl">${lbl}</span>
      <div class="hbar"><div style="width:${pct}%; background:${color}; animation-delay:${i * 0.07}s"></div></div>
      <span class="hbar-val">${v} · ${pct}%</span></div>`;
  }).join("");
  return `<div class="chart-box light">${rows}</div>`;
}

// ---------- Reports ----------
async function generateReport() {
  const start = document.getElementById("rep-start").value || "";
  const end = document.getElementById("rep-end").value || "";
  const q = start || end ? `?start=${start}&end=${end}` : "";
  currentReport = await api(`/api/report${q}`);
  renderReport(currentReport);
}

function renderReport(rep) {
  const k = rep.kpis;
  const rows = rep.by_project.map(p => `<tr><td>${esc(p.name)}</td><td>${p.total}</td><td>${p.done}</td><td>${p.open}</td><td>${p.blocked}</td></tr>`).join("");
  const overdue = rep.overdue_tasks.map(t => `<li>${esc(t.title)} — vencía ${t.due_date} · prioridad ${PRI_LABEL[t.priority] || t.priority}</li>`).join("");
  const blocked = rep.blocked_tasks.map(t => `<li>${esc(t.title)}${t.assignee ? " — " + esc(t.assignee) : ""}</li>`).join("");
  document.getElementById("report-output").innerHTML = `
    <div class="report">
      <h1>${esc(rep.title)}</h1>
      <p class="meta-line">Período: ${rep.period.start} → ${rep.period.end} · Generado: ${rep.generated_at}</p>
      <div class="charts-row">${donutChart(k.done, k.total_tasks)}${statusBars(rep)}${priorityBars(rep)}</div>
      <h3>Indicadores</h3>
      <div class="rkpis">
        <div class="rkpi"><b>${k.total_tasks}</b>Tareas</div>
        <div class="rkpi"><b>${k.completion_pct}%</b>Completado</div>
        <div class="rkpi"><b>${k.done}</b>Hechas</div>
        <div class="rkpi"><b>${k.in_progress}</b>En curso</div>
        <div class="rkpi"><b>${k.blocked}</b>Bloqueadas</div>
        <div class="rkpi"><b>${k.overdue}</b>Vencidas</div>
      </div>
      <h3>Avance por proyecto</h3>
      <table><tr><th>Proyecto</th><th>Total</th><th>Hechas</th><th>Abiertas</th><th>Bloqueadas</th></tr>${rows || "<tr><td colspan=5>Sin datos</td></tr>"}</table>
      ${overdue ? `<h3>Tareas vencidas</h3><ul>${overdue}</ul>` : ""}
      ${blocked ? `<h3>Bloqueos que requieren atención del comité</h3><ul>${blocked}</ul>` : ""}
    </div>
    <div class="report-actions">
      <button class="btn primary" onclick="saveReport()">${I.save} Guardar informe</button>
      <button class="btn" onclick="exportDoc('docx')">${I.doc} Word</button>
      <button class="btn" onclick="exportDoc('xlsx')">${I.sheet} Excel</button>
      <button class="btn" onclick="printReport()">${I.print} Imprimir / PDF</button>
    </div>`;
}

async function saveReport() {
  if (!currentReport) return;
  await api("/api/reports", { method: "POST", body: JSON.stringify(currentReport) });
  loadSavedReports();
}

function printReport() { window.print(); }

function exportDoc(fmt) {
  const start = document.getElementById("rep-start").value;
  const end = document.getElementById("rep-end").value;
  window.open(`/api/export/${fmt}?start=${start}&end=${end}`, "_blank");
}

async function loadSavedReports() {
  const reps = await api("/api/reports");
  document.getElementById("saved-reports").innerHTML = reps.length
    ? reps.map((r, i) => `<div class="saved-item" style="animation-delay:${i * 0.04}s"><span>${I.doc} ${esc(r.title)} · ${r.period_start} → ${r.period_end} <small>(${r.created_at})</small></span>
        <button class="btn ghost" onclick="viewSavedReport(${r.id})">${I.eye} Ver</button></div>`).join("")
    : `<div class="empty-state"><span class="es-icon">${I.doc}</span>Todavía no hay informes guardados.<br>Genera un informe y pulsa «Guardar informe» para archivarlo.</div>`;
}

async function viewSavedReport(id) {
  currentReport = await api(`/api/reports/${id}`);
  renderReport(currentReport);
}

// ---------- Modal ----------
function showModal() { document.getElementById("modal-overlay").classList.remove("hidden"); }
function hideModal() { document.getElementById("modal-overlay").classList.add("hidden"); }
function closeModal(e) { if (e.target === document.getElementById("modal-overlay")) hideModal(); }
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------- Init ----------
document.getElementById("btn-new-project").addEventListener("click", () => openProjectModal());
document.getElementById("btn-new-task").addEventListener("click", () => openTaskModal());
document.getElementById("btn-generate").addEventListener("click", generateReport);
const d = new Date();
document.getElementById("rep-start").value = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
document.getElementById("rep-end").value = d.toISOString().slice(0, 10);
loadDashboard();
loadTasks();
