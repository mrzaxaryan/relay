import type { AgentConnection } from "./types";

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
