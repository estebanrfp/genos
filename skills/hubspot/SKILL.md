---
name: hubspot
description: Query and manage HubSpot CRM data — contacts, companies, deals, tickets, pipelines. No SDK needed.
metadata:
  {
    "genosos":
      {
        "emoji": "📊",
        "requires": { "bins": ["python3"], "env": ["HUBSPOT_TOKEN"] },
        "primaryEnv": "HUBSPOT_TOKEN",
      },
  }
---

# HubSpot

Interact with HubSpot CRM directly via the HubSpot API (`api.hubapi.com`).

## Setup (one-time)

1. In HubSpot: Settings (gear icon) > Integrations > Legacy Apps (Aplicaciones Anteriores)
2. Create Legacy App > Private
3. Name: `GenosOS` > Scopes tab, enable:
   - `crm.objects.contacts` read + write
   - `crm.objects.companies` read + write
   - `crm.objects.deals` read + write
   - `crm.objects.owners` read
   - `crm.schemas.contacts` read
4. Create App > Show token > copy it (format: `pat-eu1-...` or `pat-na1-...`)
5. Set environment variable:
   ```
   HUBSPOT_TOKEN=pat-eu1-...
   ```

**Note:** `HUBSPOT_TOKEN` and all `env.vars` from genosos.json are auto-injected as `process.env.*` when scripts run. Do NOT verify them manually via CLI — just run the scripts directly.

## Queries

### Search contacts

```bash
python3 {baseDir}/scripts/hubspot_query.py search contacts --query "john"
python3 {baseDir}/scripts/hubspot_query.py search contacts --email "john@example.com"
```

### List contacts

```bash
python3 {baseDir}/scripts/hubspot_query.py list contacts --limit 20
```

### Get a specific object

```bash
python3 {baseDir}/scripts/hubspot_query.py get contacts 12345
python3 {baseDir}/scripts/hubspot_query.py get companies 67890
python3 {baseDir}/scripts/hubspot_query.py get deals 11111
```

### List companies

```bash
python3 {baseDir}/scripts/hubspot_query.py list companies --limit 20
```

### Search companies

```bash
python3 {baseDir}/scripts/hubspot_query.py search companies --query "Acme"
```

### List deals

```bash
python3 {baseDir}/scripts/hubspot_query.py list deals --limit 20
```

### Search deals

```bash
python3 {baseDir}/scripts/hubspot_query.py search deals --query "enterprise"
```

### List tickets

```bash
python3 {baseDir}/scripts/hubspot_query.py list tickets --limit 20
```

### Create a contact

```bash
python3 {baseDir}/scripts/hubspot_query.py create contacts --email "new@example.com" --firstname "Jane" --lastname "Doe"
```

### Create a company

```bash
python3 {baseDir}/scripts/hubspot_query.py create companies --name "Acme Corp" --domain "acme.com"
```

### Create a deal

```bash
python3 {baseDir}/scripts/hubspot_query.py create deals --dealname "Enterprise Plan" --amount 50000 --pipeline default --dealstage appointmentscheduled
```

### Update an object

```bash
python3 {baseDir}/scripts/hubspot_query.py update contacts 12345 --email "new@example.com" --phone "+1234567890"
python3 {baseDir}/scripts/hubspot_query.py update deals 11111 --dealstage closedwon --amount 75000
```

### Associate objects

```bash
python3 {baseDir}/scripts/hubspot_query.py associate contacts 12345 companies 67890
```

### List pipelines

```bash
python3 {baseDir}/scripts/hubspot_query.py pipelines deals
python3 {baseDir}/scripts/hubspot_query.py pipelines tickets
```

### List owners

```bash
python3 {baseDir}/scripts/hubspot_query.py owners
```
