import { store } from "./store.js";

export class ApiError extends Error {}

export async function api(url, { method = "GET", body } = {}) {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", "X-User": encodeURIComponent(store.user || "") },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* respuesta vacía */ }
  if (!res.ok) throw new ApiError((data && data.error) || `Error ${res.status}`);
  return data;
}

export const get = (url) => api(url);
export const post = (url, body) => api(url, { method: "POST", body });
export const put = (url, body) => api(url, { method: "PUT", body });
export const del = (url) => api(url, { method: "DELETE" });
