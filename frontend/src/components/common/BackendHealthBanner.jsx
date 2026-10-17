import { useBackendHealth } from "../../hooks/useBackendHealth";

/**
 * Renders nothing when the backend is reachable. When it isn't, shows a
 * fixed, unmissable banner explaining exactly what's wrong and what to
 * check, so "Network Error" never has to be diagnosed via DevTools again.
 */
export default function BackendHealthBanner() {
  const { isReachable, hasCheckedOnce } = useBackendHealth();

  if (!hasCheckedOnce || isReachable) return null;

  return (
    <div className="fixed top-0 inset-x-0 z-50 bg-warning text-white text-sm px-4 py-2.5 text-center">
      <strong>Can't reach the backend server.</strong> Make sure{" "}
      <code className="bg-white/20 rounded px-1">python manage.py runserver</code> is running at{" "}
      <code className="bg-white/20 rounded px-1">http://localhost:8000</code>, then this banner will disappear
      automatically.
    </div>
  );
}
