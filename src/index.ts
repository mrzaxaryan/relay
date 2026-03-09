// WebSocket Relay Server
// Cloudflare Workers + Durable Objects
//
// Endpoints:
//   /             — API documentation (JSON)
//   /status       — Live status + connection data (JSON)
//   /agent        — Agent WebSocket connections
//   /relay/:id    — Relay WebSocket (1:1 exclusive pairing to an agent)
//   /events       — Live WebSocket feed of agent connect/disconnect events

import type { Env } from "./types";
import { corsHeaders } from "./utils";

export { RelayHub } from "./hub";
export type { Env } from "./types";

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		if (request.method === "OPTIONS") {
			return new Response(null, { status: 204, headers: corsHeaders() });
		}

		const id = env.RELAY_HUB.idFromName("global");
		const stub = env.RELAY_HUB.get(id);
		return stub.fetch(request);
	},
};
