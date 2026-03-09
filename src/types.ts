export interface Env {
	WS_POOL: DurableObjectNamespace;
}

export interface AgentInfo {
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

export interface AgentConn {
	id: string;
	ws: WebSocket;
	connectedAt: number;
	relayId: string | null;
	info: AgentInfo;
	messageCount: number;
	lastActiveAt: number;
}

export interface RelayConn {
	id: string;
	ws: WebSocket;
	connectedAt: number;
	agentId: string;
}

export interface EventListenerConn {
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
