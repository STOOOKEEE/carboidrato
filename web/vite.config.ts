import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/** Port de l'API (npm run api), surchargeable comme côté serveur. */
const API_PORT = process.env.API_PORT ?? "8787";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { "/api": `http://localhost:${API_PORT}` },
  },
});
