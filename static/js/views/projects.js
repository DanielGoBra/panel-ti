import { icons } from "../icons.js";
import { store } from "../store.js";
import { confirmDialog, healthBadge, openProjectForm, person, popMenu, toast, toastError } from "../ui.js";
import { $, $$, diffDays, esc, fmtDate } from "../util.js";

export const title = "Proyectos";
let tab = "active";

export function projectStats(p) {
  const ts = store.tasks.filter((t) => t.project_id === p.id);
  const done = ts.filter((t) => t.status === "done").length;
  const overdue = ts.filter((t) => store.isOverdue(t)).length;
  const blocked = ts.filter((t) => t.status === "blocked").length;
  const state = overdue >= 3 || blocked >= 2 ? "risk" : overdue || blocked ? "watch" : "ok";
  return { total: ts.length, open: ts.length - done, done, overdue, blocked, state, progress: ts.length ? Math.round((100 * done) / ts.length) : 0 };
}

export function render(root, _params, nav) {
  const counts = { active: 0, paused: 0, closed: 0 };
  store.projects.forEach((p) => { counts[p.status || "active"] = (counts[p.status || "active"] || 0) + 1; });
  const list = store.projects.filter((p) => (p.status || "active") === tab);

  root.innerHTML = `<div class="page">
    <div class="page-head"><div><div class="page-title">Proyectos</div>
      <div class="page-sub">Iniciativas del área con su avance, responsables y riesgos</div></div>
      <div class="seg">${[["active", "Activos"], ["paused", "En pausa"], ["closed", "Cerrados"]].map(([k, l]) => `<button class="${tab === k ? "on" : ""}" data-tab="${k}">${l} <span class="muted">${counts[k] || 0}</span></button>`).join("")}</div>
    </div>
    <div class="proj-grid">
      ${list.map((p) => {
        const s = projectStats(p);
        const days = p.due_date ? diffDays(p.due_date, store.today) : null;
        return `<article class="card proj" style="--pc:${esc(p.color)}" data-id="${p.id}">
          <div class="proj-top"><div><span class="key">${esc(p.key)}${p.area ? ` · ${esc(p.area)}` : ""}</span><h3>${esc(p.name)}</h3></div>
            <button class="icon-btn menu" data-menu="${p.id}" title="Opciones">${icons.more}</button></div>
          <div class="proj-desc">${esc(p.description || "Sin descripción.")}</div>
          <div class="proj-stats">
            <div><b>${s.open}</b><span>abiertas</span></div>
            <div><b>${s.done}</b><span>hechas</span></div>
            <div><b class="${s.overdue ? "bad" : ""}">${s.overdue}</b><span>vencidas</span></div>
            <div><b class="${s.blocked ? "bad" : ""}">${s.blocked}</b><span>bloqueadas</span></div>
          </div>
          <div class="proj-progress"><div class="meter${s.progress === 100 ? " good" : ""}"><i style="width:${s.progress}%"></i></div><span class="num">${s.progress}%</span></div>
          <div class="proj-foot">${person(p.owner, "Sin responsable")}
            <span class="right">${healthBadge(s.state)}${p.due_date ? `<span title="Fecha objetivo"${days < 0 && s.open ? ' style="color:var(--bad)"' : ""}>${esc(fmtDate(p.due_date))}</span>` : ""}</span></div>
        </article>`;
      }).join("")}
      ${tab === "active" ? `<button class="card proj proj-new" data-new><span>${icons.plus}Nuevo proyecto</span></button>` : ""}
    </div>
    ${!list.length && tab !== "active" ? `<p class="muted" style="margin-top:12px">No hay proyectos en este estado.</p>` : ""}
  </div>`;

  $$("[data-tab]", root).forEach((b) => b.onclick = () => { tab = b.dataset.tab; render(root, _params, nav); });
  $("[data-new]", root)?.addEventListener("click", () => openProjectForm());
  $$(".proj[data-id]", root).forEach((c) => c.onclick = (e) => {
    if (e.target.closest("[data-menu]")) return;
    nav("#/tablero", { project: c.dataset.id });
  });
  $$("[data-menu]", root).forEach((b) => b.onclick = (e) => {
    e.stopPropagation();
    const p = store.project(b.dataset.menu);
    popMenu(b, [
      { value: "board", html: `${icons.board}Abrir tablero` },
      { value: "list", html: `${icons.list}Ver en lista` },
      { value: "edit", html: `${icons.edit}Editar` },
      { label: "Estado" },
      ...[["active", "Activo"], ["paused", "En pausa"], ["closed", "Cerrado"]].map(([k, l]) => ({ value: "st:" + k, html: l, selected: (p.status || "active") === k })),
      { sep: true },
      { value: "del", html: `${icons.trash}Eliminar`, danger: true },
    ], async (v) => {
      if (v === "board") nav("#/tablero", { project: p.id });
      if (v === "list") nav("#/lista", { project: p.id });
      if (v === "edit") openProjectForm(p);
      if (v.startsWith?.("st:")) store.saveProject(p.id, { status: v.slice(3) }).then(() => toast("Estado del proyecto actualizado")).catch(toastError);
      if (v === "del") {
        const n = store.tasks.filter((t) => t.project_id === p.id).length;
        if (await confirmDialog({ title: `Eliminar ${p.name}`, text: `Se eliminarán también sus ${n} tareas. Si solo quieres archivarlo, márcalo como cerrado.` })) {
          store.deleteProject(p.id).then(() => toast("Proyecto eliminado")).catch(toastError);
        }
      }
    });
  });
}
