export interface Env {
	RELAY_HUB: DurableObjectNamespace;
}

export interface AgentMetadata {
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
	requestPriority: string;
	tlsVersion: string;
	httpVersion: string;
}

export interface AgentConnection {
	id: string;
	ws: WebSocket;
	connectedAt: number;
	pairedRelayId: string | null;
	metadata: AgentMetadata;
	messagesForwarded: number;
	lastActiveAt: number;
}

export interface RelayConnection {
	id: string;
	ws: WebSocket;
	connectedAt: number;
	pairedAgentId: string;
}

export interface EventListenerConnection {
	id: string;
	ws: WebSocket;
	connectedAt: number;
	metadata: {
		ip: string;
		country: string;
		city: string;
		userAgent: string;
	};
}
