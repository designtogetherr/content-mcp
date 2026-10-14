// The tools the content team uses through Claude. Descriptions are written for a
// model talking to someone who isn't a developer.
import type { McpServer } from "@modelcontextprotocol/server";
import { getMcpAuthContext } from "agents/mcp/server";
import { z } from "zod";
import { repo, UserError, type Repo } from "./github";
import type { Props } from "./utils";
import {
	describeFields,
	parseFile,
	previewStatus,
	renderFile,
	renderNew,
	validatePageUpdate,
	validatePost,
	type PreviewStatus,
} from "./validate";

const PAGES = "content/pages";
const BLOG = "content/blog";
const LIBRARY = "public/images/library";
const STAGING = "staging";
const MAIN = "main";

const SAFE_PATH = /^content\/(pages|blog)\/[a-z0-9]+(-[a-z0-9]+)*\.md$/;

export const INSTRUCTIONS = `This server edits a website's words, images and blog posts. The person you're helping is not a developer.
- Start with list_content to see what can be edited.
- After every edit, show the preview link and say it updates in about a minute.
- Edits only reach the preview. Never call publish unless the person clearly asks to make changes live. Before publishing, tell them what will go live.
- When a tool refuses something, pass its message on in your own words without inventing workarounds. Design, layout and new pages are the developer's job.`;

type Text = { content: { type: "text"; text: string }[]; isError?: boolean };
const reply = (text: string): Text => ({ content: [{ type: "text", text }] });

function user(): Props {
	const auth = getMcpAuthContext();
	if (!auth) throw new UserError("You're not signed in. Reconnect the website tool and sign in with GitHub.");
	return auth.props as Props;
}

/** Runs a tool body, turning refusals and GitHub errors into plain English. */
async function run(fn: () => Promise<string>): Promise<Text> {
	try {
		return reply(await fn());
	} catch (e) {
		if (e instanceof UserError) return { ...reply(e.message), isError: true };
		console.error(e);
		const code = (e as { status?: number }).status;
		return {
			...reply(`GitHub returned an error${code ? ` (${code})` : ""}. Try again in a minute; if it keeps happening, tell your developer.`),
			isError: true,
		};
	}
}

const describePath = (path: string) => {
	const m = path.match(/^content\/(pages|blog)\/(.+)\.md$/);
	if (!m) return path;
	return m[1] === "pages" ? `the ${m[2]} page` : `the blog post '${m[2]}'`;
};

const today = () => new Date().toISOString().slice(0, 10);
const commit = (what: string) => `content: ${what} (via content-mcp)`;

export function registerTools(server: McpServer, env: Env) {
	const site = () => repo(user().accessToken, env.GITHUB_OWNER, env.GITHUB_REPO, user().login);
	const previewNote = `Preview (updates in about a minute): ${env.PREVIEW_URL}`;

	async function status(gh: Repo): Promise<{ status: PreviewStatus; message: string }> {
		const head = await gh.head(STAGING);
		return { status: previewStatus(await gh.checkRuns(head.sha), head.date, new Date()), message: head.message };
	}

	const library = (gh: Repo) => gh.listFiles(LIBRARY, STAGING);
	const pageNames = async (gh: Repo) => (await gh.listFiles(PAGES, STAGING)).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3));

	server.registerTool(
		"list_content",
		{
			description:
				"Lists everything that can be edited: each page with its fields, the blog posts, the image library, whether the preview is ready, and what's waiting to go live. Call this first.",
		},
		() =>
			run(async () => {
				const gh = site();
				await gh.checkAccess(false);
				const [names, postFiles, images, preview, pending] = await Promise.all([
					pageNames(gh),
					gh.listFiles(BLOG, STAGING),
					library(gh),
					status(gh),
					gh.changes(MAIN, STAGING),
				]);
				const pages = await Promise.all(
					names.map(async (name) => {
						const file = parseFile((await gh.readFile(`${PAGES}/${name}.md`, STAGING))?.text ?? "");
						return `- ${name}: ${describeFields(file.data).join(", ")}${file.body.trim() ? "; plus main text" : ""}`;
					}),
				);
				const posts = await Promise.all(
					postFiles
						.filter((f) => f.endsWith(".md"))
						.map(async (f) => {
							const { data } = parseFile((await gh.readFile(`${BLOG}/${f}`, STAGING))?.text ?? "");
							return `- ${f.slice(0, -3)}: "${data.title}" (${data.date}${data.draft ? ", draft: hidden" : ""})`;
						}),
				);
				const previewLine = {
					ready: "ready",
					building: "building (it updates in about a minute)",
					failed: `failed. The last change ("${preview.message}") didn't build, so the preview still shows the version before it. Your developer can see why in the build log.`,
					unknown: "unknown",
				}[preview.status];
				return [
					`Preview: ${previewLine}`,
					`Preview link: ${env.PREVIEW_URL}`,
					`Live site: ${env.LIVE_URL}`,
					`Waiting to go live: ${pending.ahead ? pending.files.map(describePath).join(", ") : "nothing (the live site matches the preview)"}`,
					"",
					"Pages (change with update_page):",
					...pages,
					"",
					"Blog posts (change with save_post; read one with read_content):",
					...(posts.length ? posts : ["- none yet"]),
					"",
					`Image library: ${images.join(", ") || "empty"}`,
				].join("\n");
			}),
	);

	server.registerTool(
		"read_content",
		{
			description:
				"Reads one page or post exactly as the preview has it: its fields and main text. Read before changing anything, so you know the current words and shapes.",
			inputSchema: z.object({
				path: z.string().describe("e.g. 'content/pages/home.md' or 'content/blog/my-post.md'"),
			}),
		},
		({ path }) =>
			run(async () => {
				if (!SAFE_PATH.test(path)) throw new UserError("Only pages (content/pages/<name>.md) and posts (content/blog/<slug>.md) can be read.");
				const gh = site();
				await gh.checkAccess(false);
				const found = await gh.readFile(path, STAGING);
				if (!found) throw new UserError(`There's nothing at ${path}. Use list_content to see what exists.`);
				const { data, body } = parseFile(found.text);
				return `Fields:\n${JSON.stringify(data, null, 2)}\n\nMain text:\n${body.trim() || "(none)"}`;
			}),
	);

	server.registerTool(
		"update_page",
		{
			description:
				"Changes the words or images on an existing page. Send only the fields you're changing; lists are replaced whole, in the same shape they have now. Pages and fields can't be added or removed, and there are no fields for design (colours, sizes, layout). When changing a photo, describe the new one in its matching ...Alt field in the same call. The change goes to the preview only: show the preview link afterwards.",
			inputSchema: z.object({
				page: z.string().describe("Page name from list_content, e.g. 'home'"),
				fields: z
					.record(z.string(), z.union([z.string(), z.array(z.string()), z.array(z.record(z.string(), z.string()))]))
					.optional()
					.describe("Fields to change, with their complete new values"),
				body: z.string().optional().describe("New main text in Markdown, only for pages that have main text"),
			}),
		},
		({ page, fields, body }) =>
			run(async () => {
				const gh = site();
				await gh.checkAccess(true);
				const path = `${PAGES}/${page}.md`;
				const found = /^[a-z0-9-]+$/.test(page) ? await gh.readFile(path, STAGING) : null;
				const file = found ? parseFile(found.text) : null;
				const result = validatePageUpdate({
					page,
					pages: found ? [] : await pageNames(gh),
					existing: file,
					fields,
					body,
					library: await library(gh),
				});
				if (!result.ok) throw new UserError(result.errors.join("\n"));
				for (const [key, value] of Object.entries(result.value.data)) file!.doc.set(key, value);
				const next = renderFile(file!.doc, result.value.body ?? file!.body);
				if (next === found!.text) return `That's already what the ${page} page says, so nothing changed.`;
				const changed = [...Object.keys(result.value.data), ...(body !== undefined ? ["main text"] : [])];
				await gh.writeFile(path, next, commit(`update ${page} page (${changed.join(", ")})`), STAGING, found!.sha);
				return `Updated the ${page} page: ${changed.join(", ")}.\n${previewNote}`;
			}),
	);

	server.registerTool(
		"save_post",
		{
			description:
				"Creates a blog post, or updates one (send every field: read it first). To unpublish a post, save it with draft: true. 'image' must be a file from the image library; whenever you set or change it, also send imageAlt describing the photo in plain words. Leave image out to keep the current one, or send '' to remove it. The change goes to the preview only: show the preview link afterwards.",
			inputSchema: z.object({
				slug: z.string().describe("The post's web address, e.g. 'spring-deck-checklist'"),
				title: z.string(),
				description: z.string().describe("One or two sentences for search results, 160 characters max"),
				body: z.string().describe("The post in Markdown. Headings start at ##"),
				date: z.string().optional().describe("YYYY-MM-DD. New posts default to today"),
				draft: z.boolean().optional().describe("true hides the post from the site"),
				image: z.string().optional(),
				imageAlt: z.string().optional(),
			}),
		},
		(input) =>
			run(async () => {
				const gh = site();
				await gh.checkAccess(true);
				const path = `${BLOG}/${input.slug}.md`;
				const found = SAFE_PATH.test(path) ? await gh.readFile(path, STAGING) : null;
				const old = found ? parseFile(found.text) : null;
				const result = validatePost({ input, existing: old, library: await library(gh), today: today() });
				if (!result.ok) throw new UserError(result.errors.join("\n"));
				const { data, body } = result.value;
				const what = !old ? "new post" : data.draft && !old.data.draft ? "unpublish post" : "update post";
				await gh.writeFile(path, renderNew(data, body), commit(`${what} "${data.title}"`), STAGING, found?.sha);
				const done = { "new post": "Created", "unpublish post": "Unpublished", "update post": "Updated" }[what];
				return `${done} the post "${data.title}"${data.draft ? " (draft: hidden from the site)" : ""}.\n${previewNote}`;
			}),
	);

	server.registerTool(
		"publish",
		{
			description:
				"Makes everything in the preview live on the real website. Only call this when the person clearly asks to go live, after telling them what will go live (list_content shows it). Refuses if the preview didn't build or is still building.",
		},
		() =>
			run(async () => {
				const gh = site();
				await gh.checkAccess(true);
				const pending = await gh.changes(MAIN, STAGING);
				if (!pending.ahead) return "Nothing to publish; the live site already matches the preview.";
				const preview = await status(gh);
				if (preview.status === "building") return "The preview is still building. Give it a minute and ask me again.";
				if (preview.status === "failed") {
					throw new UserError(
						`The preview didn't build, so I haven't published anything. The last change was: "${preview.message}". Ask your developer to look at the build log, or discard your changes.`,
					);
				}
				const sha = await gh.merge(MAIN, STAGING, commit(`publish ${pending.files.map(describePath).join(", ")}`));
				if (!sha) throw new UserError("A developer changed the same file. Ask them to publish, or discard your changes and redo them.");
				await gh.moveBranch(STAGING, sha, false);
				return `Published: ${pending.files.map(describePath).join(", ")}.\nThe live site updates in about a minute: ${env.LIVE_URL}`;
			}),
	);

	server.registerTool(
		"discard_changes",
		{
			description:
				"Throws away every change made since the last publish, so the preview matches the live site again. Can't be undone: confirm with the person first.",
		},
		() =>
			run(async () => {
				const gh = site();
				await gh.checkAccess(true);
				const pending = await gh.changes(MAIN, STAGING);
				if (!pending.ahead) return "Nothing to discard; the preview already matches the live site.";
				await gh.moveBranch(STAGING, (await gh.head(MAIN)).sha, true);
				return `Discarded changes to: ${pending.files.map(describePath).join(", ")}.\n${previewNote}`;
			}),
	);
}
