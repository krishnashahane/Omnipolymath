---
summary: "Migration guide for the retired HEARTBEAT.md workspace file"
title: "Retired HEARTBEAT.md workspace file"
read_when:
  - Migrating an older workspace that still has HEARTBEAT.md
---

# HEARTBEAT.md is retired

Omnipolymath no longer creates `HEARTBEAT.md` in new workspaces or reads it at runtime. Monitoring instructions now live in ordinary automation job scratch in the shared state database.

Manage the current monitor scratch with the monitor job id from `omnipolymath automations list --all`:

```bash
omnipolymath automations scratch <jobId>
omnipolymath automations scratch <jobId> --set "..."
omnipolymath automations scratch <jobId> --file notes.md
omnipolymath automations scratch <jobId> --unset
```

If an older workspace still contains `HEARTBEAT.md`, run `omnipolymath doctor --fix`. Doctor imports its instructions into monitor scratch, converts valid legacy `tasks:` entries into cron jobs, archives the original under the state directory, and removes the workspace file.

## Related

- [Heartbeat migration](/gateway/heartbeat)
- [Cron CLI](/cli/cron)
- [Doctor](/cli/doctor)
- [Automation policies](/automation/cron-jobs/schedules#monitoring-policies)
