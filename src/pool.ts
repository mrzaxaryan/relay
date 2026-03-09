import type { Env, AgentInfo, AgentConn, RelayConn, EventListenerConn } from "./types";
import { corsHeaders, jsonResponse, agentStatus, trySend } from "./utils";

export class WebSocketPool {
	private agents: Map<string, AgentConn> = new Map();
	private relays: Map<string, RelayConn> = new Map();
	private eventListeners: Map<string, EventListenerConn> = new Map();
	private loaded = false;

	constructor(
		private ctx: DurableObjectState,
		private env: Env
	) {}

	// ── State hydration (survives hibernation) ─────────────────────

	private async ensureLoaded(): Promise<void> {
		if (this.loaded) return;
		this.loaded = true;

		const stored = await this.ctx.storage.list();
		const sockets = this.ctx.getWebSockets();

		for (const ws of sockets) {
			const tags = this.ctx.getTags(ws);
			if (!tags || tags.length < 2) continue;
			const [type, id] = tags;

			if (type === "agent") {
				const meta = stored.get(`agent:${id}`) as
					| { connectedAt: number; relayId: string | null; info: AgentInfo }
					| undefined;
				if (meta) {
					this.agents.set(id, {
						id,
						ws,
						connectedAt: meta.connectedAt,
						relayId: meta.relayId,
						info: meta.info,
						messageCount: 0,
						lastActiveAt: meta.connectedAt,
					});
				}
			} else if (type === "relay") {
				const meta = stored.get(`relay:${id}`) as
					| { connectedAt: number; agentId: string }
					| undefined;
				if (meta) {
					this.relays.set(id, { id, ws, connectedAt: meta.connectedAt, agentId: meta.agentId });
				}
			} else if (type === "listener") {
				const meta = stored.get(`listener:${id}`) as
					| { connectedAt: number; info: { ip: string; country: string; city: string; userAgent: string } }
					| undefined;
				if (meta) {
					this.eventListeners.set(id, { id, ws, connectedAt: meta.connectedAt, info: meta.info });
				}
			}
		}
	}

	private generateId(prefix: string): string {
		const rand = Math.random().toString(36).slice(2, 8);
		return `${prefix}-${Date.now().toString(36)}-${rand}`;
	}

	// ── Hibernation WebSocket handlers ──────────────────────────────

	async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer): Promise<void> {
		await this.ensureLoaded();
		const [type, id] = (this.ctx.getTags(ws) ?? []);

		if (type === "agent") {
			this.onAgentMessage(id, data);
		} else if (type === "relay") {
			this.onRelayMessage(id, data);
		}
		// event listeners don't send meaningful messages
	}

	async webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {
		await this.ensureLoaded();
		const [type, id] = (this.ctx.getTags(ws) ?? []);

		if (type === "agent") {
			await this.onAgentDisconnect(id);
		} else if (type === "relay") {
			await this.onRelayDisconnect(id);
		} else if (type === "listener") {
			this.eventListeners.delete(id);
			await this.ctx.storage.delete(`listener:${id}`);
		}
	}

	async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
		await this.ensureLoaded();
		const [type, id] = (this.ctx.getTags(ws) ?? []);

		if (type === "agent") {
			await this.onAgentDisconnect(id);
		} else if (type === "relay") {
			await this.onRelayDisconnect(id);
		} else if (type === "listener") {
			this.eventListeners.delete(id);
			await this.ctx.storage.delete(`listener:${id}`);
		}
	}

	// ── HTTP routing ────────────────────────────────────────────────

	async fetch(request: Request): Promise<Response> {
		await this.ensureLoaded();
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

		return new Response("Not Found", { status: 404, headers: corsHeaders() });
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
					description: "Live feed — sends all agents on connect, then real-time agent and relay events",
					messages: {
						onConnect: "{ type: 'agents', agents: AgentStatus[] }",
						events: [
							"{ type: 'agent_connected', agent: AgentStatus }",
							"{ type: 'agent_disconnected', agentId: string }",
							"{ type: 'agent_relayed', agentId: string, relayId: string }",
							"{ type: 'agent_unrelayed', agentId: string, relayId: string }",
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
				Events: {
					description: "WebSocket events sent to /events listeners",
					types: {
						agent_connected: {
							description: "Fired when a new agent connects to /ws",
							fields: { type: "'agent_connected'", agent: "AgentStatus" },
						},
						agent_disconnected: {
							description: "Fired when an agent disconnects",
							fields: { type: "'agent_disconnected'", agentId: "string" },
						},
						agent_relayed: {
							description: "Fired when a relay couples to an agent via /relay/:agentId",
							fields: { type: "'agent_relayed'", agentId: "string", relayId: "string" },
						},
						agent_unrelayed: {
							description: "Fired when a relay disconnects from an agent",
							fields: { type: "'agent_unrelayed'", agentId: "string", relayId: "string" },
						},
					},
				},
			},
		};

		return jsonResponse(docs);
	}

	// ── Status endpoint ──────────────────────────────────────────────

	private handleStatus(): Response {
		const agents = Array.from(this.agents.values()).map(agentStatus);

		const relays = Array.from(this.relays.values()).map((r) => ({
			id: r.id,
			connectedAt: r.connectedAt,
			agentId: r.agentId,
		}));

		return jsonResponse({
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
		});
	}

	// ── Events WebSocket (live agent feed) ───────────────────────────

	private async handleEventsUpgrade(request: Request): Promise<Response> {
		const upgrade = request.headers.get("Upgrade");
		if (!upgrade || upgrade.toLowerCase() !== "websocket") {
			return new Response("Expected WebSocket upgrade", { status: 426, headers: corsHeaders() });
		}

		const pair = new WebSocketPair();
		const [client, server] = [pair[0], pair[1]];

		const id = this.generateId("listener");
		const cf = (request as any).cf || {};
		const info = {
			ip: request.headers.get("CF-Connecting-IP") || "",
			country: cf.country || "",
			city: cf.city || "",
			userAgent: request.headers.get("User-Agent") || "",
		};
		const conn: EventListenerConn = {
			id,
			ws: server,
			connectedAt: Date.now(),
			info,
		};

		this.ctx.acceptWebSocket(server, ["listener", id]);
		this.eventListeners.set(id, conn);
		await this.ctx.storage.put(`listener:${id}`, { connectedAt: conn.connectedAt, info });

		// Send current agents snapshot
		trySend(server, {
			type: "agents",
			agents: Array.from(this.agents.values()).map(agentStatus),
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

	private async handleAgentUpgrade(request: Request): Promise<Response> {
		const upgrade = request.headers.get("Upgrade");
		if (!upgrade || upgrade.toLowerCase() !== "websocket") {
			return new Response("Expected WebSocket upgrade", { status: 426, headers: corsHeaders() });
		}

		const pair = new WebSocketPair();
		const [client, server] = [pair[0], pair[1]];

		const id = this.generateId("agent");
		const cf = (request as any).cf || {};
		const info: AgentInfo = {
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
		};
		const conn: AgentConn = {
			id,
			ws: server,
			connectedAt: Date.now(),
			relayId: null,
			info,
			messageCount: 0,
			lastActiveAt: Date.now(),
		};

		this.ctx.acceptWebSocket(server, ["agent", id]);
		this.agents.set(id, conn);
		await this.ctx.storage.put(`agent:${id}`, {
			connectedAt: conn.connectedAt,
			relayId: null,
			info,
		});

		this.broadcastEvent({ type: "agent_connected", agent: agentStatus(conn) });

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
			relay.ws.send(data);
		} catch {
			this.onRelayDisconnect(conn.relayId);
		}
	}

	private async onAgentDisconnect(agentId: string): Promise<void> {
		const conn = this.agents.get(agentId);
		if (!conn) return;

		if (conn.relayId) {
			const relay = this.relays.get(conn.relayId);
			if (relay) {
				try {
					relay.ws.close(1000, "agent disconnected");
				} catch {}
				this.relays.delete(conn.relayId);
				await this.ctx.storage.delete(`relay:${conn.relayId}`);
			}
			this.broadcastEvent({ type: "agent_unrelayed", agentId, relayId: conn.relayId });
		}

		try {
			conn.ws.close(1000, "disconnect");
		} catch {}
		this.agents.delete(agentId);
		await this.ctx.storage.delete(`agent:${agentId}`);

		this.broadcastEvent({ type: "agent_disconnected", agentId });
	}

	// ── Relay WebSocket ──────────────────────────────────────────────

	private async handleRelayUpgrade(request: Request, agentId: string): Promise<Response> {
		const upgrade = request.headers.get("Upgrade");
		if (!upgrade || upgrade.toLowerCase() !== "websocket") {
			return new Response("Expected WebSocket upgrade", { status: 426, headers: corsHeaders() });
		}

		const agent = this.agents.get(agentId);
		if (!agent) {
			return jsonResponse({ error: "agent_not_found", agentId }, 404);
		}

		if (agent.relayId) {
			return jsonResponse({ error: "agent_already_relayed", agentId, relayId: agent.relayId }, 409);
		}

		const pair = new WebSocketPair();
		const [ws, server] = [pair[0], pair[1]];

		const relayId = this.generateId("relay");
		const conn: RelayConn = {
			id: relayId,
			ws: server,
			connectedAt: Date.now(),
			agentId,
		};

		this.ctx.acceptWebSocket(server, ["relay", relayId]);
		this.relays.set(relayId, conn);
		agent.relayId = relayId;

		await Promise.all([
			this.ctx.storage.put(`relay:${relayId}`, { connectedAt: conn.connectedAt, agentId }),
			this.ctx.storage.put(`agent:${agent.id}`, {
				connectedAt: agent.connectedAt,
				relayId,
				info: agent.info,
			}),
		]);

		this.broadcastEvent({ type: "agent_relayed", agentId, relayId });

		return new Response(null, { status: 101, webSocket: ws });
	}

	private onRelayMessage(relayId: string, data: string | ArrayBuffer): void {
		const relay = this.relays.get(relayId);
		if (!relay) return;

		const agent = this.agents.get(relay.agentId);
		if (!agent) return;

		try {
			agent.ws.send(data);
		} catch {
			this.onRelayDisconnect(relayId);
		}
	}

	private async onRelayDisconnect(relayId: string): Promise<void> {
		const relay = this.relays.get(relayId);
		if (!relay) return;

		const agent = this.agents.get(relay.agentId);
		if (agent) {
			agent.relayId = null;
			await this.ctx.storage.put(`agent:${agent.id}`, {
				connectedAt: agent.connectedAt,
				relayId: null,
				info: agent.info,
			});
			this.broadcastEvent({ type: "agent_unrelayed", agentId: relay.agentId, relayId });
		}

		try {
			relay.ws.close(1000, "disconnect");
		} catch {}
		this.relays.delete(relayId);
		await this.ctx.storage.delete(`relay:${relayId}`);
	}
}
