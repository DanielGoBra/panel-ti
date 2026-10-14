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
export const PROJECT_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948", "#6f7f8e"];
export const label = (list, id) => (list.find((x) => x.id === id) || {}).label || id || "";
export const PRIORITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 };
export const STATUS_RANK = Object.fromEntries(STATUS.map((s, i) => [s.id, i]));

const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* almacenamiento no disponible */ } },
};

const listeners = new Set();

export const store = {
  projects: [],
  members: [],
  tasks: [],
  settings: { wip_limits: {}, workspace: "Tecnología" },
  today: "",
  user: LS.get("pti.user", ""),
  filters: Object.assign({ q: "", project: "", assignee: "", priority: "", type: "", mine: false }, LS.get("pti.filters", {}), { q: "" }),
  prefs: Object.assign({ listGroup: "status", listSort: { key: "", dir: 1 } }, LS.get("pti.prefs", {})),

  on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  emit(reason) { listeners.forEach((fn) => fn(reason)); },

  async load() {
    const b = await api("/api/bootstrap");
    Object.assign(this, { projects: b.projects, members: b.members, tasks: b.tasks, settings: b.settings, today: b.today });
    if (!this.user || !this.members.some((m) => m.name === this.user)) {
      this.user = this.members[0]?.name || "";
      LS.set("pti.user", this.user);
    }
    this.emit("load");
  },

  setUser(name) { this.user = name; LS.set("pti.user", name); this.emit("user"); },
  setFilters(patch) {
    Object.assign(this.filters, patch);
    const { q, ...persist } = this.filters;
    LS.set("pti.filters", persist);
    this.emit("filters");
  },
  setPref(k, v) { this.prefs[k] = v; LS.set("pti.prefs", this.prefs); },

  project(id) { return this.projects.find((p) => p.id === Number(id)); },
  member(name) { return this.members.find((m) => m.name === name); },
  task(id) { return this.tasks.find((t) => t.id === Number(id)); },
  taskKey(t) { const p = this.project(t.project_id); return `${p ? p.key : "TI"}-${t.number}`; },
  isOverdue(t) { return t.status !== "done" && t.due_date && t.due_date < this.today; },
  openCount(pid) { return this.tasks.filter((t) => t.project_id === pid && t.status !== "done").length; },

  filtered({ ignoreProject = false } = {}) {
    const f = this.filters;
    const q = f.q.trim().toLowerCase();
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
      return true;
    });
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
    this.emit("task");
    return t;
  },
  async updateTask(id, changes) {
    const prev = { ...this.task(id) };
    this._put({ ...prev, ...changes });
    this.emit("task");
    try {
      const t = await api(`/api/tasks/${id}`, { method: "PUT", body: changes });
      this._put(t);
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
    this.tasks = this.tasks.filter((t) => t.id !== id);
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
    else res.forEach((t) => this._put(t));
    this.emit("task");
    return res;
  },
  async refreshTask(id) {
    const t = await api(`/api/tasks/${id}`);
    const { checklist, comments, activity, ...plain } = t;
    this._put(plain);
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
      if (this.user === old.name) this.setUser(m.name);
    }
    const i = this.members.findIndex((x) => x.id === m.id);
    if (i >= 0) this.members[i] = m; else this.members.push(m);
    this.members.sort((a, b) => a.name.localeCompare(b.name, "es"));
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

  async saveSettings(patch) {
    this.settings = await api("/api/settings", { method: "PUT", body: patch });
    this.emit("settings");
  },
};
