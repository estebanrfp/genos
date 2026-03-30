Backup Operations:
Summary: Smart backup engine with automatic change detection. Just call create — no parameters needed.

How it works (handled by the engine, not the agent):
· First backup or no previous → complete backup, auto-copies to ~/Desktop/Nyx-Backups
· Files changed since last → incremental (only changed/added files)
· Nothing changed → skipped
· Periodic auto-promotion to complete backup

Creating Backups:
config_manage backup sub_action=create
No value parameter needed — the engine decides automatically.
Returns: { ok, type, fileCount, totalFiles, archiveSize, timestamp, rotation, copiedTo?, delta?, skipped? }

When to Create Backups:
· When user requests "make a backup" or "save state"
· Before config_manage agents delete (irreversible)
· Before config_manage security harden
· Before restoring a previous backup
· On cron schedule

Listing Backups:
config_manage backup sub_action=list

Verifying Backups:
config_manage backup sub_action=verify value={manifest-path}

Restoring Backups:
config_manage backup sub_action=restore value={manifest-path}
IMPORTANT: Always create a backup BEFORE restoring

Reporting — use the returned fields:
· type: what the engine decided
· delta: files changed/added/removed (when incremental)
· skipped + reason: nothing changed
· copiedTo: Desktop copy path (when applicable)

Related Actions:
· config_manage doctor — health check (run after restore)
· config_manage security audit — pair with backup before harden
· cron — schedule automated backups
