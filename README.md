# content-mcp

**You don't need a CMS.** A CMS was never really about the database. Its job was a
restricted editing interface: the content team changes the words without breaking
the design. This MCP server is that interface: it runs inside the AI app your team
already uses, and has no per-seat pricing or lock-in.

- **Developers** build and change the site with Claude Code. The site lives in GitHub.
- **The content team** edits it by talking to Claude through this server. It can
  only touch content files, and code checks every edit. Asking it to "make the
  headline red" gets a polite no, because there's no field for colour.

```
Content team ──Claude──▶ content-mcp (Cloudflare Worker) ──GitHub API, as the signed-in user
                                                               │
                                              commits to `staging` ──▶ preview URL
                                              `publish` merges into `main` ──▶ live site
```

- **Git is the database.** Pages and posts are Markdown files in the site's repo.
- **GitHub is the user system.** Editors sign in with GitHub. Anyone with write
  access to the repo can edit, and every commit carries their name, so `git log`
  is the audit trail.
- **Failing safe is the default.** The site validates its own content at build
  time. A bad edit can't reach the preview or the live site, and `publish`
  refuses while the preview is broken.

## 10-minute setup

You need a Cloudflare account, a GitHub account, and a site that follows
[`CONTRACT.md`](CONTRACT.md) (see below).

1. **Use this template** on GitHub, clone your copy, and run `npm install`.
2. **KV namespace** for sign-in state:
   ```
   npx wrangler kv namespace create OAUTH_KV
   ```
   Paste the `id` it prints into `kv_namespaces` in `wrangler.jsonc`.
3. **GitHub OAuth app.** If the site repo is in a GitHub organization, create the
   app under that org (Settings → Developer settings → OAuth Apps): new orgs block
   personal OAuth apps from their repos. Otherwise use github.com/settings/developers.
   - Homepage URL: `https://content-mcp.<your-subdomain>.workers.dev`
   - Callback URL: `https://content-mcp.<your-subdomain>.workers.dev/callback`
4. **Secrets:**
   ```
   npx wrangler secret put GITHUB_CLIENT_ID
   npx wrangler secret put GITHUB_CLIENT_SECRET
   openssl rand -hex 32 | npx wrangler secret put COOKIE_ENCRYPTION_KEY
   ```
5. **Your site**: set the four `vars` in `wrangler.jsonc`, the same file as the
   KV id:
   ```jsonc
   "GITHUB_OWNER": "your-github-user",
   "GITHUB_REPO": "your-site-repo",
   "LIVE_URL": "https://your-site-repo.<subdomain>.workers.dev",
   "PREVIEW_URL": "https://staging-your-site-repo.<subdomain>.workers.dev"
   ```
6. **Deploy:** `npx wrangler deploy`. A brand-new Worker can take about 3 minutes
   to reach every Cloudflare location. Until then, requests can fail with errors
   1104 or 1042.
7. **Connect Claude:** Settings → Connectors → **Add custom connector** →
   `https://content-mcp.<your-subdomain>.workers.dev/mcp`, then sign in with GitHub.
   Ask: *"What can I edit on the website?"*

## A compatible site

[`SITE_PROMPT.md`](SITE_PROMPT.md) is a prompt for Claude Code that builds a
complete compatible site (Astro, Tailwind, Cloudflare Workers) in an empty folder.
Edit the business, the GitHub repo name and the images folder in it first.

Any stack works if it follows [`CONTRACT.md`](CONTRACT.md):
- content lives in `content/pages/*.md` and `content/blog/*.md`;
- the site fails its build on bad content;
- it deploys with **Cloudflare Workers Builds** with **preview builds on**. Branch
  builds run `npx wrangler preview`, which needs `"previews": {}` in the site's
  `wrangler.jsonc`. The `staging` branch then has a stable preview URL.

## Tools

| Tool | What it does |
|---|---|
| `list_content` | Pages and their fields, posts, the image library, the preview status (ready / building / failed) and what's waiting to go live |
| `read_content` | One page or post, as the preview has it |
| `update_page` | Changes fields or the main text of an existing page |
| `save_post` | Creates, updates or unpublishes (`draft: true`) a blog post |
| `publish` | Merges `staging` into `main`, so the live site updates. Refuses while the preview is building or broken |
| `discard_changes` | Resets `staging` to `main`, throwing away unpublished edits |

Every edit is validated in code ([`src/validate.ts`](src/validate.ts)) before it's
committed, and the refusal message comes from the validator, not the model. Run
the tests with `npm test`.

## Honest limits

- **The `repo` OAuth scope is broad.** It lets the server act on every repo the
  signed-in account can reach, not just the site. Sign in with accounts that can
  only reach the site. A GitHub App would narrow this to one repo (not built yet).
- **No image uploads.** Posts and pages pick from `public/images/library/`, which
  the developer fills.
- **No new pages or layouts.** The developer creates pages; the content team edits them.
- **One editor at a time.** If two people edit the same file at once, the second is
  asked to try again. Nothing is silently overwritten.
- **One site per server.** Deploy a copy per client site.
- **Build errors aren't shown to editors.** Cloudflare's GitHub check reports
  only that a build failed. The reason is in the Cloudflare build log, for the developer.
- **`wrangler preview` is in open beta** (as of October 2026).
- **No custom domains** in this setup (`workers.dev` only).

Built on Cloudflare's [remote MCP GitHub OAuth template](https://github.com/cloudflare/ai/tree/main/demos/remote-mcp-github-oauth).
Before using it in production, read Cloudflare's
[guide to securing MCP servers](https://github.com/cloudflare/agents/blob/main/docs/securing-mcp-servers.md).

MIT licensed.
