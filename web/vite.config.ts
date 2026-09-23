import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { studioApiPlugin } from "./server/plugin";

export default defineConfig({
  plugins: [react(), studioApiPlugin()],
  server: {
    port: 5173,
    host: true,
  },
  preview: {
    port: Number(process.env.STUDIO_PORT || 5173),
    host: true,
    allowedHosts: true,
  },
});
