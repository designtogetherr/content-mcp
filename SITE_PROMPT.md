# Build a content-mcp site

You're in an empty folder. Build a complete, deployable website for a local
business and finish without asking me anything.

## Stack

- Scaffold here: `npm create astro@latest -- . --template minimal --install --no-git --skip-houston --yes`,
  then `npx astro add tailwind --yes` (Tailwind v4) and import `src/styles/global.css`
  in your layout. If the scaffold lands in a subfolder, move it up to this folder.
  Static output, no adapter.
- Add `wrangler` as a devDependency and create `wrangler.jsonc` exactly like this
  (today's date). The empty `previews` block is required for branch previews:
  ```jsonc
  {
    "$schema": "./node_modules/wrangler/config-schema.json",
    "name": "harrowgate-site",
    "compatibility_date": "<today, YYYY-MM-DD>",
    "assets": { "directory": "./dist", "not_found_handling": "404-page" },
    "previews": {}
  }
  ```
- Cloudflare Workers Builds deploys this from GitHub. Never run `wrangler deploy`.

## Content: follow this contract exactly

```
content/
  pages/<page>.md         fixed set, created by the developer. MCP can EDIT, never create or delete.
  blog/<slug>.md          MCP can create, edit and unpublish (draft: true).
public/images/library/    images the content team can choose from. MCP can't upload.
```

**Pages** (`content/pages/<page>.md`): YAML frontmatter plus an optional Markdown
body. Every field is a string, a list of strings, or a list of objects whose
values are all strings (cards: `services: [{ title, text }, …]`). Nothing is
empty, no list is empty, and every object in a list has the same keys. Never pack
two values into one string ("Title: text"). You decide which fields exist;
editors can change values but not add, remove or retype fields.
Every page has `seoTitle` and `seoDescription`. Required pages: `site`, `home`,
`about`, `blog`. `site.md` is global with no route: `businessName`, `phone`,
`email`, `serviceArea`; its `seoTitle`/`seoDescription` are site-wide defaults.
`blog.md` is the blog index intro. A field named `image` or ending in `Image`
holds a filename from `public/images/library/` and always has a matching `…Alt`
field (`heroImage` → `heroImageAlt`): the photo in plain words, used as its alt
text (inside cards too).

**Posts** (`content/blog/<slug>.md`): `title` (string), `description` (string,
max 160 chars, the meta description), `date` (YYYY-MM-DD, unquoted), `draft`
(boolean, `true` hides the post everywhere), `image` (optional library filename),
`imageAlt` (required when `image` is set: the photo in plain words, used as its
alt text), and a Markdown body. No other fields. Slug = filename: lowercase, digits, single hyphens.

**Rules:** bodies are Markdown only, no HTML, headings start at `##`. Layout and
styling live in code; no fields for colours or sizes. The site renders every
visible word from these files, except fixed UI labels (nav, button chrome) and
the demo footer line. Every field and body appears on the site or in meta tags.
A bad file fails the build.

**How to implement it:**
- `src/content.config.ts`: `glob()` from `astro/loaders` with base `./content/pages`
  and `./content/blog`; `z` from `astro/zod`. Pages: `seoTitle` and `seoDescription`
  required, then `.catchall()` of a union: non-empty string, non-empty list of
  them, or non-empty list of `z.record(z.string(), <non-empty string>)`. Then
  `.superRefine()` so it fails when cards in one list have different keys, or
  when an `image`/`…Image` key (top level or in a card) has no non-empty `…Alt`
  (path `[key + "Alt"]`). Posts:
  the fields above, `.strict()`, `date: z.coerce.date()`, then `.refine()` so
  `image` without a non-empty `imageAlt` fails (path `["imageAlt"]`).
- Read page fields through small helpers that throw if a field is missing or a
  card lacks a key the template uses, so a page and its template can't drift apart silently.
- If you check at build time that library images exist, resolve paths from the
  project root (`process.cwd()`), not `import.meta.url` (it points into `dist/`).
- Format dates in UTC. Show images with plain `<img src="/images/library/…">`;
  every image's `alt` is its `…Alt` field.
- Style Markdown bodies properly (e.g. `@tailwindcss/typography`).

## The business

**Harrowgate Build Co.**, a fictional residential renovation and construction
company. Pages: home `/`, about `/about`, blog index `/blog` (newest first, drafts
hidden), posts `/blog/<slug>`, and a 404. The home page needs a hero, the services,
how a project works, the service area and a clear call to action with the phone
and email. Write specific, real-sounding seed content, and 3 published blog
posts, each with an image and an `imageAlt` that describes that photo.

**Fiction rules:** phone `(555) 555-01xx`, email `@example.com`. No testimonials,
ratings, licence numbers, awards, years in business or prices. Every page's
footer says: "Demo site: fictional business created for a video." (hard-coded,
not content). Every page has `<meta name="robots" content="noindex, nofollow">`,
and `public/robots.txt` disallows everything.

## Images

Copy every image in `~/Documents/no-cms-demo/images/` into `public/images/library/`
with descriptive kebab-case names. If that folder is empty, make 8 clean SVG
placeholders instead (site crew, finished kitchen, framing, house exterior,
blueprints, roof, deck, tools).

## Design

It should look like a good local business site, not a template: a deliberate
palette and type, real hierarchy, generous spacing. Check it at 375 px and 1280 px
wide (screenshot it with a headless browser if you can). No horizontal scroll at
any width.

## Finish

1. `npm run build` passes.
2. Prove the schema works: add an unknown field to a post, confirm the build
   fails, then revert it.
3. Commit on a branch named `main`, then
   `gh repo create designtogetherr/harrowgate-site --private --source=. --push`,
   and push a `staging` branch from `main`.
4. Reply with: each page and its fields, the posts, and the image library.
