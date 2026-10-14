// Aplica el tema guardado antes de pintar para evitar un destello (script clásico, sin módulos).
try { var t = localStorage.getItem("pti.theme"); if (t) document.documentElement.dataset.theme = t; } catch (e) { /* sin almacenamiento */ }
