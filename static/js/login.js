import { api } from "./api.js";
import { $, esc } from "./util.js";

const ERRORS = {
  sso: "No se pudo completar el inicio de sesión con Microsoft. Inténtalo de nuevo.",
  noaccount: "Tu cuenta de Microsoft no tiene acceso. Pide a administración que te dé de alta.",
  disabled: "Tu cuenta está desactivada. Contacta con administración.",
};

const MS_ICON = `<svg viewBox="0 0 21 21" width="16" height="16" aria-hidden="true"><rect x="1" y="1" width="9" height="9" fill="#f25022"/><rect x="11" y="1" width="9" height="9" fill="#7fba00"/><rect x="1" y="11" width="9" height="9" fill="#00a4ef"/><rect x="11" y="11" width="9" height="9" fill="#ffb900"/></svg>`;

/** Muestra el acceso y resuelve cuando hay sesión iniciada. */
export function showAuth(status) {
  const root = $("#auth");
  $("#app").classList.add("hidden");
  root.classList.remove("hidden");
  const hashErr = (location.hash.match(/error=(\w+)/) || [])[1];
  return new Promise((resolve) => {
    const render = (mode, err = "") => {
      const setup = mode === "setup";
      root.innerHTML = `<div class="auth-card">
        <div class="auth-brand"><span class="ws-mark"><svg viewBox="0 0 24 24" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="6" height="14" rx="1.5"/><rect x="14" y="5" width="6" height="8" rx="1.5"/></svg></span>Panel TI</div>
        <h1>${setup ? "Crea la cuenta de administración" : "Inicia sesión"}</h1>
        <p class="auth-sub">${setup ? "Es la primera vez que se abre este espacio. Esta cuenta podrá invitar al resto del equipo." : "Usa tu correo corporativo."}</p>
        ${status.sso && !setup ? `<a class="btn auth-ms" href="/auth/microsoft/login">${MS_ICON}Continuar con Microsoft</a><div class="auth-sep"><span>o con contraseña</span></div>` : ""}
        <form novalidate>
          ${setup ? `<label class="field"><span>Nombre y apellidos</span><input class="input" name="name" autocomplete="name" required></label>` : ""}
          <label class="field"><span>Correo</span><input class="input" name="email" type="email" autocomplete="username" required autofocus></label>
          <label class="field"><span>Contraseña</span><input class="input" name="password" type="password" autocomplete="${setup ? "new-password" : "current-password"}" required minlength="8"></label>
          ${setup ? "" : `<label class="auth-check"><input type="checkbox" name="remember" class="chk" checked> Mantener la sesión en este equipo</label>`}
          <div class="form-error${err ? "" : " hidden"}" role="alert">${esc(err)}</div>
          <button class="btn primary auth-submit" type="submit">${setup ? "Crear cuenta y entrar" : "Entrar"}</button>
        </form>
        ${setup ? "" : `<p class="auth-foot">¿Has olvidado la contraseña? Pide a administración que la restablezca.</p>`}
      </div>`;
      const form = $("form", root);
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
    render(status.needs_setup ? "setup" : "login", ERRORS[hashErr] || "");
  });
}
