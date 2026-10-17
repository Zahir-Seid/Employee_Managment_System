import { useEffect, useState } from "react";
import axios from "axios";

const CHECK_INTERVAL_MS = 15000;
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api";

/**
 * Polls the backend's no-auth health endpoint so connectivity problems
 * are surfaced immediately and unmistakably (a persistent banner) rather
 * than only showing up as a generic "Network Error" toast the next time
 * someone happens to submit a form. Uses a bare axios call (not the
 * shared api client) so it never triggers the JWT refresh/redirect logic.
 */
export function useBackendHealth() {
  const [isReachable, setIsReachable] = useState(true);
  const [hasCheckedOnce, setHasCheckedOnce] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        await axios.get(`${API_BASE_URL}/health/`, { timeout: 5000 });
        if (!cancelled) setIsReachable(true);
      } catch (error) {
        // A response (even an error one, e.g. 404) means the backend is
        // genuinely up and reachable, it just doesn't have this route,
        // most likely because an older copy of the project is running.
        // Only a true network failure (no response at all) means "down."
        if (!cancelled) setIsReachable(!!error?.response);
      } finally {
        if (!cancelled) setHasCheckedOnce(true);
      }
    }

    check();
    const interval = setInterval(check, CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return { isReachable, hasCheckedOnce };
}
