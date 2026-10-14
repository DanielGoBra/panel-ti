import { get, post } from "./api.js";
import { icons } from "./icons.js";
import { store } from "./store.js";
import { openTask } from "./taskpanel.js";
import { avatar, closePop, toastError } from "./ui.js";
import { $, $$, el, esc, timeAgo } from "./util.js";

const KIND_ICON = {
  assigned: "user", mention: "comment", comment: "comment", due_soon: "calendar", overdue: "calendar", blocked: "blocked",
  resolved: "done", approval_requested: "approve", approval_decided: "approve", sla_risk: "timer", sla_breach: "timer",
  recurring: "repeat", inbound: "mail",
};

let panel = null;

export function closeNotifications() { panel?.remove(); panel = null; document.removeEventListener("mousedown", outside, true); }
function outside(e) { if (panel && !panel.contains(e.target) && !e.target.closest("#bell-btn")) closeNotifications(); }

export async function toggleNotifications(anchor) {
  if (panel) return closeNotifications();
  closePop();
  panel = el(`<div class="notif-panel" role="dialog" aria-label="Avisos"><div class="notif-head"><b>Avisos</b><button class="btn sm ghost" data-all>Marcar todo como leído</button></div><div class="notif-list"><div class="skeleton" style="height:60px;margin:10px"></div></div></div>`);
  document.body.appendChild(panel);
  const r = anchor.getBoundingClientRect();
  panel.style.top = `${r.bottom + 6}px`;
  panel.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
  setTimeout(() => document.addEventListener("mousedown", outside, true));
  $("[data-all]", panel).onclick = async () => {
    try { await post("/api/notifications/read", { all: true }); store.unread = 0; store.emit("unread"); draw((await get("/api/notifications")).items); } catch (e) { toastError(e); }
  };
  try { draw((await get("/api/notifications")).items); } catch (e) { toastError(e); }
}

function draw(items) {
  if (!panel) return;
  const list = $(".notif-list", panel);
  list.innerHTML = items.length ? items.map((n) => `<button class="notif${n.read_at ? "" : " unread"}" data-id="${n.id}" data-task="${n.task_id || ""}">
      <span class="notif-ic">${icons[KIND_ICON[n.kind]] || icons.bell}</span>
      <span class="notif-body"><b>${esc(n.title)}</b><span>${esc(n.body)}</span><time>${n.actor && n.actor !== "Sistema" ? `${esc(n.actor)} · ` : ""}${esc(timeAgo(n.created_at))}</time></span>
    </button>`).join("") : `<div class="empty" style="padding:28px 16px">${icons.bell}<p>No tienes avisos. Aquí verás asignaciones, menciones, vencimientos y alertas de SLA.</p></div>`;
  $$(".notif", list).forEach((b) => b.onclick = async () => {
    if (b.classList.contains("unread")) {
      post("/api/notifications/read", { ids: [Number(b.dataset.id)] }).catch(() => {});
      b.classList.remove("unread");
      store.unread = Math.max(0, store.unread - 1);
      store.emit("unread");
    }
    if (b.dataset.task) { closeNotifications(); openTask(b.dataset.task); }
  });
}

export { avatar };
