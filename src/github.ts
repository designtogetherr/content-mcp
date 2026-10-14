// The few GitHub calls content-mcp needs, made with the signed-in user's token
// so every commit is authored by them.
import { Octokit } from "octokit";
import type { CheckRun } from "./validate";

/** A message written for the person using Claude. Tools return it as-is. */
export class UserError extends Error {}

export const STALE =
	"Someone else just edited this. I've reloaded it; tell me again what to change.";

const status = (e: unknown) => (e as { status?: number }).status;

const toBase64 = (text: string) => {
	let binary = "";
	for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
	return btoa(binary);
};
const fromBase64 = (b64: string) =>
	new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\n/g, "")), (c) => c.charCodeAt(0)));

export function repo(token: string, owner: string, name: string, login: string) {
	const octokit = new Octokit({ auth: token });
	const r = { owner, repo: name };

	return {
		/** Throws a plain-English UserError unless the user can push to the repo. */
		async checkAccess(write: boolean) {
			try {
				const { data } = await octokit.rest.repos.get(r);
				if (write && !data.permissions?.push) {
					throw new UserError(
						`Your GitHub account (${login}) can view ${owner}/${name} but can't edit it. Ask your developer to give you write access.`,
					);
				}
			} catch (e) {
				if (e instanceof UserError) throw e;
				if (status(e) === 401) throw new UserError("Your GitHub sign-in has expired. Disconnect and reconnect the website tool, then try again.");
				if (status(e) === 403 || status(e) === 404) {
					throw new UserError(
						`Your GitHub account (${login}) doesn't have access to ${owner}/${name}. Ask your developer to give you write access.`,
					);
				}
				throw e;
			}
		},

		async readFile(path: string, ref: string): Promise<{ text: string; sha: string } | null> {
			try {
				const { data } = await octokit.rest.repos.getContent({ ...r, path, ref });
				if (Array.isArray(data) || data.type !== "file") return null;
				return { text: fromBase64(data.content), sha: data.sha };
			} catch (e) {
				if (status(e) === 404) return null;
				throw e;
			}
		},

		async listFiles(dir: string, ref: string): Promise<string[]> {
			try {
				const { data } = await octokit.rest.repos.getContent({ ...r, path: dir, ref });
				return Array.isArray(data) ? data.filter((f) => f.type === "file").map((f) => f.name) : [];
			} catch (e) {
				if (status(e) === 404) return [];
				throw e;
			}
		},

		async writeFile(path: string, text: string, message: string, branch: string, sha?: string) {
			try {
				await octokit.rest.repos.createOrUpdateFileContents({ ...r, path, branch, message, sha, content: toBase64(text) });
			} catch (e) {
				// 409: the file changed since we read it. 422: it now exists but we sent no sha.
				if (status(e) === 409 || (status(e) === 422 && /sha/i.test(String((e as Error).message)))) throw new UserError(STALE);
				throw e;
			}
		},

		async head(branch: string) {
			const { data } = await octokit.rest.repos.getCommit({ ...r, ref: branch });
			return { sha: data.sha, message: data.commit.message.split("\n")[0], date: new Date(data.commit.committer?.date ?? Date.now()) };
		},

		/** Files changed on `head` since it left `base`. */
		async changes(base: string, head: string) {
			const { data } = await octokit.rest.repos.compareCommits({ ...r, base, head });
			return { ahead: data.ahead_by, files: (data.files ?? []).map((f) => f.filename) };
		},

		/** Merges head into base. Returns the merge commit sha, or null on a conflict. */
		async merge(base: string, head: string, message: string): Promise<string | null> {
			try {
				const res = await octokit.rest.repos.merge({ ...r, base, head, commit_message: message });
				return res.status === 201 ? res.data.sha : (await this.head(base)).sha;
			} catch (e) {
				if (status(e) === 409) return null;
				throw e;
			}
		},

		async moveBranch(branch: string, sha: string, force: boolean) {
			await octokit.rest.git.updateRef({ ...r, ref: `heads/${branch}`, sha, force });
		},

		async checkRuns(sha: string): Promise<CheckRun[]> {
			const { data } = await octokit.rest.checks.listForRef({ ...r, ref: sha, filter: "all", per_page: 100 });
			return data.check_runs;
		},
	};
}

export type Repo = ReturnType<typeof repo>;
