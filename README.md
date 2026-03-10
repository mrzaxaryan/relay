# Relay

WebSocket relay server for [Position-Independent-Agent](https://github.com/mrzaxaryan/Position-Independent-Agent) and [Command Center](https://github.com/mrzaxaryan/cc) — built on Cloudflare Workers + Durable Objects.

A single Durable Object (`RelayHub`) holds all connections in memory, pairing agents with relay connections 1:1. All messages flow transparently between paired WebSockets (string and binary). Connections survive hibernation via state hydration, and a heartbeat mechanism detects dead clients.

## API Reference

Base URL: `GET /` returns this documentation as JSON.

### Endpoints

#### `GET /` — API Documentation

Returns a JSON object describing all endpoints, types, and events.

#### `GET /status` — Live Status

Returns the current state of all connected agents, relays, and event listeners.

**Response: `StatusResponse`**

```json
{
  "agents": {
    "count": 1,
    "connections": [
      {
        "id": "agent-lz3k8f-a1b2c3",
        "connectedAt": 1710000000000,
        "paired": true,
        "pairedRelayId": "relay-lz3k8f-x9y8z7",
        "messagesForwarded": 42,
        "lastActiveAt": 1710000060000,
        "ip": "203.0.113.1",
        "country": "US",
        "city": "San Francisco",
        "region": "California",
        "continent": "NA",
        "timezone": "America/Los_Angeles",
        "postalCode": "94105",
        "latitude": "37.7749",
        "longitude": "-122.4194",
        "asn": 13335,
        "asOrganization": "Cloudflare Inc",
        "userAgent": "Position-Independent-Agent/1.0",
        "requestPriority": "",
        "tlsVersion": "TLSv1.3",
        "httpVersion": "h2"
      }
    ]
  },
  "relays": {
    "count": 1,
    "connections": [
      {
        "id": "relay-lz3k8f-x9y8z7",
        "connectedAt": 1710000010000,
        "pairedAgentId": "agent-lz3k8f-a1b2c3"
      }
    ]
  },
  "eventListeners": {
    "count": 1,
    "connections": [
      {
        "id": "listener-lz3k8f-d4e5f6",
        "connectedAt": 1710000020000,
        "ip": "198.51.100.1",
        "country": "US",
        "city": "New York",
        "region": "New York",
        "continent": "NA",
        "timezone": "America/New_York",
        "asn": 13335,
        "asOrganization": "Cloudflare Inc",
        "userAgent": "Mozilla/5.0",
        "tlsVersion": "TLSv1.3",
        "httpVersion": "h2"
      }
    ]
  }
}
```

---

#### `WS /agent` — Agent Connection

Upgrades to a WebSocket. The server assigns a unique ID and broadcasts an `agent_connected` event to all event listeners.

- **Incoming messages**: forwarded to paired relay
- **Outgoing messages**: forwarded from paired relay

---

#### `WS /relay/:agentId` — Relay Connection

Upgrades to a WebSocket with exclusive 1:1 pairing to the specified agent.

- **Incoming messages**: forwarded to paired agent
- **Outgoing messages**: forwarded from paired agent

| Status | Error | Description |
|--------|-------|-------------|
| `404` | `agent_not_found` | No agent with the given ID is connected |
| `409` | `agent_already_paired` | Agent already has an active relay connection |

**Error response:**

```json
{ "error": "agent_not_found", "agentId": "agent-lz3k8f-a1b2c3" }
```

```json
{ "error": "agent_already_paired", "agentId": "agent-lz3k8f-a1b2c3", "pairedRelayId": "relay-lz3k8f-x9y8z7" }
```

---

#### `WS /events` — Live Event Feed

Upgrades to a WebSocket that receives real-time events. On connect, the server sends a snapshot of all current agents.

**On connect:**

```json
{ "type": "agents", "agents": [ AgentStatus, ... ] }
```

**Events:**

| Event | Fields | Description |
|-------|--------|-------------|
| `agent_connected` | `{ type, agent: AgentStatus }` | A new agent connected |
| `agent_disconnected` | `{ type, agentId }` | An agent disconnected |
| `agent_paired` | `{ type, agentId, relayId }` | A relay paired with an agent |
| `agent_unpaired` | `{ type, agentId, relayId }` | A relay disconnected from an agent |

---

### Types

#### `AgentMetadata`

Connection metadata collected from the Cloudflare request.

| Field | Type | Description |
|-------|------|-------------|
| `ip` | `string` | Client IP address |
| `country` | `string` | ISO country code |
| `city` | `string` | City name |
| `region` | `string` | Region / state |
| `continent` | `string` | Continent code (e.g. `NA`, `EU`) |
| `timezone` | `string` | IANA timezone (e.g. `America/New_York`) |
| `postalCode` | `string` | Postal / ZIP code |
| `latitude` | `string` | Geographic latitude |
| `longitude` | `string` | Geographic longitude |
| `asn` | `number` | Autonomous System Number |
| `asOrganization` | `string` | AS organization name |
| `userAgent` | `string` | Client `User-Agent` header |
| `requestPriority` | `string` | Request priority hint |
| `tlsVersion` | `string` | TLS version (e.g. `TLSv1.3`) |
| `httpVersion` | `string` | HTTP protocol (e.g. `h2`) |

#### `AgentStatus`

Extends `AgentMetadata` with connection state. Returned in `/status` and `/events`.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique agent identifier |
| `connectedAt` | `number` | Connection timestamp (Unix ms) |
| `paired` | `boolean` | Whether a relay is currently paired |
| `pairedRelayId` | `string \| null` | Paired relay ID, or `null` |
| `messagesForwarded` | `number` | Total messages forwarded |
| `lastActiveAt` | `number` | Last activity timestamp (Unix ms) |
| _...AgentMetadata_ | | All metadata fields spread |

#### `RelayStatus`

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique relay identifier |
| `connectedAt` | `number` | Connection timestamp (Unix ms) |
| `pairedAgentId` | `string` | ID of the paired agent |

#### `EventListenerStatus`

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique listener identifier |
| `connectedAt` | `number` | Connection timestamp (Unix ms) |
| `ip` | `string` | Client IP address |
| `country` | `string` | ISO country code |
| `city` | `string` | City name |
| `region` | `string` | Region / state |
| `continent` | `string` | Continent code |
| `timezone` | `string` | IANA timezone |
| `asn` | `number` | Autonomous System Number |
| `asOrganization` | `string` | AS organization name |
| `userAgent` | `string` | Client `User-Agent` header |
| `tlsVersion` | `string` | TLS version |
| `httpVersion` | `string` | HTTP protocol |

---

### How It Works

1. An **agent** connects to `/agent` — the server assigns an ID and broadcasts `agent_connected` to event listeners
2. A **relay** connects to `/relay/:agentId` — this immediately pairs it 1:1 with that agent
3. All messages flow transparently between the paired WebSockets (string and binary)
4. If either side disconnects, the pairing is cleaned up and the other side is notified
5. **Event listeners** on `/events` receive a snapshot of all agents on connect, then live events

### Heartbeat

- Clients send `ping` frames; the server auto-responds with `pong` (works during hibernation)
- The server sends `ping` every 30 seconds and considers a client dead after 60 seconds of silence

### Constraints

- Each agent can have **at most one** relay at a time
- Connecting to `/relay/:agentId` returns `404` if the agent doesn't exist
- Connecting to `/relay/:agentId` returns `409` if the agent already has an active relay

---

## Development

```sh
npm install
npm run dev      # local dev server via wrangler
npm run deploy   # deploy to Cloudflare
npm run tail     # stream live logs
```

## Related Repositories

- [Position-Independent-Agent](https://github.com/mrzaxaryan/Position-Independent-Agent) — the agent that connects to this relay
- [Command Center (cc)](https://github.com/mrzaxaryan/cc) — web UI that connects as relay and event listener
