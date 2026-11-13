---
summary: "CLI reference for `omnipolymath browser` (lifecycle, profiles, tabs, actions, state, and debugging)"
read_when:
  - You use `omnipolymath browser` and want examples for common tasks
  - You want to control a browser running on another machine via a node host
  - You want to attach to your local signed-in Chrome via Chrome MCP
title: "Browser"
---

# `omnipolymath browser`

Manage Omnipolymath's browser control surface and run browser actions: lifecycle, profiles, tabs, snapshots, screenshots, navigation, input, state emulation, and debugging.

Related: [Browser tool](/tools/browser)

## Common flags

- `--url <gatewayWsUrl>`: Gateway WebSocket URL (defaults to config).
- `--token <token>`: Gateway token (if required).
- `--timeout <ms>`: request timeout in ms (default: `30000`).
- `--expect-final`: wait for a final Gateway response.
- `--browser-profile <name>`: choose a browser profile (default: `omnipolymath`, or `browser.defaultProfile`).
- `--json`: machine-readable output (where supported). This is a browser-level option, so
  place it before the subcommand for an unambiguous form, such as
  `omnipolymath browser --json status`. Trailing placement such as
  `omnipolymath browser status --json` also works when the selected child command does not
  define its own `--json`.

With `--json`, local action-input, state, and viewport validation refusals write one JSON error document to
stdout (`ok: false`, `error.type: "cli_error"`) and exit with status 1. Without
`--json`, the diagnostic remains on stderr.

Malformed request timeouts, invalid tab indexes, and Gateway request rejections
also use this JSON failure envelope, including navigation, resize, and cookie requests.

Ctrl-C or SIGTERM cancels pending reads such as status, tabs, and plain snapshots
without printing late results. Already-accepted actions, `errors --clear`,
`requests --clear`, and `snapshot --labels` still wait for their receipt.
This includes the status readback for `start` and `stop`. Interrupted `doctor`
reads do not report the browser as unhealthy.

The CLI reserves 10 additional seconds beyond the request timeout for node and
Gateway transport, allowing browser timeout diagnostics to reach the caller.

## Quick start (local)

```bash
omnipolymath browser profiles
omnipolymath browser --browser-profile omnipolymath start
omnipolymath browser --browser-profile omnipolymath open https://example.com
omnipolymath browser --browser-profile omnipolymath snapshot
```

Agents can run the same readiness check with `browser({ action: "doctor" })`.

## Quick troubleshooting

If `start` fails with `not reachable after start`, troubleshoot CDP readiness first. If `start` and `tabs` succeed but `open` or `navigate` fails, the browser control plane is healthy and the failure is usually a navigation SSRF policy block.

Minimal sequence:

```bash
omnipolymath browser --browser-profile omnipolymath doctor
omnipolymath browser --browser-profile omnipolymath start
omnipolymath browser --browser-profile omnipolymath tabs
omnipolymath browser --browser-profile omnipolymath open https://example.com
```

Detailed guidance: [Browser troubleshooting](/tools/browser/troubleshooting#cdp-startup-failure-vs-navigation-ssrf-block)

## Lifecycle

```bash
omnipolymath browser status
omnipolymath browser doctor
omnipolymath browser doctor --deep
omnipolymath browser start
omnipolymath browser start --headless
omnipolymath browser stop
omnipolymath browser --browser-profile omnipolymath reset-profile
```

- `doctor --deep` adds a live snapshot check: useful when basic CDP readiness is green but you want proof the current tab can be inspected.
- For a running local managed profile, `status` and `doctor` report cached
  graphics diagnostics from Chrome: hardware/software classification, renderer,
  backend, device/driver, feature and disabled-status details, and accelerated
  video capabilities. `omnipolymath browser --json status` returns the full structured payload.
  Passive status never launches Chrome just to collect these facts.
- `stop` closes the active control session and clears temporary emulation overrides. This applies even to `attachOnly` and remote CDP profiles, where Omnipolymath did not launch the browser process itself. For local managed profiles, `stop` also stops the spawned browser process.
- `start --headless` applies only to that start request, and only when Omnipolymath launches a local managed browser. It does not rewrite `browser.headless` or profile config, and is a no-op for an already-running browser.
- Local managed profiles run headless by default on every platform. `OMNIPOLYMATH_BROWSER_HEADLESS=0`, `browser.headless=false`, or `browser.profiles.<name>.headless=false` explicitly requests a visible browser; Linux then needs `DISPLAY` or `WAYLAND_DISPLAY`. Externally owned browsers keep their current mode.

## If the command is missing

If `omnipolymath browser` is an unknown command, check `plugins.allow` in `~/.omnipolymath/omnipolymath.json`. When `plugins.allow` is present, list the bundled browser plugin explicitly unless the config already has a root `browser` block:

```json5
{
  plugins: {
    allow: ["telegram", "browser"],
  },
}
```

An explicit root `browser` block (for example `browser.enabled=true` or `browser.profiles.<name>`) also activates the bundled browser plugin under a restrictive plugin allowlist.

Related: [Browser tool](/tools/browser/setup#missing-browser-command-or-tool)

## Profiles

Profiles are named browser routing configs:

- `omnipolymath` (default): launches or attaches to a dedicated Omnipolymath-managed Chrome instance (isolated user data dir).
- `user`: controls your existing signed-in Chrome session via Chrome DevTools MCP.
- custom CDP profiles: point at a local or remote CDP endpoint.

```bash
omnipolymath browser profiles
omnipolymath browser system-profiles
omnipolymath browser system-profiles --browser brave
omnipolymath browser import-profile --browser chrome --system Default --into imported
omnipolymath browser import-profile --system "Profile 1" --into work --domains google.com,youtube.com
omnipolymath browser create-profile --name work --color "#FF5A36"
omnipolymath browser create-profile --name chrome-live --driver existing-session
omnipolymath browser create-profile --name remote --cdp-url https://browser-host.example.com
omnipolymath browser delete-profile --name work
```

Use a specific profile with `--browser-profile <name>` on any subcommand, for example `omnipolymath browser --browser-profile work tabs`.

Automatic local profile creation skips CDP ports already occupied by another process. The check does not reserve the port; browser launch still checks availability. Explicit ports and CDP URLs remain unchanged.

On macOS, `system-profiles` lists real Chrome, Brave, Edge, or Chromium profiles available on the host. `import-profile` decrypts their cookies after one macOS Keychain/Touch ID consent prompt and injects them into a fresh Omnipolymath-managed profile. It imports cookies only. Local storage and IndexedDB are unchanged. Some Google sessions use device-bound session credentials (DBSC) and can still require re-authentication after import.

Newer macOS versions can also ask whether the Gateway's Node process may access the browser's data. Until someone answers that prompt on the Gateway host, system-profile discovery and import time out while the rest of the Gateway keeps running.

When the macOS app uses a local Gateway, it can offer this import once and make the isolated imported profile the default for agent browsing. Import always requires an explicit click. Successful import or dismissal suppresses later automatic prompts, and **Settings → General → Browser login** remains available for re-import.

System-profile import is enabled by default. Set `browser.allowSystemProfileImport=false` to disable both CLI and agent-triggered imports. Import is host-local and cannot run through the browser node proxy.

### Cookie sync to a remote Gateway

`import-profile` targets a managed profile on the same host. When your Omnipolymath Gateway and agent browser run on a separate computer, use `cookie-sync` instead. It decrypts cookies on this Mac and pushes them into a managed profile on that remote Gateway over the operator connection:

```bash
omnipolymath browser cookie-sync --domains github.com,news.ycombinator.com --into work
omnipolymath browser --url wss://gateway.example.com cookie-sync --domains github.com --into work --watch
```

- `--domains` is required. Cookie sync copies live session cookies, so it never sends an unrestricted cookie jar. A missing or empty allowlist is a hard error.
- `--into` selects the target managed profile on the Gateway (default `imported`). `--gateway`/`--url` selects a remote Gateway (default is the configured or local one).
- `--watch` keeps the command running and re-pushes when the source Cookies database changes. The macOS Keychain secret is read once per watch session, so you approve a single consent prompt rather than one per change.
- Decryption is host-local (macOS only) and reuses the same allowlist and Keychain path as `import-profile`. Cookies are decrypted on this Mac and shipped over the existing TLS-pinned Gateway connection. No cookie values are printed.
- Some Google sessions use device-bound session credentials (DBSC) that stay tied to this Mac and can still require re-authentication after sync. For those sites, prefer driving the browser on the Mac itself through the [browser node proxy](#remote-browser-control-node-host-proxy).

The macOS app exposes the same capability under **Dashboard → Settings → This Mac → Browser**: an off-by-default toggle, an editable domain allowlist, and a target-profile field. When enabled in remote mode it supervises `cookie-sync --watch` for you against the connected Gateway and shows a live status row.

## Chrome extension relay

```bash
omnipolymath browser extension path
omnipolymath browser extension setup --action inspect --json
omnipolymath browser extension setup --action install --json
omnipolymath browser extension setup --action verify --browser-profile chrome --json
omnipolymath browser extension install
omnipolymath browser extension install --no-store
omnipolymath browser extension install --json --wait-ms 60000
omnipolymath browser extension status
omnipolymath browser extension status --json
omnipolymath browser extension uninstall-host
omnipolymath browser extension uninstall-store
omnipolymath browser extension pair
omnipolymath browser extension pair --gateway-url wss://gateway.example.com
omnipolymath browser extension cdp
omnipolymath browser extension cdp --json
```

- `extension setup` is the shared host-local controller for CLI, TUI, and native
  desktop adapters. `inspect` is read-only installation discovery, `install`
  prepares native bootstrap, and `verify` authenticates the selected local relay.
  Its redacted JSON separates preparation, Chrome approval, and connection.
  Valid pending/blocked states exit 0; execution failures exit nonzero. It never
  treats a remote dashboard or SSH loopback URL as proof of a local browser host.
- `extension install` pre-registers the origin-locked native bootstrap host.
  Google Chrome on macOS can be prepared before its first launch; other supported
  browsers need an existing user-data directory. On macOS, setup then requests
  the official Store installation in Google Chrome for all profiles in that directory.
  Chrome discovers this at startup. Fully quit and reopen Chrome when convenient,
  then approve or enable Omnipolymath. The command never restarts Chrome or bypasses
  approval. For other browsers and platforms,
  load the unpacked extension as described in the [Chrome extension guide](/tools/chrome-extension)
  (it isn't on the Chrome Web Store yet).
  Linux supports automatic native pairing. Windows uses the self-contained
  `Omnipolymath.BrowserBootstrap.exe` from the packaged CLI or Windows companion.
  A portable/local installer can pass `--native-host-executable <absolute-path>`
  to `extension setup --action install` or `extension install`. Setup checks owned
  context/ACLs and actual framed subprocess responses before user-level registry
  registration through the shared C# registration service. The CLI explicitly
  selects native Windows context; the Companion owns its managed-WSL mode.
  Conflicting contexts and unknown transport outcomes never trigger another
  writer or mode fallback. No executable or no proof means no automatic bootstrap; it never
  falls back to a script host or bypasses Chrome approval.
- `extension install --no-store` copies the stable development extension and
  registers the native host without creating a Store request. Existing requests
  are unchanged. Use the printed path for **Load unpacked**.
- `extension status` reports `storeInstallRequests` states (`requested`,
  `missing`, `foreign`, `invalid`) separately from `storeDiscovered` approval
  fields (`enabled`, `awaitingApproval`), approved unpacked IDs and paths, and
  native-host registration health. Local installation status does not prove a
  live relay connection. JSON output never includes a pairing string or relay key.
- `extension uninstall-host` removes only verified Omnipolymath-owned native-host
  manifests and launchers. It does not remove the extension from Chrome. On
  Windows it delegates to the same registration service; `--remove-store` removes
  verified owned Store requests first. `--native-host-executable` and
  `--browser-profile` select the same explicit local context for status/removal.
- `extension uninstall-store` removes only Omnipolymath-owned macOS Chrome Store
  requests (macOS only). Windows uses `uninstall-host --remove-store` rather than
  a separate Store writer. Chrome may remove an externally installed extension at its next
  startup. Native-host registration and the development copy remain intact.
- `extension path` is read-only. It prints the stable installed copy when
  present and the bundled source directory otherwise.
- `extension pair` remains the advanced manual flow. `--gateway-url` creates a
  direct remote-Gateway pairing URL. Non-loopback URLs must use `wss://`.
- `extension pair --local-gateway --json` lets desktop native helpers obtain
  the existing local pairing through the Gateway’s `/browser/extension` wake-up
  route. It requires a local Gateway configuration and cannot be combined with
  `--gateway-url`. The JSON contains a credential: consume it privately, never log it.
- `extension cdp` prints non-secret Browser Relay Authentication v2 metadata:
  the loopback browser/CDP endpoints, protocol version, key ID, and fixed
  challenge/complete binding. It never prints the relay key or an authorization
  header by default.

Automatic local bootstrap connects through the local Gateway's exact
`/browser/extension` route so the first authenticated extension connection
starts the lazy browser-control service. Keep `omnipolymath gateway run` or the
managed Gateway service running. No separate browser request or prewarm is
needed. Local Omnipolymath and mcporter calls still use the profile relay port
reported by `extension pair` or `extension cdp` after that wakeup. Browser-node
pairings continue to use the relay on the browser-node host, while explicit
`--gateway-url` pairings remain direct-remote and manual-only.

The advanced manual `extension pair` command without `--gateway-url` or
`--local-gateway` retains
the host-local `/extension` relay URL. With the native host installed,
**Automatic local setup** enabled, and an extension build that supports relay
wake-up, reconnecting can start a standalone relay on the saved pairing's
configured port. This does not start Gateway browser control: authenticated CDP
clients can use the standalone relay without a Gateway, but `omnipolymath browser`
actions still require one. For source-checkout testing, load the managed unpacked
copy from the same Omnipolymath installation.

`extension cdp --legacy-bearer` is a temporary migration escape hatch. It
prints the old Bearer header with a warning only while
`browser.extensionRelay.allowLegacyAuth=true`. Otherwise it exits with an error
without printing a credential. Use `--json` for machine output. Warnings remain
on stderr so stdout stays valid JSON.

Setup, security model, and recovery steps: [Chrome extension](/tools/chrome-extension).

Run installation on the machine hosting Chrome. In the macOS app,
**Dashboard → Settings → This Mac → Browser → Set up Chrome on this Mac** invokes
the local CLI even when connected to a remote Gateway. The browser-based
dashboard offers Store and documentation links instead.

If the extension already attempted automatic setup before the native host
existed, Chromium retains that miss for the running browser process. Restart
Chrome once, run `extension install`, then reopen the Store extension. Popup
retries alone cannot recover that existing process.

## Tabs

```bash
omnipolymath browser tabs
omnipolymath browser tab new --label docs
omnipolymath browser tab label t1 docs
omnipolymath browser tab select 2
omnipolymath browser tab close 2
omnipolymath browser open https://omnipolymath.vercel.app/docs --label docs
omnipolymath browser focus docs
omnipolymath browser close t1
```

`tabs` returns `suggestedTargetId` first, then the stable `tabId` (such as `t1`), the optional label, and the raw `targetId`. Pass `suggestedTargetId` back into `focus`, `close`, snapshots, and actions. Assign a label with `open --label`, `tab new --label`, or `tab label`. Labels, tab ids, raw target ids, and unique target-id prefixes are all accepted. The request field is still named `targetId` for compatibility, but it accepts any of these tab references.

For HTTP CDP profiles, `close` confirms that the tab disappears before reporting
success. If a page prompt keeps it open, resolve the prompt and retry. If the tab
list cannot be read after the close request, confirm the tab's state in the
browser before retrying; the close may already have succeeded.

Profiles configured with `driver: "extension"` can additionally return a numeric
`webExtensionTabId`. It is scoped to the current browser runtime and is intended
only for calls into Chrome's WebExtensions API. It can change after the browser
or extension reconnects and is omitted for other drivers or when extension
metadata is unavailable. Do not pass it to Omnipolymath browser commands; keep using
`suggestedTargetId` or `tabId` there.

Raw target ids are volatile diagnostic handles, not durable agent memory. Chromium can replace the underlying raw target during a navigation or form submit. Omnipolymath then keeps the stable `tabId` or label attached to the replacement tab, when it can prove the match. Prefer `suggestedTargetId`.

## Snapshot / screenshot / actions

Snapshot:

```bash
omnipolymath browser snapshot
omnipolymath browser snapshot --urls
```

Page-text extraction through the browser API counts its character budget in UTF-16
code units. If a limit falls inside a surrogate pair, extraction omits the whole
pair rather than returning a broken character; the result remains truncated.

Screenshot:

```bash
omnipolymath browser screenshot
omnipolymath browser screenshot --full-page
omnipolymath browser screenshot --ref e12
omnipolymath browser screenshot --labels
```

- `--full-page` is for page captures only. It cannot be combined with `--ref` or `--element`.
- `existing-session` / `user` profiles support page screenshots and `--ref` screenshots from snapshot output, but not CSS `--element` screenshots.
- `--labels` overlays current snapshot refs on the screenshot. On Playwright-backed profiles it works with `--full-page` (full-page overlay), `--ref` (element-clip overlay by ARIA ref), and `--element` (element-clip overlay by CSS selector). In element-clip modes labels are projected relative to the element. The response also includes an `annotations` array, omitted when empty. Each entry carries one ref's bounding box: `ref`, `number`, `role`, optional `name`, and `box: {x, y, width, height}`. Coordinates use the captured image's space (viewport, fullpage, or element-relative).
  `existing-session` profiles render a chrome-mcp overlay on page screenshots but do not use the Playwright projection helper and do not include `annotations`. CSS `--element` screenshots are unsupported there. Without Playwright or chrome-mcp, labeled screenshots are not available.
- `snapshot --urls` appends discovered link destinations to AI snapshots so agents can choose direct navigation targets instead of guessing from link text alone.

Navigate/click/type (ref-based UI automation):

```bash
omnipolymath browser navigate https://example.com
omnipolymath browser click <ref>
omnipolymath browser click-coords 120 340
omnipolymath browser type <ref> "hello"
omnipolymath browser press Enter
omnipolymath browser hover <ref>
omnipolymath browser scrollintoview <ref>
omnipolymath browser drag <startRef> <endRef>
omnipolymath browser select <ref> OptionA OptionB
omnipolymath browser fill --fields '[{"ref":"1","value":"Ada"}]'
omnipolymath browser wait --text "Done"
omnipolymath browser evaluate --fn '(el) => el.textContent' --ref <ref>
omnipolymath browser evaluate --fn 'const title = document.title; return title;'
omnipolymath browser evaluate --timeout-ms 30000 --fn 'async () => { await window.ready; return true; }'
```

`press` accepts named keys and shortcuts such as `Escape`, `Control+Shift+T`, and `Control++`. Common `Esc`, `Return`, `Del`, `Ctrl`, and `Cmd` aliases are normalized.

For managed browser profiles, `select` preserves option values exactly. Quote empty or whitespace-sensitive values, such as `omnipolymath browser select <ref> ""` or `omnipolymath browser select <ref> " padded "`.

`evaluate --fn` accepts a function source, an expression, or a statement body. Statement bodies are wrapped as async functions, so use `return` for the value you want back. Use `--timeout-ms` when the page-side function may need longer than the default evaluate timeout. `browser.evaluateEnabled=false` (default: `true`) disables both `evaluate` and `wait --fn`.

Action responses return the current raw `targetId` after action-triggered page replacement when Omnipolymath can prove the replacement tab. Scripts should still store and pass `suggestedTargetId`/labels for long-lived workflows.

File + dialog helpers:

```bash
omnipolymath browser upload /tmp/omnipolymath/uploads/file.pdf --ref <ref>
omnipolymath browser upload media://inbound/file.pdf --ref <ref>
omnipolymath browser waitfordownload
omnipolymath browser download <ref> report.pdf
omnipolymath browser dialog --accept
omnipolymath browser dialog --dismiss --dialog-id d1
```

Managed Chrome profiles save ordinary click-triggered downloads into the Omnipolymath downloads directory (`/tmp/omnipolymath/downloads` by default, or the configured temp root). Use `waitfordownload` or `download` when the agent needs to wait for a specific file and return its path. Those explicit waiters own the next download. Uploads accept files from the Omnipolymath temp uploads root and Omnipolymath-managed inbound media, including `media://inbound/<id>` and sandbox-relative `media/inbound/<id>` references. Nested media refs, traversal, and arbitrary local paths are rejected.

For remote browser nodes, Omnipolymath stages private copies and normalizes filenames for portability, including Windows device names and trailing dots or spaces. File bytes remain unchanged.

File-chooser uploads measure their completion timeout using elapsed time.
Adjusting the Gateway host's wall clock does not shorten or extend that budget;
the existing timeout and cancellation still apply.

Explicit download paths and `trace stop --out` preserve filename whitespace where the filesystem supports it. Quote these paths, for example `omnipolymath browser download <ref> " report.pdf "`. Output paths must stay inside their managed download or trace directory.

If saving a download fails, Omnipolymath requests cancellation of the transfer and reports the original save error. Correct the output path or filesystem problem before starting a new download.

If a page closes before its next download starts, the pending download wait rejects
immediately. Accepted downloads keep their existing save and cancellation behavior.

When an action opens a modal dialog, text output reports the block and pending dialog IDs. The JSON response returns `blockedByDialog` with `browserState.dialogs.pending`. Pass `--dialog-id` to answer it directly. Dialogs handled outside Omnipolymath appear under `browserState.dialogs.recent`.

Batch actions:

```bash
omnipolymath browser batch --actions '[{"kind":"wait","timeMs":500},{"kind":"click","ref":"12"},{"kind":"type","ref":"23","text":"hello"}]'
omnipolymath browser batch --actions-file plan.json
omnipolymath browser batch --actions-file - --continue
```

`omnipolymath browser batch` sends a `kind="batch"` `/act` request with nested `BrowserActRequest` actions (`wait`, `click`, `type`, `evaluate`, ...) — not `open`/`navigate`/`snapshot`/`screenshot`, which are CLI subcommands, not `/act` kinds. `--continue` sets `stopOnError=false` (default stops on first error). `--target-id` scopes the whole batch to one tab. A failed nested action makes the command exit nonzero. Use `--json` to retain the ordered `results` response. See [Browser batch CLI](/tools/browser-control#browser-batch-cli) for the full contract (ref lifecycle, target id conflicts, error summary). `batch` is not supported on `profile="user"` / existing-session profiles.

If navigation or a closed page stops the batch, text output reports the action number and skipped count. Take a fresh snapshot before continuing with dependent actions.

`--actions-file` and `--actions-file -` stdin input are capped at 1,000,000 bytes. Split larger plans into multiple `omnipolymath browser batch` commands.

`fill --fields-file`, `batch --actions-file`, and batch stdin require valid UTF-8.
Malformed bytes are rejected before any browser action runs. Save the input as
UTF-8 and retry; valid Unicode values, including emoji and CJK text, are preserved.

`fill --fields-file` requires a regular file or a symlink to one. Pipes and other
special files are rejected before dispatch. Fields files have no size cap.

## State and storage

Viewport + emulation:

```bash
omnipolymath browser resize 1280 720
omnipolymath browser set viewport 1280 720
omnipolymath browser set offline on
omnipolymath browser set media dark
omnipolymath browser set timezone Europe/London
omnipolymath browser set locale en-GB
omnipolymath browser set geo 51.5074 -0.1278 --accuracy 25
omnipolymath browser set device "iPhone 14"
omnipolymath browser set headers '{"x-test":"1"}'
omnipolymath browser set credentials myuser mypass
```

Cookies + storage:

```bash
omnipolymath browser cookies
omnipolymath browser cookies set session abc123 --url https://example.com
omnipolymath browser cookies clear
omnipolymath browser storage local get
omnipolymath browser storage local set token abc123
omnipolymath browser storage session clear
```

Storage keys preserve surrounding whitespace. Quote the key in shell commands,
for example `omnipolymath browser storage local get " account "`. Setting that key
does not overwrite the separate `account` entry. Empty or whitespace-only keys
remain invalid for `set`; omitting the key in `get` lists all entries.

## Debugging

```bash
omnipolymath browser console --level error
omnipolymath browser pdf
omnipolymath browser responsebody "**/api"
omnipolymath browser highlight <ref>
omnipolymath browser errors --clear
omnipolymath browser requests --filter api
omnipolymath browser trace start
omnipolymath browser trace stop --out trace.zip
```

`responsebody` writes the bounded response prefix to stdout and warns on stderr
when it is truncated. `--json` includes the response metadata and `truncated`
flag without a separate warning. Use `--max-chars` to select the prefix limit.

## Existing Chrome via MCP

Use the built-in `user` profile, or create your own `existing-session` profile:

```bash
omnipolymath browser --browser-profile user tabs
omnipolymath browser create-profile --name chrome-live --driver existing-session
omnipolymath browser create-profile --name brave-live --driver existing-session --user-data-dir "~/Library/Application Support/BraveSoftware/Brave-Browser"
omnipolymath browser create-profile --name chrome-port --driver existing-session --cdp-url http://127.0.0.1:9222
omnipolymath browser --browser-profile chrome-live tabs
```

The default existing-session path is host-only Chrome MCP auto-connect. If the browser is already running with a DevTools endpoint, pass `--cdp-url` so Chrome MCP attaches to that endpoint instead. For Docker, Browserless, or other remote setups where Chrome MCP semantics are not needed, use a CDP profile instead.

Current existing-session limits:

- Snapshot-driven actions use refs, not CSS selectors.
- Supported `act` requests use a built-in 60000 ms default when callers omit `timeoutMs`. Accepted per-call overrides set that action budget.
- `click` is left-click only.
- `type` does not support `slowly=true`.
- `press` does not support `delayMs`.
- `hover`, `scrollintoview`, `drag`, `select`, and `fill` reject per-call timeout overrides. `evaluate` accepts `--timeout-ms`.
- `select` supports one value only.
- `wait --load networkidle` is not supported (works on managed and raw/remote CDP profiles).
- File uploads require `--ref` / `--input-ref` and do not support CSS `--element`. Pass multiple paths when the page's file input accepts multiple files.
- Dialog hooks do not support `--timeout`.
- Screenshots support page captures and `--ref`, but not CSS `--element`.
- `responsebody`, download interception, PDF export, and batch actions still require a managed browser or raw CDP profile.

Existing-session action steps share one execution budget: filling and submitting with `type` do not each receive a fresh timeout. A conditional `wait` allows its explicit `timeMs` delay plus the action budget (with a 250 ms minimum) to satisfy the condition. A pure timer wait reserves the larger of `timeMs` and the action budget.

Navigation verification has a separate shared allowance of the action budget plus 1250 ms for scheduled delays. `resize` and `close` skip verification. Browser and tab preparation, execution, and final URL lookup share the overall request deadline. Internal calls and navigation checks do not renew it.

## Remote browser control (node host proxy)

If the Gateway runs on a different machine than the browser, run a **node host** on the machine that has Chrome/Brave/Edge/Chromium. The Gateway proxies browser actions to that node. No separate browser control server is required.

Automatic routing prefers the Gateway host's browser and uses a single connected browser node only when local browser capability is unavailable. Use `gateway.nodes.browser.mode` to control this fallback and `gateway.nodes.browser.node` to explicitly select a node, including when the host has a browser. A stopped local managed browser with an installed executable still stays local.

Security + remote setup: [Browser tool](/tools/browser), [Remote access](/gateway/remote), [Tailscale](/gateway/tailscale), [Security](/gateway/security)

## Related

- [CLI reference](/cli)
- [Browser](/tools/browser)
