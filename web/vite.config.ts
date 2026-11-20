import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/** Port de l'API du fonds (npm run api:fund), surchargeable comme côté serveur. */
const API_PORT = process.env.API_PORT ?? "8788";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { "/api": `http://localhost:${API_PORT}` },
  },
});
