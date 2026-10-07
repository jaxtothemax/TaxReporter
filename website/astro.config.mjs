// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

// ─── Where the site is served ────────────────────────────────────────────────
//
// GitHub Pages serves a project site at https://<owner>.github.io/<repo>/, so
// `site` is the origin and `base` must be "/<repo>/". Neither is hardcoded:
// .github/workflows/docs.yml reads both from actions/configure-pages (which
// also accounts for a custom domain, where the base becomes "/") and passes
// them in as SITE_URL and BASE_PATH. Without them, as in `npm run dev`, the
// site builds for http://localhost:4321 at "/".
//
// A wrong `base` 404s every asset and link on the deployed site while
// `astro dev` still looks fine. Before changing anything here, build and
// preview with the values CI would pass:
//   SITE_URL=https://<owner>.github.io BASE_PATH=/<repo> npm run build && npm run preview
const siteUrl = (process.env.SITE_URL || "http://localhost:4321").replace(/\/+$/, "");
const basePath = normalizeBase(process.env.BASE_PATH);

// The repository behind the GitHub and "Edit page" links. GitHub Actions sets
// GITHUB_REPOSITORY ("owner/repo"); the fallback only serves local builds.
const FALLBACK_REPOSITORY = "jaxtothemax/TaxReporter";
const repositoryUrl = `https://github.com/${process.env.GITHUB_REPOSITORY || FALLBACK_REPOSITORY}`;

/**
 * "" | "/" | "repo" | "/repo" | "/repo/" -> "/" or "/repo/"
 * @param {string | undefined} value
 */
function normalizeBase(value) {
  const trimmed = (value ?? "").trim().replace(/^\/+|\/+$/g, "");
  return trimmed ? `/${trimmed}/` : "/";
}

// ─── Links inside Markdown ───────────────────────────────────────────────────
//
// Pages link to each other root-relative ("/roadmap/") and to the repository
// with full URLs under CANONICAL_REPOSITORY_URL, because that is what
// scripts/check-docs-internal-links.py can verify. Astro does not add `base`
// to links inside Markdown, and the repository may be renamed or forked, so
// this rewrites both at build time from `basePath` and `repositoryUrl` above.
// It covers Markdown links, reference definitions and images. It does not
// touch raw HTML or frontmatter, so write links as Markdown.
//
// Renaming the repository: change FALLBACK_REPOSITORY and the repository links
// in src/content/docs/ in the same commit, so the link checker keeps seeing
// them as links into this repository.
const CANONICAL_REPOSITORY_URL = `https://github.com/${FALLBACK_REPOSITORY}`;

/** @param {string} url */
function rewriteUrl(url) {
  if (url.startsWith("/") && !url.startsWith("//")) {
    return basePath.slice(0, -1) + url;
  }
  if (url.startsWith(CANONICAL_REPOSITORY_URL)) {
    const rest = url.slice(CANONICAL_REPOSITORY_URL.length);
    if (rest === "" || /^[/?#]/.test(rest)) return repositoryUrl + rest;
  }
  return url;
}

/** @param {{ url: string }} node @param {any} ctx */
function rewriteNodeUrl(node, ctx) {
  const url = rewriteUrl(node.url);
  if (url !== node.url) ctx.setProperty(node, "url", url);
}

// An mdast plugin for Sätteri, Astro's default Markdown processor.
const markdownLinksPlugin = {
  name: "taxreporter-markdown-links",
  // Plain data that the processor ignores. Astro hashes the serializable part
  // of its config to decide whether cached pages are stale, so a different
  // base or repository re-renders them instead of reusing old links.
  rewrites: { basePath, repositoryUrl },
  link: rewriteNodeUrl,
  definition: rewriteNodeUrl,
  image: rewriteNodeUrl,
};

/** @returns {import("astro").AstroIntegration} */
function markdownLinks() {
  return {
    name: "taxreporter-markdown-links",
    hooks: {
      "astro:config:setup": ({ config }) => {
        const processor = config.markdown.processor;
        // Fail the build instead of shipping links that 404 under `base`.
        if (processor?.name !== "satteri") {
          throw new Error(
            `taxreporter-markdown-links supports the "satteri" Markdown processor, not "${processor?.name}". Port the link rewrite before switching processors.`,
          );
        }
        // Sätteri's resolved options always carry an `mdastPlugins` array;
        // Starlight registers its own Markdown plugins the same way.
        const options = /** @type {{ mdastPlugins: unknown[] }} */ (processor.options);
        options.mdastPlugins.push(markdownLinksPlugin);
      },
    },
  };
}

export default defineConfig({
  site: siteUrl,
  base: basePath,
  vite: {
    // The docs site is its own npm project, not part of the pnpm workspace.
    // Without this pin, Vite discovers a tsconfig per file and can reach the
    // repository's root tsconfig.json, a solution file whose project references
    // belong to the workspace; a referenced project that does not exist yet
    // then fails this build ("Tsconfig not found .../packages/core").
    tsconfig: "./tsconfig.json",
  },
  integrations: [
    markdownLinks(),
    starlight({
      title: "TaxReporter",
      description:
        "Turn foreign-broker exports into Doh-KDVP and Doh-Div files for FURS eDavki, on your own device.",
      social: [{ icon: "github", label: "GitHub", href: repositoryUrl }],
      editLink: { baseUrl: `${repositoryUrl}/edit/main/website/` },
      sidebar: [
        {
          label: "Start here",
          items: [{ slug: "index", label: "Overview" }],
        },
        {
          label: "Guides",
          items: [{ slug: "guides/how-it-will-work" }, { slug: "guides/privacy-and-security" }],
        },
        {
          label: "Reference",
          items: [{ slug: "reference/exchange-rates" }],
        },
        {
          label: "Project",
          items: [{ slug: "roadmap" }, { slug: "contributing" }],
        },
      ],
    }),
  ],
});
