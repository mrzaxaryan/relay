import type { AgentConn } from "./types";

export function corsHeaders(): HeadersInit {
	return {
		"Access-Control-Allow-Origin": "*",
		"Access-Control-Allow-Methods": "GET, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type, Upgrade",
	};
}

export function jsonResponse(body: object, status: number = 200): Response {
	return new Response(JSON.stringify(body, null, 2), {
		status,
		headers: { "Content-Type": "application/json", ...corsHeaders() },
	});
}

export function agentStatus(a: AgentConn) {
	return {
		id: a.id,
		connectedAt: a.connectedAt,
		relayed: a.relayId !== null,
		relayId: a.relayId,
		messageCount: a.messageCount,
		lastActiveAt: a.lastActiveAt,
		...a.info,
	};
}

export function trySend(ws: WebSocket, data: object | string): void {
	try {
		ws.send(typeof data === "string" ? data : JSON.stringify(data));
	} catch {}
}
