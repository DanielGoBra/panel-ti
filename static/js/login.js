import { api } from "./api.js";
import { $, esc } from "./util.js";

const ERRORS = {
  sso: "No se pudo completar el inicio de sesión. Inténtalo de nuevo.",
  notallowed: "Esa cuenta no tiene acceso a este espacio. Entra con la cuenta autorizada o pide acceso a administración.",
  noaccount: "Tu cuenta no tiene acceso. Pide a administración que te dé de alta.",
  disabled: "Tu cuenta está desactivada. Contacta con administración.",
};

const GOOGLE_ICON = `<svg viewBox="0 0 48 48" width="16" height="16" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>`;
const MS_ICON = `<svg viewBox="0 0 21 21" width="16" height="16" aria-hidden="true"><rect x="1" y="1" width="9" height="9" fill="#f25022"/><rect x="11" y="1" width="9" height="9" fill="#7fba00"/><rect x="1" y="11" width="9" height="9" fill="#00a4ef"/><rect x="11" y="11" width="9" height="9" fill="#ffb900"/></svg>`;

/** Muestra el acceso y resuelve cuando hay sesión iniciada. */
export function showAuth(status) {
  const root = $("#auth");
  $("#app").classList.add("hidden");
  root.classList.remove("hidden");
  const hashErr = (location.hash.match(/error=(\w+)/) || [])[1];
  const providers = status.providers || (status.sso ? [{ id: "microsoft", label: "Microsoft" }] : []);
  return new Promise((resolve) => {
    const render = (mode, err = "") => {
      const setup = mode === "setup";
      root.innerHTML = `<div class="auth-card">
        <div class="auth-brand"><span class="ws-mark"><svg viewBox="0 0 24 24" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="6" height="14" rx="1.5"/><rect x="14" y="5" width="6" height="8" rx="1.5"/></svg></span>Panel TI</div>
        <h1>${setup ? "Crea la cuenta de administración" : "Inicia sesión"}</h1>
        <p class="auth-sub">${setup ? "Es la primera vez que se abre este espacio. Esta cuenta podrá invitar al resto del equipo." : status.password ? "Usa la cuenta con la que te dieron acceso." : "Entra con la cuenta autorizada para este espacio."}</p>
        ${providers.length && !setup ? `${providers.map((p) => `<a class="btn auth-ms" href="/auth/${p.id}/login">${p.id === "google" ? GOOGLE_ICON : MS_ICON}Continuar con ${p.label}</a>`).join("")}${status.password ? `<div class="auth-sep"><span>o con contraseña</span></div>` : ""}` : ""}
        ${!status.password && !providers.length ? `<p class="form-error">No hay ningún método de acceso activo. Configura Google o Microsoft, o activa las contraseñas (PASSWORD_LOGIN=1).</p>` : ""}
        ${status.password || setup ? `<form novalidate>
          ${setup ? `<label class="field"><span>Nombre y apellidos</span><input class="input" name="name" autocomplete="name" required></label>` : ""}
          <label class="field"><span>Correo</span><input class="input" name="email" type="email" autocomplete="username" required autofocus></label>
          <label class="field"><span>Contraseña</span><input class="input" name="password" type="password" autocomplete="${setup ? "new-password" : "current-password"}" required minlength="8"></label>
          ${setup ? "" : `<label class="auth-check"><input type="checkbox" name="remember" class="chk" checked> Mantener la sesión en este equipo</label>`}
          <div class="form-error${err ? "" : " hidden"}" role="alert">${esc(err)}</div>
          <button class="btn primary auth-submit" type="submit">${setup ? "Crear cuenta y entrar" : "Entrar"}</button>
        </form>` : `<div class="form-error${err ? "" : " hidden"}" role="alert" style="margin-top:14px">${esc(err)}</div>`}
        ${setup || !status.password ? "" : `<p class="auth-foot">¿Has olvidado la contraseña? Pide a administración que la restablezca.</p>`}
      </div>`;
      const form = $("form", root);
      if (!form) return;
      setTimeout(() => (setup ? form.name : form.email).focus());
      form.onsubmit = async (e) => {
        e.preventDefault();
        const btn = $("button[type=submit]", form);
        btn.disabled = true;
        const data = Object.fromEntries(new FormData(form));
        data.remember = !!form.remember?.checked;
        try {
          const r = await api(setup ? "/api/auth/setup" : "/api/auth/login", { method: "POST", body: data });
          root.classList.add("hidden");
          root.innerHTML = "";
          if (hashErr) history.replaceState(null, "", "#/inicio");
          resolve(r.user);
        } catch (er) {
          const box = $(".form-error", form);
          box.textContent = er.message;
          box.classList.remove("hidden");
          btn.disabled = false;
          form.password.value = "";
          form.password.focus();
        }
      };
    };
    render(status.needs_setup && status.password !== false ? "setup" : "login", ERRORS[hashErr] || "");
  });
}
