# relay

WebSocket relay server for PIR clients — Cloudflare Workers + Durable Objects.

A single Durable Object (`WebSocketPool`) holds all connections in memory, acting as a middleman between remote clients and admin controllers.

## Endpoints

| Path | Type | Description |
|------|------|-------------|
| `/wssClient` | WebSocket | PIR client connections |
| `/wssAdmin` | WebSocket | Admin connections |
| `/api/clients` | REST GET | List connected clients |

## How It Works

An admin can **couple** to a client, creating a 1:1 relay channel:

- Client messages are forwarded to the coupled admin (wrapped in `relay` / `relay_binary` envelopes)
- Admin messages are forwarded raw to the coupled client (binary via base64)
- Disconnection on either side cleans up the pairing and broadcasts an updated client list to all admins

### Admin Actions

Send JSON with an `action` field:

| Action | Description |
|--------|-------------|
| `couple` | Bind to a client (`{ action: "couple", clientId: "..." }`) |
| `decouple` | Unbind from the current client |
| `send` | Relay string data to the coupled client |
| `send_binary` | Relay base64-encoded binary data to the coupled client |
| `list` | Request the current client list |
| `kick` | Disconnect a client by ID |

## Development

```sh
npm install
npm run dev      # local dev server via wrangler
npm run deploy   # deploy to Cloudflare
npm run tail     # stream live logs
```
