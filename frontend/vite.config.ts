import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The backend's APP_ORIGIN must match exactly, so never drift to another port.
  server: {
    port: 3000,
    strictPort: true,
    // siteConfig reads this one backend file. Never allow the whole backend folder.
    fs: { allow: [".", "../backend/app/intake/form_config.json"] },
  },
  test: {
    environment: "jsdom",
    env: {
      VITE_API_URL: "https://api.test.invalid",
      VITE_NEON_AUTH_URL: "https://auth.test.invalid",
    },
  },
});
