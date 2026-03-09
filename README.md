# relay

WebSocket relay server for [Position-Independent-Agent](https://github.com/mrzaxaryan/Position-Independent-Agent) — Cloudflare Workers + Durable Objects.

A single Durable Object (`WebSocketPool`) holds all connections in memory, pairing clients with relay connections 1:1.

## Endpoints

| Path | Type | Description |
|------|------|-------------|
| `/` | GET | JSON status — connected clients, active relays |
| `/ws` | WebSocket | Client connections |
| `/relay/:id` | WebSocket | Relay connection, auto-couples to client by ID (exclusive) |

## How It Works

1. A **client** connects to `/ws` and receives an `identity` message with its ID
2. A **relay** connects to `/relay/:clientId` — this immediately couples it 1:1 with that client
3. All messages flow transparently between the paired WebSockets (string and binary)
4. If either side disconnects, the pairing is cleaned up and the other side is notified

### Constraints

- Each client can have **at most one** relay at a time
- Connecting to `/relay/:id` returns `404` if the client doesn't exist
- Connecting to `/relay/:id` returns `409` if the client already has an active relay

## Status Endpoint

`GET /` returns:

```json
{
  "clients": { "count": 1, "connections": [{ "id": "...", "connectedAt": 0, "relayed": false }] },
  "relays": { "count": 0, "connections": [] }
}
```

## Development

```sh
npm install
npm run dev      # local dev server via wrangler
npm run deploy   # deploy to Cloudflare
npm run tail     # stream live logs
```
