import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  root: "dashboard-ui",
  plugins: [tailwindcss(), vue()],
  build: {
    outDir: "dist",
    emptyOutDir: true
  },
  server: {
    port: 5174,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4317",
        changeOrigin: true
      }
    }
  }
});
