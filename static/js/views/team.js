import { icons } from "../icons.js";
import { store } from "../store.js";
import { avatar, confirmDialog, emptyState, openMemberForm, popMenu, toast, toastError } from "../ui.js";
import { $, $$, addDays, esc } from "../util.js";

export const title = "Equipo";

export function render(root, _params, nav) {
  const since = addDays(store.today, -30);
  const rows = store.members.map((m) => {
    const ts = store.tasks.filter((t) => t.assignee === m.name);
    const open = ts.filter((t) => t.status !== "done");
    return {
      m,
      open: open.length,
      wip: open.filter((t) => t.status === "in_progress" || t.status === "review").length,
      blocked: open.filter((t) => t.status === "blocked").length,
      overdue: open.filter((t) => store.isOverdue(t)).length,
      closed30: ts.filter((t) => t.status === "done" && (t.completed_at || "").slice(0, 10) >= since).length,
      hours: open.reduce((a, t) => a + (t.estimate || 0), 0),
    };
  });
  const unassigned = store.tasks.filter((t) => !t.assignee && t.status !== "done").length;

  root.innerHTML = `<div class="page">
    <div class="page-head"><div><div class="page-title">Equipo</div>
      <div class="page-sub">${store.members.length} personas · ${unassigned ? `<a href="#/tablero" data-unassigned>${unassigned} tareas abiertas sin asignar</a>` : "todas las tareas abiertas tienen responsable"}</div></div>
      <button class="btn primary" data-new>${icons.plus}Añadir persona</button></div>
    <div class="card" style="overflow-x:auto">
    ${rows.length ? `<table class="ph-table team-tbl"><thead><tr><th>Persona</th><th>Equipo</th><th>Abiertas</th><th>En curso</th><th>Bloqueadas</th><th>Vencidas</th><th>Cerradas 30 d</th><th>Horas est.</th><th>Ocupación</th><th></th></tr></thead><tbody>
      ${rows.map((r) => {
        const pct = r.m.capacity ? Math.round((100 * r.open) / r.m.capacity) : 0;
        const cls = pct > 100 ? "bad" : pct >= 85 ? "warn" : "";
        return `<tr class="click" data-name="${esc(r.m.name)}">
          <td><div class="person">${avatar(r.m.name, "lg")}<div><div style="font-weight:500">${esc(r.m.name)}${r.m.name === store.user ? ' <span class="muted" style="font-weight:400">(tú)</span>' : ""}</div><div class="muted" style="font-size:12px">${esc(r.m.role || r.m.email || "")}</div></div></div></td>
          <td class="muted">${esc(r.m.team || "—")}</td>
          <td class="num">${r.open}</td><td class="num">${r.wip}</td>
          <td class="num"${r.blocked ? ' style="color:var(--bad);font-weight:600"' : ""}>${r.blocked}</td>
          <td class="num"${r.overdue ? ' style="color:var(--bad);font-weight:600"' : ""}>${r.overdue}</td>
          <td class="num">${r.closed30}</td>
          <td class="num">${r.hours ? r.hours : "—"}</td>
          <td><div class="load" title="${r.open} abiertas sobre una capacidad de ${r.m.capacity}"><div class="meter ${cls}"><i style="width:${Math.min(100, pct)}%"></i></div><span class="num">${pct}%</span></div></td>
          <td><button class="icon-btn" data-menu="${r.m.id}" title="Opciones">${icons.more}</button></td></tr>`;
      }).join("")}</tbody></table>` : emptyState("team", "Aún no hay personas", "Añade al equipo para poder asignar tareas y medir la carga.")}
    </div>
    <p class="muted" style="font-size:12px;margin-top:10px">Ocupación = tareas abiertas / capacidad. Por encima del 100 % conviene redistribuir trabajo.</p>
  </div>`;

  $("[data-new]", root).onclick = () => openMemberForm();
  $("[data-unassigned]", root)?.addEventListener("click", (e) => { e.preventDefault(); nav("#/tablero", { assignee: "__none" }); });
  $$("tr[data-name]", root).forEach((tr) => tr.onclick = (e) => {
    if (e.target.closest("[data-menu]")) return;
    nav("#/tablero", { assignee: tr.dataset.name });
  });
  $$("[data-menu]", root).forEach((b) => b.onclick = (e) => {
    e.stopPropagation();
    const m = store.members.find((x) => x.id === Number(b.dataset.menu));
    popMenu(b, [
      { value: "board", html: `${icons.board}Ver su tablero` },
      { value: "edit", html: `${icons.edit}Editar` },
      ...(m.name !== store.user ? [{ value: "me", html: `${icons.me}Usar como mi usuario` }] : []),
      { sep: true },
      { value: "del", html: `${icons.trash}Quitar del equipo`, danger: true },
    ], async (v) => {
      if (v === "board") nav("#/tablero", { assignee: m.name });
      if (v === "edit") openMemberForm(m);
      if (v === "me") { store.setUser(m.name); toast(`Ahora trabajas como ${m.name}`); }
      if (v === "del") {
        const open = store.tasks.filter((t) => t.assignee === m.name && t.status !== "done").length;
        if (await confirmDialog({ title: `Quitar a ${m.name}`, text: open ? `Sus ${open} tareas abiertas quedarán sin asignar.` : "No tiene tareas abiertas." , okLabel: "Quitar" })) {
          store.deleteMember(m.id).then(() => toast("Persona eliminada del equipo")).catch(toastError);
        }
      }
    });
  });
}
