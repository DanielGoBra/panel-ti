// Texto en línea con un subconjunto de markdown. Siempre se escapa primero:
// solo se generan etiquetas conocidas y enlaces http(s)/mailto.
import { store } from "./store.js";
import { esc } from "./util.js";

const URL_RE = /\b(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])/g;

export function inline(text) {
  let s = esc(text);
  const codes = [];
  s = s.replace(/`([^`\n]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  s = s.replace(/\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:)[^)\s]+)\)/g, (_, l, u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${l}</a>`);
  s = s.replace(URL_RE, (m, u, off, all) => (all.slice(Math.max(0, off - 6), off).includes('href="') || all.slice(off - 1, off) === ">" ? m : `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`));
  s = s.replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>");
  s = s.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, "$1<i>$2</i>");
  s = s.replace(/~~([^~\n]+)~~/g, "<s>$1</s>");
  s = s.replace(/\b([A-Z]{1,6})-(\d+)\b/g, (m) => {
    const t = store.taskByKey(m);
    return t ? `<a class="task-ref" data-task="${t.id}" href="#/tablero?t=${t.id}" title="${esc(t.title)}"><span class="status-dot" data-s="${t.status}"></span>${m}</a>` : m;
  });
  if (s.includes("@")) {
    for (const m of [...store.members].sort((a, b) => b.name.length - a.name.length)) {
      const n = esc(m.name);
      s = s.split(`@${n}`).join(`<span class="mention">@${n}</span>`);
    }
  }
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[Number(i)]}</code>`);
}

/** Bloque de texto con varias líneas (comentarios). */
export const multiline = (text) => String(text || "").split("\n").map(inline).join("<br>");
