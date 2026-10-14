// Secrets set with `npx wrangler secret put`. `wrangler types` can't see them.
interface __BaseEnv_Env {
	GITHUB_CLIENT_ID: string;
	GITHUB_CLIENT_SECRET: string;
	COOKIE_ENCRYPTION_KEY: string;
}
