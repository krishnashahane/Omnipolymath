---
summary: "Generated inventory of Omnipolymath plugins shipped in core, published externally, or kept source-only"
read_when:
  - You are deciding whether a plugin ships in the core npm package or installs separately
  - You are updating bundled plugin package metadata or release automation
  - You need the current internal vs external plugin list
title: "Plugin inventory"
---

<!-- Generated file. Do not edit by hand.
Run `pnpm plugins:inventory:gen` to rebuild it. -->

This page lists every Omnipolymath plugin with its package, install route, and
description. Operators use it to find a plugin and to see whether that plugin
needs a separate install. Maintainers use it to check bundled plugin metadata
and release automation.

## Definitions

- **Core npm package:** built into the `omnipolymath` npm package and available without a separate plugin install.
- **Official external package:** Omnipolymath-maintained plugin omitted from the core npm package, kept in this official inventory, and installed on demand through ClawHub and/or npm.
- **Source checkout only:** repo-local plugin omitted from published npm artifacts and not advertised as an installable package.

Source checkouts are different from npm installs: after `pnpm install`, bundled
plugins load from `extensions/<id>` so local edits and package-local workspace
dependencies are available.

## Install a plugin

Use the install route in each entry to decide whether install is needed. Plugins
that say `included in Omnipolymath` are already present in the core package.
Official external packages need one install. Installation applies to the running
local Gateway without restarting it; start the Gateway if it was stopped.

For example, Discord is an official external package:

```bash
omnipolymath plugins install @omnipolymath/discord
omnipolymath plugins inspect discord --runtime --json
```

Package specs, including `@omnipolymath/*`, install from ClawHub by default. Only
bare plugin ids without a version or tag retain bundled and official catalog
shortcuts. Use `clawhub:@omnipolymath/discord`
or `npm:@omnipolymath/discord` when you need an explicit source. After install,
follow the plugin's setup doc, such as [Discord](/channels/discord), to add
credentials and channel config. See
[Manage plugins](/plugins/manage-plugins) for update, uninstall, and publishing
commands.

Each entry lists the package, distribution route, and description.

## Core npm package

80 plugins

- **[a2a](/plugins/reference/a2a)** (`@omnipolymath/a2a`) - included in Omnipolymath. A2A v1.0 Agent-to-Agent protocol channel plugin.

- **[active-memory](/plugins/reference/active-memory)** (`omnipolymath`) - included in Omnipolymath. Runs bounded pre-reply memory retrieval and implements per-agent Remember across conversations for eligible private conversations.

- **[admin-http-rpc](/plugins/reference/admin-http-rpc)** (`@omnipolymath/admin-http-rpc`) - included in Omnipolymath. Omnipolymath admin HTTP RPC endpoint.

- **[advisor](/plugins/reference/advisor)** (`@omnipolymath/advisor`) - included in Omnipolymath. Reviews ongoing agent work on the session's own model and offers one short correction.

- **[agent-guidance](/plugins/reference/agent-guidance)** (`@omnipolymath/agent-guidance`) - included in Omnipolymath. Shares instruction files across selected agents without editing their workspace files.

- **[agentsapi](/plugins/reference/agentsapi)** (`@omnipolymath/agentsapi`) - included in Omnipolymath. OpenAI Agents API harness with hosted or self-hosted sessions.

- **[alibaba](/plugins/reference/alibaba)** (`@omnipolymath/alibaba-provider`) - included in Omnipolymath. Adds video generation provider support.

- **[anthropic](/plugins/reference/anthropic)** (`@omnipolymath/anthropic-provider`) - included in Omnipolymath. Anthropic models, Claude CLI, and native Claude session catalog.

- **[apple-fm](/plugins/reference/apple-fm)** (`@omnipolymath/apple-fm-provider`) - included in Omnipolymath. On-device Apple Intelligence inference for lightweight setup and short tasks.

- **[autoreview](/plugins/reference/autoreview)** (`@omnipolymath/autoreview`) - included in Omnipolymath. Review changes in the current sandbox with the installed Auto Review helper.

- **[azure-speech](/plugins/reference/azure-speech)** (`@omnipolymath/azure-speech`) - included in Omnipolymath. Azure AI Speech text-to-speech (MP3, native Ogg/Opus voice notes, PCM telephony).

- **[beam](/plugins/reference/beam)** (`@omnipolymath/beam`) - included in Omnipolymath. Read-only coding-session Beam receiver.

- **[bifrost](/plugins/reference/bifrost)** (`@omnipolymath/bifrost-provider`) - included in Omnipolymath. Adds Bifrost model provider support to Omnipolymath.

- **[bonjour](/plugins/reference/bonjour)** (`@omnipolymath/bonjour`) - included in Omnipolymath. Advertise the local Omnipolymath gateway over Bonjour/mDNS.

- **[browser](/plugins/reference/browser)** (`@omnipolymath/browser-plugin`) - included in Omnipolymath. Adds agent-callable tools.

- **[canvas](/plugins/reference/canvas)** (`@omnipolymath/canvas-plugin`) - included in Omnipolymath. Presents hosted widget documents on paired macOS panels.

- **[clawrouter](/plugins/reference/clawrouter)** (`@omnipolymath/clawrouter`) - included in Omnipolymath. Adds ClawRouter model provider support to Omnipolymath.

- **[cloudflare](/plugins/reference/cloudflare)** (`@omnipolymath/cloudflare`) - included in Omnipolymath, and also from npm or ClawHub: `@omnipolymath/cloudflare`. Cloudflare R2 storage for named Omnipolymath storage locations.

- **[code-mode-quickjs](/plugins/reference/code-mode-quickjs)** (`@omnipolymath/code-mode-quickjs`) - included in Omnipolymath. Hardened JavaScript execution for Code Mode using QuickJS in WebAssembly.

- **[copilot-proxy](/plugins/reference/copilot-proxy)** (`@omnipolymath/copilot-proxy`) - included in Omnipolymath. Adds Copilot Proxy model provider support to Omnipolymath.

- **[crabbox](/plugins/reference/crabbox)** (`@omnipolymath/crabbox-provider`) - included in Omnipolymath. Cloud worker provider and lease-backed sandbox backend for the Crabbox CLI.

- **[cua-computer](/plugins/reference/cua-computer)** (`@omnipolymath/cua-computer`) - included in Omnipolymath. Experimental CUA Driver computer control for macOS, Windows, and Linux node hosts.

- **[deep-research](/plugins/reference/deep-research)** (`@omnipolymath/deep-research`) - included in Omnipolymath. Bounded research with source-backed findings and explicit gaps.

- **[deepgram](/plugins/reference/deepgram)** (`@omnipolymath/deepgram-provider`) - included in Omnipolymath. Deepgram audio transcription with Nova and Flux models, plus realtime speech recognition.

- **[device-pair](/plugins/reference/device-pair)** (`omnipolymath`) - included in Omnipolymath. Generate setup codes and approve device pairing requests.

- **[document-extract](/plugins/reference/document-extract)** (`@omnipolymath/document-extract-plugin`) - included in Omnipolymath. Extract text and fallback page images from local document attachments.

- **[elevenlabs](/plugins/reference/elevenlabs)** (`@omnipolymath/elevenlabs-speech`) - included in Omnipolymath. Adds media understanding provider support. Adds realtime transcription provider support. Adds text-to-speech provider support.

- **[fal](/plugins/reference/fal)** (`@omnipolymath/fal-provider`) - included in Omnipolymath. Adds fal model provider support to Omnipolymath.

- **[file-transfer](/plugins/reference/file-transfer)** (`@omnipolymath/file-transfer`) - included in Omnipolymath. Fetch, list, and write files on paired nodes via dedicated node commands. Bypasses bash stdout truncation by using base64 over node.invoke for binaries up to 16 MB.

- **[geolocation](/plugins/reference/geolocation)** (`@omnipolymath/geolocation-plugin`) - included in Omnipolymath. Resolves client IP addresses to a coarse city using a locally cached IP-geolocation database.

- **[github](/plugins/reference/github)** (`@omnipolymath/github`) - included in Omnipolymath. Public GitHub link previews and document reader.

- **[github-copilot](/plugins/reference/github-copilot)** (`@omnipolymath/github-copilot-provider`) - included in Omnipolymath. Adds GitHub Copilot model provider support to Omnipolymath.

- **[google](/plugins/reference/google)** (`@omnipolymath/google-plugin`) - included in Omnipolymath. Adds Google, Google Gemini CLI, Google Vertex model provider support to Omnipolymath.

- **[huggingface](/plugins/reference/huggingface)** (`@omnipolymath/huggingface-provider`) - included in Omnipolymath. Adds Hugging Face model provider support to Omnipolymath.

- **[imap](/plugins/reference/imap)** (`@omnipolymath/imap`) - included in Omnipolymath. Watch IMAP mailboxes and dispatch authenticated incoming email to isolated agent sessions.

- **[kie](/plugins/reference/kie)** (`@omnipolymath/kie-provider`) - included in Omnipolymath. Adds Kie model provider support to Omnipolymath.

- **[knowledge](/plugins/reference/knowledge)** (`@omnipolymath/knowledge`) - included in Omnipolymath. Evidence-backed knowledge, inspectable in Omnipolymath.

- **[linux-node](/plugins/reference/linux-node)** (`@omnipolymath/linux-node`) - included in Omnipolymath. Desktop notifications, camera capture, and location for Linux node hosts.

- **[litellm](/plugins/reference/litellm)** (`@omnipolymath/litellm-provider`) - included in Omnipolymath. Adds LiteLLM model provider support to Omnipolymath.

- **[llm-task](/plugins/reference/llm-task)** (`@omnipolymath/llm-task`) - included in Omnipolymath. Generic JSON-only LLM tool for structured tasks callable from workflows.

- **[lmstudio](/plugins/reference/lmstudio)** (`@omnipolymath/lmstudio-provider`) - included in Omnipolymath. Adds LM Studio model provider support to Omnipolymath.

- **[logbook](/plugins/reference/logbook)** (`@omnipolymath/logbook`) - included in Omnipolymath. Automatic work journal: captures periodic screen snapshots from a paired node and turns them into a reviewable timeline of your day.

- **[mcp-events](/plugins/reference/mcp-events)** (`@omnipolymath/mcp-events`) - included in Omnipolymath. Subscribe to events from configured MCP accounts and trigger authored automations.

- **[mcp-relay](/plugins/reference/mcp-relay)** (`@omnipolymath/mcp-relay`) - included in Omnipolymath. Connect remote MCP clients to your Omnipolymath Gateway.

- **[memory-core](/plugins/reference/memory-core)** (`@omnipolymath/memory-core`) - included in Omnipolymath. Adds agent-callable tools.

- **[memory-wiki](/plugins/reference/memory-wiki)** (`@omnipolymath/memory-wiki`) - included in Omnipolymath. Persistent wiki compiler and Obsidian-friendly knowledge vault for Omnipolymath.

- **[microsoft](/plugins/reference/microsoft)** (`@omnipolymath/microsoft-speech`) - included in Omnipolymath. Adds text-to-speech provider support.

- **[microsoft-foundry](/plugins/reference/microsoft-foundry)** (`@omnipolymath/microsoft-foundry`) - included in Omnipolymath. Adds Microsoft Foundry model provider support to Omnipolymath.

- **[migrate-claude](/plugins/reference/migrate-claude)** (`@omnipolymath/migrate-claude`) - included in Omnipolymath. Imports Claude Code and Claude Desktop instructions, MCP servers, skills, and safe configuration into Omnipolymath.

- **[migrate-hermes](/plugins/reference/migrate-hermes)** (`@omnipolymath/migrate-hermes`) - included in Omnipolymath. Imports Hermes configuration, memories, skills, and supported credentials into Omnipolymath.

- **[minimax](/plugins/reference/minimax)** (`@omnipolymath/minimax-provider`) - included in Omnipolymath. Adds MiniMax, MiniMax Portal model provider support to Omnipolymath.

- **[nvidia](/plugins/reference/nvidia)** (`@omnipolymath/nvidia-provider`) - included in Omnipolymath. Adds NVIDIA model provider support to Omnipolymath.

- **[oc-path](/plugins/reference/oc-path)** (`@omnipolymath/oc-path`) - included in Omnipolymath. Adds the omnipolymath path CLI for oc:// workspace file addressing.

- **[ollama](/plugins/reference/ollama)** (`@omnipolymath/ollama-provider`) - included in Omnipolymath. Adds Ollama, Ollama Cloud model provider support to Omnipolymath.

- **[omlx](/plugins/reference/omlx)** (`@omnipolymath/omlx-provider`) - included in Omnipolymath. Adds Omlx model provider support to Omnipolymath.

- **[omnipolymath-id-access](/plugins/reference/omnipolymath-id-access)** (`@omnipolymath/omnipolymath-id-access`) - included in Omnipolymath. Choose who can reach this claw remotely: invite people, approve their requests, and see and remove members.

- **[onepassword](/plugins/reference/onepassword)** (`@omnipolymath/onepassword`) - included in Omnipolymath. 1Password SecretRef resolver and curated agent broker with approval policy and SQLite audit history.

- **[openai](/plugins/reference/openai)** (`@omnipolymath/openai-provider`) - included in Omnipolymath. Adds OpenAI model provider support to Omnipolymath.

- **[opencode-go](/plugins/reference/opencode-go)** (`@omnipolymath/opencode-go-provider`) - included in Omnipolymath. Adds OpenCode Go model provider support to Omnipolymath.

- **[openrouter](/plugins/reference/openrouter)** (`@omnipolymath/openrouter-provider`) - included in Omnipolymath. Adds OpenRouter model provider support to Omnipolymath.

- **[policy](/plugins/reference/policy)** (`@omnipolymath/policy`) - included in Omnipolymath. Adds policy-backed doctor checks for workspace conformance.

- **[reef](/plugins/reference/reef)** (`@omnipolymath/reef`) - included in Omnipolymath. Guarded end-to-end encrypted claw channel.

- **[requesty](/plugins/reference/requesty)** (`@omnipolymath/requesty-provider`) - included in Omnipolymath. Adds Requesty model provider support to Omnipolymath.

- **[rerank](/plugins/reference/rerank)** (`@omnipolymath/rerank-provider`) - included in Omnipolymath. Use any /rerank endpoint as a Decision model.

- **[runway](/plugins/reference/runway)** (`@omnipolymath/runway-provider`) - included in Omnipolymath. Adds video generation provider support.

- **[senseaudio](/plugins/reference/senseaudio)** (`@omnipolymath/senseaudio-provider`) - included in Omnipolymath. Adds media understanding provider support.

- **[session-share](/plugins/reference/session-share)** (`@omnipolymath/session-share`) - included in Omnipolymath. Read-only Omnipolymath sessions on paired gateways.

- **[sglang](/plugins/reference/sglang)** (`@omnipolymath/sglang-provider`) - included in Omnipolymath. Adds SGLang model provider support to Omnipolymath.

- **[skill-workshop](/plugins/reference/skill-workshop)** (`@omnipolymath/skill-workshop`) - included in Omnipolymath. Learned skills each agent saves from its own work.

- **[talk-voice](/plugins/reference/talk-voice)** (`omnipolymath`) - included in Omnipolymath. Manage Talk voice selection (list/set).

- **[telegram](/plugins/reference/telegram)** (`@omnipolymath/telegram`) - included in Omnipolymath. Omnipolymath Telegram channel plugin.

- **[together](/plugins/reference/together)** (`@omnipolymath/together-provider`) - included in Omnipolymath. Adds Together model provider support to Omnipolymath.

- **[trust-firewall](/plugins/reference/trust-firewall)** (`@omnipolymath/trust-firewall`) - included in Omnipolymath. Least-privilege approvals, prompt-injection shield with a model second opinion, tamper-evident action log with undo, dry-run mode, daily spend cap, agent wallets, self-cleaning memory, skill install checks and a receipt for every run.

- **[tts-local-cli](/plugins/reference/tts-local-cli)** (`@omnipolymath/tts-local-cli`) - included in Omnipolymath. Adds text-to-speech provider support.

- **[vault](/plugins/reference/vault)** (`@omnipolymath/vault`) - included in Omnipolymath. HashiCorp Vault SecretRef provider integration.

- **[vllm](/plugins/reference/vllm)** (`@omnipolymath/vllm-provider`) - included in Omnipolymath. Adds vLLM model provider support to Omnipolymath.

- **[web-readability](/plugins/reference/web-readability)** (`@omnipolymath/web-readability-plugin`) - included in Omnipolymath. Extract readable article content from local HTML web fetch responses.

- **[workboard](/plugins/reference/workboard)** (`@omnipolymath/workboard`) - included in Omnipolymath. Dashboard workboard for agent-owned issues and sessions.

- **[x](/plugins/reference/x)** (`@omnipolymath/x`) - included in Omnipolymath. Allowlisted X mentions and public replies.

- **[xai](/plugins/reference/xai)** (`@omnipolymath/xai-plugin`) - included in Omnipolymath. xAI provider for Grok models, Grok web and X search, code execution, speech, and media generation.

## Official external packages

105 plugins

- **[abliteration](/plugins/reference/abliteration)** (`@omnipolymath/abliteration-provider`) - npm or ClawHub: `@omnipolymath/abliteration-provider`. Omnipolymath Abliteration provider plugin.

- **[acpx](/plugins/reference/acpx)** (`@omnipolymath/acpx`) - npm or ClawHub: `@omnipolymath/acpx`. Omnipolymath ACP runtime backend with plugin-owned session and transport management.

- **[amazon-bedrock](/plugins/reference/amazon-bedrock)** (`@omnipolymath/amazon-bedrock-provider`) - npm or ClawHub: `@omnipolymath/amazon-bedrock-provider`. Omnipolymath Amazon Bedrock provider plugin with model discovery, embeddings, and guardrail support.

- **[amazon-bedrock-mantle](/plugins/reference/amazon-bedrock-mantle)** (`@omnipolymath/amazon-bedrock-mantle-provider`) - npm or ClawHub: `@omnipolymath/amazon-bedrock-mantle-provider`. Omnipolymath Amazon Bedrock Mantle provider plugin for OpenAI Responses, Chat Completions, and Anthropic Messages routing.

- **[anthropic-vertex](/plugins/reference/anthropic-vertex)** (`@omnipolymath/anthropic-vertex-provider`) - npm or ClawHub: `@omnipolymath/anthropic-vertex-provider`. Omnipolymath Anthropic Vertex provider plugin for Claude models on Google Vertex AI.

- **[arcee](/plugins/reference/arcee)** (`@omnipolymath/arcee-provider`) - npm or ClawHub: `@omnipolymath/arcee-provider`. Adds Arcee model provider support to Omnipolymath.

- **[baseten](/plugins/reference/baseten)** (`@omnipolymath/baseten-provider`) - npm or ClawHub: `@omnipolymath/baseten-provider`. Omnipolymath Baseten provider plugin.

- **[brave](/plugins/reference/brave)** (`@omnipolymath/brave-plugin`) - npm or ClawHub: `@omnipolymath/brave-plugin`. Omnipolymath Brave Search provider plugin for web search.

- **[buzz](/plugins/reference/buzz)** (`@omnipolymath/buzz`) - npm or ClawHub: `@omnipolymath/buzz`. Connect Omnipolymath agents to Buzz rooms.

- **[byteplus](/plugins/reference/byteplus)** (`@omnipolymath/byteplus-provider`) - npm or ClawHub: `@omnipolymath/byteplus-provider`. Adds BytePlus, BytePlus Plan model provider support to Omnipolymath.

- **[celeris](/plugins/reference/celeris)** (`@omnipolymath/celeris`) - npm or ClawHub: `@omnipolymath/celeris`. Adds Celeris model provider support to Omnipolymath.

- **[cerebras](/plugins/reference/cerebras)** (`@omnipolymath/cerebras-provider`) - npm or ClawHub: `@omnipolymath/cerebras-provider`. Adds Cerebras model provider support to Omnipolymath.

- **[chutes](/plugins/reference/chutes)** (`@omnipolymath/chutes-provider`) - npm or ClawHub: `@omnipolymath/chutes-provider`. Adds Chutes model provider support to Omnipolymath.

- **[clickclack](/plugins/reference/clickclack)** (`@omnipolymath/clickclack`) - npm or ClawHub: `@omnipolymath/clickclack`. Omnipolymath ClickClack channel plugin.

- **[cloudflare-ai-gateway](/plugins/reference/cloudflare-ai-gateway)** (`@omnipolymath/cloudflare-ai-gateway-provider`) - npm or ClawHub: `@omnipolymath/cloudflare-ai-gateway-provider`. Adds Cloudflare AI Gateway model provider support to Omnipolymath.

- **[codex](/plugins/reference/codex)** (`@omnipolymath/codex`) - npm or ClawHub: `@omnipolymath/codex`. Codex app-server harness and native session catalog.

- **[cohere](/plugins/reference/cohere)** (`@omnipolymath/cohere-provider`) - npm or ClawHub: `@omnipolymath/cohere-provider`. Omnipolymath Cohere provider plugin.

- **[comfy](/plugins/reference/comfy)** (`@omnipolymath/comfy-provider`) - npm or ClawHub: `@omnipolymath/comfy-provider`. Adds ComfyUI model provider support to Omnipolymath.

- **[copilot](/plugins/reference/copilot)** (`@omnipolymath/copilot`) - npm or ClawHub: `@omnipolymath/copilot`. Registers the GitHub Copilot agent runtime.

- **[deepinfra](/plugins/reference/deepinfra)** (`@omnipolymath/deepinfra-provider`) - npm or ClawHub: `@omnipolymath/deepinfra-provider`. Adds DeepInfra model provider support to Omnipolymath.

- **[deepseek](/plugins/reference/deepseek)** (`@omnipolymath/deepseek-provider`) - npm or ClawHub: `@omnipolymath/deepseek-provider`. Adds DeepSeek model provider support to Omnipolymath.

- **[diagnostics-otel](/plugins/reference/diagnostics-otel)** (`@omnipolymath/diagnostics-otel`) - npm or ClawHub: `@omnipolymath/diagnostics-otel`. Omnipolymath diagnostics OpenTelemetry exporter for metrics, traces, and logs.

- **[diagnostics-prometheus](/plugins/reference/diagnostics-prometheus)** (`@omnipolymath/diagnostics-prometheus`) - npm or ClawHub: `@omnipolymath/diagnostics-prometheus`. Omnipolymath diagnostics Prometheus exporter for runtime metrics.

- **[diffs](/plugins/reference/diffs)** (`@omnipolymath/diffs`) - npm or ClawHub: `@omnipolymath/diffs`. Omnipolymath read-only diff viewer plugin and file renderer for agents.

- **[diffs-language-pack](/plugins/reference/diffs-language-pack)** (`@omnipolymath/diffs-language-pack`) - npm or ClawHub: `@omnipolymath/diffs-language-pack`. Adds syntax highlighting for languages outside the default diffs viewer set.

- **[discord](/plugins/reference/discord)** (`@omnipolymath/discord`) - npm or ClawHub: `@omnipolymath/discord`. Omnipolymath Discord channel plugin for channels, DMs, commands, and app events.

- **[duckduckgo](/plugins/reference/duckduckgo)** (`@omnipolymath/duckduckgo-plugin`) - npm or ClawHub: `@omnipolymath/duckduckgo-plugin`. Adds web search provider support.

- **[exa](/plugins/reference/exa)** (`@omnipolymath/exa-plugin`) - npm or ClawHub: `@omnipolymath/exa-plugin`. Adds web search provider support.

- **[facetime](/plugins/reference/facetime)** (`@omnipolymath/facetime`) - npm or ClawHub: `@omnipolymath/facetime`. Experimental FaceTime realtime voice carrier for Omnipolymath agents.

- **[fastino](/plugins/reference/fastino)** (`@omnipolymath/fastino-provider`) - npm or ClawHub: `@omnipolymath/fastino-provider`. Native GLiDE Boolean, Choice and Score decisions.

- **[featherless](/plugins/reference/featherless)** (`@omnipolymath/featherless-provider`) - npm or ClawHub: `@omnipolymath/featherless-provider`. Omnipolymath Featherless AI provider plugin.

- **[feishu](/plugins/reference/feishu)** (`@omnipolymath/feishu`) - npm or ClawHub: `@omnipolymath/feishu`. Omnipolymath Feishu/Lark channel plugin for chats and workplace tools (community maintained by @m1heng).

- **[firecrawl](/plugins/reference/firecrawl)** (`@omnipolymath/firecrawl-plugin`) - npm or ClawHub: `@omnipolymath/firecrawl-plugin`. Adds agent-callable tools. Adds web fetch provider support. Adds web search provider support.

- **[fireworks](/plugins/reference/fireworks)** (`@omnipolymath/fireworks-provider`) - npm or ClawHub: `@omnipolymath/fireworks-provider`. Adds Fireworks model provider support to Omnipolymath.

- **[fish-audio-speech](/plugins/reference/fish-audio-speech)** (`@omnipolymath/fish-audio-speech`) - npm or ClawHub: `@omnipolymath/fish-audio-speech`. Fish Audio hosted text-to-speech with streaming, voice notes, and telephony output.

- **[gmi](/plugins/reference/gmi)** (`@omnipolymath/gmi-provider`) - npm or ClawHub: `@omnipolymath/gmi-provider`. Omnipolymath GMI Cloud provider plugin.

- **[google-meet](/plugins/reference/google-meet)** (`@omnipolymath/google-meet`) - npm or ClawHub: `@omnipolymath/google-meet`. Omnipolymath Google Meet participant plugin for joining calls through Chrome or Twilio transports.

- **[googlechat](/plugins/reference/googlechat)** (`@omnipolymath/googlechat`) - npm or ClawHub: `@omnipolymath/googlechat`. Omnipolymath Google Chat channel plugin for spaces and direct messages.

- **[gradium](/plugins/reference/gradium)** (`@omnipolymath/gradium-speech`) - npm or ClawHub: `@omnipolymath/gradium-speech`. Adds text-to-speech provider support.

- **[groq](/plugins/reference/groq)** (`@omnipolymath/groq-provider`) - npm or ClawHub: `@omnipolymath/groq-provider`. Adds Groq model provider support to Omnipolymath.

- **[imessage](/plugins/reference/imessage)** (`@omnipolymath/imessage`) - npm or ClawHub: `@omnipolymath/imessage`. Omnipolymath iMessage channel plugin using imsg on a signed-in Mac.

- **[inworld](/plugins/reference/inworld)** (`@omnipolymath/inworld-speech`) - npm or ClawHub: `@omnipolymath/inworld-speech`. Inworld streaming text-to-speech (MP3, OGG_OPUS, PCM telephony).

- **[irc](/plugins/reference/irc)** (`@omnipolymath/irc`) - npm or ClawHub: `@omnipolymath/irc`. Omnipolymath IRC channel plugin.

- **[kilocode](/plugins/reference/kilocode)** (`@omnipolymath/kilocode-provider`) - npm or ClawHub: `@omnipolymath/kilocode-provider`. Adds Kilocode model provider support to Omnipolymath.

- **[kimi](/plugins/reference/kimi)** (`@omnipolymath/kimi-provider`) - npm or ClawHub: `@omnipolymath/kimi-provider`. Adds Kimi, Kimi Code, Kimi Coding model provider support to Omnipolymath.

- **[levanto](/plugins/reference/levanto)** (`@omnipolymath/levanto`) - npm or ClawHub: `@omnipolymath/levanto`. Native Yes/No, Choice, Scale, Sort, and Tags decisions with explicit abstention.

- **[line](/plugins/reference/line)** (`@omnipolymath/line`) - npm or ClawHub: `@omnipolymath/line`. Omnipolymath LINE channel plugin for LINE Bot API chats.

- **[liquid-ai](/plugins/reference/liquid-ai)** (`@omnipolymath/liquid-ai-provider`) - npm or ClawHub: `@omnipolymath/liquid-ai-provider`. Adds Liquid AI model provider support to Omnipolymath.

- **[llama-cpp](/plugins/reference/llama-cpp)** (`@omnipolymath/llama-cpp-provider`) - npm or ClawHub: `@omnipolymath/llama-cpp-provider`. Managed and external llama.cpp servers for GGUF chat, embeddings and local images.

- **[lobster](/plugins/reference/lobster)** (`@omnipolymath/lobster`) - npm or ClawHub: `@omnipolymath/lobster`. Lobster workflow tool plugin for typed pipelines and resumable approvals.

- **[longcat](/plugins/reference/longcat)** (`@omnipolymath/longcat-provider`) - npm or ClawHub: `@omnipolymath/longcat-provider`. Omnipolymath LongCat provider plugin.

- **[matrix](/plugins/reference/matrix)** (`@omnipolymath/matrix`) - npm or ClawHub: `@omnipolymath/matrix`. Omnipolymath Matrix channel plugin for rooms and direct messages.

- **[mattermost](/plugins/reference/mattermost)** (`@omnipolymath/mattermost`) - npm or ClawHub: `@omnipolymath/mattermost`. Omnipolymath Mattermost channel plugin.

- **[memory-lancedb](/plugins/reference/memory-lancedb)** (`@omnipolymath/memory-lancedb`) - npm or ClawHub: `@omnipolymath/memory-lancedb`. Omnipolymath LanceDB-backed long-term memory plugin with auto-recall, auto-capture, and vector search.

- **[meta](/plugins/reference/meta)** (`@omnipolymath/meta-provider`) - npm or ClawHub: `@omnipolymath/meta-provider`. Adds Meta model provider support to Omnipolymath.

- **[mistral](/plugins/reference/mistral)** (`@omnipolymath/mistral-provider`) - npm or ClawHub: `@omnipolymath/mistral-provider`. Adds Mistral model provider support to Omnipolymath.

- **[moonshot](/plugins/reference/moonshot)** (`@omnipolymath/moonshot-provider`) - npm or ClawHub: `@omnipolymath/moonshot-provider`. Adds Moonshot model provider support to Omnipolymath.

- **[msteams](/plugins/reference/msteams)** (`@omnipolymath/msteams`) - npm or ClawHub: `@omnipolymath/msteams`. Omnipolymath Microsoft Teams channel plugin for bot conversations.

- **[muse](/plugins/reference/muse)** (`@omnipolymath/muse`) - npm or ClawHub: `@omnipolymath/muse`. Runs Meta models through the Muse Code CLI.

- **[mxc](/plugins/reference/mxc)** (`@omnipolymath/mxc-sandbox`) - npm or ClawHub: `@omnipolymath/mxc-sandbox`. OS-level sandboxed tool execution via MXC: runs commands in a Windows ProcessContainer with configured MXC policy files.

- **[nace](/plugins/reference/nace)** (`@omnipolymath/nace`) - npm or ClawHub: `@omnipolymath/nace`. Adds Nace model provider support to Omnipolymath.

- **[nextcloud-talk](/plugins/reference/nextcloud-talk)** (`@omnipolymath/nextcloud-talk`) - npm or ClawHub: `@omnipolymath/nextcloud-talk`. Omnipolymath Nextcloud Talk channel plugin for conversations.

- **[nostr](/plugins/reference/nostr)** (`@omnipolymath/nostr`) - npm or ClawHub: `@omnipolymath/nostr`. Omnipolymath Nostr channel plugin for NIP-04 encrypted direct messages.

- **[novita](/plugins/reference/novita)** (`@omnipolymath/novita-provider`) - npm or ClawHub: `@omnipolymath/novita-provider`. Adds Novita, Novita AI, Novitaai model provider support to Omnipolymath.

- **[onnx](/plugins/reference/onnx)** (`@omnipolymath/onnx`) - npm or ClawHub: `@omnipolymath/onnx`. Local typed decisions using pinned ONNX classifiers.

- **[opencode](/plugins/reference/opencode)** (`@omnipolymath/opencode-provider`) - npm or ClawHub: `@omnipolymath/opencode-provider`. Adds OpenCode model provider support to Omnipolymath.

- **[openshell](/plugins/reference/openshell)** (`@omnipolymath/openshell-sandbox`) - npm or ClawHub: `@omnipolymath/openshell-sandbox`. Omnipolymath sandbox backend for the NVIDIA OpenShell CLI with mirrored local workspaces and SSH command execution.

- **[parallel](/tools/parallel-search)** (`@omnipolymath/parallel-plugin`) - npm or ClawHub: `@omnipolymath/parallel-plugin`. Adds Parallel model provider support to Omnipolymath.

- **[particle](/plugins/reference/particle)** (`@omnipolymath/particle-provider`) - npm or ClawHub: `@omnipolymath/particle-provider`. Adds Particle model provider support to Omnipolymath.

- **[perplexity](/plugins/reference/perplexity)** (`@omnipolymath/perplexity-plugin`) - npm or ClawHub: `@omnipolymath/perplexity-plugin`. Adds Perplexity Decisions model provider support to Omnipolymath.

- **[pixverse](/plugins/reference/pixverse)** (`@omnipolymath/pixverse-provider`) - npm or ClawHub: `@omnipolymath/pixverse-provider`. Omnipolymath PixVerse video generation provider plugin.

- **[qianfan](/plugins/reference/qianfan)** (`@omnipolymath/qianfan-provider`) - npm or ClawHub: `@omnipolymath/qianfan-provider`. Adds Qianfan model provider support to Omnipolymath.

- **[qqbot](/plugins/reference/qqbot)** (`@tencent-connect/omnipolymath-qqbot`) - npm. Omnipolymath QQ Bot channel plugin for group and direct-message workflows.

- **[qwen](/plugins/reference/qwen)** (`@omnipolymath/qwen-provider`) - npm or ClawHub: `@omnipolymath/qwen-provider`. Adds Qwen, Qwen Cloud, Model Studio, DashScope, Qwen Token Plan, Bailian Token Plan model provider support to Omnipolymath.

- **[radius](/plugins/reference/radius)** (`@omnipolymath/radius-provider`) - npm or ClawHub: `@omnipolymath/radius-provider`. Radius model gateway provider.

- **[raft](/plugins/reference/raft)** (`@omnipolymath/raft`) - npm or ClawHub: `@omnipolymath/raft`. Omnipolymath Raft channel plugin for secure CLI wake bridges.

- **[searxng](/plugins/reference/searxng)** (`@omnipolymath/searxng-plugin`) - npm or ClawHub: `@omnipolymath/searxng-plugin`. Adds web search provider support.

- **[signal](/plugins/reference/signal)** (`@omnipolymath/signal`) - npm or ClawHub: `@omnipolymath/signal`. Omnipolymath Signal channel plugin.

- **[slack](/plugins/reference/slack)** (`@omnipolymath/slack`) - npm or ClawHub: `@omnipolymath/slack`. Omnipolymath Slack channel plugin for channels, DMs, commands, and app events.

- **[slack-huddles](/plugins/reference/slack-huddles)** (`@omnipolymath/slack-huddles`) - npm or ClawHub: `@omnipolymath/slack-huddles`. Join Slack huddles through a dedicated Slack user in Chrome.

- **[sms](/plugins/reference/sms)** (`@omnipolymath/sms`) - npm or ClawHub: `@omnipolymath/sms`. Twilio SMS/MMS channel plugin for Omnipolymath messages.

- **[stepfun](/plugins/reference/stepfun)** (`@omnipolymath/stepfun-provider`) - npm or ClawHub: `@omnipolymath/stepfun-provider`. Adds StepFun, StepFun Plan model provider support to Omnipolymath.

- **[subq](/plugins/reference/subq)** (`@omnipolymath/subq`) - npm or ClawHub: `@omnipolymath/subq`. SubQ Snap typed decisions (not a conversational model).

- **[synology-chat](/plugins/reference/synology-chat)** (`@omnipolymath/synology-chat`) - npm or ClawHub: `@omnipolymath/synology-chat`. Synology Chat channel plugin for Omnipolymath channels and direct messages.

- **[synthetic](/plugins/reference/synthetic)** (`@omnipolymath/synthetic-provider`) - npm or ClawHub: `@omnipolymath/synthetic-provider`. Adds Synthetic model provider support to Omnipolymath.

- **[tavily](/plugins/reference/tavily)** (`@omnipolymath/tavily-plugin`) - npm or ClawHub: `@omnipolymath/tavily-plugin`. Adds agent-callable tools. Adds web search provider support.

- **[team-reports](/plugins/reference/team-reports)** (`@omnipolymath/team-reports`) - npm or ClawHub: `@omnipolymath/team-reports`. Daily, weekly, and monthly team activity reports from GitHub and Discord, with model-written summaries, served in the Control UI.

- **[teams-meetings](/plugins/reference/teams-meetings)** (`@omnipolymath/teams-meetings`) - npm or ClawHub: `@omnipolymath/teams-meetings`. Join Microsoft Teams meetings as a Chrome browser guest.

- **[tencent](/plugins/reference/tencent)** (`@omnipolymath/tencent-provider`) - npm or ClawHub: `@omnipolymath/tencent-provider`. Adds Tencent TokenHub, Tencent Tokenplan model provider support to Omnipolymath.

- **[tlon](/plugins/reference/tlon)** (`@omnipolymath/tlon`) - npm or ClawHub: `@omnipolymath/tlon`. Omnipolymath Tlon/Urbit channel plugin for chat workflows.

- **[tokenjuice](/plugins/reference/tokenjuice)** (`@omnipolymath/tokenjuice`) - npm or ClawHub: `@omnipolymath/tokenjuice`. Compacts exec and bash tool results with tokenjuice reducers.

- **[twitch](/plugins/reference/twitch)** (`@omnipolymath/twitch`) - npm or ClawHub: `@omnipolymath/twitch`. Omnipolymath Twitch channel plugin for chat and moderation workflows.

- **[typesafe](/plugins/reference/typesafe)** (`@omnipolymath/typesafe`) - npm or ClawHub: `@omnipolymath/typesafe`. Typed decision provider for hosted Jev and local System One models.

- **[venice](/plugins/reference/venice)** (`@omnipolymath/venice-provider`) - npm or ClawHub: `@omnipolymath/venice-provider`. Adds Venice model provider support to Omnipolymath.

- **[vercel-ai-gateway](/plugins/reference/vercel-ai-gateway)** (`@omnipolymath/vercel-ai-gateway-provider`) - npm or ClawHub: `@omnipolymath/vercel-ai-gateway-provider`. Adds Vercel AI Gateway model provider support to Omnipolymath.

- **[voice-call](/plugins/reference/voice-call)** (`@omnipolymath/voice-call`) - npm or ClawHub: `@omnipolymath/voice-call`. Omnipolymath voice-call plugin for Twilio, Telnyx, and Plivo phone calls.

- **[volcengine](/plugins/reference/volcengine)** (`@omnipolymath/volcengine-provider`) - npm or ClawHub: `@omnipolymath/volcengine-provider`. Adds Volcengine, Volcengine Plan model provider support to Omnipolymath.

- **[voyage](/plugins/reference/voyage)** (`@omnipolymath/voyage-provider`) - npm or ClawHub: `@omnipolymath/voyage-provider`. Adds embedding provider support, including memory search.

- **[vydra](/plugins/reference/vydra)** (`@omnipolymath/vydra-provider`) - npm or ClawHub: `@omnipolymath/vydra-provider`. Adds Vydra model provider support to Omnipolymath.

- **[whatsapp](/plugins/reference/whatsapp)** (`@omnipolymath/whatsapp`) - npm or ClawHub: `@omnipolymath/whatsapp`. Omnipolymath WhatsApp channel plugin for WhatsApp Web chats.

- **[xiaomi](/plugins/reference/xiaomi)** (`@omnipolymath/xiaomi-provider`) - npm or ClawHub: `@omnipolymath/xiaomi-provider`. Adds Xiaomi, Xiaomi Token Plan model provider support to Omnipolymath.

- **[zai](/plugins/reference/zai)** (`@omnipolymath/zai-provider`) - npm or ClawHub: `@omnipolymath/zai-provider`. Adds Z.AI model provider support to Omnipolymath.

- **[zalo](/plugins/reference/zalo)** (`@omnipolymath/zalo`) - npm or ClawHub: `@omnipolymath/zalo`. Omnipolymath Zalo channel plugin for bot and webhook chats.

- **[zalouser](/plugins/reference/zalouser)** (`@omnipolymath/zalouser`) - npm or ClawHub: `@omnipolymath/zalouser`. Omnipolymath Zalo Personal Account plugin via native zca-js integration.

- **[zoom-meetings](/plugins/reference/zoom-meetings)** (`@omnipolymath/zoom-meetings`) - npm or ClawHub: `@omnipolymath/zoom-meetings`. Join Zoom meetings as a Chrome browser guest.

## Source checkout only

3 plugins

- **[qa-channel](/plugins/reference/qa-channel)** (`@omnipolymath/qa-channel`) - source checkout only. Omnipolymath QA synthetic channel plugin.

- **[qa-lab](/plugins/reference/qa-lab)** (`@omnipolymath/qa-lab`) - source checkout only. Omnipolymath QA lab plugin with private debugger UI and scenario runner.

- **[visitor-access](/plugins/reference/visitor-access)** (`@omnipolymath/visitor-access`) - source checkout only. Manage expiring visitor grants through one Cloudflare Access email policy.

## How this page is built

Omnipolymath generates this page from the top-level
`extensions/*/omnipolymath.plugin.json` manifests and the root npm package
`files` exclusions. Optional `package.json` metadata enriches package and
distribution details. Regenerate the page with:

```bash
pnpm plugins:inventory:gen
```
