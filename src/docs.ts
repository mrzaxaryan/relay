export function buildDocsHtml(base: string): string {
	const ws = base.replace("http", "ws");

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Relay API</title>
<style>
  :root {
    --bg: #0d1117;
    --surface: #161b22;
    --border: #30363d;
    --text: #e6edf3;
    --muted: #8b949e;
    --accent: #58a6ff;
    --green: #3fb950;
    --orange: #d29922;
    --red: #f85149;
    --purple: #bc8cff;
    --code-bg: #1c2128;
    --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    --mono: "SF Mono", "Cascadia Code", "Fira Code", Consolas, monospace;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: var(--font); background: var(--bg); color: var(--text); line-height: 1.6; }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }

  .container { max-width: 960px; margin: 0 auto; padding: 48px 24px; }

  header { margin-bottom: 48px; }
  header h1 { font-size: 32px; font-weight: 700; margin-bottom: 8px; }
  header p { color: var(--muted); font-size: 16px; max-width: 640px; }
  .repos { display: flex; gap: 16px; margin-top: 16px; flex-wrap: wrap; }
  .repos a {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 6px 12px; border-radius: 6px;
    background: var(--surface); border: 1px solid var(--border);
    font-size: 13px; color: var(--muted); transition: border-color 0.15s;
  }
  .repos a:hover { border-color: var(--accent); color: var(--accent); text-decoration: none; }

  section { margin-bottom: 48px; }
  section > h2 {
    font-size: 20px; font-weight: 600; margin-bottom: 24px;
    padding-bottom: 8px; border-bottom: 1px solid var(--border);
  }

  .endpoint { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; margin-bottom: 16px; overflow: hidden; }
  .endpoint-header { display: flex; align-items: center; gap: 12px; padding: 16px 20px; }
  .method {
    display: inline-block; padding: 2px 8px; border-radius: 4px;
    font-family: var(--mono); font-size: 12px; font-weight: 700; text-transform: uppercase; flex-shrink: 0;
  }
  .method-get { background: rgba(63,185,80,0.15); color: var(--green); }
  .method-post { background: rgba(210,153,34,0.15); color: var(--orange); }
  .method-ws { background: rgba(88,166,255,0.15); color: var(--accent); }
  .badge-auth { background: rgba(248,81,73,0.15); color: var(--red); margin-left: auto; }
  .path { font-family: var(--mono); font-size: 15px; font-weight: 600; }
  .path .param { color: var(--orange); }
  .endpoint-desc { padding: 0 20px 16px; color: var(--muted); font-size: 14px; }
  .endpoint-url { padding: 0 20px 16px; }
  .endpoint-url code { font-family: var(--mono); font-size: 13px; color: var(--muted); background: var(--code-bg); padding: 4px 8px; border-radius: 4px; }
  .endpoint-body { padding: 0 20px 16px; }

  .detail-grid { display: grid; grid-template-columns: auto 1fr; gap: 4px 16px; font-size: 13px; }
  .detail-grid dt { color: var(--muted); font-family: var(--mono); }
  .detail-grid dd { font-family: var(--mono); }

  .error-row { display: flex; gap: 12px; align-items: baseline; margin-bottom: 6px; font-size: 13px; }
  .error-status { font-family: var(--mono); font-weight: 700; color: var(--red); min-width: 32px; }
  .error-body { font-family: var(--mono); color: var(--muted); }

  .events-list { list-style: none; }
  .events-list li { padding: 8px 0; border-bottom: 1px solid var(--border); font-size: 13px; }
  .events-list li:last-child { border-bottom: none; }
  .event-type { font-family: var(--mono); font-weight: 600; color: var(--purple); }
  .event-fields { font-family: var(--mono); color: var(--muted); margin-left: 8px; }

  table { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 16px; }
  th { text-align: left; padding: 8px 12px; background: var(--surface); border: 1px solid var(--border); color: var(--muted); font-weight: 600; }
  td { padding: 8px 12px; border: 1px solid var(--border); }
  td:first-child { font-family: var(--mono); color: var(--accent); white-space: nowrap; }
  td:nth-child(2) { font-family: var(--mono); color: var(--orange); white-space: nowrap; }

  .type-block { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; margin-bottom: 16px; overflow: hidden; }
  .type-name { font-family: var(--mono); font-size: 15px; font-weight: 600; padding: 16px 20px; color: var(--purple); }
  .type-desc { padding: 0 20px 12px; color: var(--muted); font-size: 14px; }

  .info-box {
    background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
    padding: 20px; font-size: 14px;
  }
  .info-box h3 { font-size: 14px; font-weight: 600; margin-bottom: 8px; }
  .info-box ul { list-style: disc; padding-left: 20px; }
  .info-box li { margin-bottom: 4px; color: var(--muted); }
  .info-box code { font-family: var(--mono); font-size: 13px; color: var(--accent); }

  .badge { display: inline-block; padding: 2px 6px; border-radius: 3px; font-family: var(--mono); font-size: 11px; }
  .badge-interval { background: rgba(88,166,255,0.15); color: var(--accent); }
  .badge-timeout { background: rgba(248,81,73,0.15); color: var(--red); }
</style>
</head>
<body>
<div class="container">

<header>
  <h1>Relay API</h1>
  <p>WebSocket relay server for Position-Independent-Agent and Command Center. Pairs agents with relays 1:1 for transparent bidirectional message forwarding.</p>
  <div class="repos">
    <a href="https://github.com/mrzaxaryan/relay">relay</a>
    <a href="https://github.com/mrzaxaryan/Position-Independent-Agent">agent</a>
    <a href="https://github.com/mrzaxaryan/cc">command center</a>
  </div>
</header>

<section>
  <h2>Authentication</h2>
  <div class="info-box">
    <p style="margin-bottom: 12px;">All endpoints except <code>GET /</code> require a Bearer token.</p>
    <dl class="detail-grid" style="margin-bottom: 12px;">
      <dt>Header</dt><dd>Authorization: Bearer &lt;token&gt;</dd>
      <dt>Query</dt><dd>?token=&lt;token&gt;</dd>
    </dl>
    <div class="error-row"><span class="error-status">401</span><span class="error-body">{ "error": "unauthorized", "message": "Missing or invalid Authorization header" }</span></div>
    <div class="error-row"><span class="error-status">403</span><span class="error-body">{ "error": "forbidden", "message": "Token does not have access to this resource" }</span></div>
  </div>
</section>

<section>
  <h2>Endpoints</h2>

  <div class="endpoint">
    <div class="endpoint-header">
      <span class="method method-get">GET</span>
      <span class="path">/</span>
    </div>
    <div class="endpoint-desc">API documentation (this page).</div>
    <div class="endpoint-url"><code>${base}/</code></div>
  </div>

  <div class="endpoint">
    <div class="endpoint-header">
      <span class="method method-get">GET</span>
      <span class="path">/status</span>
      <span class="badge badge-auth">AUTH</span>
    </div>
    <div class="endpoint-desc">Live status of all connected agents, relays, and event listeners. Returns <code>StatusResponse</code>.</div>
    <div class="endpoint-url"><code>${base}/status</code></div>
  </div>

  <div class="endpoint">
    <div class="endpoint-header">
      <span class="method method-post">POST</span>
      <span class="path">/disconnect-all-agents</span>
      <span class="badge badge-auth">AUTH</span>
    </div>
    <div class="endpoint-desc">Disconnect all connected agents and their paired relays. Returns the count and IDs of disconnected agents.</div>
    <div class="endpoint-url"><code>${base}/disconnect-all-agents</code></div>
    <div class="endpoint-body">
      <dl class="detail-grid">
        <dt>returns</dt><dd>{ "disconnected": number, "agentIds": string[] }</dd>
      </dl>
    </div>
  </div>

  <div class="endpoint">
    <div class="endpoint-header">
      <span class="method method-ws">WS</span>
      <span class="path">/agent</span>
      <span class="badge badge-auth">AUTH</span>
    </div>
    <div class="endpoint-desc">Agent WebSocket connection. Server assigns a unique ID and broadcasts <code>agent_connected</code> to all event listeners.</div>
    <div class="endpoint-url"><code>${ws}/agent</code></div>
    <div class="endpoint-body">
      <dl class="detail-grid">
        <dt>send</dt><dd>any &mdash; forwarded to paired relay</dd>
        <dt>receive</dt><dd>any &mdash; forwarded from paired relay</dd>
      </dl>
    </div>
  </div>

  <div class="endpoint">
    <div class="endpoint-header">
      <span class="method method-ws">WS</span>
      <span class="path">/relay/<span class="param">:agentId</span></span>
      <span class="badge badge-auth">AUTH</span>
    </div>
    <div class="endpoint-desc">Relay WebSocket with exclusive 1:1 pairing to the specified agent.</div>
    <div class="endpoint-url"><code>${ws}/relay/{agentId}</code></div>
    <div class="endpoint-body">
      <dl class="detail-grid">
        <dt>send</dt><dd>any &mdash; forwarded to paired agent</dd>
        <dt>receive</dt><dd>any &mdash; forwarded from paired agent</dd>
      </dl>
      <div style="margin-top: 12px;">
        <div class="error-row"><span class="error-status">404</span><span class="error-body">{ "error": "agent_not_found", "agentId": "..." }</span></div>
        <div class="error-row"><span class="error-status">409</span><span class="error-body">{ "error": "agent_already_paired", "agentId": "...", "pairedRelayId": "..." }</span></div>
      </div>
    </div>
  </div>

  <div class="endpoint">
    <div class="endpoint-header">
      <span class="method method-ws">WS</span>
      <span class="path">/events</span>
      <span class="badge badge-auth">AUTH</span>
    </div>
    <div class="endpoint-desc">Live event feed. Sends a snapshot of all agents on connect, then real-time events.</div>
    <div class="endpoint-url"><code>${ws}/events</code></div>
    <div class="endpoint-body">
      <p style="font-size:13px; color:var(--muted); margin-bottom:8px;"><strong style="color:var(--text)">On connect:</strong> <code>{ "type": "agents", "agents": AgentStatus[] }</code></p>
      <ul class="events-list">
        <li><span class="event-type">agent_connected</span><span class="event-fields">{ agent: AgentStatus }</span></li>
        <li><span class="event-type">agent_disconnected</span><span class="event-fields">{ agentId: string }</span></li>
        <li><span class="event-type">agent_paired</span><span class="event-fields">{ agentId: string, relayId: string }</span></li>
        <li><span class="event-type">agent_unpaired</span><span class="event-fields">{ agentId: string, relayId: string }</span></li>
      </ul>
    </div>
  </div>
</section>

<section>
  <h2>Types</h2>

  <div class="type-block">
    <div class="type-name">AgentMetadata</div>
    <div class="type-desc">Connection metadata collected from the Cloudflare request.</div>
    <table>
      <tr><th>Field</th><th>Type</th><th>Description</th></tr>
      <tr><td>ip</td><td>string</td><td>Client IP address</td></tr>
      <tr><td>country</td><td>string</td><td>ISO country code</td></tr>
      <tr><td>city</td><td>string</td><td>City name</td></tr>
      <tr><td>region</td><td>string</td><td>Region / state</td></tr>
      <tr><td>continent</td><td>string</td><td>Continent code (NA, EU, ...)</td></tr>
      <tr><td>timezone</td><td>string</td><td>IANA timezone</td></tr>
      <tr><td>postalCode</td><td>string</td><td>Postal / ZIP code</td></tr>
      <tr><td>latitude</td><td>string</td><td>Geographic latitude</td></tr>
      <tr><td>longitude</td><td>string</td><td>Geographic longitude</td></tr>
      <tr><td>asn</td><td>number</td><td>Autonomous System Number</td></tr>
      <tr><td>asOrganization</td><td>string</td><td>AS organization name</td></tr>
      <tr><td>userAgent</td><td>string</td><td>Client User-Agent header</td></tr>
      <tr><td>requestPriority</td><td>string</td><td>Request priority hint</td></tr>
      <tr><td>tlsVersion</td><td>string</td><td>TLS version (e.g. TLSv1.3)</td></tr>
      <tr><td>httpVersion</td><td>string</td><td>HTTP protocol (e.g. h2)</td></tr>
    </table>
  </div>

  <div class="type-block">
    <div class="type-name">AgentStatus</div>
    <div class="type-desc">Agent connection state. Extends AgentMetadata. Returned in /status and /events.</div>
    <table>
      <tr><th>Field</th><th>Type</th><th>Description</th></tr>
      <tr><td>id</td><td>string</td><td>Unique agent identifier</td></tr>
      <tr><td>connectedAt</td><td>number</td><td>Connection timestamp (Unix ms)</td></tr>
      <tr><td>paired</td><td>boolean</td><td>Whether a relay is currently paired</td></tr>
      <tr><td>pairedRelayId</td><td>string | null</td><td>Paired relay ID</td></tr>
      <tr><td>messagesForwarded</td><td>number</td><td>Total messages forwarded</td></tr>
      <tr><td>lastActiveAt</td><td>number</td><td>Last activity timestamp (Unix ms)</td></tr>
      <tr><td colspan="3" style="color:var(--muted); font-style:italic; font-family:var(--font);">...plus all AgentMetadata fields</td></tr>
    </table>
  </div>

  <div class="type-block">
    <div class="type-name">RelayStatus</div>
    <div class="type-desc">Relay connection state. Returned in /status.</div>
    <table>
      <tr><th>Field</th><th>Type</th><th>Description</th></tr>
      <tr><td>id</td><td>string</td><td>Unique relay identifier</td></tr>
      <tr><td>connectedAt</td><td>number</td><td>Connection timestamp (Unix ms)</td></tr>
      <tr><td>pairedAgentId</td><td>string</td><td>ID of the paired agent</td></tr>
    </table>
  </div>

  <div class="type-block">
    <div class="type-name">EventListenerStatus</div>
    <div class="type-desc">Event listener connection state. Returned in /status.</div>
    <table>
      <tr><th>Field</th><th>Type</th><th>Description</th></tr>
      <tr><td>id</td><td>string</td><td>Unique listener identifier</td></tr>
      <tr><td>connectedAt</td><td>number</td><td>Connection timestamp (Unix ms)</td></tr>
      <tr><td>ip</td><td>string</td><td>Client IP address</td></tr>
      <tr><td>country</td><td>string</td><td>ISO country code</td></tr>
      <tr><td>city</td><td>string</td><td>City name</td></tr>
      <tr><td>region</td><td>string</td><td>Region / state</td></tr>
      <tr><td>continent</td><td>string</td><td>Continent code</td></tr>
      <tr><td>timezone</td><td>string</td><td>IANA timezone</td></tr>
      <tr><td>asn</td><td>number</td><td>Autonomous System Number</td></tr>
      <tr><td>asOrganization</td><td>string</td><td>AS organization name</td></tr>
      <tr><td>userAgent</td><td>string</td><td>Client User-Agent header</td></tr>
      <tr><td>tlsVersion</td><td>string</td><td>TLS version</td></tr>
      <tr><td>httpVersion</td><td>string</td><td>HTTP protocol</td></tr>
    </table>
  </div>

  <div class="type-block">
    <div class="type-name">StatusResponse</div>
    <div class="type-desc">Response from GET /status.</div>
    <table>
      <tr><th>Field</th><th>Type</th><th>Description</th></tr>
      <tr><td>agents</td><td>{ count, connections: AgentStatus[] }</td><td>Connected agents</td></tr>
      <tr><td>relays</td><td>{ count, connections: RelayStatus[] }</td><td>Connected relays</td></tr>
      <tr><td>eventListeners</td><td>{ count, connections: EventListenerStatus[] }</td><td>Connected event listeners</td></tr>
    </table>
  </div>
</section>

<section>
  <h2>Heartbeat</h2>
  <div class="info-box">
    <ul>
      <li>Clients send <code>ping</code> text frames; the server auto-responds <code>pong</code> (works during hibernation)</li>
      <li>Server sends <code>ping</code> every <span class="badge badge-interval">30s</span> to all connections</li>
      <li>Clients with no activity for <span class="badge badge-timeout">60s</span> are considered dead and disconnected</li>
    </ul>
  </div>
</section>

<section>
  <h2>Constraints</h2>
  <div class="info-box">
    <ul>
      <li>Each agent can have <strong>at most one</strong> relay at a time</li>
      <li>Connecting to <code>/relay/:agentId</code> returns <strong>404</strong> if the agent doesn't exist</li>
      <li>Connecting to <code>/relay/:agentId</code> returns <strong>409</strong> if the agent already has an active relay</li>
    </ul>
  </div>
</section>

</div>
</body>
</html>`;
}
