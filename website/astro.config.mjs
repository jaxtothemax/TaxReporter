import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import mermaid from "astro-mermaid";

// This project has GitLab's "unique domain" Pages setting turned on, so the
// site is served AT THE ROOT — no `/blueprint/` path prefix. Confirm with
// `glab api projects/macrodream%2Fblueprint/pages` before touching `base`:
// `is_unique_domain_enabled` and `path_prefix` in that response are the
// source of truth, not an assumption about how GitLab Pages URLs usually
// work. Getting this wrong 404s every asset and internal link on the
// deployed site while `astro dev` still looks fine (dev ignores `base`
// unless you deliberately test against it) — this happened once already;
// see issue #24.
//
// `site` below is the project's branded custom domain, not GitLab's
// auto-generated one (`project-template-46f9be.gitlab.io`). As of 2026-09-22
// that domain is NOT YET registered — `glab api
// projects/macrodream%2Fblueprint/pages_domains` returns none. It must be
// added under Settings → Pages (with its DNS CNAME/TXT verification records)
// before this URL resolves; until then the auto-generated domain above is
// the only one that actually serves the site. See issue #25.
export default defineConfig({
  site: "https://docs.blueprint.macrodream.co",
  base: "/",
  integrations: [
    // MUST come before starlight so the mermaid code-fence transform runs first.
    // securityLevel "loose" enables `click` links; every diagram is repo-authored.
    mermaid({
      theme: "default",
      autoTheme: true,
      mermaidConfig: { securityLevel: "loose" },
    }),
    starlight({
      title: "Blueprint",
      tagline: "A ready-made delivery system for a new software project.",
      social: [
        {
          icon: "gitlab",
          label: "GitLab",
          href: "https://gitlab.com/macrodream/blueprint",
        },
      ],
      editLink: {
        baseUrl: "https://gitlab.com/macrodream/blueprint/-/edit/main/website/",
      },
      lastUpdated: true,
      tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 3 },
      customCss: ["./src/styles/custom.css"],
      sidebar: [
        {
          label: "Start here",
          items: [{ slug: "index" }],
        },
        {
          label: "Getting Started",
          items: [
            { slug: "getting-started/quickstart" },
            { slug: "getting-started/start-a-project" },
          ],
        },
        {
          label: "Guides",
          items: [
            { slug: "guides/development-workflow" },
            { slug: "guides/issues-and-the-tracker" },
            { slug: "guides/git-and-changelog" },
            { slug: "guides/ci-pipeline" },
            { slug: "guides/external-validation" },
            { slug: "guides/testing-ai-written-code" },
            { slug: "guides/parallel-work" },
            { slug: "guides/day-in-the-life" },
            { slug: "guides/flows" },
            { slug: "guides/release-workflow" },
            { slug: "guides/publishing-to-github" },
            { slug: "guides/deployment-options" },
            { slug: "guides/adding-a-docs-site" },
            { slug: "guides/tips-and-tricks" },
            { slug: "guides/giving-feedback" },
          ],
        },
        {
          label: "Reference",
          items: [
            { slug: "reference/commands" },
            { slug: "reference/agents" },
            { slug: "reference/harness-gates" },
            { slug: "reference/agent-architecture" },
            { slug: "reference/whats-included" },
            { slug: "reference/glossary" },
          ],
        },
        {
          label: "About",
          items: [{ slug: "about/why-blueprint" }],
        },
      ],
    }),
  ],
});
