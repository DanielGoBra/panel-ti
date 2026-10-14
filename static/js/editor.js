// Editor de bloques. Cada bloque se muestra con formato y pasa a un textarea al editarlo.
// Atajos: "# ", "## ", "### ", "- ", "1. ", "[] ", "> ", "!! ", "```", "---" y el menú "/".
import { upload } from "./api.js";
import { icons } from "./icons.js";
import { inline } from "./rich.js";
import { store } from "./store.js";
import { avatar, closePop, popMenu, statusChip, toastError } from "./ui.js";
import { $, $$, esc } from "./util.js";

export const BLOCKS = [
  { type: "p", label: "Texto", icon: "text", hint: "Párrafo normal" },
  { type: "h1", label: "Título 1", icon: "heading", hint: "#" },
  { type: "h2", label: "Título 2", icon: "heading", hint: "##" },
  { type: "h3", label: "Título 3", icon: "heading", hint: "###" },
  { type: "bullet", label: "Lista", icon: "list", hint: "-" },
  { type: "number", label: "Lista numerada", icon: "numbered", hint: "1." },
  { type: "todo", label: "Casilla", icon: "todo", hint: "[]" },
  { type: "quote", label: "Cita", icon: "quote", hint: ">" },
  { type: "callout", label: "Nota destacada", icon: "callout", hint: "!!" },
  { type: "code", label: "Código", icon: "code", hint: "```" },
  { type: "divider", label: "Separador", icon: "divider", hint: "---" },
  { type: "task", label: "Tarea enlazada", icon: "t_task", hint: "Inserta una tarea con su estado" },
  { type: "image", label: "Imagen", icon: "image", hint: "Sube una imagen o captura" },
];
const LISTS = new Set(["bullet", "number", "todo"]);
const SHORTCUTS = [[/^### $/, "h3"], [/^## $/, "h2"], [/^# $/, "h1"], [/^[-*] $/, "bullet"], [/^1[.)] $/, "number"],
  [/^\[ ?\] $/, "todo"], [/^> $/, "quote"], [/^!! $/, "callout"], [/^```$/, "code"]];
const uid = () => Math.random().toString(36).slice(2, 10);

/**
 * Crea un editor en `root`.
 * opts: { blocks, readOnly, pageId, onChange(blocks), onOpenTask(id) }
 */
export function createEditor(root, opts) {
  let blocks = (opts.blocks?.length ? opts.blocks : [{ type: "p", text: "" }]).map((b) => ({ id: b.id || uid(), ...b }));
  const ro = !!opts.readOnly;
  let editing = -1;
  let dragFrom = null;

  const changed = () => opts.onChange?.(blocks.map((b) => ({ ...b })));

  function numberOf(i) {
    let n = 1;
    for (let k = i - 1; k >= 0 && blocks[k].type === "number"; k--) n++;
    return n;
  }

  function viewHtml(b, i) {
    const empty = !b.text;
    const ph = !ro && i === editing ? "" : !ro && blocks.length === 1 && empty ? "Escribe, o pulsa «/» para insertar un bloque" : "";
    switch (b.type) {
      case "divider": return `<hr>`;
      case "code": return `<pre class="blk-code">${esc(b.text) || "&nbsp;"}</pre>`;
      case "task": {
        const t = store.task(b.task_id);
        if (!t) return `<div class="blk-task missing">Tarea no disponible</div>`;
        return `<button class="blk-task" data-open-task="${t.id}">${statusChip(t.status)}<span class="key">${esc(store.taskKey(t))}</span><span class="grow">${esc(t.title)}</span>${avatar(t.assignee)}</button>`;
      }
      case "image": return b.file_id ? `<figure><img src="/api/files/${b.file_id}" alt="${esc(b.text || "Imagen")}" loading="lazy">${b.text ? `<figcaption>${inline(b.text)}</figcaption>` : ""}</figure>` : `<div class="muted">Imagen no disponible</div>`;
      default: return empty ? `<span class="blk-ph">${ph}</span>` : inline(b.text);
    }
  }

  function blockHtml(b, i) {
    const marker = b.type === "bullet" ? `<span class="blk-marker">•</span>`
      : b.type === "number" ? `<span class="blk-marker num">${numberOf(i)}.</span>`
      : b.type === "todo" ? `<input type="checkbox" class="chk blk-check"${b.checked ? " checked" : ""}${ro ? " disabled" : ""} aria-label="Completar">`
      : b.type === "callout" ? `<span class="blk-marker">${icons.bulb}</span>` : "";
    const editable = !["divider", "task", "image"].includes(b.type) || b.type === "image";
    return `<div class="blk t-${b.type}${b.checked ? " checked" : ""}" data-i="${i}">
      ${ro ? "" : `<button class="blk-handle" draggable="true" title="Arrastra para mover · clic para opciones" tabindex="-1">${icons.drag}</button>`}
      ${marker}
      <div class="blk-view" ${editable && !ro ? 'tabindex="0"' : ""}>${viewHtml(b, i)}</div>
      ${editable && !ro ? `<textarea class="blk-edit" rows="1" spellcheck="true"${b.type === "image" ? ' placeholder="Pie de imagen"' : ""}></textarea>` : ""}
    </div>`;
  }

  function render() {
    root.innerHTML = `<div class="editor${ro ? " ro" : ""}">${blocks.map(blockHtml).join("")}</div>${ro ? "" : `<div class="editor-tail" title="Añadir bloque al final"></div>`}`;
    bind();
    if (editing >= 0) edit(editing, caretPending ?? "end");
  }
  let caretPending = null;

  function rerenderBlock(i) {
    const el = $(`.blk[data-i="${i}"]`, root);
    if (!el) return render();
    const tmp = document.createElement("div");
    tmp.innerHTML = blockHtml(blocks[i], i);
    el.replaceWith(tmp.firstElementChild);
    bindBlock($(`.blk[data-i="${i}"]`, root));
  }

  function autosize(ta) { ta.style.height = "auto"; ta.style.height = `${ta.scrollHeight}px`; }

  function edit(i, caret = "end") {
    if (ro || i < 0 || i >= blocks.length) return;
    const b = blocks[i];
    if (["divider", "task"].includes(b.type)) {
      const next = caret === "start" ? i + 1 : i - 1;
      if (next >= 0 && next < blocks.length) return edit(next, caret);
      return;
    }
    $$(".blk.editing", root).forEach((x) => x.classList.remove("editing"));
    const el = $(`.blk[data-i="${i}"]`, root);
    if (!el) return;
    editing = i;
    el.classList.add("editing");
    const ta = $(".blk-edit", el);
    ta.value = b.text || "";
    autosize(ta);
    ta.focus();
    const pos = caret === "start" ? 0 : caret === "end" ? ta.value.length : Math.min(caret, ta.value.length);
    ta.setSelectionRange(pos, pos);
    caretPending = null;
  }

  function commit(i, ta) {
    if (!blocks[i]) return;
    if (blocks[i].text !== ta.value) { blocks[i].text = ta.value; changed(); }
  }

  function insertAfter(i, block, focus = true) {
    blocks.splice(i + 1, 0, { id: uid(), text: "", ...block });
    editing = focus ? i + 1 : -1;
    caretPending = "start";
    render();
    changed();
  }

  function setType(i, type) {
    const b = blocks[i];
    b.type = type;
    if (type !== "todo") delete b.checked;
    if (type === "divider") {
      b.text = "";
      if (!blocks[i + 1]) blocks.push({ id: uid(), type: "p", text: "" });
      editing = i + 1;
      caretPending = "start";
    } else {
      editing = i;
      caretPending = "end";
    }
    render();
    changed();
  }

  function slashMenu(i, ta) {
    popMenu(ta, BLOCKS.map((x) => ({ value: x.type, html: `${icons[x.icon]}<span>${x.label}</span><span class="muted" style="margin-left:auto;font-size:11.5px">${esc(x.hint)}</span>`, text: `${x.label} ${x.hint}` })), (type) => {
      blocks[i].text = (blocks[i].text || "").replace(/\/$/, "");
      if (type === "task") return pickTask(i, ta);
      if (type === "image") return pickImage(i);
      setType(i, type);
    }, { search: true, placeholder: "Tipo de bloque…" });
  }

  function pickTask(i, anchor) {
    const opts2 = [{ value: "__new", html: `${icons.plus}<span>Crear tarea nueva con este texto</span>` },
      ...store.tasks.filter((t) => t.status !== "done").concat(store.tasks.filter((t) => t.status === "done"))
        .map((t) => ({ value: t.id, html: `${statusChip(t.status)}<span class="key">${esc(store.taskKey(t))}</span><span>${esc(t.title)}</span>`, text: `${store.taskKey(t)} ${t.title}` }))];
    popMenu(anchor, opts2, async (v) => {
      let id = v;
      if (v === "__new") {
        const title = (blocks[i].text || "").trim() || "Nueva tarea";
        try { id = (await store.createTask({ title, project_id: opts.projectId || null })).id; } catch (e) { return toastError(e); }
      }
      blocks[i] = { id: blocks[i].id, type: "task", text: "", task_id: id };
      if (!blocks[i + 1]) blocks.push({ id: uid(), type: "p", text: "" });
      editing = i + 1;
      caretPending = "start";
      render();
      changed();
    }, { search: true, placeholder: "Busca una tarea por clave o título…" });
  }

  function pickImage(i) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = () => input.files[0] && insertImage(i, input.files[0], true);
    input.click();
  }

  async function insertImage(i, file, replace = false) {
    if (!opts.pageId) return;
    try {
      const f = await upload(`/api/pages/${opts.pageId}/attachments`, file);
      const block = { id: uid(), type: "image", text: "", file_id: f.id };
      if (replace && !blocks[i].text) blocks[i] = block;
      else blocks.splice(i + 1, 0, block);
      editing = -1;
      render();
      changed();
    } catch (e) { toastError(e); }
  }

  function blockMenu(i, anchor) {
    popMenu(anchor, [
      { label: "Convertir en" },
      ...BLOCKS.filter((x) => !["task", "image"].includes(x.type)).map((x) => ({ value: "t:" + x.type, html: `${icons[x.icon]}${x.label}`, selected: blocks[i].type === x.type })),
      { sep: true },
      { value: "up", html: `${icons.chevronLeft.replace("<svg", '<svg style="transform:rotate(90deg)"')}Subir` },
      { value: "down", html: `${icons.chevronLeft.replace("<svg", '<svg style="transform:rotate(-90deg)"')}Bajar` },
      { value: "dup", html: `${icons.copy}Duplicar` },
      { value: "del", html: `${icons.trash}Eliminar`, danger: true },
    ], (v) => {
      if (v.startsWith("t:")) return setType(i, v.slice(2));
      if (v === "up" && i > 0) [blocks[i - 1], blocks[i]] = [blocks[i], blocks[i - 1]];
      if (v === "down" && i < blocks.length - 1) [blocks[i + 1], blocks[i]] = [blocks[i], blocks[i + 1]];
      if (v === "dup") blocks.splice(i + 1, 0, { ...blocks[i], id: uid() });
      if (v === "del") { blocks.splice(i, 1); if (!blocks.length) blocks.push({ id: uid(), type: "p", text: "" }); }
      editing = -1;
      render();
      changed();
    });
  }

  function onKey(e, i, ta) {
    const b = blocks[i];
    const pos = ta.selectionStart, end = ta.selectionEnd;
    if ((e.ctrlKey || e.metaKey) && ["b", "i"].includes(e.key.toLowerCase())) {
      e.preventDefault();
      const mark = e.key.toLowerCase() === "b" ? "**" : "*";
      ta.setRangeText(`${mark}${ta.value.slice(pos, end)}${mark}`, pos, end, "end");
      if (pos === end) ta.setSelectionRange(pos + mark.length, pos + mark.length);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && b.type !== "code" && b.type !== "image") {
      e.preventDefault();
      if (LISTS.has(b.type) && !ta.value) { b.text = ""; return setType(i, "p"); }
      const after = ta.value.slice(end);
      b.text = ta.value.slice(0, pos);
      insertAfter(i, { type: LISTS.has(b.type) ? b.type : "p", text: after });
      return;
    }
    if (e.key === "Enter" && b.type === "code" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      commit(i, ta);
      insertAfter(i, { type: "p" });
      return;
    }
    if (e.key === "Backspace" && pos === 0 && end === 0) {
      if (b.type !== "p" && b.type !== "image") { e.preventDefault(); b.text = ta.value; return setType(i, "p"); }
      if (i > 0) {
        e.preventDefault();
        const prev = blocks[i - 1];
        if (["divider", "task", "image"].includes(prev.type)) { blocks.splice(i - 1, 1); editing = i - 1; caretPending = "start"; b.text = ta.value; render(); changed(); return; }
        const join = prev.text.length;
        prev.text += ta.value;
        blocks.splice(i, 1);
        editing = i - 1;
        caretPending = join;
        render();
        changed();
      }
      return;
    }
    if (e.key === "ArrowUp" && !ta.value.slice(0, pos).includes("\n") && i > 0) { e.preventDefault(); commit(i, ta); edit(i - 1, "end"); return; }
    if (e.key === "ArrowDown" && !ta.value.slice(end).includes("\n") && i < blocks.length - 1) { e.preventDefault(); commit(i, ta); edit(i + 1, "start"); return; }
    if (e.key === "Escape") { e.preventDefault(); ta.blur(); }
  }

  function onInput(i, ta) {
    autosize(ta);
    const b = blocks[i];
    if (b.type === "p" || LISTS.has(b.type)) {
      if (ta.value === "---") { b.text = ""; return setType(i, "divider"); }
      for (const [re, type] of SHORTCUTS) {
        if (re.test(ta.value) && b.type !== type) { b.text = ""; ta.value = ""; return setType(i, type); }
      }
    }
    if (ta.value === "/" || /\s\/$/.test(ta.value)) { b.text = ta.value; slashMenu(i, ta); return; }
    b.text = ta.value;
    changed();
  }

  function bindBlock(el) {
    const i = Number(el.dataset.i);
    const view = $(".blk-view", el);
    const ta = $(".blk-edit", el);
    $("[data-open-task]", el)?.addEventListener("click", () => opts.onOpenTask?.(Number(el.querySelector("[data-open-task]").dataset.openTask)));
    $$(".blk-view a.task-ref", el).forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); opts.onOpenTask?.(Number(a.dataset.task)); }));
    $$(".blk-view a[target=_blank]", el).forEach((a) => a.addEventListener("click", (e) => e.stopPropagation()));
    const chk = $(".blk-check", el);
    if (chk && !ro) chk.onchange = () => { blocks[i].checked = chk.checked; el.classList.toggle("checked", chk.checked); changed(); };
    if (ro || !ta) return;
    view.addEventListener("mousedown", (e) => { if (e.target.closest("a, button, input")) return; e.preventDefault(); edit(i, "end"); });
    view.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); edit(i, "end"); } });
    ta.addEventListener("keydown", (e) => onKey(e, i, ta));
    ta.addEventListener("input", () => onInput(i, ta));
    ta.addEventListener("paste", (e) => {
      const img = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith("image/"));
      if (img) { e.preventDefault(); commit(i, ta); insertImage(i, img); }
    });
    ta.addEventListener("blur", () => {
      setTimeout(() => {
        if (document.activeElement === ta || !el.isConnected) return;
        commit(i, ta);
        el.classList.remove("editing");
        if (editing === i) editing = -1;
        $(".blk-view", el).innerHTML = viewHtml(blocks[i], i);
        $$(".blk-view a.task-ref", el).forEach((a) => a.addEventListener("click", (ev) => { ev.preventDefault(); ev.stopPropagation(); opts.onOpenTask?.(Number(a.dataset.task)); }));
      }, 120);
    });
    const handle = $(".blk-handle", el);
    handle.onclick = () => { if (editing >= 0) { const t = $(`.blk[data-i="${editing}"] .blk-edit`, root); if (t) commit(editing, t); } blockMenu(i, handle); };
    handle.addEventListener("dragstart", (e) => { dragFrom = i; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(i)); el.classList.add("dragging"); });
    handle.addEventListener("dragend", () => { el.classList.remove("dragging"); $$(".blk.drop-above, .blk.drop-below", root).forEach((x) => x.classList.remove("drop-above", "drop-below")); });
  }

  function bind() {
    $$(".blk", root).forEach(bindBlock);
    if (ro) return;
    const ed = $(".editor", root);
    ed.addEventListener("dragover", (e) => {
      if (dragFrom === null) return;
      e.preventDefault();
      const target = e.target.closest(".blk");
      $$(".blk.drop-above, .blk.drop-below", root).forEach((x) => x.classList.remove("drop-above", "drop-below"));
      if (target) { const r = target.getBoundingClientRect(); target.classList.add(e.clientY < r.top + r.height / 2 ? "drop-above" : "drop-below"); }
    });
    ed.addEventListener("drop", (e) => {
      if (dragFrom === null) return;
      e.preventDefault();
      const target = e.target.closest(".blk");
      if (target) {
        let to = Number(target.dataset.i) + (target.classList.contains("drop-below") ? 1 : 0);
        const [moved] = blocks.splice(dragFrom, 1);
        if (dragFrom < to) to--;
        blocks.splice(to, 0, moved);
        changed();
      }
      dragFrom = null;
      editing = -1;
      render();
    });
    $(".editor-tail", root).onclick = () => {
      const last = blocks[blocks.length - 1];
      if (last && last.type === "p" && !last.text) edit(blocks.length - 1, "end");
      else insertAfter(blocks.length - 1, { type: "p" });
    };
  }

  render();
  return {
    get blocks() { return blocks; },
    isEditing: () => editing >= 0 || root.contains(document.activeElement),
    setBlocks(next) { blocks = next.map((b) => ({ id: b.id || uid(), ...b })); editing = -1; render(); },
    focusStart() { edit(0, "end"); },
    refresh() { if (editing < 0) render(); },
    destroy() { closePop(); },
  };
}

/** Exporta bloques a Markdown. */
export function toMarkdown(title, blocks) {
  let n = 0;
  const lines = [`# ${title}`, ""];
  for (const b of blocks) {
    n = b.type === "number" ? n + 1 : 0;
    const t = b.text || "";
    const map = {
      p: t, h1: `# ${t}`, h2: `## ${t}`, h3: `### ${t}`, bullet: `- ${t}`, number: `${n}. ${t}`,
      todo: `- [${b.checked ? "x" : " "}] ${t}`, quote: `> ${t}`, callout: `> **Nota:** ${t}`, code: "```\n" + t + "\n```", divider: "---",
      task: (() => { const x = store.task(b.task_id); return x ? `- ${store.taskKey(x)} · ${x.title}` : ""; })(),
      image: b.file_id ? `![${t}](${location.origin}/api/files/${b.file_id})` : "",
    };
    lines.push(map[b.type] ?? t);
    if (!["bullet", "number", "todo"].includes(b.type)) lines.push("");
  }
  return lines.join("\n");
}
