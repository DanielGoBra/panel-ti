import { del, get, post, put } from "../api.js";
import { icons } from "../icons.js";
import { PRIORITY, TYPES, label, store } from "../store.js";
import { confirmDialog, emptyState, modal, toast, toastError } from "../ui.js";
import { $, $$, downloadUrl, esc, timeAgo } from "../util.js";

export const title = "Ajustes";
const FIELD_TYPES = [
  { id: "text", label: "Texto" }, { id: "number", label: "Número" }, { id: "select", label: "Lista de opciones" },
  { id: "date", label: "Fecha" }, { id: "checkbox", label: "Casilla" }, { id: "url", label: "Enlace" },
];
const size = (n) => (n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);

export async function render(root) {
  if (!store.can.admin) {
    root.innerHTML = `<div class="page">${emptyState("lock", "Solo administración", "Pide a una persona con rol de administración que cambie estos ajustes.")}</div>`;
    return;
  }
  let status = null;
  try { status = await get("/api/admin/status"); } catch (e) { toastError(e); }
  const s = store.settings;
  const f = store.features;
  const inboundUrl = s.inbound_token && typeof s.inbound_token === "string" ? `${location.origin}/api/inbound/${s.inbound_token}` : "";
  const state = (ok, txt) => `<span class="health ${ok ? "ok" : "watch"}">${ok ? icons.done : icons.clock}${txt}</span>`;
  root.innerHTML = `<div class="page settings">
    <div class="page-head"><div><div class="page-title">Ajustes</div><div class="page-sub">Configuración del espacio de trabajo, integraciones y mantenimiento</div></div></div>

    <section class="card card-pad set">
      <h3>Espacio de trabajo</h3>
      <div class="form-grid">
        <label class="field"><span>Nombre del área</span><input class="input" id="ws-name" value="${esc(s.workspace || "")}"></label>
        <div class="field"><span>Integraciones del servidor</span><div class="feat-row">
          ${state(f.sso, f.sso ? "Microsoft Entra ID" : "Microsoft sin configurar")}
          ${state(f.email, f.email ? "Correo saliente" : "Correo sin configurar")}
          ${state(f.ai, f.ai ? `IA (${esc(status?.ai_model || "")})` : "IA sin configurar")}
          ${state(f.imap, f.imap ? "Buzón de entrada" : "Buzón sin configurar")}
        </div><p class="hint">Se activan con variables de entorno del servidor; consulta el README.</p></div>
      </div>
    </section>

    <section class="card card-pad set">
      <h3>Acuerdos de nivel de servicio (SLA)</h3>
      <p class="hint">Tiempo máximo de primera respuesta y de resolución según la prioridad. Se cuentan horas naturales desde la apertura.</p>
      <div class="field"><span>Se aplican a</span><div class="feat-row">${TYPES.map((t) => `<label class="auth-check"><input type="checkbox" class="chk" data-sla-type="${t.id}"${s.sla.types.includes(t.id) ? " checked" : ""}> ${t.label}</label>`).join("")}</div></div>
      <table class="ph-table sla-table"><thead><tr><th>Prioridad</th><th>Respuesta (minutos)</th><th>Resolución (horas)</th></tr></thead><tbody>
        ${PRIORITY.map((p) => `<tr><td>${p.label}</td><td><input class="input" type="number" min="1" data-resp="${p.id}" value="${s.sla.policies[p.id]?.response_min ?? ""}"></td><td><input class="input" type="number" min="0.5" step="0.5" data-res="${p.id}" value="${s.sla.policies[p.id]?.resolve_h ?? ""}"></td></tr>`).join("")}
      </tbody></table>
      <div class="field" style="margin-top:14px"><span>Necesitan aprobación del CAB antes de empezar</span><div class="feat-row">${TYPES.map((t) => `<label class="auth-check"><input type="checkbox" class="chk" data-appr-type="${t.id}"${(s.approval_types || []).includes(t.id) ? " checked" : ""}> ${t.label}</label>`).join("")}</div></div>
      <div class="set-actions"><button class="btn primary" data-save-sla>Guardar</button></div>
    </section>

    <section class="card card-pad set">
      <h3>Avisos en Microsoft Teams</h3>
      <p class="hint">Crea en Teams un flujo «Publicar en un canal cuando se recibe una solicitud de webhook» (Workflows) y pega aquí su URL. Se publicarán asignaciones, bloqueos, aprobaciones del CAB, alertas de SLA y solicitudes entrantes.</p>
      <div class="inline-form"><input class="input" id="teams-url" type="url" placeholder="https://…" value="${esc(typeof s.teams_webhook_url === "string" ? s.teams_webhook_url : "")}">
        <button class="btn" data-save-teams>Guardar</button><button class="btn ghost" data-test-teams>${icons.bell}Probar</button></div>
    </section>

    <section class="card card-pad set">
      <h3>Entrada de solicitudes por correo o webhook</h3>
      <p class="hint">Cualquier sistema puede crear tareas enviando un POST con <code>subject</code>, <code>body</code> y <code>from</code> a esta dirección (por ejemplo, un flujo de Power Automate al llegar un correo al buzón de soporte, o Teams). Las solicitudes se clasifican y asignan solas. Para leer un buzón por IMAP define <code>IMAP_HOST</code>, <code>IMAP_USER</code> e <code>IMAP_PASSWORD</code>.</p>
      ${inboundUrl ? `<div class="inline-form"><input class="input mono" readonly value="${esc(inboundUrl)}"><button class="btn" data-copy-inbound>${icons.copy}Copiar</button><button class="btn ghost" data-gen-inbound>Regenerar</button></div>`
        : `<button class="btn" data-gen-inbound>${icons.key}Generar dirección</button>`}
      <div class="form-grid" style="margin-top:12px">
        <label class="field"><span>Tipo por defecto</span><select class="select" id="inbound-type">${TYPES.map((t) => `<option value="${t.id}"${t.id === s.inbound_default_type ? " selected" : ""}>${t.label}</option>`).join("")}</select></label>
        <label class="field"><span>Proyecto por defecto</span><select class="select" id="inbound-project"><option value="">El que proponga la clasificación</option>${store.projects.map((p) => `<option value="${p.id}"${p.id === s.inbound_project_id ? " selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label>
      </div>
      <div class="set-actions"><button class="btn" data-save-inbound>Guardar</button></div>
    </section>

    <section class="card card-pad set">
      <h3>Campos personalizados</h3>
      <p class="hint">Aparecen en el detalle de cada tarea. Si eliges un proyecto, solo se muestran en sus tareas.</p>
      <div class="list-rows">${store.customFields.map((c) => `<div class="row-item"><span class="grow"><b>${esc(c.name)}</b> <span class="muted">· ${esc(label(FIELD_TYPES, c.type))}${c.options.length ? `: ${esc(c.options.join(", "))}` : ""}${c.project_id ? ` · ${esc(store.project(c.project_id)?.name || "")}` : ""}</span></span><button class="icon-btn" data-del-field="${c.id}" title="Eliminar">${icons.trash}</button></div>`).join("") || '<div class="row-item muted">Sin campos personalizados.</div>'}</div>
      <div class="set-actions"><button class="btn" data-new-field>${icons.plus}Añadir campo</button></div>
    </section>

    <section class="card card-pad set">
      <h3>Plantillas</h3>
      <p class="hint">Las plantillas de tarea crean el checklist y las subtareas. Para crear una, abre una tarea y usa «Guardar como plantilla».</p>
      <div class="list-rows">${store.templates.map((t) => `<div class="row-item"><span class="pico">${t.kind === "page" ? esc(t.payload.icon || "📄") : icons.t_task}</span><span class="grow"><b>${esc(t.name)}</b> <span class="muted">· ${t.kind === "page" ? "Página" : "Tarea"}${t.description ? ` · ${esc(t.description)}` : ""}</span></span><button class="icon-btn" data-del-tpl="${t.id}" title="Eliminar">${icons.trash}</button></div>`).join("") || '<div class="row-item muted">Sin plantillas.</div>'}</div>
    </section>

    <section class="card card-pad set">
      <h3>Copias de seguridad</h3>
      <p class="hint">Se crea una copia automática cada 24 horas y se conservan las 14 últimas (ajustable con variables de entorno). Base de datos: <code>${esc(status?.db_path || "")}</code> · ${status ? size(status.db_size) : ""}.</p>
      <div class="list-rows">${(status?.backups || []).slice(0, 8).map((b) => `<div class="row-item">${icons.save}<span class="grow">${esc(b.name)} <span class="muted">· ${size(b.size)} · ${esc(timeAgo(b.created_at))}</span></span><button class="btn sm ghost" data-dl="${esc(b.name)}">${icons.download}Descargar</button></div>`).join("") || '<div class="row-item muted">Aún no hay copias.</div>'}</div>
      <div class="set-actions"><button class="btn" data-backup>${icons.save}Crear copia ahora</button></div>
      ${status?.jobs ? `<p class="hint" style="margin-top:10px">Tareas automáticas: ${Object.entries(status.jobs).map(([k, v]) => `${esc(JOB_NAMES[k] || k)} ${esc(timeAgo(v.at))}${v.status === "error" ? " (error)" : ""}`).join(" · ")}</p>` : ""}
    </section>
  </div>`;

  const saveSettings = async (patch, msg = "Ajustes guardados") => { try { await store.saveSettings(patch); toast(msg); render(root); } catch (e) { toastError(e); } };
  $("#ws-name", root).onchange = (e) => saveSettings({ workspace: e.target.value.trim() || "Tecnología" });
  $("[data-save-sla]", root).onclick = () => {
    const policies = {};
    for (const p of PRIORITY) policies[p.id] = { response_min: Number($(`[data-resp="${p.id}"]`, root).value), resolve_h: Number($(`[data-res="${p.id}"]`, root).value) };
    saveSettings({
      sla: { types: $$("[data-sla-type]:checked", root).map((x) => x.dataset.slaType), policies },
      approval_types: $$("[data-appr-type]:checked", root).map((x) => x.dataset.apprType),
    });
  };
  $("[data-save-teams]", root).onclick = () => saveSettings({ teams_webhook_url: $("#teams-url", root).value.trim() });
  $("[data-test-teams]", root).onclick = async () => {
    try { await post("/api/notifications/test", {}); toast("Aviso de prueba enviado. Revisa el canal de Teams."); } catch (e) { toastError(e); }
  };
  $$("[data-gen-inbound]", root).forEach((b) => b.onclick = async () => {
    if (s.inbound_token && !(await confirmDialog({ title: "Regenerar dirección", text: "La dirección actual dejará de funcionar.", okLabel: "Regenerar", danger: true }))) return;
    saveSettings({ inbound_token: "regenerate" }, "Dirección generada");
  });
  $("[data-copy-inbound]", root)?.addEventListener("click", async () => { try { await navigator.clipboard.writeText(inboundUrl); toast("Copiada"); } catch (e) { toast(inboundUrl); } });
  $("[data-save-inbound]", root).onclick = () => saveSettings({ inbound_default_type: $("#inbound-type", root).value, inbound_project_id: Number($("#inbound-project", root).value) || null });
  $("[data-new-field]", root).onclick = () => modal({
    title: "Nuevo campo personalizado", size: "sm", saveLabel: "Crear",
    body: `<div class="form-grid"><label class="field full"><span>Nombre</span><input class="input" name="name" autofocus placeholder="Impacto, Proveedor…"></label>
      <label class="field"><span>Tipo</span><select class="select" name="type">${FIELD_TYPES.map((t) => `<option value="${t.id}">${t.label}</option>`).join("")}</select></label>
      <label class="field"><span>Proyecto</span><select class="select" name="project_id"><option value="">Todos</option>${store.projects.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select></label>
      <label class="field full"><span>Opciones (solo para listas, separadas por comas)</span><input class="input" name="options" placeholder="Bajo, Medio, Alto"></label></div>`,
    async onSave(form) {
      const data = Object.fromEntries(new FormData(form));
      if (!data.name.trim()) throw new Error("Pon un nombre al campo.");
      data.project_id = Number(data.project_id) || null;
      const cf = await post("/api/custom-fields", data);
      store.customFields.push(cf);
      toast("Campo creado");
      render(root);
    },
  });
  $$("[data-del-field]", root).forEach((b) => b.onclick = async () => {
    if (!(await confirmDialog({ title: "Eliminar campo", text: "Los valores guardados en las tareas dejarán de mostrarse." }))) return;
    try { await del(`/api/custom-fields/${b.dataset.delField}`); store.customFields = store.customFields.filter((c) => c.id !== Number(b.dataset.delField)); render(root); } catch (e) { toastError(e); }
  });
  $$("[data-del-tpl]", root).forEach((b) => b.onclick = async () => {
    if (!(await confirmDialog({ title: "Eliminar plantilla", text: "Las tareas ya creadas no cambian." }))) return;
    try { await del(`/api/templates/${b.dataset.delTpl}`); store.templates = store.templates.filter((t) => t.id !== Number(b.dataset.delTpl)); render(root); } catch (e) { toastError(e); }
  });
  $("[data-backup]", root).onclick = async (e) => {
    e.currentTarget.disabled = true;
    try { const r = await post("/api/admin/backup", {}); toast(`Copia creada: ${r.name}`); render(root); } catch (er) { toastError(er); }
  };
  $$("[data-dl]", root).forEach((b) => b.onclick = () => downloadUrl(`/api/admin/backups/${encodeURIComponent(b.dataset.dl)}`));
}

const JOB_NAMES = { sla: "SLA", due: "vencimientos", recurrence: "recurrentes", backup: "copia", imap: "buzón" };
export const refreshOn = ["settings"];
export { put };
