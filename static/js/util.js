export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function debounce(fn, ms = 250) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// ---------- Fechas (cadenas ISO yyyy-mm-dd, sin zonas horarias) ----------
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MONTHS_LONG = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DAYS_LONG = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

export const pad = (n) => String(n).padStart(2, "0");
export const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseISO = (s) => { const [y, m, d] = s.slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d); };
export const todayISO = () => isoDate(new Date());
export const addDays = (iso, n) => { const d = parseISO(iso); d.setDate(d.getDate() + n); return isoDate(d); };
export const diffDays = (a, b) => Math.round((parseISO(a) - parseISO(b)) / 86400000);

export function fmtDate(iso, { year = false } = {}) {
  if (!iso) return "";
  const d = parseISO(iso);
  const showYear = year || d.getFullYear() !== new Date().getFullYear();
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${showYear ? " " + d.getFullYear() : ""}`;
}
export const fmtLongDate = (iso) => { const d = parseISO(iso); return `${DAYS_LONG[d.getDay()]}, ${d.getDate()} de ${MONTHS_LONG[d.getMonth()]}`; };
export const monthName = (y, m) => `${MONTHS_LONG[m]} ${y}`;
export const shortMonth = (m) => MONTHS[m];

export function relDue(iso) {
  if (!iso) return "";
  const n = diffDays(iso, todayISO());
  if (n === 0) return "Hoy";
  if (n === 1) return "Mañana";
  if (n === -1) return "Ayer";
  if (n < 0 && n > -7) return `Hace ${-n} días`;
  if (n > 1 && n < 7) return DAYS_LONG[parseISO(iso).getDay()].replace(/^./, (c) => c.toUpperCase());
  return fmtDate(iso);
}

export function timeAgo(ts) {
  if (!ts) return "";
  const d = new Date(ts.replace(" ", "T"));
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (s < 60) return "ahora";
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  const days = Math.floor(s / 86400);
  if (days === 1) return "ayer";
  if (days < 7) return `hace ${days} días`;
  return fmtDate(ts.slice(0, 10));
}

// ---------- Personas ----------
const AV_TONES = ["#5b7a99", "#8a6d5a", "#5e8a74", "#7d6a96", "#9a6a7a", "#6f7f8e", "#8a7f52", "#5f7f86"];
export function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}
export function avatarTone(name) {
  let h = 0;
  for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AV_TONES[h % AV_TONES.length];
}

export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function downloadUrl(url) {
  const a = document.createElement("a");
  a.href = url;
  a.download = "";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
