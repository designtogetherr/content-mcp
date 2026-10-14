import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { env } from "cloudflare:workers";
import { GitHubHandler } from "./github-handler";
import { INSTRUCTIONS, registerTools } from "./tools";

// A fresh server per request (the handler is stateless).
function createServer() {
	const server = new McpServer({ name: "content-mcp", version: "1.0.0" }, { instructions: INSTRUCTIONS });
	registerTools(server, env);
	return server;
}

const mcpHandler = createMcpHandler(createServer, { route: "/mcp" });

export default new OAuthProvider({
	// OAuthProvider calls `fetch(request, env, ctx)`. The handler must get `ctx`
	// (it carries the signed-in user's props), and `mcpHandler.fetch` takes
	// different arguments, so call the handler itself.
	apiHandler: { fetch: (request, env, ctx) => mcpHandler(request, env, ctx) },
	apiRoute: "/mcp",
	authorizeEndpoint: "/authorize",
	clientRegistrationEndpoint: "/register",
	defaultHandler: GitHubHandler as any,
	tokenEndpoint: "/token",
});
