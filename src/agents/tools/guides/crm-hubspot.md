CRM HubSpot:
Summary: HubSpot CRM integration via Private App API key. Manage contacts, deals, companies, and tickets. Agent uses web_fetch for all API calls. API key stored in vault. No OAuth flow needed for Private Apps — simpler than full OAuth.

Setup:

1. Create HubSpot account: app.hubspot.com → sign up (free CRM plan is sufficient)
2. Create Private App:
   · Settings (gear icon) → Integrations → Private Apps → Create a private app
   · Name: "GenosOS" (or business name)
   · Scopes (CRITICAL — select all needed):
   - crm.objects.contacts.read + crm.objects.contacts.write
   - crm.objects.deals.read + crm.objects.deals.write
   - crm.objects.companies.read + crm.objects.companies.write
   - crm.objects.owners.read (for assignment)
   - crm.schemas.contacts.read (for custom properties)
     · Create app → Show token → copy access token
     Token format: pat-na1-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx (starts with pat-)
3. Store API key in GenosOS:
   config_manage set services.hubspot.apiKey "pat-na1-..."
   The agent stores this securely in the vault (NYXENC1 encrypted).
   Env fallback: HUBSPOT_API_KEY
4. Verify connection — agent can test with:
   web_fetch GET https://api.hubapi.com/crm/v3/objects/contacts?limit=1 headers={"Authorization":"Bearer {apiKey}"}
   Success: 200 with results array. Failure: 401 = invalid token, 403 = missing scope.

API Reference (for agent use via web_fetch):

Contacts:
· List: GET https://api.hubapi.com/crm/v3/objects/contacts?limit=10&properties=email,firstname,lastname,phone
· Search: POST https://api.hubapi.com/crm/v3/objects/contacts/search
Body: {"filterGroups":[{"filters":[{"propertyName":"email","operator":"EQ","value":"user@example.com"}]}],"properties":["email","firstname","lastname","phone"]}
· Create: POST https://api.hubapi.com/crm/v3/objects/contacts
Body: {"properties":{"email":"user@example.com","firstname":"John","lastname":"Doe","phone":"+34660777328"}}
· Update: PATCH https://api.hubapi.com/crm/v3/objects/contacts/{contactId}
Body: {"properties":{"phone":"+34660777329"}}
· Delete: DELETE https://api.hubapi.com/crm/v3/objects/contacts/{contactId}

Deals:
· List: GET https://api.hubapi.com/crm/v3/objects/deals?limit=10&properties=dealname,amount,dealstage,closedate
· Create: POST https://api.hubapi.com/crm/v3/objects/deals
Body: {"properties":{"dealname":"Website Redesign","amount":"5000","dealstage":"appointmentscheduled","pipeline":"default"}}
· Associate deal with contact: PUT https://api.hubapi.com/crm/v4/objects/deals/{dealId}/associations/contacts/{contactId}
Body: [{"associationCategory":"HUBSPOT_DEFINED","associationTypeId":3}]

Companies:
· Create: POST https://api.hubapi.com/crm/v3/objects/companies
Body: {"properties":{"name":"Acme Corp","domain":"acme.com","phone":"+34660777328"}}
· Associate contact with company: PUT https://api.hubapi.com/crm/v4/objects/contacts/{contactId}/associations/companies/{companyId}
Body: [{"associationCategory":"HUBSPOT_DEFINED","associationTypeId":1}]

Owners (assign records):
· List: GET https://api.hubapi.com/crm/v3/owners
· Assign: PATCH https://api.hubapi.com/crm/v3/objects/contacts/{contactId}
Body: {"properties":{"hubspot_owner_id":"owner_id_here"}}

All requests require header: Authorization: Bearer {apiKey}, Content-Type: application/json
API rate limit: 100 requests per 10 seconds (Private App). Agent should batch operations when possible.

Webhook Events (inbound from HubSpot):
HubSpot can send webhooks for CRM changes. Configure via GenosOS hooks:
config_manage set hooks.enabled true
config_manage set hooks.mappings '[{"source":"hubspot","match":{"source":"hubspot"},"action":"agent","template":{"message":"HubSpot event: {eventType} on {objectType} {objectId}"}}]'
Webhook URL: https://{gateway-public-url}/hooks/hubspot
In HubSpot: Settings → Integrations → Private Apps → your app → Webhooks → Create subscription → select events (contact.creation, deal.propertyChange, etc.) → paste URL.

Common Patterns:

Contact lookup on inbound call:
Agent receives call → extracts caller phone → searches HubSpot:
POST https://api.hubapi.com/crm/v3/objects/contacts/search with phone filter → returns contact name, history, deals.
Agent greets caller by name and knows their context.

Log interaction after call:
POST https://api.hubapi.com/crm/v3/objects/notes
Body: {"properties":{"hs_note_body":"Call summary: ...","hs_timestamp":"{timestamp}"},"associations":[{"to":{"id":"{contactId}"},"types":[{"associationCategory":"HUBSPOT_DEFINED","associationTypeId":10}]}]}

Deal pipeline tracking:
GET deal → check dealstage → agent knows where each lead is in the funnel → can report or act on stale deals.

Diagnostic:
STOP. Do NOT guess. Follow in order:

1. 401 Unauthorized → API key invalid or expired. Check token starts with "pat-". Regenerate in HubSpot Private Apps if needed.
2. 403 Forbidden → missing scope. Check Private App scopes match what the agent needs. Common: forgot crm.objects.deals.write when trying to create deals.
3. 429 Too Many Requests → rate limited (100/10s). Agent should wait and retry. Batch operations where possible.
4. Contact not found → search by email first, then phone. Phone format matters: HubSpot stores as-entered, search with and without country code.
5. Deal stage invalid → list pipelines first: GET https://api.hubapi.com/crm/v3/pipelines/deals → check valid stageId values.
6. Association fails → check associationTypeId. Contact-to-Company=1, Deal-to-Contact=3. Full list: GET https://api.hubapi.com/crm/v4/associations/{fromObjectType}/{toObjectType}/labels

HubSpot Config Paths:
services.hubspot.apiKey: string — HubSpot Private App access token (secret, pat-na1-...)
services.hubspot.portalId: string — HubSpot portal/account ID (for webhook verification)
hooks.mappings[]: array — Webhook event mappings (source: "hubspot")
