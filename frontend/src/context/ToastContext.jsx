import { createContext, useCallback, useContext, useState } from "react";
import { XIcon } from "../components/common/UiGlyphs.jsx";

const ToastContext = createContext(null);
let idCounter = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (message, variant = "success") => {
      const id = ++idCounter;
      setToasts((prev) => [...prev, { id, message, variant }]);
      setTimeout(() => dismiss(id), 5000);
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 w-80">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className={
              "rounded-md shadow-popover border px-4 py-3 text-sm bg-white flex items-start gap-2 animate-[fadeIn_0.15s_ease-out] " +
              (toast.variant === "error"
                ? "border-warning text-warning"
                : toast.variant === "info"
                ? "border-navy-300 text-navy-700"
                : "border-success text-success")
            }
          >
            <span className="flex-1 text-ink">{toast.message}</span>
            <button
              onClick={() => dismiss(toast.id)}
              className="text-ink-faint hover:text-ink"
              aria-label="Dismiss notification"
            >
              <XIcon width={14} height={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
