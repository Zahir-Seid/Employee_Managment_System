import { clearPersistedFilters } from "../utils/persistentFilters.js";
import axios from "axios";

const ACCESS_TOKEN_KEY = "ems_access_token";
const REFRESH_TOKEN_KEY = "ems_refresh_token";

// Talks to Django directly, bypassing Vite's dev proxy. On this
// particular machine, requests routed through the Vite proxy (browser ->
// Node -> Django) were getting intercepted and corrupted into HTTPS
// somewhere in the Node-mediated hop, while direct browser requests and
// the backend itself were both fine. Removing that hop sidesteps
// whatever is intercepting it (most likely local antivirus/security
// software doing traffic inspection on Node's outbound connections).
// The base URL comes from VITE_API_BASE_URL: .env.development points at
// localhost:8000, and production builds use the same-origin /api (Nginx).
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api";

export const tokenStorage = {
  getAccess: () => localStorage.getItem(ACCESS_TOKEN_KEY),
  getRefresh: () => localStorage.getItem(REFRESH_TOKEN_KEY),
  set: (access, refresh) => {
    localStorage.setItem(ACCESS_TOKEN_KEY, access);
    if (refresh) localStorage.setItem(REFRESH_TOKEN_KEY, refresh);
  },
  clear: () => {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    // Filters are remembered only for the length of the session.
    clearPersistedFilters();
  },
};

const api = axios.create({
  baseURL: API_BASE_URL,
});

api.interceptors.request.use((config) => {
  const token = tokenStorage.getAccess();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

let isRefreshing = false;
let refreshQueue = [];

function resolveQueue(error, token) {
  refreshQueue.forEach(({ resolve, reject }) => {
    if (error) reject(error);
    else resolve(token);
  });
  refreshQueue = [];
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry && tokenStorage.getRefresh()) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          refreshQueue.push({ resolve, reject });
        }).then((token) => {
          originalRequest.headers.Authorization = `Bearer ${token}`;
          return api(originalRequest);
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const { data } = await axios.post(`${API_BASE_URL}/auth/refresh/`, {
          refresh: tokenStorage.getRefresh(),
        });
        tokenStorage.set(data.access, data.refresh);
        resolveQueue(null, data.access);
        originalRequest.headers.Authorization = `Bearer ${data.access}`;
        return api(originalRequest);
      } catch (refreshError) {
        resolveQueue(refreshError, null);
        tokenStorage.clear();
        window.location.href = "/login";
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

export default api;

