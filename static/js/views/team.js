import { post } from "../api.js";
import { icons } from "../icons.js";
import { ROLES, label, store } from "../store.js";
import { avatar, confirmDialog, emptyState, openMemberForm, popMenu, showTempPassword, toast, toastError } from "../ui.js";
import { $, $$, addDays, esc, timeAgo } from "../util.js";

export const title = "Equipo";

export function render(root, _params, nav) {
  const since = addDays(store.today, -30);
  const admin = store.can.admin;
  const people = store.members.filter((m) => admin || m.active !== false);
  const rows = people.map((m) => {
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
      <div class="page-sub">${people.filter((x) => x.active !== false).length} personas · ${unassigned ? `<a href="#/tablero" data-unassigned>${unassigned} tareas abiertas sin asignar</a>` : "todas las tareas abiertas tienen responsable"}</div></div>
      ${admin ? `<button class="btn primary" data-new>${icons.plus}Añadir persona</button>` : ""}</div>
    <div class="card" style="overflow-x:auto">
    ${rows.length ? `<table class="ph-table team-tbl"><thead><tr><th>Persona</th><th>Rol</th><th>Abiertas</th><th>En curso</th><th>Bloqueadas</th><th>Vencidas</th><th>Cerradas 30 d</th><th>Horas est.</th><th>Ocupación</th>${admin ? "<th></th>" : ""}</tr></thead><tbody>
      ${rows.map((r) => {
        const pct = r.m.capacity ? Math.round((100 * r.open) / r.m.capacity) : 0;
        const cls = pct > 100 ? "bad" : pct >= 85 ? "warn" : "";
        const inactive = r.m.active === false;
        return `<tr class="click${inactive ? " inactive" : ""}" data-name="${esc(r.m.name)}">
          <td><div class="person">${avatar(r.m.name, "lg")}<div><div style="font-weight:500">${esc(r.m.name)}${r.m.id === store.me.id ? ' <span class="muted" style="font-weight:400">(tú)</span>' : ""}</div><div class="muted" style="font-size:12px">${esc([r.m.title, r.m.team].filter(Boolean).join(" · ") || r.m.email || "")}</div></div></div></td>
          <td><span class="role-chip ${r.m.role}">${esc(label(ROLES, r.m.role))}</span>${r.m.is_cab ? ' <span class="role-chip cab" title="Puede aprobar cambios">CAB</span>' : ""}${inactive ? ' <span class="role-chip off">Desactivada</span>' : ""}
            ${admin && !r.m.has_password && !r.m.sso ? `<div class="muted" style="font-size:11.5px;margin-top:2px">${store.features.password ? "Sin acceso todavía" : "Aún no ha entrado"}</div>` : admin && r.m.last_login ? `<div class="muted" style="font-size:11.5px;margin-top:2px">Entró ${esc(timeAgo(r.m.last_login))}</div>` : ""}</td>
          <td class="num">${r.open}</td><td class="num">${r.wip}</td>
          <td class="num"${r.blocked ? ' style="color:var(--bad);font-weight:600"' : ""}>${r.blocked}</td>
          <td class="num"${r.overdue ? ' style="color:var(--bad);font-weight:600"' : ""}>${r.overdue}</td>
          <td class="num">${r.closed30}</td>
          <td class="num">${r.hours ? r.hours : "—"}</td>
          <td><div class="load" title="${r.open} abiertas sobre una capacidad de ${r.m.capacity}"><div class="meter ${cls}"><i style="width:${Math.min(100, pct)}%"></i></div><span class="num">${pct}%</span></div></td>
          ${admin ? `<td><button class="icon-btn" data-menu="${r.m.id}" title="Opciones">${icons.more}</button></td>` : ""}</tr>`;
      }).join("")}</tbody></table>` : emptyState("team", "Aún no hay personas", "Añade al equipo para poder asignar tareas y medir la carga.")}
    </div>
    <p class="muted" style="font-size:12px;margin-top:10px">Ocupación = tareas abiertas / capacidad. Por encima del 100 % conviene redistribuir trabajo.${admin ? " Roles: " + ROLES.map((r) => `<b>${r.label}</b> ${r.hint.toLowerCase()}`).join(" · ") + "." : ""}</p>
  </div>`;

  $("[data-new]", root)?.addEventListener("click", () => openMemberForm());
  $("[data-unassigned]", root)?.addEventListener("click", (e) => { e.preventDefault(); nav("#/tablero", { assignee: "__none" }); });
  $$("tr[data-name]", root).forEach((tr) => tr.onclick = (e) => {
    if (e.target.closest("[data-menu]")) return;
    nav("#/tablero", { assignee: tr.dataset.name });
  });
  $$("[data-menu]", root).forEach((b) => b.onclick = (e) => {
    e.stopPropagation();
    const m = store.members.find((x) => x.id === Number(b.dataset.menu));
    const self = m.id === store.me.id;
    popMenu(b, [
      { value: "board", html: `${icons.board}Ver su tablero` },
      { value: "edit", html: `${icons.edit}Editar datos y rol` },
      ...(store.features.password ? [{ value: "reset", html: `${icons.key}${m.has_password ? "Restablecer contraseña" : "Crear acceso"}` }] : []),
      ...(!self ? [{ value: "active", html: `${m.active === false ? icons.done : icons.blocked}${m.active === false ? "Reactivar cuenta" : "Desactivar cuenta"}` }] : []),
      ...(!self ? [{ sep: true }, { value: "del", html: `${icons.trash}Eliminar del equipo`, danger: true }] : []),
    ], async (v) => {
      if (v === "board") nav("#/tablero", { assignee: m.name });
      if (v === "edit") openMemberForm(m);
      if (v === "reset") {
        if (!m.email) return toast("Añade antes un correo a esta persona: lo usará para iniciar sesión", { error: true });
        try { const r = await post(`/api/members/${m.id}/reset-password`, {}); showTempPassword(m.name, m.email, r.temp_password); } catch (er) { toastError(er); }
      }
      if (v === "active") {
        try { await store.saveMember(m.id, { active: m.active === false }); toast(m.active === false ? "Cuenta reactivada" : "Cuenta desactivada: ya no puede iniciar sesión"); } catch (er) { toastError(er); }
      }
      if (v === "del") {
        const open = store.tasks.filter((t) => t.assignee === m.name && t.status !== "done").length;
        if (await confirmDialog({ title: `Eliminar a ${m.name}`, text: `${open ? `Sus ${open} tareas abiertas quedarán sin asignar. ` : ""}Si solo deja de trabajar en el área, es mejor desactivar la cuenta y conservar su historial.`, okLabel: "Eliminar" })) {
          store.deleteMember(m.id).then(() => toast("Persona eliminada del equipo")).catch(toastError);
        }
      }
    });
  });
}
