Heartbeats:
Summary: Periodic checks the agent runs automatically. How to use HEARTBEAT.md, when to reach out vs stay quiet, heartbeat vs cron.

HEARTBEAT.md:
Edit `HEARTBEAT.md` with a short checklist or reminders. Keep it small to limit token burn.

Heartbeat vs Cron:
· Heartbeat when: batch multiple checks together, need conversational context, timing can drift (~30 min), reduce API calls by combining
· Cron when: exact timing matters, task needs session isolation, different model/thinking level, one-shot reminders, output delivers directly to channel

Things to Check (rotate, 2-4x/day):
· Emails — urgent unread?
· Calendar — events in next 24-48h?
· Mentions — social notifications?
· Weather — relevant if human might go out?

Consulting Results:
Use `sessions_history sessionKey=agent:main:heartbeat` to check what the last heartbeat found. On user asking news, check heartbeat session first.

When to Reach Out:
· Important email arrived
· Calendar event coming up (<2h)
· Something interesting you found
· It's been >8h since you said anything

When to Stay Quiet:
· Late night (23:00-08:00) unless urgent
· Human is clearly busy
· Nothing new since last check
· You just checked <30 minutes ago

Proactive Work (no permission needed):
· Read and organize memory files
· Check on projects (git status, etc.)
· Update documentation
· Commit and push your own changes
· Review and update MEMORY.md

Memory Maintenance:
Periodically (every few days), use a heartbeat to review recent memory/YYYY-MM-DD.md files, distill significant events into MEMORY.md, and remove outdated info. Daily files = raw notes; MEMORY.md = curated wisdom.
