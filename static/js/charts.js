// Gráficos SVG sin dependencias: marcas finas, rejilla tenue, tooltip al pasar
// el cursor y tabla de datos accesible. Los colores salen de variables CSS para
// que el modo oscuro use sus propios tonos validados.
import { esc } from "./util.js";

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function niceMax(v, ticks = 4) {
  if (v <= 0) return ticks;
  const raw = v / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  return { max: step * ticks, step };
}

function tipBox(container) {
  let tip = container.querySelector(".viz-tip");
  if (!tip) { tip = document.createElement("div"); tip.className = "viz-tip"; container.appendChild(tip); }
  return tip;
}
function placeTip(container, tip, x, y) {
  const cw = container.clientWidth;
  const tw = tip.offsetWidth;
  let left = x + 14;
  if (left + tw > cw - 4) left = x - tw - 14;
  tip.style.left = `${Math.max(4, left)}px`;
  tip.style.top = `${Math.max(0, y - tip.offsetHeight / 2)}px`;
}

function observe(container, draw) {
  draw();
  if (container._ro) container._ro.disconnect();
  let w = container.clientWidth;
  container._ro = new ResizeObserver(() => { if (Math.abs(container.clientWidth - w) > 4) { w = container.clientWidth; draw(); } });
  container._ro.observe(container);
}

export function dataTable(headers, rows) {
  return `<table class="data-table"><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

/**
 * Líneas temporales con cruceta.
 * series: [{ key, label, color (var css), area? }]
 * points: [{ label, tooltipTitle, [key]: number }]
 */
export function lineChart(container, { series, points, height = 220 }) {
  const draw = () => {
    const W = Math.max(280, container.clientWidth - 36);
    const H = height;
    const m = { t: 12, r: 14, b: 26, l: 30 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const maxV = Math.max(1, ...points.flatMap((p) => series.map((s) => p[s.key])));
    const { max, step } = niceMax(maxV);
    const x = (i) => m.l + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw);
    const y = (v) => m.t + ih - (v / max) * ih;
    let g = "";
    for (let v = 0; v <= max + 1e-9; v += step) {
      g += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" stroke="${v === 0 ? css("--axis") : css("--grid")}" stroke-width="1"/>`;
      g += `<text x="${m.l - 8}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="${css("--muted")}" class="num">${Math.round(v)}</text>`;
    }
    const every = Math.ceil(points.length / Math.max(2, Math.floor(iw / 70)));
    points.forEach((p, i) => {
      if (i % every === 0 || i === points.length - 1) {
        const anchor = i === 0 ? "start" : i === points.length - 1 ? "end" : "middle";
        g += `<text x="${x(i)}" y="${H - 6}" text-anchor="${anchor}" font-size="11" fill="${css("--muted")}">${esc(p.label)}</text>`;
      }
    });
    series.forEach((s) => {
      const col = css(s.color);
      const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[s.key]).toFixed(1)}`).join("");
      if (s.area) g += `<path d="${d}L${x(points.length - 1)},${y(0)}L${x(0)},${y(0)}Z" fill="${col}" opacity="0.10"/>`;
      g += `<path d="${d}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
      const last = points.length - 1;
      g += `<circle cx="${x(last)}" cy="${y(points[last][s.key])}" r="4" fill="${col}" stroke="${css("--surface")}" stroke-width="2"/>`;
    });
    g += `<line class="xh" x1="0" x2="0" y1="${m.t}" y2="${m.t + ih}" stroke="${css("--axis")}" stroke-width="1" visibility="hidden"/>`;
    g += `<g class="xh-dots"></g>`;
    g += `<rect class="hit" x="${m.l}" y="${m.t}" width="${iw}" height="${ih}" fill="transparent"/>`;

    container.querySelector("svg")?.remove();
    const holder = document.createElement("div");
    holder.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(series.map((s) => s.label).join(" y "))} por semana">${g}</svg>`;
    const svg = holder.firstChild;
    container.prepend(svg);

    const tip = tipBox(container);
    const xh = svg.querySelector(".xh"), dots = svg.querySelector(".xh-dots"), hit = svg.querySelector(".hit");
    const move = (ev) => {
      const r = svg.getBoundingClientRect();
      const sx = ((ev.clientX - r.left) / r.width) * W;
      const i = Math.max(0, Math.min(points.length - 1, Math.round(((sx - m.l) / iw) * (points.length - 1))));
      const p = points[i];
      xh.setAttribute("x1", x(i)); xh.setAttribute("x2", x(i)); xh.setAttribute("visibility", "visible");
      dots.innerHTML = series.map((s) => `<circle cx="${x(i)}" cy="${y(p[s.key])}" r="4.5" fill="${css(s.color)}" stroke="${css("--surface")}" stroke-width="2"/>`).join("");
      tip.innerHTML = `<div class="tt-title">${esc(p.tooltipTitle || p.label)}</div>` +
        series.map((s) => `<div class="tt-row"><i style="background:${css(s.color)}"></i>${esc(s.label)}<b>${p[s.key]}</b></div>`).join("");
      tip.classList.add("on");
      const cr = container.getBoundingClientRect();
      placeTip(container, tip, (x(i) / W) * r.width + (r.left - cr.left), ev.clientY - cr.top);
    };
    const leave = () => { xh.setAttribute("visibility", "hidden"); dots.innerHTML = ""; tip.classList.remove("on"); };
    hit.addEventListener("mousemove", move);
    hit.addEventListener("mouseleave", leave);
  };
  observe(container, draw);
}

/**
 * Barras horizontales apiladas (una fila por categoría).
 * keys: [{ key, label, color }]
 * rows: [{ label, sub?, [key]: number, onClick? }]
 */
export function stackedBars(container, { keys, rows, labelWidth = 128, barH = 16, gap = 12, extra }) {
  const draw = () => {
    const W = Math.max(280, container.clientWidth - 36);
    const rowH = barH + gap;
    const H = rows.length * rowH + 4;
    const tipW = 34;
    const iw = W - labelWidth - tipW;
    const max = Math.max(1, ...rows.map((r) => keys.reduce((a, k) => a + (r[k.key] || 0), 0)));
    let g = "";
    rows.forEach((r, ri) => {
      const y0 = ri * rowH + 2;
      const total = keys.reduce((a, k) => a + (r[k.key] || 0), 0);
      g += `<g class="row" data-i="${ri}">`;
      g += `<rect x="0" y="${y0 - gap / 2 + 1}" width="${W}" height="${rowH}" fill="transparent"/>`;
      g += `<text x="0" y="${y0 + barH / 2 + 4}" font-size="12.5" fill="${css("--text")}">${esc(r.label.length > 18 ? r.label.slice(0, 17) + "…" : r.label)}</text>`;
      let x = labelWidth;
      const segs = keys.filter((k) => r[k.key] > 0);
      segs.forEach((k, si) => {
        const w = (r[k.key] / max) * iw;
        const last = si === segs.length - 1;
        const gw = Math.max(1, w - (last ? 0 : 2));
        if (last && gw > 4) {
          g += `<path d="M${x},${y0}h${gw - 4}a4,4 0 0 1 4,4v${barH - 8}a4,4 0 0 1-4,4h-${gw - 4}z" fill="${css(k.color)}"/>`;
        } else {
          g += `<rect x="${x}" y="${y0}" width="${gw}" height="${barH}" fill="${css(k.color)}"/>`;
        }
        x += w;
      });
      if (!total) g += `<rect x="${labelWidth}" y="${y0 + barH / 2 - 0.5}" width="${iw}" height="1" fill="${css("--grid")}"/>`;
      g += `<text x="${x + 8}" y="${y0 + barH / 2 + 4}" font-size="12" font-weight="600" fill="${css("--text-2")}" class="num">${total}</text>`;
      g += `</g>`;
    });
    container.querySelector("svg")?.remove();
    const holder = document.createElement("div");
    holder.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img">${g}</svg>`;
    const svg = holder.firstChild;
    container.prepend(svg);
    const tip = tipBox(container);
    svg.querySelectorAll(".row").forEach((rowEl) => {
      const r = rows[Number(rowEl.dataset.i)];
      if (r.onClick) { rowEl.style.cursor = "pointer"; rowEl.addEventListener("click", r.onClick); }
      rowEl.addEventListener("mousemove", (ev) => {
        const total = keys.reduce((a, k) => a + (r[k.key] || 0), 0);
        tip.innerHTML = `<div class="tt-title">${esc(r.label)}</div>` +
          keys.map((k) => `<div class="tt-row"><i style="background:${css(k.color)}"></i>${esc(k.label)}<b>${r[k.key] || 0}</b></div>`).join("") +
          `<div class="tt-row" style="margin-top:3px">Total<b>${total}</b></div>` + (extra ? extra(r) : "");
        tip.classList.add("on");
        const cr = container.getBoundingClientRect();
        placeTip(container, tip, ev.clientX - cr.left, ev.clientY - cr.top);
      });
      rowEl.addEventListener("mouseleave", () => tip.classList.remove("on"));
    });
  };
  observe(container, draw);
}

/** Barras simples horizontales de una sola serie con valor en la punta. */
export function simpleBars(container, { rows, color = "--series-1", labelWidth = 96, barH = 14, gap = 12, fmt = (v) => v }) {
  const draw = () => {
    const W = Math.max(240, container.clientWidth - 2);
    const rowH = barH + gap;
    const H = rows.length * rowH;
    const iw = W - labelWidth - 76;
    const max = Math.max(1, ...rows.map((r) => r.value));
    let g = "";
    rows.forEach((r, i) => {
      const y0 = i * rowH + 2;
      const w = Math.max(r.value ? 3 : 0, (r.value / max) * iw);
      g += `<g class="row" data-i="${i}"><rect x="0" y="${y0 - gap / 2}" width="${W}" height="${rowH}" fill="transparent"/>`;
      g += `<text x="0" y="${y0 + barH / 2 + 4}" font-size="12.5" fill="${css("--text")}">${esc(r.label)}</text>`;
      g += `<rect x="${labelWidth}" y="${y0 + barH / 2 - 0.5}" width="${iw}" height="1" fill="${css("--grid")}"/>`;
      if (w > 4) g += `<path d="M${labelWidth},${y0}h${w - 4}a4,4 0 0 1 4,4v${barH - 8}a4,4 0 0 1-4,4h-${w - 4}z" fill="${css(r.color || color)}"/>`;
      else if (w) g += `<rect x="${labelWidth}" y="${y0}" width="${w}" height="${barH}" fill="${css(r.color || color)}"/>`;
      g += `<text x="${labelWidth + w + 8}" y="${y0 + barH / 2 + 4}" font-size="12" font-weight="600" fill="${css("--text-2")}" class="num">${esc(fmt(r.value, r))}</text></g>`;
    });
    container.querySelector("svg")?.remove();
    const holder = document.createElement("div");
    holder.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img">${g}</svg>`;
    container.prepend(holder.firstChild);
  };
  observe(container, draw);
}
