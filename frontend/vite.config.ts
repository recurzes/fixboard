import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";
import { siteConfig } from "./src/shared/lib/siteConfig";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      // Warns and never fails, because the client chose to launch with the placeholder (A5).
      name: "emergency-number-warning",
      // On the dev server and the build, not in Vitest's output.
      apply: (_, { mode }) => mode !== "test",
      buildStart() {
        if (siteConfig.emergencyNumberIsPlaceholder) {
          this.warn(
            `EMERGENCY NUMBER IS STILL THE PLACEHOLDER ${siteConfig.emergencyNumber}. TENANTS CANNOT REACH ANYONE WITH IT. ` +
              "Replace it in backend/app/intake/form_config.json before real tenants use the form.",
          );
        }
      },
    },
  ],
  // The backend's APP_ORIGIN must match exactly, so never drift to another port.
  server: {
    port: 3000,
    strictPort: true,
    // siteConfig reads this one backend file. Never allow the whole backend folder.
    fs: { allow: [".", "../backend/app/intake/form_config.json"] },
  },
  test: {
    environment: "jsdom",
    // Playwright runs those, against a deployed site.
    exclude: [...configDefaults.exclude, "e2e/**"],
    env: {
      VITE_API_URL: "https://api.test.invalid",
      VITE_NEON_AUTH_URL: "https://auth.test.invalid",
    },
  },
});
