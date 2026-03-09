// WebSocket Relay Server
// Cloudflare Workers + Durable Objects
//
// Endpoints:
//   /             — API documentation (JSON)
//   /health       — Live status + connection data (JSON)
//   /ws           — Agent WebSocket connections
//   /relay/:id    — Relay WebSocket (1:1 exclusive coupling to an agent)
//   /events       — Live WebSocket feed of agent connect/disconnect events

export interface Env {
	WS_POOL: DurableObjectNamespace;
}

// ─── Worker Entry Point ───────────────────────────────────────────────

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		const id = env.WS_POOL.idFromName("global");
		const stub = env.WS_POOL.get(id);

		if (url.pathname === "/") {
			return stub.fetch(request);
		}

		if (url.pathname === "/health") {
			return stub.fetch(request);
		}

		if (url.pathname === "/ws") {
			return stub.fetch(request);
		}

		if (url.pathname === "/events") {
			return stub.fetch(request);
		}

		const relayMatch = url.pathname.match(/^\/relay\/(.+)$/);
		if (relayMatch) {
			return stub.fetch(request);
		}

		return new Response("Not Found", { status: 404 });
	},
};

// ─── Connection Types ─────────────────────────────────────────────────

interface AgentInfo {
	ip: string;
	country: string;
	city: string;
	region: string;
	continent: string;
	timezone: string;
	postalCode: string;
	latitude: string;
	longitude: string;
	asn: number;
	asOrganization: string;
	userAgent: string;
	protocol: string;
	tlsVersion: string;
	httpVersion: string;
}

interface AgentConn {
	id: string;
	ws: WebSocket;
	connectedAt: number;
	relayId: string | null;
	info: AgentInfo;
	messageCount: number;
	lastActiveAt: number;
}

interface RelayConn {
	id: string;
	ws: WebSocket;
	connectedAt: number;
	agentId: string;
}

interface EventListenerConn {
	id: string;
	ws: WebSocket;
	connectedAt: number;
	info: {
		ip: string;
		country: string;
		city: string;
		userAgent: string;
	};
}

// ─── Durable Object: WebSocketPool ────────────────────────────────────

export class WebSocketPool {
	private agents: Map<string, AgentConn> = new Map();
	private relays: Map<string, RelayConn> = new Map();
	private eventListeners: Map<string, EventListenerConn> = new Map();
	private idCounter: number = 0;

	constructor(
		private state: DurableObjectState,
		private env: Env
	) {}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === "/") {
			return this.handleDocs(url);
		}

		if (url.pathname === "/health") {
			return this.handleStatus();
		}

		if (url.pathname === "/ws") {
			return this.handleAgentUpgrade(request);
		}

		if (url.pathname === "/events") {
			return this.handleEventsUpgrade(request);
		}

		const relayMatch = url.pathname.match(/^\/relay\/(.+)$/);
		if (relayMatch) {
			return this.handleRelayUpgrade(request, relayMatch[1]);
		}

		return new Response("Not Found", { status: 404 });
	}

	// ── API Documentation ───────────────────────────────────────────

	private handleDocs(url: URL): Response {
		const base = `${url.protocol}//${url.host}`;

		const docs = {
			service: "relay",
			description: "WebSocket relay server for Position-Independent-Agent and Command Center",
			repos: {
				relay: "https://github.com/mrzaxaryan/relay",
				agent: "https://github.com/mrzaxaryan/Position-Independent-Agent",
				cc: "https://github.com/mrzaxaryan/cc",
			},
			endpoints: [
				{
					method: "GET",
					path: "/",
					url: `${base}/`,
					description: "API documentation (this response)",
					returns: "ApiDocs",
				},
				{
					method: "GET",
					path: "/health",
					url: `${base}/health`,
					description: "Live status — connected agents, relays, and event listeners with full connection details",
					returns: "HealthStatus",
				},
				{
					method: "WS",
					path: "/ws",
					url: `${base}/ws`,
					description: "Agent WebSocket connection. Server assigns an ID and broadcasts agent_connected to event listeners.",
					messages: {
						incoming: "any (forwarded to coupled relay)",
						outgoing: "any (forwarded from coupled relay)",
					},
				},
				{
					method: "WS",
					path: "/relay/:agentId",
					url: `${base}/relay/{agentId}`,
					description: "Relay WebSocket — 1:1 exclusive coupling to an agent. Returns 404 if agent not found, 409 if already relayed.",
					messages: {
						incoming: "any (forwarded to coupled agent)",
						outgoing: "any (forwarded from coupled agent)",
						onConnect: "{ type: 'coupled', relayId, agentId }",
						onAgentDisconnect: "{ type: 'agent_disconnected', agentId }",
					},
					errors: {
						404: "{ error: 'agent_not_found', agentId }",
						409: "{ error: 'agent_already_relayed', agentId, relayId }",
					},
				},
				{
					method: "WS",
					path: "/events",
					url: `${base}/events`,
					description: "Live feed — sends all agents on connect, then agent_connected / agent_disconnected events",
					messages: {
						onConnect: "{ type: 'agents', agents: AgentStatus[] }",
						events: [
							"{ type: 'agent_connected', agent: AgentStatus }",
							"{ type: 'agent_disconnected', agentId: string }",
						],
					},
				},
			],
			types: {
				AgentInfo: {
					description: "Connection metadata collected from Cloudflare request",
					fields: {
						ip: "string",
						country: "string",
						city: "string",
						region: "string",
						continent: "string",
						timezone: "string",
						postalCode: "string",
						latitude: "string",
						longitude: "string",
						asn: "number",
						asOrganization: "string",
						userAgent: "string",
						protocol: "string",
						tlsVersion: "string",
						httpVersion: "string",
					},
				},
				AgentStatus: {
					description: "Agent connection state (returned in /health and /events)",
					fields: {
						id: "string",
						connectedAt: "number (unix ms)",
						relayed: "boolean",
						relayId: "string | null",
						messageCount: "number",
						lastActiveAt: "number (unix ms)",
						"...AgentInfo": "spread",
					},
				},
				RelayStatus: {
					description: "Relay connection state (returned in /health)",
					fields: {
						id: "string",
						connectedAt: "number (unix ms)",
						agentId: "string",
					},
				},
				EventListenerStatus: {
					description: "Event listener connection state (returned in /health)",
					fields: {
						id: "string",
						connectedAt: "number (unix ms)",
						ip: "string",
						country: "string",
						city: "string",
						userAgent: "string",
					},
				},
				HealthStatus: {
					description: "Response from GET /health",
					fields: {
						agents: "{ count: number, connections: AgentStatus[] }",
						relays: "{ count: number, connections: RelayStatus[] }",
						eventListeners: "{ count: number, connections: EventListenerStatus[] }",
					},
				},
			},
		};

		return new Response(JSON.stringify(docs, null, 2), {
			headers: {
				"Content-Type": "application/json",
				"Access-Control-Allow-Origin": "*",
			},
		});
	}

	// ── Status endpoint ──────────────────────────────────────────────

	private handleStatus(): Response {
		const agents = Array.from(this.agents.values()).map((a) => ({
			id: a.id,
			connectedAt: a.connectedAt,
			relayed: a.relayId !== null,
			relayId: a.relayId,
			messageCount: a.messageCount,
			lastActiveAt: a.lastActiveAt,
			...a.info,
		}));

		const relays = Array.from(this.relays.values()).map((r) => ({
			id: r.id,
			connectedAt: r.connectedAt,
			agentId: r.agentId,
		}));

		return new Response(
			JSON.stringify({
				agents: { count: agents.length, connections: agents },
				relays: { count: relays.length, connections: relays },
				eventListeners: {
					count: this.eventListeners.size,
					connections: Array.from(this.eventListeners.values()).map((e) => ({
						id: e.id,
						connectedAt: e.connectedAt,
						...e.info,
					})),
				},
			}, null, 2),
			{
				headers: {
					"Content-Type": "application/json",
					"Access-Control-Allow-Origin": "*",
				},
			}
		);
	}

	// ── Events WebSocket (live agent feed) ───────────────────────────

	private handleEventsUpgrade(request: Request): Response {
		const upgrade = request.headers.get("Upgrade");
		if (!upgrade || upgrade.toLowerCase() !== "websocket") {
			return new Response("Expected WebSocket upgrade", { status: 426 });
		}

		const pair = new WebSocketPair();
		const [client, server] = [pair[0], pair[1]];

		const id = `listener-${++this.idCounter}-${Date.now().toString(36)}`;
		const cf = (request as any).cf || {};
		const conn: EventListenerConn = {
			id,
			ws: server,
			connectedAt: Date.now(),
			info: {
				ip: request.headers.get("CF-Connecting-IP") || "",
				country: cf.country || "",
				city: cf.city || "",
				userAgent: request.headers.get("User-Agent") || "",
			},
		};

		server.accept();
		this.eventListeners.set(id, conn);

		// Send current agents snapshot
		const agents = Array.from(this.agents.values()).map((a) => ({
			id: a.id,
			connectedAt: a.connectedAt,
			relayed: a.relayId !== null,
			relayId: a.relayId,
			messageCount: a.messageCount,
			lastActiveAt: a.lastActiveAt,
			...a.info,
		}));

		trySend(server, { type: "agents", agents });

		server.addEventListener("close", () => {
			this.eventListeners.delete(id);
		});

		server.addEventListener("error", () => {
			this.eventListeners.delete(id);
		});

		return new Response(null, { status: 101, webSocket: client });
	}

	private broadcastEvent(event: object): void {
		const msg = JSON.stringify(event);
		for (const [id, conn] of this.eventListeners) {
			try {
				conn.ws.send(msg);
			} catch {
				this.eventListeners.delete(id);
			}
		}
	}

	// ── Agent WebSocket ─────────────────────────────────────────────

	private handleAgentUpgrade(request: Request): Response {
		const upgrade = request.headers.get("Upgrade");
		if (!upgrade || upgrade.toLowerCase() !== "websocket") {
			return new Response("Expected WebSocket upgrade", { status: 426 });
		}

		const pair = new WebSocketPair();
		const [client, server] = [pair[0], pair[1]];

		const id = `agent-${++this.idCounter}-${Date.now().toString(36)}`;
		const cf = (request as any).cf || {};
		const conn: AgentConn = {
			id,
			ws: server,
			connectedAt: Date.now(),
			relayId: null,
			info: {
				ip: request.headers.get("CF-Connecting-IP") || "",
				country: cf.country || "",
				city: cf.city || "",
				region: cf.region || "",
				continent: cf.continent || "",
				timezone: cf.timezone || "",
				postalCode: cf.postalCode || "",
				latitude: cf.latitude || "",
				longitude: cf.longitude || "",
				asn: cf.asn || 0,
				asOrganization: cf.asOrganization || "",
				userAgent: request.headers.get("User-Agent") || "",
				protocol: cf.requestPriority || "",
				tlsVersion: cf.tlsVersion || "",
				httpVersion: cf.httpProtocol || "",
			},
			messageCount: 0,
			lastActiveAt: Date.now(),
		};

		this.agents.set(id, conn);
		server.accept();

		this.broadcastEvent({
			type: "agent_connected",
			agent: {
				id: conn.id,
				connectedAt: conn.connectedAt,
				relayed: false,
				relayId: null,
				messageCount: 0,
				lastActiveAt: conn.lastActiveAt,
				...conn.info,
			},
		});

		server.addEventListener("message", (event) => {
			this.onAgentMessage(id, event.data);
		});

		server.addEventListener("close", () => {
			this.onAgentDisconnect(id);
		});

		server.addEventListener("error", () => {
			this.onAgentDisconnect(id);
		});

		return new Response(null, { status: 101, webSocket: client });
	}

	private onAgentMessage(agentId: string, data: string | ArrayBuffer): void {
		const conn = this.agents.get(agentId);
		if (!conn) return;

		conn.messageCount++;
		conn.lastActiveAt = Date.now();

		if (!conn.relayId) return;

		const relay = this.relays.get(conn.relayId);
		if (!relay) return;

		try {
			if (typeof data === "string") {
				relay.ws.send(data);
			} else {
				relay.ws.send(data);
			}
		} catch {
			this.onRelayDisconnect(conn.relayId);
		}
	}

	private onAgentDisconnect(agentId: string): void {
		const conn = this.agents.get(agentId);
		if (!conn) return;

		if (conn.relayId) {
			const relay = this.relays.get(conn.relayId);
			if (relay) {
				trySend(relay.ws, { type: "agent_disconnected", agentId });
				try {
					relay.ws.close(1000, "agent disconnected");
				} catch {}
				this.relays.delete(conn.relayId);
			}
		}

		try {
			conn.ws.close(1000, "disconnect");
		} catch {}
		this.agents.delete(agentId);

		this.broadcastEvent({ type: "agent_disconnected", agentId });
	}

	// ── Relay WebSocket ──────────────────────────────────────────────

	private handleRelayUpgrade(request: Request, agentId: string): Response {
		const upgrade = request.headers.get("Upgrade");
		if (!upgrade || upgrade.toLowerCase() !== "websocket") {
			return new Response("Expected WebSocket upgrade", { status: 426 });
		}

		const agent = this.agents.get(agentId);
		if (!agent) {
			return new Response(
				JSON.stringify({ error: "agent_not_found", agentId }),
				{ status: 404, headers: { "Content-Type": "application/json" } }
			);
		}

		if (agent.relayId) {
			return new Response(
				JSON.stringify({ error: "agent_already_relayed", agentId, relayId: agent.relayId }),
				{ status: 409, headers: { "Content-Type": "application/json" } }
			);
		}

		const pair = new WebSocketPair();
		const [ws, server] = [pair[0], pair[1]];

		const relayId = `relay-${++this.idCounter}-${Date.now().toString(36)}`;
		const conn: RelayConn = {
			id: relayId,
			ws: server,
			connectedAt: Date.now(),
			agentId,
		};

		this.relays.set(relayId, conn);
		agent.relayId = relayId;
		server.accept();

		server.send(JSON.stringify({ type: "coupled", relayId, agentId }));

		server.addEventListener("message", (event) => {
			this.onRelayMessage(relayId, event.data);
		});

		server.addEventListener("close", () => {
			this.onRelayDisconnect(relayId);
		});

		server.addEventListener("error", () => {
			this.onRelayDisconnect(relayId);
		});

		return new Response(null, { status: 101, webSocket: ws });
	}

	private onRelayMessage(relayId: string, data: string | ArrayBuffer): void {
		const relay = this.relays.get(relayId);
		if (!relay) return;

		const agent = this.agents.get(relay.agentId);
		if (!agent) return;

		try {
			if (typeof data === "string") {
				agent.ws.send(data);
			} else {
				agent.ws.send(data);
			}
		} catch {
			this.onAgentDisconnect(relay.agentId);
		}
	}

	private onRelayDisconnect(relayId: string): void {
		const relay = this.relays.get(relayId);
		if (!relay) return;

		const agent = this.agents.get(relay.agentId);
		if (agent) {
			agent.relayId = null;
		}

		try {
			relay.ws.close(1000, "disconnect");
		} catch {}
		this.relays.delete(relayId);
	}
}

// ─── Utilities ────────────────────────────────────────────────────────

function trySend(ws: WebSocket, data: object | string): void {
	try {
		ws.send(typeof data === "string" ? data : JSON.stringify(data));
	} catch {}
}
