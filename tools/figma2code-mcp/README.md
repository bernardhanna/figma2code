# figma2code-mcp

CLI to fetch Figma design context via the Figma MCP server, normalize it into the same AST JSON shape produced by the Figma plugin, and optionally POST that AST to the generator’s REST endpoints (`/api/preview-only` and `/api/generate`).

## What it does

- **Ingest**: Calls MCP tools (`get_design_context`, `get_screenshot`, optionally `get_variable_defs`, `get_metadata`) and normalizes the result into the plugin AST contract.
- **Output**: Writes the normalized AST to stdout and/or a file (`--out`).
- **POST** (optional): Sends the AST to a given URL (e.g. preview-only or generate) with the same body shape the UI uses.

MCP is **optional**. If MCP is unavailable (unreachable, unauthorized, or no `node-id` in URL), the CLI exits with a clear error and does not affect existing plugin or server flows.

## Requirements

- Node 18+
- For **remote MCP**: Figma design URL with `node-id` and valid Figma auth for the MCP server.
- For **desktop MCP**: Figma desktop app with MCP server running (e.g. `http://127.0.0.1:3845/mcp`) and a selection in the file.

## Install

From the repo root (or from `tools/figma2code-mcp`):

```bash
cd tools/figma2code-mcp
npm install
npm run build
```

Link or run the binary:

```bash
node dist/cli.js ingest --help
# or, if linked: figma2code-mcp ingest --help
```

## Commands

### `ingest`

Fetch from MCP, normalize to plugin AST, optionally write to file and/or POST.

**Required (pick one):**

- `--url <figmaDesignUrl>` — For remote MCP. Must include `node-id` (e.g. `?node-id=42-15`).
- `--desktop` — Use desktop MCP (selection-based); no URL.

**Options:**

| Option | Description |
|--------|-------------|
| `--mcp <endpoint>` | MCP endpoint. Default: remote `https://mcp.figma.com/mcp`, desktop `http://127.0.0.1:3845/mcp`. |
| `--type <flexi_block\|navbar\|footer>` | Block type (default: `flexi_block`). |
| `--slug <slug>` | Slug; if omitted, derived from frame/name. |
| `--out <path>` | Write AST JSON to this file. |
| `--post <url>` | POST the AST to this URL (e.g. preview-only or generate). |
| `--refineMode <0\|1\|...>` | Sent in POST body (same as UI) for preview-only. |
| `--dry-run` | Do not POST, only output AST. |
| `--verbose` | Log tool calls and timings. |
| `--minimal` | Skip `get_screenshot` and `get_variable_defs` (2 MCP calls instead of 4; use when hitting rate limits). |

## Examples

**Remote MCP, write AST to file:**

```bash
figma2code-mcp ingest --url "https://www.figma.com/design/<fileKey>/<fileName>?node-id=42-15" --out ./tmp/ast.json
```

**Desktop MCP, write AST:**

```bash
figma2code-mcp ingest --desktop --out ./tmp/ast.json
```

**POST to preview-only (e.g. local generator on port 5173):**

```bash
figma2code-mcp ingest --url "https://figma.com/design/..." --post http://localhost:5173/api/preview-only --refineMode 1
```

**POST to generate:**

```bash
figma2code-mcp ingest --url "https://figma.com/design/..." --post http://localhost:5173/api/generate --type flexi_block --slug my-section
```

## URL parsing (node-id)

- **Hyphen format** (Figma URL): `node-id=1-2` → used as-is and exposed as `nodeIdHyphen`.
- **Colon format** (MCP tools): `1:2` → derived by replacing `-` with `:` and exposed as `nodeIdColon`.

If the URL has no `node-id` query parameter, the CLI exits with an error asking you to add it.

## Rate limits

Figma MCP uses the same [rate limits as the Figma REST API](https://developers.figma.com/docs/rest-api/rate-limits/). Limits depend on **the file’s plan** and your **seat** (View/Collab vs Dev/Full):

- **Starter plan or View/Collab seats:** very low (e.g. up to 6 requests per month for Tier 1).
- **Dev/Full on paid plans:** e.g. 10–20 requests per minute (Professional/Organization/Enterprise).

Each ingest uses **4 MCP tool calls** by default (`get_design_context`, `get_screenshot`, `get_variable_defs`, `get_metadata`). To use fewer calls:

1. **Use `--minimal`**  
   Skips `get_screenshot` and `get_variable_defs`, so each ingest uses **2 calls** (design context + metadata). You still get a full AST; only screenshot overlay and variable definitions in `meta` are missing.

   ```bash
   figma2code-mcp ingest --desktop --slug my-frame --out ./tmp/ast.json --minimal
   ```

2. **File location**  
   If the file lives in a **Starter** team, limits are low. [Copy the file](https://help.figma.com/hc/en-us/articles/8403626871063) to a team on a **Professional** (or higher) plan and open that copy; higher limits apply to that file.

3. **Seat type**  
   [Dev or Full seats](https://help.figma.com/hc/en-us/articles/360046216313) on a paid plan get higher per-minute limits than View/Collab.

## Troubleshooting

### 401 Unauthorized (remote MCP)

With `--url` the CLI uses **remote** MCP (`https://mcp.figma.com/mcp`), which requires Figma authentication. Without it you get `MCP HTTP 401: Unauthorized`.

**Options:**

1. **Use desktop MCP (no cloud auth):** Open the same Figma file in the **Figma desktop app**, select the frame that matches your URL’s `node-id`, ensure the desktop MCP server is running (e.g. Dev Mode), then run:
   ```bash
   figma2code-mcp ingest --desktop --mcp http://127.0.0.1:3845/mcp --out ./tmp/your.ast.json --dry-run --verbose
   ```
   You can omit `--url`; selection is taken from the desktop app.

2. **Use remote MCP:** Set up authentication per [Figma MCP remote server installation](https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/), then run with `--url` as before.

### "Rate limit exceeded" / empty tree

If you see rate-limit messages or an AST with an empty `tree` and zero size, see [Rate limits](#rate-limits) above. Use `--minimal` to halve the number of MCP calls, and ensure the file is in a team with higher limits (or try again later).

### "MCP get_design_context failed" (other errors)

- **Remote**: Ensure you’re authenticated to the Figma MCP server (e.g. token / OAuth). Check [Figma MCP remote setup](https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/).
- **Desktop**: Ensure the Figma desktop app is running and the MCP server is enabled (e.g. Dev Mode / MCP). Default endpoint is `http://127.0.0.1:3845/mcp`.

### "Invalid or incomplete Figma URL" / missing node-id

- Use a Figma design URL that includes the selected node, e.g.  
  `https://www.figma.com/design/<fileKey>/<fileName>?node-id=42-15`.
- Add `?node-id=<id>` (hyphen form) if the URL doesn’t have it.

### Permissions

- Remote MCP: same permissions as your Figma account and the MCP app.
- Desktop MCP: local only; no extra Figma permissions beyond opening the file.

### POST fails (4xx/5xx)

- Ensure the generator server is running at the URL you pass to `--post`.
- For `/api/preview-only`, the body is `{ ...ast, refineMode }` (same as the UI).
- For `/api/generate`, the body is the AST; the server expects `slug`/`frameName`, `type`, and `tree`.

## Output AST shape

The CLI outputs an object that matches the plugin AST contract:

- `slug`, `type` (`flexi_block` | `navbar` | `footer`), `frame` (`{ w, h }`), `tree` (NodeBase), `slots`, `meta`.
- `tree` has at least `id`, `name`, `type`, `w`, `h`, `children` (array). Other fields (e.g. `bb`, `relX`, `relY`, `auto`, `fills`, `text`, `img`, `svg`) are set when available from MCP; otherwise they are omitted so downstream `normalizeAst` and the pipeline stay unchanged.

## Tests

From `tools/figma2code-mcp`:

```bash
npm run build
npm test
```

Tests cover URL parsing (fileKey, node-id, hyphen/colon), normalizer (required keys, `tree.children` array), and the POST helper (failure behavior, refineMode).
