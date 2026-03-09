# relay

WebSocket relay server for [Position-Independent-Agent](https://github.com/mrzaxaryan/Position-Independent-Agent) — Cloudflare Workers + Durable Objects.

A single Durable Object (`WebSocketPool`) holds all connections in memory, pairing agents with relay connections 1:1.

## Endpoints

| Path | Type | Description |
|------|------|-------------|
| `/` | GET | API documentation (JSON) |
| `/health` | GET | Live status — connected agents, relays, event listeners |
| `/ws` | WebSocket | Agent connections |
| `/relay/:agentId` | WebSocket | Relay connection, auto-couples to agent by ID (exclusive) |
| `/events` | WebSocket | Live feed of agent and relay events |

## How It Works

1. An **agent** connects to `/ws` — the server assigns an ID and broadcasts `agent_connected` to event listeners
2. A **relay** connects to `/relay/:agentId` — this immediately couples it 1:1 with that agent and sends a `coupled` message
3. All messages flow transparently between the paired WebSockets (string and binary)
4. If either side disconnects, the pairing is cleaned up and the other side is notified
5. **Event listeners** on `/events` receive a snapshot of all agents on connect, then live events: `agent_connected`, `agent_disconnected`, `agent_relayed`, `agent_unrelayed`

### Constraints

- Each agent can have **at most one** relay at a time
- Connecting to `/relay/:agentId` returns `404` if the agent doesn't exist
- Connecting to `/relay/:agentId` returns `409` if the agent already has an active relay

## Health Endpoint

`GET /health` returns:

```json
{
  "agents": { "count": 1, "connections": [{ "id": "agent-1-...", "connectedAt": 0, "relayed": false, "relayId": null, "messageCount": 0, "lastActiveAt": 0, "ip": "...", "country": "...", ... }] },
  "relays": { "count": 0, "connections": [] },
  "eventListeners": { "count": 0, "connections": [] }
}
```

## Development

```sh
npm install
npm run dev      # local dev server via wrangler
npm run deploy   # deploy to Cloudflare
npm run tail     # stream live logs
```
