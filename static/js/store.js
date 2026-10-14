import { api } from "./api.js";

export const STATUS = [
  { id: "todo", label: "Por hacer" },
  { id: "in_progress", label: "En curso" },
  { id: "review", label: "En revisión" },
  { id: "blocked", label: "Bloqueada" },
  { id: "done", label: "Hecha" },
];
export const PRIORITY = [
  { id: "critical", label: "Crítica" },
  { id: "high", label: "Alta" },
  { id: "medium", label: "Media" },
  { id: "low", label: "Baja" },
];
export const TYPES = [
  { id: "task", label: "Tarea" },
  { id: "incident", label: "Incidente" },
  { id: "change", label: "Cambio" },
  { id: "request", label: "Solicitud" },
  { id: "improvement", label: "Mejora" },
];
export const ROLES = [
  { id: "admin", label: "Administración", hint: "Gestiona personas, ajustes y todo el contenido" },
  { id: "member", label: "Miembro", hint: "Crea y edita tareas, páginas y activos" },
  { id: "viewer", label: "Lectura", hint: "Consulta tableros, páginas e informes sin editar" },
];
export const RECURRENCE = [
  { id: "none", label: "No se repite" },
  { id: "weekly", label: "Cada semana" },
  { id: "biweekly", label: "Cada dos semanas" },
  { id: "monthly", label: "Cada mes" },
  { id: "quarterly", label: "Cada trimestre" },
  { id: "yearly", label: "Cada año" },
];
export const PROJECT_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948", "#6f7f8e"];
export const label = (list, id) => (list.find((x) => x.id === id) || {}).label || id || "";
export const PRIORITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 };
export const STATUS_RANK = Object.fromEntries(STATUS.map((s, i) => [s.id, i]));

const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* almacenamiento no disponible */ } },
};

const listeners = new Set();
const EMPTY_FILTERS = { q: "", project: "", assignee: "", priority: "", type: "", mine: false, adv: null };

export const store = {
  me: null,
  projects: [],
  members: [],
  tasks: [],
  pages: [],
  assets: [],
  customFields: [],
  templates: [],
  settings: { wip_limits: {}, workspace: "Tecnología", sla: { types: [], policies: {} }, approval_types: [] },
  features: { ai: false, email: false, sso: false, imap: false },
  revision: 0,
  unread: 0,
  today: "",
  filters: Object.assign({ ...EMPTY_FILTERS }, LS.get("pti.filters", {}), { q: "", adv: null }),
  prefs: Object.assign({ listGroup: "status", listSort: { key: "", dir: 1 } }, LS.get("pti.prefs", {})),

  get user() { return this.me?.name || ""; },
  get can() {
    const r = this.me?.role;
    return { edit: r === "admin" || r === "member", admin: r === "admin", cab: r === "admin" || !!this.me?.is_cab };
  },

  on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  emit(reason) { listeners.forEach((fn) => fn(reason)); },

  async load(reason = "load") {
    const b = await api("/api/bootstrap");
    Object.assign(this, {
      me: b.user, projects: b.projects, members: b.members, tasks: b.tasks, pages: b.pages, assets: b.assets,
      customFields: b.custom_fields, templates: b.templates, settings: b.settings, today: b.today,
      features: b.features, revision: b.revision,
    });
    this.emit(reason);
  },

  setFilters(patch) {
    Object.assign(this.filters, patch);
    const { q, adv, ...persist } = this.filters;
    LS.set("pti.filters", persist);
    this.emit("filters");
  },
  resetFilters(patch = {}) {
    Object.assign(this.filters, EMPTY_FILTERS, patch);
    this.setFilters({});
  },
  setPref(k, v) { this.prefs[k] = v; LS.set("pti.prefs", this.prefs); },

  project(id) { return this.projects.find((p) => p.id === Number(id)); },
  member(name) { return this.members.find((m) => m.name === name); },
  task(id) { return this.tasks.find((t) => t.id === Number(id)); },
  page(id) { return this.pages.find((p) => p.id === Number(id)); },
  asset(id) { return this.assets.find((a) => a.id === Number(id)); },
  subtasks(id) { return this.tasks.filter((t) => t.parent_id === Number(id)).sort((a, b) => a.position - b.position); },
  taskKey(t) { const p = this.project(t.project_id); return `${p ? p.key : "TI"}-${t.number}`; },
  taskByKey(key) {
    const m = /^([A-Z]{1,6})-(\d+)$/.exec(key);
    if (!m) return null;
    const p = this.projects.find((x) => x.key === m[1]);
    return this.tasks.find((t) => t.number === Number(m[2]) && (m[1] === "TI" ? !t.project_id : p && t.project_id === p.id));
  },
  isOverdue(t) { return t.status !== "done" && t.due_date && t.due_date < this.today; },
  openCount(pid) { return this.tasks.filter((t) => t.project_id === pid && t.status !== "done").length; },
  needsApproval(t) { return (this.settings.approval_types || []).includes(t.type) && t.approval_status !== "approved"; },

  filtered({ ignoreProject = false } = {}) {
    const f = this.filters;
    const q = f.q.trim().toLowerCase();
    const a = f.adv;
    return this.tasks.filter((t) => {
      if (!ignoreProject && f.project && String(t.project_id) !== String(f.project)) return false;
      if (f.assignee && (f.assignee === "__none" ? t.assignee : t.assignee !== f.assignee)) return false;
      if (f.priority && t.priority !== f.priority) return false;
      if (f.type && t.type !== f.type) return false;
      if (f.mine && t.assignee !== this.user) return false;
      if (q) {
        const hay = `${this.taskKey(t)} ${t.title} ${t.tags} ${t.assignee}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return a ? this.matchAdvanced(t, a) : true;
    });
  },

  /** Filtro compuesto procedente de una pregunta en lenguaje natural. */
  matchAdvanced(t, a) {
    if (a.assignee && (a.assignee === "__none" ? t.assignee : t.assignee !== a.assignee)) return false;
    if (a.project_id && t.project_id !== a.project_id) return false;
    if (a.statuses?.length && !a.statuses.includes(t.status)) return false;
    if (!a.statuses?.length && !a.updated_from && t.status === "done" && !a.text) return false;
    if (a.types?.length && !a.types.includes(t.type)) return false;
    if (a.priorities?.length && !a.priorities.includes(t.priority)) return false;
    if (a.overdue && !this.isOverdue(t)) return false;
    if (a.delayed && !t.delay) return false;
    if (a.approval === "not_approved" && (t.approval_status === "approved" || !this.needsApproval(t))) return false;
    if (["pending", "approved", "rejected"].includes(a.approval) && t.approval_status !== a.approval) return false;
    if (a.sla && (!t.sla || (a.sla === "breached" ? t.sla.state !== "breached" : !["risk", "breached"].includes(t.sla.state)))) return false;
    if (a.due_from && (!t.due_date || t.due_date < a.due_from)) return false;
    if (a.due_to && (!t.due_date || t.due_date > a.due_to)) return false;
    if (a.updated_from && (t.updated_at || "").slice(0, 10) < a.updated_from) return false;
    if (a.text && !`${this.taskKey(t)} ${t.title} ${t.notes} ${t.tags}`.toLowerCase().includes(a.text.toLowerCase())) return false;
    return true;
  },

  // ---------- Tareas ----------
  _put(task) {
    const i = this.tasks.findIndex((t) => t.id === task.id);
    if (i >= 0) this.tasks[i] = { ...this.tasks[i], ...task };
    else this.tasks.push(task);
  },
  async createTask(data) {
    const t = await api("/api/tasks", { method: "POST", body: data });
    this._put(t);
    if (t.parent_id) await this.refreshTask(t.parent_id).catch(() => {});
    this.emit("task");
    return t;
  },
  async createFromTemplate(tplId, overrides) {
    const t = await api(`/api/templates/${tplId}/apply`, { method: "POST", body: overrides });
    await this.load("task");
    return t;
  },
  async updateTask(id, changes) {
    const prev = { ...this.task(id) };
    this._put({ ...prev, ...changes });
    this.emit("task");
    try {
      const t = await api(`/api/tasks/${id}`, { method: "PUT", body: changes });
      this._put(t);
      if (t.parent_id && "status" in changes) await this.refreshTask(t.parent_id).catch(() => {});
      if ("status" in changes) this.tasks.filter((x) => x.depends_on?.includes(id)).forEach((x) => this.refreshTask(x.id).catch(() => {}));
      this.emit("task");
      return t;
    } catch (e) {
      this._put(prev);
      this.emit("task");
      throw e;
    }
  },
  async deleteTask(id) {
    await api(`/api/tasks/${id}`, { method: "DELETE" });
    this.tasks = this.tasks.filter((t) => t.id !== id && t.parent_id !== id);
    this.emit("task");
  },
  async duplicateTask(id) {
    const t = await api(`/api/tasks/${id}/duplicate`, { method: "POST" });
    this._put(t);
    this.emit("task");
    return t;
  },
  async bulk(ids, payload) {
    const res = await api("/api/tasks/bulk", { method: "POST", body: { ids, ...payload } });
    if (payload.delete) this.tasks = this.tasks.filter((t) => !ids.includes(t.id));
    else res.updated.forEach((t) => this._put(t));
    this.emit("task");
    return res;
  },
  async refreshTask(id) {
    const t = await api(`/api/tasks/${id}`);
    const { checklist, comments, activity, approvals, attachments, subtasks, pages, ...plain } = t;
    this._put(plain);
    this.emit("task");
    return t;
  },
  async taskAction(id, url, method, body) {
    const t = await api(url, { method, body });
    if (t && t.id === Number(id)) this._put(t);
    this.emit("task");
    return t;
  },

  // ---------- Proyectos ----------
  async saveProject(id, data) {
    const p = await api(id ? `/api/projects/${id}` : "/api/projects", { method: id ? "PUT" : "POST", body: data });
    const i = this.projects.findIndex((x) => x.id === p.id);
    if (i >= 0) this.projects[i] = p; else this.projects.push(p);
    this.projects.sort((a, b) => a.name.localeCompare(b.name, "es"));
    this.emit("project");
    return p;
  },
  async deleteProject(id) {
    await api(`/api/projects/${id}`, { method: "DELETE" });
    this.projects = this.projects.filter((p) => p.id !== id);
    this.tasks = this.tasks.filter((t) => t.project_id !== id);
    if (String(this.filters.project) === String(id)) this.filters.project = "";
    this.emit("project");
  },

  // ---------- Personas ----------
  async saveMember(id, data) {
    const old = id ? this.members.find((m) => m.id === id) : null;
    const m = await api(id ? `/api/members/${id}` : "/api/members", { method: id ? "PUT" : "POST", body: data });
    if (old && old.name !== m.name) {
      this.tasks.forEach((t) => { if (t.assignee === old.name) t.assignee = m.name; });
      this.projects.forEach((p) => { if (p.owner === old.name) p.owner = m.name; });
    }
    const i = this.members.findIndex((x) => x.id === m.id);
    if (i >= 0) this.members[i] = m; else this.members.push(m);
    this.members.sort((a, b) => a.name.localeCompare(b.name, "es"));
    if (this.me && m.id === this.me.id) Object.assign(this.me, m);
    this.emit("member");
    return m;
  },
  async deleteMember(id) {
    const m = this.members.find((x) => x.id === id);
    await api(`/api/members/${id}`, { method: "DELETE" });
    this.members = this.members.filter((x) => x.id !== id);
    this.tasks.forEach((t) => { if (t.assignee === m.name && t.status !== "done") t.assignee = ""; });
    this.emit("member");
  },

  // ---------- Páginas ----------
  _putPage(p) {
    const meta = { id: p.id, parent_id: p.parent_id, project_id: p.project_id, title: p.title, icon: p.icon, kind: p.kind,
      position: p.position, updated_at: p.updated_at, updated_by: p.updated_by };
    const i = this.pages.findIndex((x) => x.id === p.id);
    if (i >= 0) this.pages[i] = meta; else this.pages.push(meta);
  },
  async createPage(data) {
    const p = await api("/api/pages", { method: "POST", body: data });
    this._putPage(p);
    this.emit("page");
    return p;
  },
  async savePage(id, data) {
    const p = await api(`/api/pages/${id}`, { method: "PUT", body: data });
    this._putPage(p);
    this.emit("page-meta");
    return p;
  },
  async deletePage(id) {
    await api(`/api/pages/${id}`, { method: "DELETE" });
    const drop = new Set([id]);
    let grew = true;
    while (grew) {
      grew = false;
      this.pages.forEach((p) => { if (p.parent_id && drop.has(p.parent_id) && !drop.has(p.id)) { drop.add(p.id); grew = true; } });
    }
    this.pages = this.pages.filter((p) => !drop.has(p.id));
    this.emit("page");
  },

  // ---------- Activos ----------
  async saveAsset(id, data) {
    const a = await api(id ? `/api/assets/${id}` : "/api/assets", { method: id ? "PUT" : "POST", body: data });
    const i = this.assets.findIndex((x) => x.id === a.id);
    if (i >= 0) this.assets[i] = a; else this.assets.push(a);
    this.assets.sort((x, y) => x.name.localeCompare(y.name, "es"));
    this.emit("asset");
    return a;
  },
  async deleteAsset(id) {
    await api(`/api/assets/${id}`, { method: "DELETE" });
    this.assets = this.assets.filter((a) => a.id !== id);
    this.tasks.forEach((t) => { t.asset_ids = (t.asset_ids || []).filter((x) => x !== id); });
    this.emit("asset");
  },

  async saveSettings(patch) {
    this.settings = await api("/api/settings", { method: "PUT", body: patch });
    this.emit("settings");
    return this.settings;
  },
};
