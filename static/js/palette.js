import { get } from "./api.js";
import { icons } from "./icons.js";
import { store } from "./store.js";
import { openTask } from "./taskpanel.js";
import { projectDot, statusDot } from "./ui.js";
import { $, $$, debounce, el, esc } from "./util.js";

const QUESTION_RE = /^(¿|qu[eé]|qui[eé]n|cu[aá]l|cu[aá]nt|c[oó]mo|d[oó]nde|muestra|mu[eé]strame|ens[eé][nñ]ame|dame|lista|busca|tareas|incidentes|cambios|solicitudes)/i;

let node = null;

export const isPaletteOpen = () => !!node;

export function openPalette(actions) {
  if (node) return;
  node = el(`<div class="modal-scrim" role="dialog" aria-modal="true" aria-label="Buscar">
    <div class="cmdk">
      <div class="cmdk-in">${icons.search}<input placeholder="Busca tareas, páginas o acciones, o haz una pregunta…" aria-label="Buscar"></div>
      <div class="cmdk-list"></div>
      <div class="cmdk-foot"><span><kbd>↑</kbd> <kbd>↓</kbd> moverse</span><span><kbd>Enter</kbd> abrir</span><span><kbd>Esc</kbd> cerrar</span></div>
    </div></div>`);
  document.body.appendChild(node);
  const input = $("input", node);
  const list = $(".cmdk-list", node);
  let items = [];
  let hl = 0;
  let remote = { q: "", rows: [] };
  const fetchPages = debounce(async (q) => {
    try {
      const rows = await get(`/api/pages/search?q=${encodeURIComponent(q)}`);
      if (node && input.value.trim().toLowerCase() === q.toLowerCase()) { remote = { q: q.toLowerCase(), rows }; draw(); }
    } catch (e) { /* búsqueda opcional */ }
  }, 220);

  const close = () => { node?.remove(); node = null; };
  node.addEventListener("mousedown", (e) => { if (e.target === node) close(); });

  const draw = () => {
    const q = input.value.trim().toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    const match = (s) => words.every((w) => s.toLowerCase().includes(w));
    const acts = actions.filter((a) => !q || match(a.label + " " + (a.keywords || "")));
    const projs = store.projects.filter((p) => q && match(`${p.name} ${p.key} ${p.area}`)).slice(0, 5);
    const tasks = q ? store.tasks.filter((t) => match(`${store.taskKey(t)} ${t.title} ${t.tags} ${t.assignee}`))
      .sort((a, b) => (a.status === "done") - (b.status === "done")).slice(0, 8) : [];
    items = [];
    let html = "";
    const group = (title, arr, fn) => {
      if (!arr.length) return;
      html += `<div class="cmdk-group">${title}</div>`;
      arr.forEach((x) => { const i = items.length; items.push(fn.run(x)); html += `<button class="cmdk-item" data-i="${i}">${fn.html(x)}</button>`; });
    };
    const isQuestion = q && (QUESTION_RE.test(q) || q.endsWith("?") || words.length >= 4);
    if (isQuestion && actions.ask) group(store.features.ai ? "Preguntar (IA)" : "Preguntar", [q], { html: (x) => `${icons.question}<span>Filtrar tareas: «${esc(input.value.trim())}»</span><span class="right">Enter</span>`, run: () => () => actions.ask(input.value.trim()) });
    group("Tareas", tasks, { html: (t) => `${statusDot(t.status)}<span class="key">${esc(store.taskKey(t))}</span><span>${esc(t.title)}</span><span class="right">${esc(t.assignee || "")}</span>`, run: (t) => () => openTask(t.id) });
    const localPages = q ? store.pages.filter((p) => match(p.title || "")).slice(0, 5) : [];
    const seen = new Set(localPages.map((p) => p.id));
    const contentPages = remote.q === q ? remote.rows.filter((r) => !seen.has(r.id)).slice(0, 5) : [];
    group("Páginas", [...localPages, ...contentPages], { html: (p) => `${p.icon ? `<span class="pico">${esc(p.icon)}</span>` : icons.page}<span>${esc(p.title || "Sin título")}</span>${p.snippet ? `<span class="right snippet">${esc(p.snippet)}</span>` : ""}`, run: (p) => () => { location.hash = `#/pagina/${p.id}`; } });
    group("Proyectos", projs, { html: (p) => `${projectDot(p)}<span>${esc(p.name)}</span><span class="right">${esc(p.key)}</span>`, run: (p) => () => actions.goProject(p.id) });
    group(q ? "Acciones" : "Ir a y acciones", acts.slice(0, q ? 6 : 20), { html: (a) => `${icons[a.icon] || ""}<span>${esc(a.label)}</span>${a.hint ? `<span class="right">${a.hint}</span>` : ""}`, run: (a) => a.run });
    list.innerHTML = html || `<div class="cmdk-empty">Sin resultados para «${esc(q)}»</div>`;
    hl = Math.min(hl, Math.max(0, items.length - 1));
    paint();
    $$(".cmdk-item", list).forEach((b) => {
      b.onclick = () => { const fn = items[Number(b.dataset.i)]; close(); fn(); };
      b.onmousemove = () => { hl = Number(b.dataset.i); paint(); };
    });
  };
  const paint = () => $$(".cmdk-item", list).forEach((b) => { const on = Number(b.dataset.i) === hl; b.classList.toggle("hl", on); if (on) b.scrollIntoView({ block: "nearest" }); });

  input.oninput = () => { hl = 0; draw(); const v = input.value.trim(); if (v.length >= 3) fetchPages(v); };
  input.onkeydown = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); hl = Math.min(items.length - 1, hl + 1); paint(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); hl = Math.max(0, hl - 1); paint(); }
    else if (e.key === "Enter") { e.preventDefault(); const fn = items[hl]; if (fn) { close(); fn(); } }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
  };
  draw();
  input.focus();
}
