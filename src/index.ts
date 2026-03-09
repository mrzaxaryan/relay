// WebSocket Relay Server
// Cloudflare Workers + Durable Objects
//
// Endpoints:
//   /ws         — Client WebSocket connections
//   /relay/:id  — Relay WebSocket (1:1 exclusive coupling to a client)
//   /           — Status info (JSON)

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

		if (url.pathname === "/ws") {
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

interface ClientInfo {
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

interface ClientConn {
	id: string;
	ws: WebSocket;
	connectedAt: number;
	relayId: string | null;
	info: ClientInfo;
	messageCount: number;
	lastActiveAt: number;
}

interface RelayConn {
	id: string;
	ws: WebSocket;
	connectedAt: number;
	clientId: string;
}

// ─── Durable Object: WebSocketPool ────────────────────────────────────

export class WebSocketPool {
	private clients: Map<string, ClientConn> = new Map();
	private relays: Map<string, RelayConn> = new Map();
	private idCounter: number = 0;

	constructor(
		private state: DurableObjectState,
		private env: Env
	) {}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === "/") {
			return this.handleStatus();
		}

		if (url.pathname === "/ws") {
			return this.handleClientUpgrade(request);
		}

		const relayMatch = url.pathname.match(/^\/relay\/(.+)$/);
		if (relayMatch) {
			return this.handleRelayUpgrade(request, relayMatch[1]);
		}

		return new Response("Not Found", { status: 404 });
	}

	// ── Status endpoint ──────────────────────────────────────────────

	private handleStatus(): Response {
		const clients = Array.from(this.clients.values()).map((c) => ({
			id: c.id,
			connectedAt: c.connectedAt,
			relayed: c.relayId !== null,
			relayId: c.relayId,
			messageCount: c.messageCount,
			lastActiveAt: c.lastActiveAt,
			...c.info,
		}));

		const relays = Array.from(this.relays.values()).map((r) => ({
			id: r.id,
			connectedAt: r.connectedAt,
			clientId: r.clientId,
		}));

		return new Response(
			JSON.stringify({
				clients: { count: clients.length, connections: clients },
				relays: { count: relays.length, connections: relays },
			}),
			{ headers: { "Content-Type": "application/json" } }
		);
	}

	// ── Client WebSocket ─────────────────────────────────────────────

	private handleClientUpgrade(request: Request): Response {
		const upgrade = request.headers.get("Upgrade");
		if (!upgrade || upgrade.toLowerCase() !== "websocket") {
			return new Response("Expected WebSocket upgrade", { status: 426 });
		}

		const pair = new WebSocketPair();
		const [client, server] = [pair[0], pair[1]];

		const id = `client-${++this.idCounter}-${Date.now().toString(36)}`;
		const cf = (request as any).cf || {};
		const conn: ClientConn = {
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

		this.clients.set(id, conn);
		server.accept();

		server.send(JSON.stringify({ type: "identity", id }));

		server.addEventListener("message", (event) => {
			this.onClientMessage(id, event.data);
		});

		server.addEventListener("close", () => {
			this.onClientDisconnect(id);
		});

		server.addEventListener("error", () => {
			this.onClientDisconnect(id);
		});

		return new Response(null, { status: 101, webSocket: client });
	}

	private onClientMessage(clientId: string, data: string | ArrayBuffer): void {
		const conn = this.clients.get(clientId);
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

	private onClientDisconnect(clientId: string): void {
		const conn = this.clients.get(clientId);
		if (!conn) return;

		if (conn.relayId) {
			const relay = this.relays.get(conn.relayId);
			if (relay) {
				trySend(relay.ws, { type: "client_disconnected", clientId });
				try {
					relay.ws.close(1000, "client disconnected");
				} catch {}
				this.relays.delete(conn.relayId);
			}
		}

		try {
			conn.ws.close(1000, "disconnect");
		} catch {}
		this.clients.delete(clientId);
	}

	// ── Relay WebSocket ──────────────────────────────────────────────

	private handleRelayUpgrade(request: Request, clientId: string): Response {
		const upgrade = request.headers.get("Upgrade");
		if (!upgrade || upgrade.toLowerCase() !== "websocket") {
			return new Response("Expected WebSocket upgrade", { status: 426 });
		}

		const client = this.clients.get(clientId);
		if (!client) {
			return new Response(
				JSON.stringify({ error: "client_not_found", clientId }),
				{ status: 404, headers: { "Content-Type": "application/json" } }
			);
		}

		if (client.relayId) {
			return new Response(
				JSON.stringify({ error: "client_already_relayed", clientId, relayId: client.relayId }),
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
			clientId,
		};

		this.relays.set(relayId, conn);
		client.relayId = relayId;
		server.accept();

		server.send(JSON.stringify({ type: "coupled", relayId, clientId }));
		trySend(client.ws, { type: "coupled", relayId });

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

		const client = this.clients.get(relay.clientId);
		if (!client) return;

		try {
			if (typeof data === "string") {
				client.ws.send(data);
			} else {
				client.ws.send(data);
			}
		} catch {
			this.onClientDisconnect(relay.clientId);
		}
	}

	private onRelayDisconnect(relayId: string): void {
		const relay = this.relays.get(relayId);
		if (!relay) return;

		const client = this.clients.get(relay.clientId);
		if (client) {
			client.relayId = null;
			trySend(client.ws, { type: "decoupled", relayId });
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
