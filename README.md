# Relay

WebSocket relay server for [Position-Independent-Agent](https://github.com/mrzaxaryan/Position-Independent-Agent) and [Command Center](https://github.com/mrzaxaryan/cc) — built on Cloudflare Workers + Durable Objects.

A single Durable Object (`RelayHub`) holds all connections in memory, pairing agents with relay connections 1:1.

## Authentication

All endpoints except `GET /` and `/agent` require a token validated against the `AUTH_TOKEN` environment variable.

| Method | How to authenticate |
|--------|---------------------|
| HTTP | `Authorization: Bearer <token>` header |
| WebSocket | `?token=<token>` query parameter |

| Status | Error |
|--------|-------|
| `401` | `{ error: "unauthorized", message: "Missing or invalid token" }` |
| `403` | `{ error: "forbidden", message: "Token does not have access to this resource" }` |

## Endpoints

| Path | Type | Auth | Description |
|------|------|------|-------------|
| `/` | GET | No | API documentation (HTML) |
| `/status` | GET | Yes | Live status — connected agents, relays, event listeners |
| `/disconnect-all-agents` | POST | Yes | Disconnect all connected agents and their paired relays |
| `/agent` | WebSocket | No | Agent connections |
| `/relay/:agentId` | WebSocket | Yes | Relay connection, auto-pairs to agent by ID (exclusive) |
| `/events` | WebSocket | Yes | Live feed of agent and relay events |

## How It Works

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
