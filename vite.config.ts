import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:3001",
    },
  },
  // OpenSCAD-WASM ships a 9.6 MB binary (vendored under src/vendor/). Vite's
  // default 4 MB asset-warning threshold spams the console — bump it.
  build: {
    chunkSizeWarningLimit: 12000,
    assetsInlineLimit: 0,
  },
  // Don't try to optimize the vendored OpenSCAD (it's an Emscripten module
  // with import.meta.url tricks that break under esbuild's pre-bundling).
  optimizeDeps: {
    exclude: ["@vendor/openscad-wasm"],
  },
  worker: {
    format: "es",
  },
});
