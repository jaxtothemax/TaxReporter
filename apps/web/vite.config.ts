import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // Public path the built app is served from. Local dev and `vite preview` use
  // "/"; the GitHub Pages deploy will serve it under /app/, so that build sets
  // TAXREPORTER_WEB_BASE=/app/. An empty value counts as unset.
  base: process.env.TAXREPORTER_WEB_BASE || "/",
  plugins: [react()],
});
