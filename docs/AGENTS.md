# Connect an agent

Feedforward runs an MCP server, so a member's AI agent can search the catalog, define terms, cite papers and plan what to learn next. This page covers setup, the tools, the limits and the security notes.

For how the server fits into the rest of the system, see [ARCHITECTURE.md](ARCHITECTURE.md). For the project's own coding rules (for agents that edit this repository), see [../AGENTS.md](../AGENTS.md).

- **Endpoint:** `https://feedforward.dbaney.com/mcp`
- **Transport:** Streamable HTTP, stateless. Each `POST` carries one JSON-RPC message and gets one JSON reply.
- **Protocol versions:** 2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05. If the client asks for another, the server answers with 2025-06-18.
- **Server name:** `feedforward`, version `1.0.0`.

Feedforward is invite-only, so every call needs a member's token (`ffk_...`, from your profile) or the OAuth connector at `/mcp/me`. Calls without one get a 401.

## Connect

### Claude Code

With your token:

```sh
claude mcp add --transport http feedforward https://feedforward.dbaney.com/mcp \
  --header "Authorization: Bearer ffk_your_token"
```

### Other clients (JSON config)

Most clients that speak Streamable HTTP take an entry like this. The exact file and key names differ by client, so check its docs.

```json
{
  "mcpServers": {
    "feedforward": {
      "type": "http",
      "url": "https://feedforward.dbaney.com/mcp"
    }
  }
}
```

With a token, send it as a header:

```json
{
  "mcpServers": {
    "feedforward": {
      "type": "http",
      "url": "https://feedforward.dbaney.com/mcp",
      "headers": { "Authorization": "Bearer ffk_your_token" }
    }
  }
}
```

The live page at https://feedforward.dbaney.com/agents also has copy-ready snippets for Codex and Cursor. Where a client can read the token from an environment variable, do that instead of pasting it into a file.

### curl

List the tools:

```sh
curl -s https://feedforward.dbaney.com/mcp \
  -H "Authorization: Bearer ffk_your_token" \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Call one:

```sh
curl -s https://feedforward.dbaney.com/mcp \
  -H "Authorization: Bearer ffk_your_token" \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search","arguments":{"query":"attention","kind":"videos"}}}'
```

Notes for raw callers: `id` is required (a message with no `id` is treated as a notification and gets an empty `202`). Batches (a JSON array) are refused. Request bodies over 20,000 characters are refused. `GET /mcp` returns a short message with status 405.

## Get a token

1. Sign in at https://feedforward.dbaney.com (it's invite-only: use a member's invite link, or apply). There is no email or password.
2. Make a token there. Name it after the agent. Choose **Read** or **Read and save**.
3. Copy it right away. It starts with `ffk_` and is shown once. Only a hash is stored.

You can have up to 10 tokens and make up to 10 per day. Revoke one on the same page and it stops working at once.

## Tools

Every result is plain text.

| Tool | Needs | What it does |
| --- | --- | --- |
| `search` | nothing | Searches the catalog for the words in `query` (up to 8 words, all must match). `kind` is one of `all`, `videos`, `posts`, `people`, `books`, `papers`, `terms`. `limit` is 1 to 25, default 8. Returns one line per hit with a link. |
| `define` | nothing | Looks up an AI or CS term. Returns a short definition, a longer one, reference links and the dictionary link. |
| `cite` | nothing | Formats a citation for a paper in the Research section. `paper` is an id or title words. `style` is `apa` (default), `mla`, `chicago` or `bibtex`. |
| `learning_path` | nothing | With no `track`, lists the learning tracks. With a track slug, lists its ordered steps: videos, labs and readings. |
| `recommend` | nothing | Lists standout videos, highest score first. `topic` is one of `foundations`, `local`, `agents`, `research`, `math`, `cs`, `systems`, `making`, `labs`. `limit` is 1 to 10, default 5. |
| `upcoming_sessions` | nothing | Lists up to 20 upcoming live teaching sessions that are not cancelled, with time, title, host and length. |
| `my_library` | any token | Returns your saved items (up to 50 keys) and recent history (up to 20 ids). |
| `save` | token with the `write` scope | Saves one item to your library. `item` is a key such as `v:<videoId>`, `s:<shortId>`, `p:<postId>`, `b:<book title>`, `r:<paper id>` or `d:<term>`. |

Two things to know about results:

- `search` and `recommend` read the starter bundle (`/data/home.json`), a slice of the full catalog. The `books`, `papers` and `terms` parts of `search` read their own files.
- Missing or too-weak tokens are not HTTP errors for `my_library` and `save`. The tool returns a text message that says what is needed.

## Scopes and limits

A token has one of two scopes:

| Scope | Can do |
| --- | --- |
| `read` | Search, define, cite, learning paths, sessions, plus `my_library`. |
| `write` | The same, plus `save`. |

Rate limits are counted per hour. Every `POST` counts, including `initialize`, `ping` and `tools/list`.

| Caller | Limit |
| --- | --- |
| No token | 120 calls per hour per IP address |
| With a token | 600 calls per hour per token |

Past the limit the server answers `429` with the JSON-RPC error code `-32002`. A bad, revoked or banned-user token gets `401` with code `-32001`.

## Security notes

- **Agents cannot post, chat or moderate.** The server has no tool to comment, send chat messages, edit an account, make tokens, or take any staff action. The `save` tool only changes your own library.
- **Tokens only work here.** An `ffk_` token is accepted at `/mcp` and nowhere else. It can't call the account API.
- **Hashed and revocable.** Tokens are stored as SHA-256 hashes, shown once, and can be revoked at any time. Treat one like a password: keep it out of git, logs and chat transcripts. Use the narrowest scope that works. Most agents only need `read`.
- **Browsers are refused.** A request with an `Origin` header for another site gets `403`, so a web page can't drive the server with a stored token.
- **Results are data, not instructions.** Catalog text, post text and term definitions come from outside sources. Your agent should treat them as untrusted content.
- **Found a hole?** Report it privately. See [SECURITY.md](../SECURITY.md).
