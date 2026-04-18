import { getSessionUser, initializeSessionStorage } from "./session";

initializeSessionStorage();
const API_BASE = import.meta.env.VITE_BACKEND_URL || "http://localhost:5000/api";
const BACKEND_URL = API_BASE;

async function request(path, options = {}) {
  let response;
  const currentUser = getSessionUser();

  try {
    response = await fetch(`${API_BASE}${path}`, {
      headers: {
        "Content-Type": "application/json",
        ...(currentUser?.email ? { "x-user-email": currentUser.email } : {}),
        ...(options.headers || {}),
      },
      ...options,
    });
  } catch (networkError) {
    throw new Error(`Cannot reach backend. Make sure backend is running at ${BACKEND_URL}.`);
  }

  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const message =
      typeof data === "object" && data?.message
        ? data.message
        : typeof data === "string" && data.trim()
        ? data.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 180)
        : `Request failed with status ${response.status}.`;
    throw new Error(message);
  }

  return data;
}

export const api = {
  get: (path) => request(path),
  post: (path, body) =>
    request(path, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  put: (path, body) =>
    request(path, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  delete: (path) =>
    request(path, {
      method: "DELETE",
    }),
};

export function getApiBaseUrl() {
  return API_BASE;
}
