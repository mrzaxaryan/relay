// WebSocket Relay Server
// Cloudflare Workers + Durable Objects
//
// Endpoints:
//   /wssClient   — PIR client WebSocket connections
//   /wssAdmin    — Admin WebSocket connections
//   /api/clients — REST: list connected clients

export interface Env {
	WS_POOL: DurableObjectNamespace;
}

// ─── Worker Entry Point ───────────────────────────────────────────────

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		// All WebSocket and API routes go to the single Durable Object instance
		if (
			url.pathname === "/wssClient" ||
			url.pathname === "/wssAdmin" ||
			url.pathname === "/api/clients"
		) {
			// Single global instance — all connections share one pool
			const id = env.WS_POOL.idFromName("global");
			const stub = env.WS_POOL.get(id);
			return stub.fetch(request);
		}

		return new Response("Not Found", { status: 404 });
	},
};

// ─── Connection Types ─────────────────────────────────────────────────

interface ClientConn {
	id: string;
	ws: WebSocket;
	connectedAt: number;
	label: string;
	coupledAdminId: string | null;
}

interface AdminConn {
	id: string;
	ws: WebSocket;
	connectedAt: number;
	coupledClientId: string | null;
}

// ─── Durable Object: WebSocketPool ────────────────────────────────────

export class WebSocketPool {
	private clients: Map<string, ClientConn> = new Map();
	private admins: Map<string, AdminConn> = new Map();
	private idCounter: number = 0;

	constructor(
		private state: DurableObjectState,
		private env: Env
	) {}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === "/api/clients") {
			return this.handleApiClients();
		}

		if (url.pathname === "/wssClient") {
			return this.handleClientUpgrade(request);
		}

		if (url.pathname === "/wssAdmin") {
			return this.handleAdminUpgrade(request);
		}

		return new Response("Not Found", { status: 404 });
	}

	// ── REST: list connected clients ──────────────────────────────────

	private handleApiClients(): Response {
		const list = Array.from(this.clients.values()).map((c) => ({
			id: c.id,
			label: c.label,
			connectedAt: c.connectedAt,
			coupled: c.coupledAdminId !== null,
		}));
		return new Response(JSON.stringify(list), {
			headers: { "Content-Type": "application/json" },
		});
	}

	// ── Client WebSocket ──────────────────────────────────────────────

	private handleClientUpgrade(request: Request): Response {
		const upgrade = request.headers.get("Upgrade");
		if (!upgrade || upgrade.toLowerCase() !== "websocket") {
			return new Response("Expected WebSocket upgrade", { status: 426 });
		}

		const pair = new WebSocketPair();
		const [client, server] = [pair[0], pair[1]];

		const id = `client-${++this.idCounter}-${Date.now().toString(36)}`;
		const conn: ClientConn = {
			id,
			ws: server,
			connectedAt: Date.now(),
			label: id,
			coupledAdminId: null,
		};

		this.clients.set(id, conn);
		server.accept();

		// Send the client its assigned ID
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

		// Broadcast updated client list to all admins
		this.broadcastClientList();

		return new Response(null, { status: 101, webSocket: client });
	}

	private onClientMessage(clientId: string, data: string | ArrayBuffer): void {
		const conn = this.clients.get(clientId);
		if (!conn || !conn.coupledAdminId) return;

		// Relay to coupled admin
		const admin = this.admins.get(conn.coupledAdminId);
		if (!admin) return;

		try {
			if (typeof data === "string") {
				admin.ws.send(
					JSON.stringify({
						type: "relay",
						from: clientId,
						data,
					})
				);
			} else {
				// Binary data — wrap with metadata header
				admin.ws.send(
					JSON.stringify({
						type: "relay_binary",
						from: clientId,
						data: arrayBufferToBase64(data),
					})
				);
			}
		} catch {
			this.onAdminDisconnect(conn.coupledAdminId);
		}
	}

	private onClientDisconnect(clientId: string): void {
		const conn = this.clients.get(clientId);
		if (!conn) return;

		// Decouple if coupled
		if (conn.coupledAdminId) {
			const admin = this.admins.get(conn.coupledAdminId);
			if (admin) {
				admin.coupledClientId = null;
				trySend(admin.ws, {
					type: "decoupled",
					reason: "client_disconnected",
					clientId,
				});
			}
		}

		try {
			conn.ws.close(1000, "disconnect");
		} catch {}
		this.clients.delete(clientId);
		this.broadcastClientList();
	}

	// ── Admin WebSocket ───────────────────────────────────────────────

	private handleAdminUpgrade(request: Request): Response {
		const upgrade = request.headers.get("Upgrade");
		if (!upgrade || upgrade.toLowerCase() !== "websocket") {
			return new Response("Expected WebSocket upgrade", { status: 426 });
		}

		const pair = new WebSocketPair();
		const [client, server] = [pair[0], pair[1]];

		const id = `admin-${++this.idCounter}-${Date.now().toString(36)}`;
		const conn: AdminConn = {
			id,
			ws: server,
			connectedAt: Date.now(),
			coupledClientId: null,
		};

		this.admins.set(id, conn);
		server.accept();

		// Send identity + current client list
		server.send(JSON.stringify({ type: "identity", id }));
		this.sendClientList(server);

		server.addEventListener("message", (event) => {
			if (typeof event.data === "string") {
				this.onAdminMessage(id, event.data);
			}
		});

		server.addEventListener("close", () => {
			this.onAdminDisconnect(id);
		});

		server.addEventListener("error", () => {
			this.onAdminDisconnect(id);
		});

		return new Response(null, { status: 101, webSocket: client });
	}

	private onAdminMessage(adminId: string, raw: string): void {
		let msg: any;
		try {
			msg = JSON.parse(raw);
		} catch {
			return;
		}

		const admin = this.admins.get(adminId);
		if (!admin) return;

		switch (msg.action) {
			case "couple":
				this.coupleAdminToClient(adminId, msg.clientId);
				break;

			case "decouple":
				this.decoupleAdmin(adminId);
				break;

			case "send":
				this.relayAdminToClient(adminId, msg.data, false);
				break;

			case "send_binary":
				this.relayAdminToClient(adminId, msg.data, true);
				break;

			case "list":
				this.sendClientList(admin.ws);
				break;

			case "kick":
				this.kickClient(msg.clientId);
				break;

			default:
				trySend(admin.ws, {
					type: "error",
					message: `Unknown action: ${msg.action}`,
				});
		}
	}

	private coupleAdminToClient(adminId: string, clientId: string): void {
		const admin = this.admins.get(adminId);
		const client = this.clients.get(clientId);

		if (!admin) return;
		if (!client) {
			trySend(admin.ws, {
				type: "error",
				message: `Client ${clientId} not found`,
			});
			return;
		}

		// Decouple existing connections first
		if (admin.coupledClientId) {
			this.decoupleAdmin(adminId);
		}
		if (client.coupledAdminId) {
			this.decoupleAdmin(client.coupledAdminId);
		}

		// Couple
		admin.coupledClientId = clientId;
		client.coupledAdminId = adminId;

		trySend(admin.ws, { type: "coupled", clientId });
		trySend(client.ws, JSON.stringify({ type: "coupled" }));

		this.broadcastClientList();
	}

	private decoupleAdmin(adminId: string): void {
		const admin = this.admins.get(adminId);
		if (!admin || !admin.coupledClientId) return;

		const client = this.clients.get(admin.coupledClientId);
		const clientId = admin.coupledClientId;

		admin.coupledClientId = null;
		if (client) {
			client.coupledAdminId = null;
			trySend(client.ws, JSON.stringify({ type: "decoupled" }));
		}

		trySend(admin.ws, { type: "decoupled", reason: "admin_request", clientId });
		this.broadcastClientList();
	}

	private relayAdminToClient(
		adminId: string,
		data: string,
		isBinary: boolean
	): void {
		const admin = this.admins.get(adminId);
		if (!admin || !admin.coupledClientId) {
			if (admin) {
				trySend(admin.ws, {
					type: "error",
					message: "Not coupled to any client",
				});
			}
			return;
		}

		const client = this.clients.get(admin.coupledClientId);
		if (!client) return;

		try {
			if (isBinary) {
				client.ws.send(base64ToArrayBuffer(data));
			} else {
				client.ws.send(data);
			}
		} catch {
			this.onClientDisconnect(admin.coupledClientId);
		}
	}

	private kickClient(clientId: string): void {
		this.onClientDisconnect(clientId);
	}

	private onAdminDisconnect(adminId: string): void {
		const admin = this.admins.get(adminId);
		if (!admin) return;

		// Decouple if coupled
		if (admin.coupledClientId) {
			const client = this.clients.get(admin.coupledClientId);
			if (client) {
				client.coupledAdminId = null;
				trySend(client.ws, JSON.stringify({ type: "decoupled" }));
			}
		}

		try {
			admin.ws.close(1000, "disconnect");
		} catch {}
		this.admins.delete(adminId);
		this.broadcastClientList();
	}

	// ── Broadcast helpers ─────────────────────────────────────────────

	private broadcastClientList(): void {
		for (const admin of this.admins.values()) {
			this.sendClientList(admin.ws);
		}
	}

	private sendClientList(ws: WebSocket): void {
		const list = Array.from(this.clients.values()).map((c) => ({
			id: c.id,
			label: c.label,
			connectedAt: c.connectedAt,
			coupled: c.coupledAdminId !== null,
			coupledAdminId: c.coupledAdminId,
		}));
		trySend(ws, { type: "client_list", clients: list });
	}
}

// ─── Utilities ────────────────────────────────────────────────────────

function trySend(ws: WebSocket, data: object | string): void {
	try {
		ws.send(typeof data === "string" ? data : JSON.stringify(data));
	} catch {}
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = "";
	for (let i = 0; i < bytes.byteLength; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes.buffer;
}
