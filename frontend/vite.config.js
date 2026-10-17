import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Note: api/client.js connects directly to http://localhost:8000 rather
// than relying on this proxy (see the comment there for why — on some
// machines, requests routed through this proxy were getting intercepted
// and corrupted into HTTPS). The proxy below is kept as a harmless
// fallback/reference but isn't the active code path.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
});
