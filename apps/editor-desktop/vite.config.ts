import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./", // ✅ важно для Electron file:// (иначе будет пустой экран)
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true
  }
});
