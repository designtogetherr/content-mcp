# Content contract

The interface between a site and content-mcp. A site that follows it can be
edited through Claude without anyone touching code.

```
content/
  pages/<page>.md         fixed set, created by the developer. MCP can EDIT, never create or delete.
  blog/<slug>.md          MCP can create, edit and unpublish (draft: true).
public/images/library/    images the content team can choose from. MCP can't upload.
```

## Pages: `content/pages/<page>.md`

- YAML frontmatter plus an optional Markdown body. Every field is one of:
  - a **string**;
  - a **list of strings**;
  - a **list of objects whose values are all strings**, for cards
    (`services: [{ title, text }, …]`).
- No value is empty, and no list is empty.
- The developer decides which fields exist. The content team can change values
  but can't add fields, remove them or change their type. Lists can grow or
  shrink. Every object in a list has exactly the same keys as the others.
  Nothing is packed into a string to be parsed later (no "Title: text").
- Every page has `seoTitle` and `seoDescription`.
- Required pages: `site`, `home`, `about`, `blog`.
  - `site.md` is global and has no route: `businessName`, `phone`, `email`,
    `serviceArea`. Its `seoTitle` and `seoDescription` are the site-wide defaults.
  - `blog.md` is the intro for the blog index.
- A field named `image` or ending in `Image` holds a filename from
  `public/images/library/`, and always has a matching `…Alt` field
  (`heroImage` → `heroImageAlt`): the photo described in plain words, used as its
  alt text. Changing an image means describing the new one in the same edit.
  This applies inside card objects too.

## Posts: `content/blog/<slug>.md`

| Field | Type | Rule |
|---|---|---|
| `title` | string | required |
| `description` | string | required, max 160 characters, used as the meta description |
| `date` | date | `YYYY-MM-DD`, unquoted |
| `draft` | boolean | `true` hides the post everywhere |
| `image` | string | optional, a filename in `public/images/library/` |
| `imageAlt` | string | required when `image` is set: the photo described in plain words, used as its alt text |

Plus a Markdown body. No other fields. The slug is the filename:
lowercase letters, digits and single hyphens.

## Rules

- **Bodies are Markdown only.** No HTML tags. Headings start at `##`, because
  the page title is the `#`.
- **Layout and styling live in code.** There are no fields for colours, sizes or
  positions.
- **The site renders every visible word from these files**, except fixed UI
  labels (nav labels, button chrome) and the demo footer line. If an edit needs a
  code change, the contract has failed.
- **Every field is used.** Each field and body appears on the site or in its meta
  tags, so every edit is visible.
- **A bad file fails the build.** The site validates content with a schema, so
  broken content never reaches the preview or the live site. content-mcp reads
  the build result for `staging` and won't publish a preview that failed.
