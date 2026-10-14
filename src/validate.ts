// Every rule the content team's edits must pass, and the exact words used to
// refuse them. Pure functions: no network, no Worker APIs, tested in validate.test.ts.
import YAML from "yaml";

export type Card = Record<string, string>;
export type Value = string | string[] | Card[];
export type Result<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HTML = /<\/?[a-z][^>]*>/i;
const TOP_HEADING = /^#\s/m;

export const NO_HTML =
	"Formatting like colours and sizes is controlled by the site's design, not the content. I can change the words; ask your developer for design changes.";
export const POST_ALT =
	"Please describe the photo in a few plain words, for example 'Two roofers fitting new shingles'. It's read aloud to people using screen readers, and it helps search engines understand the image.";
const pageAlt = (altKey: string) =>
	`When you change a photo, please describe the new one in a few plain words in the same edit (${altKey}), for example 'A finished white kitchen with an island'. It's read aloud to people using screen readers, and it helps search engines understand the image.`;
const TOP_HEADING_MSG =
	"The page title is already the main heading, so headings in the text start at ## (a smaller heading). Use ## instead of #.";

export const isImageKey = (key: string) => key === "image" || key.endsWith("Image");

// ---------- Markdown files: YAML frontmatter + body ----------

export type ContentFile = { doc: YAML.Document; data: Record<string, unknown>; body: string };

export function parseFile(src: string): ContentFile {
	const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
	const doc = YAML.parseDocument(m ? m[1] : "");
	return { doc, data: (doc.toJS() ?? {}) as Record<string, unknown>, body: m ? m[2] : src };
}

export function renderFile(doc: YAML.Document, body: string): string {
	const fm = doc.toString({ lineWidth: 0 });
	const text = body.trim();
	return `---\n${fm}---\n${text ? `\n${text}\n` : ""}`;
}

export const renderNew = (data: object, body: string) => renderFile(new YAML.Document(data), body);

// ---------- shapes ----------

type Kind = "text" | "list" | "cards";

function kindOf(v: unknown): Kind | null {
	if (typeof v === "string") return "text";
	if (!Array.isArray(v)) return null;
	if (v.every((x) => typeof x === "string")) return "list";
	if (v.every((x) => x !== null && typeof x === "object" && !Array.isArray(x))) return "cards";
	return null;
}

const keysOf = (card: object) => Object.keys(card).sort().join(", ");

function describeKind(key: string, existing: unknown): string {
	const kind = kindOf(existing);
	if (kind === "text") return `'${key}' is a single piece of text.`;
	if (kind === "list") return `'${key}' is a list of short texts. Send the whole list.`;
	return `'${key}' is a list of items, each with: ${keysOf((existing as Card[])[0])}. Send the whole list in that shape.`;
}

/** Field names with a hint of their shape, for list_content. */
export function describeFields(data: Record<string, unknown>): string[] {
	return Object.entries(data).map(([k, v]) => {
		const kind = kindOf(v);
		if (kind === "cards") return `${k} (list of items: ${keysOf((v as Card[])[0])})`;
		if (kind === "list") return `${k} (list)`;
		return isImageKey(k) ? `${k} (image)` : k;
	});
}

// ---------- shared checks ----------

function checkText(label: string, s: string, errors: string[]) {
	if (!s.trim()) errors.push(`${label} can't be empty. To remove something from the page, ask your developer.`);
	else if (HTML.test(s)) errors.push(NO_HTML);
}

function checkBody(body: string, errors: string[]) {
	if (!body.trim()) errors.push("The main text can't be empty.");
	else if (HTML.test(body)) errors.push(NO_HTML);
	else if (TOP_HEADING.test(body)) errors.push(TOP_HEADING_MSG);
}

function checkImage(name: string, library: string[], errors: string[]) {
	if (!library.includes(name)) {
		errors.push(
			`There's no image called '${name}' in the image library. Images you can use: ${library.join(", ")}. New images are added by your developer.`,
		);
	}
}

const dedupe = (errors: string[]) => [...new Set(errors)];

// ---------- update_page ----------

export function validatePageUpdate(args: {
	page: string;
	pages: string[];
	existing: { data: Record<string, unknown>; body: string } | null;
	fields?: Record<string, unknown>;
	body?: string;
	library: string[];
}): Result<{ data: Record<string, Value>; body?: string }> {
	const { page, pages, existing, fields = {}, body, library } = args;
	if (!existing) {
		return {
			ok: false,
			errors: [`There's no page called '${page}'. Pages are added by your developer. Editable pages: ${pages.join(", ")}.`],
		};
	}
	const errors: string[] = [];
	const data: Record<string, Value> = {};
	const known = Object.keys(existing.data);

	if (Object.keys(fields).length === 0 && body === undefined) {
		return { ok: false, errors: ["Nothing to change: send at least one field or the main text."] };
	}

	for (const [key, value] of Object.entries(fields)) {
		if (!known.includes(key)) {
			errors.push(
				`The ${page} page has no '${key}' field. Fields you can change on ${page}: ${known.join(", ")}. New fields are added by your developer.`,
			);
			continue;
		}
		const want = kindOf(existing.data[key]);
		const got = kindOf(value);
		if (want === null || got !== want) {
			errors.push(describeKind(key, existing.data[key]));
			continue;
		}
		if (want === "text") {
			checkText(`'${key}'`, value as string, errors);
			if (isImageKey(key) && (value as string).trim()) {
				checkImage(value as string, library, errors);
				const alt = fields[`${key}Alt`];
				if (value !== existing.data[key] && !(typeof alt === "string" && alt.trim())) errors.push(pageAlt(`${key}Alt`));
			}
		} else {
			const items = value as unknown[];
			if (items.length === 0) {
				errors.push(`'${key}' needs at least one item.`);
				continue;
			}
			if (want === "list") {
				items.forEach((s) => checkText(`An item in '${key}'`, s as string, errors));
			} else {
				const shape = keysOf((existing.data[key] as Card[])[0]);
				(items as Card[]).forEach((card, i) => {
					if (keysOf(card) !== shape) {
						errors.push(`Each item in '${key}' needs exactly these parts: ${shape}. Item ${i + 1} has: ${keysOf(card) || "nothing"}.`);
						return;
					}
					for (const [k, v] of Object.entries(card)) {
						if (typeof v !== "string") {
							errors.push(`'${k}' in item ${i + 1} of '${key}' must be text.`);
							continue;
						}
						checkText(`'${k}' in item ${i + 1} of '${key}'`, v, errors);
						if (isImageKey(k) && v.trim()) checkImage(v, library, errors);
					}
				});
			}
		}
		data[key] = value as Value;
	}

	if (body !== undefined) {
		if (!existing.body.trim()) {
			errors.push(`The ${page} page doesn't have a main text area. Fields you can change on ${page}: ${known.join(", ")}.`);
		} else checkBody(body, errors);
	}

	return errors.length ? { ok: false, errors: dedupe(errors) } : { ok: true, value: { data, body } };
}

// ---------- save_post ----------

export type PostInput = {
	slug: string;
	title: string;
	description: string;
	body: string;
	date?: string;
	draft?: boolean;
	image?: string;
	imageAlt?: string;
};

export type PostData = { title: string; description: string; date: string; draft: boolean; image?: string; imageAlt?: string };

export function validatePost(args: {
	input: PostInput;
	existing: { data: Record<string, unknown> } | null;
	library: string[];
	today: string;
}): Result<{ data: PostData; body: string }> {
	const { input, existing, library, today } = args;
	const old = (existing?.data ?? {}) as Partial<PostData>;
	const errors: string[] = [];

	if (!SLUG.test(input.slug)) {
		errors.push(
			`'${input.slug}' can't be used as the post's web address. Use lowercase letters, numbers and single hyphens, for example 'spring-deck-checklist'.`,
		);
	}
	checkText("The title", input.title, errors);
	checkText("The description", input.description, errors);
	if (input.description.length > 160) {
		errors.push(
			`The description is ${input.description.length} characters. It needs to be 160 or fewer, because search results cut off anything longer.`,
		);
	}

	const date = input.date ?? (typeof old.date === "string" ? old.date : undefined) ?? today;
	const parsed = new Date(`${date}T00:00:00Z`);
	if (!DATE.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
		errors.push(`'${date}' isn't a valid date. Use the form YYYY-MM-DD, for example ${today}.`);
	}

	// Omitted image keeps the current one; "" removes it.
	const image = input.image === undefined ? old.image : input.image.trim() || undefined;
	let imageAlt = input.imageAlt?.trim() ? input.imageAlt : undefined;
	if (image) {
		checkImage(image, library, errors);
		if (!imageAlt && image === old.image) imageAlt = old.imageAlt;
		if (!imageAlt?.trim()) errors.push(POST_ALT);
		else if (HTML.test(imageAlt)) errors.push(NO_HTML);
	}

	checkBody(input.body, errors);

	if (errors.length) return { ok: false, errors: dedupe(errors) };
	const data: PostData = {
		title: input.title,
		description: input.description,
		date,
		draft: input.draft ?? (typeof old.draft === "boolean" ? old.draft : false),
	};
	if (image) Object.assign(data, { image, imageAlt });
	return { ok: true, value: { data, body: input.body } };
}

// ---------- preview status ----------

export type CheckRun = {
	name: string;
	status: string;
	conclusion: string | null;
	external_id: string | null;
	started_at: string | null;
};
export type PreviewStatus = "ready" | "building" | "failed" | "unknown";

/**
 * Status of the Workers Builds runs on the staging head commit. Each build posts
 * an in_progress record that is never updated plus a completed one, so group by
 * build ID (external_id).
 */
export function previewStatus(runs: CheckRun[], commitDate: Date, now: Date): PreviewStatus {
	const minutes = (iso: string | null) => (iso ? (now.getTime() - new Date(iso).getTime()) / 60000 : Infinity);
	const builds = new Map<string, CheckRun[]>();
	for (const run of runs.filter((r) => r.name.startsWith("Workers Builds"))) {
		const id = run.external_id ?? run.name;
		builds.set(id, [...(builds.get(id) ?? []), run]);
	}
	let building = false;
	let failed = false;
	let done = 0;
	for (const records of builds.values()) {
		const completed = records.find((r) => r.status === "completed");
		if (!completed) {
			if (records.some((r) => minutes(r.started_at) < 15)) building = true;
			continue;
		}
		done++;
		if (completed.conclusion !== "success") failed = true;
	}
	if (building) return "building";
	if (failed) return "failed";
	if (done) return "ready";
	return minutes(commitDate.toISOString()) < 10 ? "building" : "unknown";
}
