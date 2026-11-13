# @omnipolymath/buzz

Official Buzz channel plugin for Omnipolymath. It connects an Omnipolymath agent to approved Buzz rooms for text conversations and threaded replies.

## Requirements

You need:

- A Buzz relay URL
- A Buzz owner or admin
- A room where the bot can receive the **Bot** role

Use `wss://` outside local development.

## Set up

```bash
omnipolymath channels add --channel buzz
```

Omnipolymath installs the plugin if needed, asks for the relay URL, and generates a dedicated bot identity.

Give the displayed **public key only** to a Buzz owner or admin:

```bash
buzz channels add-member \
  --channel <ROOM_UUID> \
  --pubkey <BOT_PUBLIC_KEY> \
  --role bot
```

Closed relays may also require the bot to be added as a relay member. Setup waits for approval, discovers accessible rooms, and saves the selected rooms and default target.

Restart the Gateway if it was already running.

## Verify

```bash
omnipolymath channels status --probe
```

Inspect the current bot, approved rooms, and room members:

```bash
omnipolymath directory self --channel buzz
omnipolymath directory peers list --channel buzz
omnipolymath directory groups list --channel buzz
omnipolymath directory groups members --channel buzz --group-id buzz:<ROOM_UUID>
```

Buzz profile and room names are used as display labels, while public keys and
room UUIDs remain the stable identities. Archived rooms are omitted; an
archive or restore event rebuilds only the Buzz connection's room
subscriptions and does not stop the Gateway.

Send a test message:

```bash
omnipolymath message send \
  --channel buzz \
  --target <ROOM_UUID> \
  --message "Hello from Omnipolymath"
```

## Security and scope

- Never give Omnipolymath a human owner's private key.
- The generated bot private key is stored in Omnipolymath configuration; only its public key is displayed.
- Treat Buzz messages as untrusted agent input.
- Currently supported: text conversations, threads, typing, and directory
  lookup in group rooms.
- Not yet supported: DMs, media, reactions, or creating rooms from Omnipolymath.

Full documentation: https://omnipolymath.vercel.app/docs/channels/buzz

Package: `@omnipolymath/buzz` · Plugin ID: `buzz`
