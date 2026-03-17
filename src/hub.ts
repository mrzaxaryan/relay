import type { Env, AgentMetadata, AgentConnection, RelayConnection, EventListenerConnection } from "./types";
import { corsHeaders, jsonResponse, toAgentStatus, safeSend } from "./utils";
import { buildDocsHtml } from "./docs";


export class RelayHub {
	private agents: Map<string, AgentConnection> = new Map();
	private relays: Map<string, RelayConnection> = new Map();
	private eventListeners: Map<string, EventListenerConnection> = new Map();
	private hydrated = false;
	private static readonly HEARTBEAT_INTERVAL_MS = 30_000;
	private static readonly HEARTBEAT_TIMEOUT_MS = 60_000;

	constructor(
		private state: DurableObjectState,
		private env: Env
	) {
		// Auto-respond "pong" to client-sent "ping" (works during hibernation)
		this.state.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
	}

	// ── State hydration (survives hibernation) ─────────────────────

	private async hydrateIfNeeded(): Promise<void> {
		if (this.hydrated) return;
		this.hydrated = true;

		const stored = await this.state.storage.list();
		const sockets = this.state.getWebSockets();

		for (const ws of sockets) {
			const tags = this.state.getTags(ws);
			if (!tags || tags.length < 2) continue;
			const [type, id] = tags;

			if (type === "agent") {
				const meta = stored.get(`agent:${id}`) as
					| { connectedAt: number; pairedRelayId: string | null; metadata: AgentMetadata }
					| undefined;
				if (meta) {
					this.agents.set(id, {
						id,
						ws,
						connectedAt: meta.connectedAt,
						pairedRelayId: meta.pairedRelayId,
						metadata: meta.metadata,
						messagesForwarded: 0,
						lastActiveAt: meta.connectedAt,
					});
				}
			} else if (type === "relay") {
				const meta = stored.get(`relay:${id}`) as
					| { connectedAt: number; pairedAgentId: string }
					| undefined;
				if (meta) {
					this.relays.set(id, { id, ws, connectedAt: meta.connectedAt, pairedAgentId: meta.pairedAgentId });
				}
			} else if (type === "listener") {
				const meta = stored.get(`listener:${id}`) as
					| { connectedAt: number; metadata: EventListenerConnection["metadata"] }
					| undefined;
				if (meta) {
					this.eventListeners.set(id, { id, ws, connectedAt: meta.connectedAt, metadata: meta.metadata });
				}
			}
		}
	}

	private generateId(prefix: string): string {
		const rand = Math.random().toString(36).slice(2, 8);
		return `${prefix}-${Date.now().toString(36)}-${rand}`;
	}

	// ── Alarm-based server→agent heartbeat ─────────────────────────

	private async scheduleNextHeartbeat(): Promise<void> {
		const existing = await this.state.storage.getAlarm();
		if (!existing) {
			await this.state.storage.setAlarm(Date.now() + RelayHub.HEARTBEAT_INTERVAL_MS);
		}
	}

	async alarm(): Promise<void> {
		await this.hydrateIfNeeded();

		const now = Date.now();
		const sockets = this.state.getWebSockets();

		for (const ws of sockets) {
			const tags = this.state.getTags(ws);
			if (!tags || tags.length < 2) continue;
			const [type, id] = tags;

			// Check last auto-response timestamp (last time client sent "ping" and got "pong")
			const lastResponse = ws.getLastAutoResponseTimestamp();
			if (lastResponse && now - lastResponse.getTime() > RelayHub.HEARTBEAT_TIMEOUT_MS) {
				// Client hasn't pinged in too long — consider dead
				if (type === "agent") {
					await this.onAgentDisconnect(id);
				} else if (type === "relay") {
					await this.onRelayDisconnect(id);
				} else if (type === "listener") {
					this.eventListeners.delete(id);
					await this.state.storage.delete(`listener:${id}`);
					try { ws.close(1000, "heartbeat timeout"); } catch { }
				}
				continue;
			}

			// Send server→client ping
			try {
				ws.send("ping");
			} catch {
				if (type === "agent") {
					await this.onAgentDisconnect(id);
				} else if (type === "relay") {
					await this.onRelayDisconnect(id);
				} else if (type === "listener") {
					this.eventListeners.delete(id);
					await this.state.storage.delete(`listener:${id}`);
				}
			}
		}

		// Re-schedule if there are still active connections
		if (this.agents.size > 0 || this.relays.size > 0 || this.eventListeners.size > 0) {
			await this.state.storage.setAlarm(now + RelayHub.HEARTBEAT_INTERVAL_MS);
		}
	}

	// ── Hibernation WebSocket handlers ──────────────────────────────

	async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer): Promise<void> {
		await this.hydrateIfNeeded();
		const [type, id] = (this.state.getTags(ws) ?? []);

		if (type === "agent") {
			this.onAgentMessage(id, data);
		} else if (type === "relay") {
			this.onRelayMessage(id, data);
		}
		// event listeners don't send meaningful messages
	}

	async webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {
		await this.hydrateIfNeeded();
		const [type, id] = (this.state.getTags(ws) ?? []);

		if (type === "agent") {
			await this.onAgentDisconnect(id);
		} else if (type === "relay") {
			await this.onRelayDisconnect(id);
		} else if (type === "listener") {
			this.eventListeners.delete(id);
			await this.state.storage.delete(`listener:${id}`);
		}
	}

	async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
		await this.hydrateIfNeeded();
		const [type, id] = (this.state.getTags(ws) ?? []);

		if (type === "agent") {
			await this.onAgentDisconnect(id);
		} else if (type === "relay") {
			await this.onRelayDisconnect(id);
		} else if (type === "listener") {
			this.eventListeners.delete(id);
			await this.state.storage.delete(`listener:${id}`);
		}
	}

	// ── HTTP routing ────────────────────────────────────────────────

	async fetch(request: Request): Promise<Response> {
		await this.hydrateIfNeeded();
		const url = new URL(request.url);

		if (url.pathname === "/") {
			return this.serveDocs(url);
		}

		if (url.pathname === "/status") {
			return this.handleStatus();
		}

		if (url.pathname === "/disconnect-all-agents" && request.method === "POST") {
			return this.handleDisconnectAllAgents();
		}

		if (url.pathname === "/agent") {
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

	private serveDocs(url: URL): Response {
		const base = `${url.protocol}//${url.host}`;
		return new Response(buildDocsHtml(base), {
			headers: { "Content-Type": "text/html; charset=utf-8", ...corsHeaders() },
		});
	}

	// ── Status endpoint ──────────────────────────────────────────────

	private handleStatus(): Response {
		const agents = Array.from(this.agents.values()).map(toAgentStatus);

		const relays = Array.from(this.relays.values()).map((r) => ({
			id: r.id,
			connectedAt: r.connectedAt,
			pairedAgentId: r.pairedAgentId,
		}));

		return jsonResponse({
			agents: { count: agents.length, connections: agents },
			relays: { count: relays.length, connections: relays },
			eventListeners: {
				count: this.eventListeners.size,
				connections: Array.from(this.eventListeners.values()).map((e) => ({
					id: e.id,
					connectedAt: e.connectedAt,
					...e.metadata,
				})),
			},
		});
	}

	// ── Disconnect all agents ────────────────────────────────────────

	private async handleDisconnectAllAgents(): Promise<Response> {
		const agentIds = Array.from(this.agents.keys());
		for (const id of agentIds) {
			await this.onAgentDisconnect(id);
		}
		return jsonResponse({ disconnected: agentIds.length, agentIds });
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
		const metadata = {
			ip: request.headers.get("CF-Connecting-IP") || "",
			country: cf.country || "",
			city: cf.city || "",
			region: cf.region || "",
			continent: cf.continent || "",
			timezone: cf.timezone || "",
			asn: cf.asn || 0,
			asOrganization: cf.asOrganization || "",
			userAgent: request.headers.get("User-Agent") || "",
			tlsVersion: cf.tlsVersion || "",
			httpVersion: cf.httpProtocol || "",
		};
		const conn: EventListenerConnection = {
			id,
			ws: server,
			connectedAt: Date.now(),
			metadata,
		};

		this.state.acceptWebSocket(server, ["listener", id]);
		this.eventListeners.set(id, conn);
		await this.state.storage.put(`listener:${id}`, { connectedAt: conn.connectedAt, metadata });

		await this.scheduleNextHeartbeat();

		// Send current agents snapshot
		safeSend(server, {
			type: "agents",
			agents: Array.from(this.agents.values()).map(toAgentStatus),
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
		const metadata: AgentMetadata = {
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
			requestPriority: cf.requestPriority || "",
			tlsVersion: cf.tlsVersion || "",
			httpVersion: cf.httpProtocol || "",
		};
		const conn: AgentConnection = {
			id,
			ws: server,
			connectedAt: Date.now(),
			pairedRelayId: null,
			metadata,
			messagesForwarded: 0,
			lastActiveAt: Date.now(),
		};

		this.state.acceptWebSocket(server, ["agent", id]);
		this.agents.set(id, conn);
		await this.state.storage.put(`agent:${id}`, {
			connectedAt: conn.connectedAt,
			pairedRelayId: null,
			metadata,
		});

		this.broadcastEvent({ type: "agent_connected", agent: toAgentStatus(conn) });
		await this.scheduleNextHeartbeat();

		return new Response(null, { status: 101, webSocket: client });
	}

	private onAgentMessage(agentId: string, data: string | ArrayBuffer): void {
		const conn = this.agents.get(agentId);
		if (!conn) return;

		conn.messagesForwarded++;
		conn.lastActiveAt = Date.now();

		if (!conn.pairedRelayId) return;

		const relay = this.relays.get(conn.pairedRelayId);
		if (!relay) return;

		try {
			relay.ws.send(data);
		} catch {
			this.onRelayDisconnect(conn.pairedRelayId);
		}
	}

	private async onAgentDisconnect(agentId: string): Promise<void> {
		const conn = this.agents.get(agentId);
		if (!conn) return;

		if (conn.pairedRelayId) {
			const relay = this.relays.get(conn.pairedRelayId);
			if (relay) {
				try {
					relay.ws.close(1000, "agent disconnected");
				} catch { }
				this.relays.delete(conn.pairedRelayId);
				await this.state.storage.delete(`relay:${conn.pairedRelayId}`);
			}
			this.broadcastEvent({ type: "agent_unpaired", agentId, relayId: conn.pairedRelayId });
		}

		try {
			conn.ws.close(1000, "disconnect");
		} catch { }
		this.agents.delete(agentId);
		await this.state.storage.delete(`agent:${agentId}`);

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

		if (agent.pairedRelayId) {
			return jsonResponse({ error: "agent_already_paired", agentId, pairedRelayId: agent.pairedRelayId }, 409);
		}

		const pair = new WebSocketPair();
		const [client, server] = [pair[0], pair[1]];

		const relayId = this.generateId("relay");
		const conn: RelayConnection = {
			id: relayId,
			ws: server,
			connectedAt: Date.now(),
			pairedAgentId: agentId,
		};

		this.state.acceptWebSocket(server, ["relay", relayId]);
		this.relays.set(relayId, conn);
		agent.pairedRelayId = relayId;

		await Promise.all([
			this.state.storage.put(`relay:${relayId}`, { connectedAt: conn.connectedAt, pairedAgentId: agentId }),
			this.state.storage.put(`agent:${agent.id}`, {
				connectedAt: agent.connectedAt,
				pairedRelayId: relayId,
				metadata: agent.metadata,
			}),
		]);

		this.broadcastEvent({ type: "agent_paired", agentId, relayId });
		await this.scheduleNextHeartbeat();

		return new Response(null, { status: 101, webSocket: client });
	}

	private onRelayMessage(relayId: string, data: string | ArrayBuffer): void {
		const relay = this.relays.get(relayId);
		if (!relay) return;

		const agent = this.agents.get(relay.pairedAgentId);
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

		const agent = this.agents.get(relay.pairedAgentId);
		if (agent) {
			agent.pairedRelayId = null;
			await this.state.storage.put(`agent:${agent.id}`, {
				connectedAt: agent.connectedAt,
				pairedRelayId: null,
				metadata: agent.metadata,
			});
			this.broadcastEvent({ type: "agent_unpaired", agentId: relay.pairedAgentId, relayId });
		}

		try {
			relay.ws.close(1000, "disconnect");
		} catch { }
		this.relays.delete(relayId);
		await this.state.storage.delete(`relay:${relayId}`);
	}
}
