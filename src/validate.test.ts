import { describe, expect, it } from "vitest";
import {
	NO_HTML,
	POST_ALT,
	parseFile,
	previewStatus,
	renderFile,
	renderNew,
	validatePageUpdate,
	validatePost,
	type CheckRun,
	type PostInput,
} from "./validate";

const library = ["kitchen.avif", "roof.avif"];
const home = {
	data: {
		seoTitle: "Home",
		seoDescription: "Our home page",
		heroHeading: "Careful building",
		heroImage: "kitchen.avif",
		heroImageAlt: "A white kitchen",
		towns: ["Harrowgate", "Millbrook"],
		services: [
			{ title: "Kitchens", text: "New layouts" },
			{ title: "Decks", text: "Cedar decks" },
		],
	},
	body: "",
};
const about = { data: { seoTitle: "About", seoDescription: "About us" }, body: "## Who we are\n\nA small crew." };
const page = (fields?: Record<string, unknown>, body?: string, existing: typeof home | typeof about | null = home) =>
	validatePageUpdate({ page: "home", pages: ["site", "home", "about", "blog"], existing, fields, body, library });
const errors = (r: { ok: boolean; errors?: string[] }) => (r.ok ? [] : r.errors!).join("\n");

describe("update_page", () => {
	it("edits an existing page / refuses a page that doesn't exist", () => {
		expect(page({ heroHeading: "New words" }).ok).toBe(true);
		const r = validatePageUpdate({ page: "services", pages: ["site", "home", "about", "blog"], existing: null, library });
		expect(errors(r)).toBe("There's no page called 'services'. Pages are added by your developer. Editable pages: site, home, about, blog.");
	});

	it("allows existing fields / refuses new ones", () => {
		expect(page({ towns: ["Harrowgate"] }).ok).toBe(true);
		expect(errors(page({ heroColour: "red" }))).toMatch(/The home page has no 'heroColour' field. Fields you can change on home: seoTitle/);
	});

	it("keeps types / refuses a type change", () => {
		expect(page({ services: [{ title: "Roofs", text: "Repairs" }] }).ok).toBe(true);
		expect(errors(page({ heroHeading: ["a", "b"] }))).toBe("'heroHeading' is a single piece of text.");
		expect(errors(page({ towns: "Harrowgate" }))).toBe("'towns' is a list of short texts. Send the whole list.");
	});

	it("accepts cards with the same parts / refuses different parts", () => {
		expect(page({ services: [{ text: "Repairs", title: "Roofs" }] }).ok).toBe(true);
		expect(errors(page({ services: [{ title: "Roofs" }] }))).toBe(
			"Each item in 'services' needs exactly these parts: text, title. Item 1 has: title.",
		);
	});

	it("refuses empty values and empty lists", () => {
		expect(errors(page({ heroHeading: "  " }))).toMatch(/^'heroHeading' can't be empty/);
		expect(errors(page({ services: [{ title: "", text: "x" }] }))).toMatch(/^'title' in item 1 of 'services' can't be empty/);
		expect(errors(page({ towns: [] }))).toBe("'towns' needs at least one item.");
	});

	it("refuses HTML in fields and bodies", () => {
		expect(errors(page({ heroHeading: '<span style="color:red">Hi</span>' }))).toBe(NO_HTML);
		expect(errors(page(undefined, "<b>Bold</b> words", about))).toBe(NO_HTML);
	});

	it("edits a body / refuses a body on a page without one, or a # heading", () => {
		expect(page(undefined, "## Who we are\n\nStill small.", about).ok).toBe(true);
		expect(errors(page(undefined, "Some text"))).toMatch(/^The home page doesn't have a main text area/);
		expect(errors(page(undefined, "# Big heading\n\nText", about))).toMatch(/headings in the text start at ##/);
	});

	it("requires a new description when a photo changes", () => {
		expect(page({ heroImage: "roof.avif", heroImageAlt: "Two roofers at work" }).ok).toBe(true);
		expect(page({ heroImageAlt: "A bright white kitchen" }).ok).toBe(true);
		expect(errors(page({ heroImage: "roof.avif" }))).toMatch(
			/^When you change a photo, please describe the new one in a few plain words in the same edit \(heroImageAlt\)/,
		);
		expect(errors(page({ heroImageAlt: "" }))).toMatch(/^'heroImageAlt' can't be empty/);
	});

	it("only allows images from the library", () => {
		expect(errors(page({ heroImage: "cat.png", heroImageAlt: "A cat" }))).toMatch(
			/^There's no image called 'cat.png' in the image library. Images you can use: kitchen.avif, roof.avif/,
		);
	});
});

const post = (input: Partial<PostInput> = {}, existing: { data: Record<string, unknown> } | null = null) =>
	validatePost({
		input: { slug: "deck-checklist", title: "Deck checklist", description: "What to check.", body: "Some text.", ...input },
		existing,
		library,
		today: "2026-10-14",
	});

describe("save_post", () => {
	it("accepts a good slug / refuses a bad one", () => {
		expect(post().ok).toBe(true);
		expect(errors(post({ slug: "Deck Checklist!" }))).toMatch(/can't be used as the post's web address/);
	});

	it("limits the description to 160 characters", () => {
		expect(post({ description: "x".repeat(160) }).ok).toBe(true);
		expect(errors(post({ description: "x".repeat(161) }))).toMatch(/^The description is 161 characters/);
	});

	it("defaults the date to today / refuses an invalid date", () => {
		const r = post();
		expect(r.ok && r.value.data.date).toBe("2026-10-14");
		expect(errors(post({ date: "2026-02-30" }))).toMatch(/^'2026-02-30' isn't a valid date/);
	});

	it("requires imageAlt with an image from the library", () => {
		expect(post({ image: "roof.avif", imageAlt: "Two roofers at work" }).ok).toBe(true);
		expect(errors(post({ image: "roof.avif" }))).toBe(POST_ALT);
		expect(errors(post({ image: "cat.png", imageAlt: "A cat" }))).toMatch(/^There's no image called 'cat.png'/);
	});

	it("keeps an existing image and its description when image is left out", () => {
		const r = post({}, { data: { date: "2026-01-02", draft: true, image: "roof.avif", imageAlt: "Roofers" } });
		expect(r.ok && r.value.data).toEqual({
			title: "Deck checklist",
			description: "What to check.",
			date: "2026-01-02",
			draft: true,
			image: "roof.avif",
			imageAlt: "Roofers",
		});
	});

	it("refuses an empty body or HTML", () => {
		expect(errors(post({ body: " " }))).toBe("The main text can't be empty.");
		expect(errors(post({ body: "<div>Hi</div>" }))).toBe(NO_HTML);
	});
});

describe("files", () => {
	it("writes posts with an unquoted date that reads back the same", () => {
		const text = renderNew({ title: "Deck checklist", description: "true", date: "2026-10-14", draft: false }, "Body.");
		expect(text).toContain("date: 2026-10-14\n");
		expect(parseFile(text).data).toEqual({ title: "Deck checklist", description: "true", date: "2026-10-14", draft: false });
		expect(parseFile(text).body.trim()).toBe("Body.");
	});

	it("changes one page field and leaves the rest as written, quoting style included", () => {
		const src = '---\nseoTitle: "Home"\nheroHeading: "Old"\nlong: "x"\n---\n';
		const file = parseFile(src);
		file.doc.set("heroHeading", "New");
		expect(renderFile(file.doc, file.body)).toBe('---\nseoTitle: "Home"\nheroHeading: "New"\nlong: "x"\n---\n');
	});
});

describe("preview status", () => {
	const now = new Date("2026-10-14T14:00:00Z");
	const run = (id: string, status: string, conclusion: string | null, minutesAgo: number): CheckRun => ({
		name: "Workers Builds: site",
		status,
		conclusion,
		external_id: id,
		started_at: new Date(now.getTime() - minutesAgo * 60000).toISOString(),
	});
	const old = new Date("2026-10-14T13:00:00Z");

	it("is ready when every build finished, ignoring the stale in-progress records", () => {
		expect(previewStatus([run("a", "in_progress", null, 3), run("a", "completed", "success", 2)], old, now)).toBe("ready");
	});
	it("is building while a build has no completed record", () => {
		expect(previewStatus([run("a", "in_progress", null, 1)], old, now)).toBe("building");
	});
	it("ignores builds stuck for over 15 minutes", () => {
		expect(previewStatus([run("a", "in_progress", null, 30), run("b", "completed", "success", 20)], old, now)).toBe("ready");
	});
	it("is failed when a finished build failed", () => {
		expect(previewStatus([run("a", "in_progress", null, 3), run("a", "completed", "failure", 2)], old, now)).toBe("failed");
	});
	it("is building for a fresh commit with no runs yet, unknown for an old one", () => {
		expect(previewStatus([], new Date("2026-10-14T13:58:00Z"), now)).toBe("building");
		expect(previewStatus([], old, now)).toBe("unknown");
	});
});
