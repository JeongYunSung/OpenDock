import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
    proxy: {
      "/registry": {
        target: "https://registry.opendock.app",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/registry/, "")
      }
    }
  }
});
