Payments Stripe:
Summary: Stripe payment processing integration. Agent creates payment links, manages customers, and receives webhook events for payment confirmations. All API calls via web_fetch with Bearer token. Webhook events via GenosOS hooks system. ALWAYS start in test mode.

Setup:

1. Create Stripe account: dashboard.stripe.com → sign up → verify email
2. Get API keys:
   · Dashboard → Developers → API keys
   · Copy Secret key (starts with sk*test* for test mode, sk*live* for production)
   · CRITICAL: Start with TEST keys (sk*test*...). Switch to live ONLY after verifying everything works.
   Publishable key (pk*test*...) is NOT needed for server-side operations.
3. Store API key in GenosOS:
   config*manage set services.stripe.apiKey "sk_test*..."
   Securely stored in vault (NYXENC1 encrypted).
   Env fallback: STRIPE*API_KEY
   For production: config_manage set services.stripe.apiKey "sk_live*..."
4. Configure webhook (to receive payment events):
   · Dashboard → Developers → Webhooks → Add endpoint
   · URL: https://{gateway-public-url}/hooks/stripe
   · Events to listen: payment*intent.succeeded, payment_intent.payment_failed, checkout.session.completed, charge.refunded
   · Copy Webhook signing secret (whsec*...)
   config*manage set services.stripe.webhookSecret "whsec*..."
   config_manage set hooks.enabled true
   config_manage set hooks.mappings '[{"source":"stripe","match":{"source":"stripe"},"action":"agent","template":{"message":"Stripe: {type} — amount {data.object.amount} {data.object.currency}"}}]'
5. Verify connection — agent can test with:
   web*fetch GET https://api.stripe.com/v1/balance headers={"Authorization":"Bearer sk_test*..."}
   Success: 200 with available/pending amounts. Failure: 401 = invalid key.

API Reference (for agent use via web_fetch):

All requests: Authorization: Bearer {apiKey}, Content-Type: application/x-www-form-urlencoded
NOTE: Stripe API uses form-encoded bodies, NOT JSON. Agent must use URL-encoded params.

Payment Links (simplest — no code checkout):
· Create: POST https://api.stripe.com/v1/payment_links
Body: line_items[0][price]={priceId}&line_items[0][quantity]=1
Returns: { url: "https://buy.stripe.com/..." } — share directly with customer
· List: GET https://api.stripe.com/v1/payment_links?limit=10

Prices (products with pricing):
· Create product + price in one step:
POST https://api.stripe.com/v1/prices
Body: unit_amount=5000&currency=eur&product_data[name]=Consultation&recurring[interval]=month
(unit_amount in cents: 5000 = €50.00)
· One-time price:
POST https://api.stripe.com/v1/prices
Body: unit_amount=15000&currency=eur&product_data[name]=Website+Design
· List prices: GET https://api.stripe.com/v1/prices?limit=10&active=true

Checkout Sessions (hosted payment page):
· Create: POST https://api.stripe.com/v1/checkout/sessions
Body: mode=payment&success_url=https://example.com/thanks&cancel_url=https://example.com/cancel&line_items[0][price]={priceId}&line_items[0][quantity]=1&customer_email=user@example.com
Returns: { url: "https://checkout.stripe.com/..." }

Customers:
· Create: POST https://api.stripe.com/v1/customers
Body: email=user@example.com&name=John+Doe&phone=%2B34660777328
· Search: GET https://api.stripe.com/v1/customers/search?query=email:"user@example.com"
· List: GET https://api.stripe.com/v1/customers?limit=10&email=user@example.com

Invoices:
· Create draft: POST https://api.stripe.com/v1/invoices
Body: customer={customerId}&auto_advance=true
· Add line item: POST https://api.stripe.com/v1/invoiceitems
Body: customer={customerId}&invoice={invoiceId}&amount=5000&currency=eur&description=Consultation+Fee
· Finalize + send: POST https://api.stripe.com/v1/invoices/{invoiceId}/finalize
· Send: POST https://api.stripe.com/v1/invoices/{invoiceId}/send

Refunds:
· Create: POST https://api.stripe.com/v1/refunds
Body: payment_intent={paymentIntentId}&amount=5000 (partial) or payment_intent={paymentIntentId} (full)

Balance:
· GET https://api.stripe.com/v1/balance — current balance (available + pending)
· GET https://api.stripe.com/v1/balance_transactions?limit=5 — recent transactions

Webhook Event Handling:
Events arrive at /hooks/stripe via POST. Key events:
· payment_intent.succeeded — payment completed (confirm to customer)
· payment_intent.payment_failed — payment failed (notify customer, retry)
· checkout.session.completed — checkout page completed (fulfill order)
· invoice.paid — recurring invoice paid (update subscription status)
· charge.refunded — refund processed (confirm to customer)
· customer.subscription.deleted — subscription cancelled

Agent receives webhook → parses event type → takes action (send confirmation via WhatsApp, update CRM contact, log to memory).

PCI Compliance:
· NEVER store card numbers, CVVs, or raw card data. Stripe handles all card processing.
· NEVER log full card details in memory or transcripts.
· Use Stripe Checkout or Payment Links — customer enters card on Stripe's hosted page.
· Agent only handles: payment links, customer records, invoice amounts, payment status.

Common Patterns:

Send payment link via WhatsApp:
Agent creates payment link → sends URL to customer via message tool → customer pays on Stripe page → webhook confirms → agent notifies "payment received".

Recurring billing:
Create product with recurring price → create subscription for customer → Stripe auto-charges → webhook events for each payment.

Invoice workflow:
Create customer → create invoice → add line items → finalize → send via email → webhook when paid.

Test Mode:
ALWAYS verify with test keys first:
· Test card: 4242424242424242, any future expiry, any CVC
· Test card (decline): 4000000000000002
· Test card (requires auth): 4000002500003155
Switch to live keys only after full verification.

Diagnostic:
STOP. Do NOT guess. Follow in order:

1. 401 Unauthorized → API key invalid. Check key starts with sk*test* or sk*live*. Verify at dashboard.stripe.com → Developers → API keys.
2. Webhook not receiving events → check hooks.enabled is true. Verify webhook URL in Stripe Dashboard. Check gateway is publicly accessible (ngrok/Tailscale). Check webhookSecret matches.
3. Payment link returns error → check priceId exists: GET /v1/prices/{id}. Common: price is archived or inactive.
4. Wrong amounts → Stripe uses cents (smallest currency unit). €50.00 = 5000, $10.00 = 1000. For JPY/KRW: amount IS the final amount (no cents).
5. Customer not found → search by email first. Stripe allows duplicate customers — use search, not assume uniqueness.
6. Test mode vs live → check API key prefix. sk*test* only sees test data, sk*live* only sees live data. They are completely separate.
7. Webhook signature fails → verify webhookSecret (whsec\_...) matches the endpoint's signing secret in Stripe Dashboard.

Stripe Config Paths:
services.stripe.apiKey: string — Stripe Secret API key (secret, sk*test*... or sk*live*...)
services.stripe.webhookSecret: string — Webhook signing secret (secret, whsec\_...)
services.stripe.testMode: boolean, true — Use test keys (safety flag)
hooks.mappings[]: array — Webhook event mappings (source: "stripe")
