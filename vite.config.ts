import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  css: { preprocessorOptions: { less: { javascriptEnabled: true } } },
  server: { host: "127.0.0.1", port: 7777, strictPort: true },
  clearScreen: false,
});
