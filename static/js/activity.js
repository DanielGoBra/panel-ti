import { PRIORITY, STATUS, TYPES, label, store } from "./store.js";
import { esc, fmtDate } from "./util.js";

const FIELD = {
  status: (o, n) => `cambió el estado de <b>${label(STATUS, o)}</b> a <b>${label(STATUS, n)}</b>`,
  priority: (o, n) => `cambió la prioridad a <b>${label(PRIORITY, n)}</b>`,
  type: (o, n) => `cambió el tipo a <b>${label(TYPES, n)}</b>`,
  assignee: (o, n) => (n ? `asignó a <b>${esc(n)}</b>` : `quitó la asignación a ${esc(o)}`),
  due_date: (o, n) => (n ? `fijó el vencimiento el <b>${fmtDate(n)}</b>` : "quitó la fecha de vencimiento"),
  start_date: (o, n) => (n ? `fijó el inicio el <b>${fmtDate(n)}</b>` : "quitó la fecha de inicio"),
  title: () => "renombró la tarea",
  notes: () => "editó la descripción",
  estimate: (o, n) => (n ? `estimó <b>${esc(Number(n))} h</b>` : "quitó la estimación"),
  tags: (o, n) => (n ? `cambió las etiquetas a <b>${esc(n)}</b>` : "quitó las etiquetas"),
  project_id: (o, n) => { const p = store.project(n); return p ? `movió al proyecto <b>${esc(p.name)}</b>` : "quitó el proyecto"; },
  parent_id: (o, n) => { const t = store.task(n); return t ? `la convirtió en subtarea de <b>${esc(store.taskKey(t))}</b>` : "la separó de su tarea principal"; },
  depends_on: (o, n) => `añadió que espera a <b>${esc(n)}</b>`,
  recurrence: (o, n) => (n ? "programó que se repita" : "quitó la repetición"),
  assets: () => "cambió los activos vinculados",
  custom: () => "actualizó campos personalizados",
};
const APPROVAL = {
  requested: (n) => `solicitó la aprobación del CAB${n ? `: «${esc(n)}»` : ""}`,
  approved: (n) => `aprobó el cambio${n ? `: «${esc(n)}»` : ""}`,
  rejected: (n) => `rechazó el cambio${n ? `: «${esc(n)}»` : ""}`,
};

/** Frase de actividad. Devuelve HTML; withTask añade el título de la tarea. */
export function describe(a, { withTask = false } = {}) {
  const t = store.task(a.task_id);
  const name = t ? `${store.taskKey(t)} ${t.title}` : a.task_title;
  const link = withTask && name ? ` <span class="t-link" data-task="${a.task_id || ""}">${esc(name)}</span>` : "";
  switch (a.action) {
    case "created": return a.field === "duplicate" ? `duplicó una tarea${link ? " como" + link : ""}` : `creó${link || " la tarea"}`;
    case "deleted": return `eliminó <b>${esc(a.task_title)}</b>`;
    case "commented": return `comentó en${link || " la tarea"}<span class="quote">${esc(a.new_value)}</span>`;
    case "checked": return `completó «${esc(a.new_value)}»${link ? " en" + link : ""}`;
    case "approval": return (APPROVAL[a.field] ? APPROVAL[a.field](a.new_value) : "actualizó la aprobación") + (link ? " en" + link : "");
    case "attached": return `adjuntó <b>${esc(a.new_value)}</b>${link ? " en" + link : ""}`;
    case "kb_created": return `creó el artículo <b>${esc(a.new_value)}</b>${link ? " a partir de" + link : ""}`;
    case "page_deleted": return `eliminó la página <b>${esc(a.old_value)}</b>`;
    case "project_created": return `creó el proyecto <b>${esc(a.new_value)}</b>`;
    case "project_deleted": return `eliminó el proyecto <b>${esc(a.old_value)}</b>`;
    case "updated": {
      const f = FIELD[a.field];
      const txt = f ? f(a.old_value, a.new_value) : `actualizó ${esc(a.field)}`;
      return txt + (link ? " en" + link : "");
    }
    default: return esc(a.action) + link;
  }
}
