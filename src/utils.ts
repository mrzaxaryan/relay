import type { AgentConnection, Env } from "./types";

export function authenticate(request: Request, env: Env): Response | null {
	const url = new URL(request.url);

	// Accept token from Authorization header or ?token= query param
	const headerAuth = request.headers.get("Authorization");
	const headerToken = headerAuth?.startsWith("Bearer ") ? headerAuth.slice(7) : null;
	const queryToken = url.searchParams.get("token");
	const token = headerToken || queryToken;

	if (!token) {
		return jsonResponse({ error: "unauthorized", message: "Missing or invalid Authorization header" }, 401);
	}

	if (token !== env.AUTH_TOKEN) {
		return jsonResponse({ error: "forbidden", message: "Token does not have access to this resource" }, 403);
	}

	return null; // authorized
}

export function corsHeaders(): HeadersInit {
	return {
		"Access-Control-Allow-Origin": "*",
		"Access-Control-Allow-Methods": "GET, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type, Upgrade, Authorization",
	};
}

export function jsonResponse(body: object, status: number = 200): Response {
	return new Response(JSON.stringify(body, null, 2), {
		status,
		headers: { "Content-Type": "application/json", ...corsHeaders() },
	});
}

export function toAgentStatus(agent: AgentConnection) {
	return {
		id: agent.id,
		connectedAt: agent.connectedAt,
		paired: agent.pairedRelayId !== null,
		pairedRelayId: agent.pairedRelayId,
		messagesForwarded: agent.messagesForwarded,
		lastActiveAt: agent.lastActiveAt,
		...agent.metadata,
	};
}

export function safeSend(ws: WebSocket, data: object | string): void {
	try {
		ws.send(typeof data === "string" ? data : JSON.stringify(data));
	} catch {}
}
