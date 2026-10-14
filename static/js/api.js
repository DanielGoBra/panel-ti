export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

const hooks = { onUnauthorized: null, onRevision: null };
export const setApiHooks = (h) => Object.assign(hooks, h);

async function handle(res) {
  let data = null;
  try { data = await res.json(); } catch (e) { /* respuesta vacía */ }
  const rev = res.headers.get("X-Revision");
  if (rev && hooks.onRevision) hooks.onRevision(Number(rev));
  if (res.status === 401 && hooks.onUnauthorized && !res.url.includes("/api/auth/")) hooks.onUnauthorized();
  if (!res.ok) throw new ApiError((data && data.error) || `Error ${res.status}`, res.status, data);
  return data;
}

export async function api(url, { method = "GET", body } = {}) {
  const res = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-Requested-With": "panel-ti" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return handle(res);
}

export async function upload(url, file, onProgress) {
  const fd = new FormData();
  fd.append("file", file, file.name || "captura.png");
  if (!onProgress) {
    const res = await fetch(url, { method: "POST", body: fd, credentials: "same-origin", headers: { "X-Requested-With": "panel-ti" } });
    return handle(res);
  }
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("X-Requested-With", "panel-ti");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch (e) { /* sin cuerpo */ }
      const rev = xhr.getResponseHeader("X-Revision");
      if (rev && hooks.onRevision) hooks.onRevision(Number(rev));
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new ApiError((data && data.error) || `Error ${xhr.status}`, xhr.status, data));
    };
    xhr.onerror = () => reject(new ApiError("Sin conexión con el servidor", 0));
    xhr.send(fd);
  });
}

export const get = (url) => api(url);
export const post = (url, body) => api(url, { method: "POST", body });
export const put = (url, body) => api(url, { method: "PUT", body });
export const del = (url) => api(url, { method: "DELETE" });
