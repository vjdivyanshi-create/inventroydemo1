import { getSessionUser, initializeSessionStorage } from "./session";

initializeSessionStorage();
const API_BASE = import.meta.env.VITE_BACKEND_URL || "/api";
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:5000/api";

function getAuthHeaders() {
  const currentUser = getSessionUser();
  return {
    ...(currentUser?.email ? { "x-user-email": currentUser.email } : {}),
  };
}

async function request(path, options = {}) {
  let response;
  const headers = {
    "Content-Type": "application/json",
    ...getAuthHeaders(),
    ...(options.headers || {}),
  };

  try {
    response = await fetch(`${API_BASE}${path}`, {
      headers,
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

export async function downloadFile(path, filename) {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: "GET",
      headers: getAuthHeaders(),
    });
  } catch (networkError) {
    throw new Error(`Cannot reach backend. Make sure backend is running at ${BACKEND_URL}.`);
  }

  if (!response.ok) {
    const contentType = response.headers.get("content-type") || "";
    const message = contentType.includes("application/json")
      ? (await response.json()).message
      : await response.text();
    throw new Error(message || `Request failed with status ${response.status}.`);
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
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
