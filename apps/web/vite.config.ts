import react from "@vitejs/plugin-react";
import { defaultClientConditions, defineConfig, type Plugin } from "vite";

/**
 * The built app's Content Security Policy (CLAUDE.md, "Secure code"): scripts,
 * fonts and requests from its own origin only, so even injected markup cannot
 * load code or send data elsewhere. The opt-in LLM check will add exactly its
 * provider's origin to connect-src when it lands (ADR 0008).
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  // No 'unsafe-inline': React applies the style prop through the CSSOM, which
  // a policy does not restrict, and no markup carries a style attribute.
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

/**
 * Build-only, because the dev server's React refresh runtime is an inline
 * script the policy would rightly block. GitHub Pages cannot send headers, so
 * the policy travels as a <meta> tag (which cannot carry frame-ancestors).
 */
function contentSecurityPolicy(): Plugin {
  return {
    name: "taxreporter-content-security-policy",
    apply: "build",
    transformIndexHtml: () => [
      {
        tag: "meta",
        attrs: {
          "http-equiv": "Content-Security-Policy",
          content: CONTENT_SECURITY_POLICY,
        },
        injectTo: "head-prepend",
      },
    ],
  };
}

export default defineConfig({
  // Public path the built app is served from. Local dev and `vite preview` use
  // "/"; the GitHub Pages deploy will serve it under /app/, so that build sets
  // TAXREPORTER_WEB_BASE=/app/. An empty value counts as unset.
  base: process.env.TAXREPORTER_WEB_BASE || "/",
  plugins: [react(), contentSecurityPolicy()],
  // The workspace packages export their TypeScript sources under the
  // "source" condition, so the app bundles the engine from src/ directly.
  resolve: { conditions: ["source", ...defaultClientConditions] },
});
