import { get } from "../api.js";
import { createEditor, toMarkdown } from "../editor.js";
import { icons } from "../icons.js";
import { store } from "../store.js";
import { openTask } from "../taskpanel.js";
import { closePop, confirmDialog, emptyState, modal, popMenu, projectDot, statusChip, toast, toastError } from "../ui.js";
import { $, $$, debounce, esc, fmtDate, timeAgo } from "../util.js";

export const title = "Páginas";
export const KINDS = [
  { id: "page", label: "Página" },
  { id: "procedure", label: "Procedimiento" },
  { id: "minutes", label: "Acta" },
  { id: "kb", label: "Base de conocimiento" },
];
const EMOJIS = ["📄", "🏠", "📚", "📘", "🧭", "🗂", "🔎", "🛡", "🔐", "🖥", "💻", "🌐", "☁️", "🗄", "🔧", "⚙️", "📈", "📊", "✅", "📌", "🧾", "📅", "👥", "🚨", "🧩", "💡", "📝", "🏷", "📦", "🔁"];

export const pageTitle = (p) => p?.title || "Sin título";
export const pageIcon = (p) => (p?.icon ? `<span class="pico">${esc(p.icon)}</span>` : icons.page);

/** Crea una página (con elección de plantilla) y navega a ella. */
export function newPage({ parent_id = null, project_id = null, kind = null } = {}) {
  const tpls = store.templates.filter((t) => t.kind === "page");
  const create = async (data) => {
    try {
      const p = await store.createPage({ parent_id, project_id, kind: kind || "page", ...data });
      location.hash = `#/pagina/${p.id}`;
      return p;
    } catch (e) { toastError(e); }
  };
  if (!tpls.length) return create({ title: "" });
  const { node, close } = modal({
    title: "Nueva página", size: "sm", hideSave: true, cancelLabel: "Cancelar",
    body: `<div class="tpl-list">
      <button type="button" class="tpl-item" data-tpl="">${icons.page}<div><b>Página en blanco</b><span>Empieza a escribir desde cero</span></div></button>
      ${tpls.map((t) => `<button type="button" class="tpl-item" data-tpl="${t.id}"><span class="pico">${esc(t.payload.icon || "📄")}</span><div><b>${esc(t.name)}</b><span>${esc(t.description || "")}</span></div></button>`).join("")}
    </div>`,
  });
  $$("[data-tpl]", node).forEach((b) => b.onclick = () => { close(); create(b.dataset.tpl ? { template_id: Number(b.dataset.tpl) } : { title: "" }); });
}

function breadcrumb(p) {
  const chain = [];
  let cur = p;
  while (cur) { chain.unshift(cur); cur = cur.parent_id ? store.page(cur.parent_id) : null; }
  return chain;
}
export function pageCrumbs(id) {
  const p = store.page(id);
  if (!p) return "";
  return `<a href="#/paginas">Páginas</a>` + breadcrumb(p).map((x, i, arr) => `<span class="sep">/</span>${i === arr.length - 1 ? `<b>${esc(pageTitle(x))}</b>` : `<a href="#/pagina/${x.id}">${esc(pageTitle(x))}</a>`}`).join("");
}

// ---------- Índice de páginas ----------
export function renderIndex(root) {
  const byKind = (k) => store.pages.filter((p) => p.kind === k).sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
  const recent = [...store.pages].sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || "")).slice(0, 8);
  const card = (p) => `<a class="pcard" href="#/pagina/${p.id}">${pageIcon(p)}<div><b>${esc(pageTitle(p))}</b><span>${esc(p.updated_by || "")} · ${esc(timeAgo(p.updated_at))}</span></div></a>`;
  const section = (ttl, list, kind) => `<section class="page-sec"><h2 class="section">${ttl} <span class="muted">${list.length}</span>
      ${store.can.edit ? `<button class="btn sm ghost" data-new-kind="${kind}">${icons.plus}Nueva</button>` : ""}</h2>
      ${list.length ? `<div class="pcards">${list.map(card).join("")}</div>` : `<p class="muted" style="font-size:13px">Aún no hay ninguna.</p>`}</section>`;
  root.innerHTML = `<div class="page">
    <div class="page-head"><div><div class="page-title">Páginas</div>
      <div class="page-sub">Wiki del área, procedimientos, actas del comité y base de conocimiento</div></div>
      <label class="filter-search page-search"><span class="ic">${icons.search}</span><input type="search" placeholder="Buscar en el contenido…" data-focus-key="page-q"></label>
    </div>
    <div class="search-results hidden" id="page-results"></div>
    ${store.pages.length ? `<section class="page-sec"><h2 class="section">Editadas recientemente</h2><div class="pcards">${recent.map(card).join("")}</div></section>
      ${section("Base de conocimiento", byKind("kb"), "kb")}
      ${section("Procedimientos", byKind("procedure"), "procedure")}
      ${section("Actas del comité", byKind("minutes"), "minutes")}`
      : `<div class="card">${emptyState("page", "Sin páginas todavía", "Crea la wiki del área, documenta procedimientos o guarda las actas del comité.", store.can.edit ? `<button class="btn primary" data-new-kind="page">${icons.plus}Crear la primera página</button>` : "")}</div>`}
  </div>`;
  $$("[data-new-kind]", root).forEach((b) => b.onclick = () => newPage({ kind: b.dataset.newKind }));
  const input = $(".page-search input", root);
  const out = $("#page-results", root);
  input.oninput = debounce(async () => {
    const q = input.value.trim();
    if (q.length < 2) { out.classList.add("hidden"); return; }
    try {
      const rows = await get(`/api/pages/search?q=${encodeURIComponent(q)}`);
      out.classList.remove("hidden");
      out.innerHTML = rows.length ? rows.map((r) => `<a class="row-item" href="#/pagina/${r.id}">${r.icon ? `<span class="pico">${esc(r.icon)}</span>` : icons.page}<span class="grow">${esc(r.title || "Sin título")}<span class="reason">${esc(r.snippet)}</span></span></a>`).join("")
        : `<div class="row-item muted">Sin resultados para «${esc(q)}»</div>`;
    } catch (e) { toastError(e); }
  }, 250);
}

// ---------- Página ----------
let open = null; // { id, editor, base, saving, pending, dirty }

export function isEditingPage() { return !!open && (open.dirty || open.editor?.isEditing()); }

export async function renderPage(root, id, nav) {
  id = Number(id);
  if (open && open.id !== id) await flush();
  root.innerHTML = `<div class="page doc"><div class="skeleton" style="height:42px;width:50%;margin:40px 0 20px"></div><div class="skeleton" style="height:200px"></div></div>`;
  let p;
  try { p = await get(`/api/pages/${id}`); } catch (e) {
    root.innerHTML = `<div class="page">${emptyState("page", "Página no encontrada", "Puede que se haya eliminado.", `<a class="btn" href="#/paginas">Ver páginas</a>`)}</div>`;
    return;
  }
  if (!root.isConnected) return;
  store._putPage(p);
  const ro = !store.can.edit;
  const proj = store.project(p.project_id);
  const linked = p.linked_tasks.map((tid) => store.task(tid)).filter(Boolean);
  root.innerHTML = `<div class="page doc">
    <div class="doc-head">
      <button class="doc-icon" data-icon-pick${ro ? " disabled" : ""} title="Cambiar icono">${p.icon ? esc(p.icon) : `<span class="muted add-icon">${icons.page}</span>`}</button>
      <textarea class="doc-title" rows="1" placeholder="Sin título"${ro ? " readonly" : ""}>${esc(p.title)}</textarea>
      <div class="doc-meta">
        <span class="kind-chip">${esc((KINDS.find((k) => k.id === p.kind) || KINDS[0]).label)}</span>
        ${proj ? `<a class="person" href="#/tablero" data-proj="${proj.id}">${projectDot(proj)}<span>${esc(proj.name)}</span></a>` : ""}
        <span class="muted" data-saved>Editada por ${esc(p.updated_by || p.created_by)} ${esc(timeAgo(p.updated_at))}</span>
      </div>
    </div>
    <div class="doc-body" id="doc-editor"></div>
    ${p.children.length || !ro ? `<div class="doc-children">
      <h4>Subpáginas</h4>
      ${p.children.map((c) => `<a class="page-link" href="#/pagina/${c.id}">${pageIcon(c)}${esc(pageTitle(c))}</a>`).join("")}
      ${ro ? "" : `<button class="btn sm ghost" data-new-child>${icons.plus}Añadir subpágina</button>`}
    </div>` : ""}
    ${linked.length ? `<div class="doc-children"><h4>Tareas mencionadas</h4>${linked.map((t) => `<button class="row-item doc-task" data-task="${t.id}">${statusChip(t.status)}<span class="key">${esc(store.taskKey(t))}</span><span class="grow">${esc(t.title)}</span></button>`).join("")}</div>` : ""}
  </div>`;

  const titleEl = $(".doc-title", root);
  const auto = () => { titleEl.style.height = "auto"; titleEl.style.height = `${titleEl.scrollHeight}px`; };
  auto();
  open = { id, base: p.updated_at, dirty: false, saving: false, pending: null, title: p.title };
  const saved = $("[data-saved]", root);
  const doSave = async (patch, force = false) => {
    if (!open || open.id !== id) return;
    open.saving = true;
    saved.textContent = "Guardando…";
    try {
      const r = await store.savePage(id, { ...patch, ...(force ? {} : { base_updated_at: open.base }) });
      if (open?.id === id) { open.base = r.updated_at; open.dirty = false; saved.textContent = "Guardado"; }
    } catch (e) {
      if (e.status === 409 && e.data?.conflict) return conflict(e.data, patch);
      saved.textContent = "No se pudo guardar";
      toastError(e);
    } finally { if (open) open.saving = false; }
  };
  const conflict = (data, patch) => {
    modal({
      title: "La página ha cambiado", sub: esc(data.error),
      saveLabel: "Guardar mi versión", cancelLabel: "Ver su versión",
      async onSave() { await doSave(patch, true); },
    }).node.querySelector("[data-cancel]").addEventListener("click", () => { open = null; renderPage(root, id, nav); });
  };
  const queue = debounce(() => { if (open?.pending) { const pt = open.pending; open.pending = null; doSave(pt); } }, 800);
  const schedule = (patch) => {
    open.dirty = true;
    open.pending = { ...(open.pending || {}), ...patch };
    saved.textContent = "Cambios sin guardar";
    queue();
  };
  open.flush = async () => { if (open?.pending) { const pt = open.pending; open.pending = null; await doSave(pt); } };

  if (!ro) {
    titleEl.oninput = () => { auto(); schedule({ title: titleEl.value }); };
    titleEl.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); open.editor.focusStart(); } };
    $("[data-icon-pick]", root).onclick = (e) => {
      const pop = popMenu(e.currentTarget, [{ value: "", html: "Sin icono" }], (v) => { schedule({ icon: v }); $("[data-icon-pick]", root).innerHTML = v ? esc(v) : `<span class="muted add-icon">${icons.page}</span>`; });
      const grid = document.createElement("div");
      grid.className = "emoji-grid";
      grid.innerHTML = EMOJIS.map((em) => `<button type="button">${em}</button>`).join("");
      pop.prepend(grid);
      $$("button", grid).forEach((b) => b.onclick = () => { closeEmoji(b.textContent); });
      const closeEmoji = (v) => { closePop(); schedule({ icon: v }); $("[data-icon-pick]", root).innerHTML = esc(v); };
    };
  }
  open.editor = createEditor($("#doc-editor", root), {
    blocks: p.blocks, readOnly: ro, pageId: id, projectId: p.project_id,
    onChange: (blocks) => schedule({ blocks }),
    onOpenTask: (tid) => openTask(tid),
  });
  if (!p.title && !ro) titleEl.focus();
  $("[data-new-child]", root)?.addEventListener("click", () => newPage({ parent_id: id, project_id: p.project_id, kind: p.kind === "kb" ? "kb" : null }));
  $$("[data-task]", root).forEach((b) => b.onclick = () => openTask(b.dataset.task));
  $("[data-proj]", root)?.addEventListener("click", (e) => { e.preventDefault(); nav("#/tablero", { project: p.project_id }); });
}

export async function flush() {
  if (open?.flush) await open.flush();
  open = null;
}

export function pageActions(id) {
  return [
    { value: "child", html: `${icons.plus}Añadir subpágina` },
    { value: "kind", html: `${icons.layers}Cambiar tipo` },
    { value: "move", html: `${icons.move}Mover a…` },
    { value: "project", html: `${icons.folder}Vincular a proyecto` },
    { value: "md", html: `${icons.download}Descargar en Markdown` },
    { value: "link", html: `${icons.link}Copiar enlace` },
    { sep: true },
    { value: "del", html: `${icons.trash}Eliminar`, danger: true },
  ];
}

export async function runPageAction(v, id, anchor) {
  const p = store.page(id);
  if (!p) return;
  if (v === "child") return newPage({ parent_id: id, project_id: p.project_id });
  if (v === "link") { try { await navigator.clipboard.writeText(`${location.origin}/#/pagina/${id}`); toast("Enlace copiado"); } catch (e) { toast(location.href); } return; }
  if (v === "md") {
    await flush();
    const full = await get(`/api/pages/${id}`);
    const blob = new Blob([toMarkdown(full.title || "Sin título", full.blocks)], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(full.title || "pagina").replace(/[\\/:*?"<>|]+/g, "-")}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
    location.hash = `#/pagina/${id}`;
    return;
  }
  const after = async (patch, msg) => { try { await flush(); await store.savePage(id, patch); toast(msg); store.emit("page-reload"); } catch (e) { toastError(e); } };
  if (v === "kind") return popMenu(anchor, KINDS.map((k) => ({ value: k.id, html: k.label, selected: k.id === p.kind })), (k) => after({ kind: k }, "Tipo cambiado"));
  if (v === "project") return popMenu(anchor, [{ value: 0, html: "Sin proyecto", selected: !p.project_id }, ...store.projects.map((x) => ({ value: x.id, html: projectDot(x) + esc(x.name), selected: x.id === p.project_id }))], (pid) => after({ project_id: pid || null }, "Proyecto actualizado"), { search: true });
  if (v === "move") {
    const descendants = new Set([id]);
    let grew = true;
    while (grew) { grew = false; store.pages.forEach((x) => { if (x.parent_id && descendants.has(x.parent_id) && !descendants.has(x.id)) { descendants.add(x.id); grew = true; } }); }
    return popMenu(anchor, [{ value: 0, html: `${icons.home}Nivel superior`, selected: !p.parent_id },
      ...store.pages.filter((x) => !descendants.has(x.id)).map((x) => ({ value: x.id, html: `${pageIcon(x)}${esc(pageTitle(x))}`, selected: x.id === p.parent_id, text: pageTitle(x) }))],
    (pid) => after({ parent_id: pid || null }, "Página movida"), { search: true, placeholder: "Mover dentro de…" });
  }
  if (v === "del") {
    const kids = store.pages.filter((x) => x.parent_id === id).length;
    if (!(await confirmDialog({ title: "Eliminar página", text: `Se eliminará «${pageTitle(p)}»${kids ? ` y sus ${kids} subpáginas` : ""}. No se puede deshacer.` }))) return;
    try { open = null; await store.deletePage(id); toast("Página eliminada"); location.hash = p.parent_id ? `#/pagina/${p.parent_id}` : "#/paginas"; } catch (e) { toastError(e); }
  }
}

export { fmtDate };
