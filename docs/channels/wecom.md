---
summary: "Install the external WeCom plugin and find its versioned setup documentation"
read_when:
  - You want to connect Omnipolymath to WeCom
  - You need the supported WeCom plugin and its setup documentation
title: "WeCom"
---

<Warning>
The WeCom plugin is maintained outside this repository for the upstream project Omnipolymath is based on. It expects that project's plugin SDK, so it doesn't install or load in Omnipolymath yet. The rest of this page describes how the integration is designed to work.
</Warning>

Omnipolymath exposes WeCom through the external
`@wecom/wecom-omnipolymath-plugin` package maintained by the Tencent WeCom team.
The plugin is listed in Omnipolymath's official channel catalog but is not bundled
with the core install.

## Install

```bash
omnipolymath channels add --channel wecom
omnipolymath channels status --channel wecom
```

The Omnipolymath catalog installs an exact version of
`@wecom/wecom-omnipolymath-plugin`. Start the Gateway if it is offline; see
[Apply changes and inspect](/plugins/manage-plugins#apply-changes-and-inspect).

## Configure

WeCom credentials, connection modes, callback routes, and access-control
behavior belong to the external plugin and can change independently of
Omnipolymath. Follow the
package documentation
for the installed release before configuring the channel.

When upgrading the plugin independently, keep using the documentation for the
installed version.
