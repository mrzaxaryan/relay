// WebSocket Relay Server
// Cloudflare Workers + Durable Objects
//
// Endpoints:
//   /             — API documentation (JSON)
//   /health       — Live status + connection data (JSON)
//   /ws           — Agent WebSocket connections
//   /relay/:id    — Relay WebSocket (1:1 exclusive coupling to an agent)
//   /events       — Live WebSocket feed of agent connect/disconnect events

import type { Env } from "./types";
import { corsHeaders } from "./utils";

export { WebSocketPool } from "./pool";
export type { Env } from "./types";

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		if (request.method === "OPTIONS") {
			return new Response(null, { status: 204, headers: corsHeaders() });
		}

		const id = env.WS_POOL.idFromName("global");
		const stub = env.WS_POOL.get(id);
		return stub.fetch(request);
	},
};
