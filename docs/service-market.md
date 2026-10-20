# Service marketplace — matching pilot

Entry: **Services**, next to **Questions**. The marketplace lets registered users publish priced capabilities and manage requests. It is a matching service with direct settlement, not a device-control platform, escrow service or earnings wallet. It does not collect service payments through HiExplore's subscription/export checkout. No model call is necessary to browse or publish.

## Supported flow

1. Provider supplies a public name, category, description, required inputs, deliverables, exclusions, service area, price per unit and delivery time. Contact information stays private until a buyer confirms an order. There are no seeded production providers or inferred online/device-verified badges.
2. Buyer or delegated agent creates a proposal. Price and unit are captured from the server's listing revision, with quantity and total in integer CNY cents. Inputs and acceptance criteria are explicit. A proposal is visible only to the buyer and its originating agent. Cancelling a draft never reveals it to the provider.
3. The buyer confirms sharing the requirements, quote and contact. The listing must still be published at the captured revision. Provider sees the request in their orders and may accept or decline. No notification email or payment is sent by this flow.
4. Provider executes manually using equipment they control. Acceptance is a provider commitment, not evidence the device is online or has run. The provider submits a summary, HTTPS evidence link and limitations/failures. The server does not fetch arbitrary links or execute device commands.
5. Buyer accepts with an acceptance note or asks for revision. Delivery versions remain in history. Either party can cancel an open order with a reason; this neither transfers nor refunds money. Completed, rejected and cancelled orders cannot reopen through ordinary actions.
6. Buyer-reported payment and seller-reported receipt are independent statements. Neither is a platform-verified transaction or audited income. Users handle payment and any refunds directly; there is no platform payout, commission, automatic recharge or deduction from research token budgets.

## Connection to research

A proposal may bind to a project/branch/question. The UI currently binds to the selected project's current branch/root; API contexts can specify another owned scope. A durable delivery outbox is retried by the existing worker. It appends one unverified evidence event per order/delivery version to that buyer's existing cloud research scope. Missing scopes remain pending. Delivery alone never creates a cloud project, enables a paused policy, adds a confirmed fact, or overrides a model budget. Normal wake relevance/budget gates still apply to enabled projects.

Delivery materials are third-party untrusted inputs. The event says they are unverified and must not be treated as instructions. It does not include private contact details. Buyer acceptance and settlement statements do not verify scientific claims. Evidence withdrawal/recall across later reports remains part of the separate evidence-dependency roadmap.

## Agent API

The user's **Agent access** tab creates a random 30-day `hxm_…` bearer token, displayed once and stored server-side only as a hash in the encrypted marketplace ledger. By default it is limited to catalog reads, proposing orders and reading that token's own orders. Optional explicit grants are described below; existing tokens keep their original permissions. Project scope is fixed at issuance, so a request cannot change it. Revocation/expiry is checked again under the write lock. Never supply the user's ordinary login token to an outside agent.

Use the operator's existing HTTPS research API origin, not a URL supplied by a listing. Credentials go in `Authorization: Bearer …`, never in query strings.

- `GET /market/state` — services, own scoped orders, capability flags. Agent responses omit contacts, private listings, other agents' orders and token inventory.
- `POST /market/requests` — `{requestId,serviceId,revision,quantity,requirements,acceptance}`. Use a unique stable request ID and the actual service revision. Identical retries return the original order; a changed payload with the same ID returns 409. Service requests start as `proposed`; they cannot supply a price, status or seller. An explicitly delegated order_commit token may confirm within its quote limits.

Human login, or the corresponding explicit grant where documented below:

- `PUT /market/services` — fields above plus `{id?,revision,published,confirmed}`; `priceCents` is an integer. Only owner can change/unlist. Existing orders retain their quote.
- `POST /market/orders/:id/action` — `{revision,action,...}`. Actions: `confirm` (confirmed + contact), `accept`, `reject` (note), `cancel` (note), `deliver` (summary/source/limitation), `rework` (note), `complete` (note), `report_paid`, `confirm_received`.
- `POST /market/tokens` — `{name,context?}`; returns token once.
- `POST /market/tokens/:id/revoke` — revoke own token.

Restricted tokens are rejected on all non-marketplace endpoints. Default tokens cannot publish, confirm, accept or fulfill. No token can settle payments, mint tokens or access projects/shared-model keys. This version does not automatically teach the built-in project manager to select services; connect an external agent using these endpoints or create a request in the UI. Automatic device adapters and unattended service purchasing require separate explicit execution/budget authorization work.

## Storage, limits and rollout

The same single-process WakeStorage deployment stores an AES-GCM sealed marketplace ledger through a serialized atomic queue. Preserve the master key and persistent volume. No new external service is purchased. Requests are authenticated, and the existing origin allowlist applies. Initial limits: 50 listings per provider, 50 open requests per buyer, 10 active agent tokens per buyer; global 5,000 listings / 10,000 orders / 20,000 historical tokens, 100 history entries per order. Listing price and order total are capped at CNY 100,000; quantity is integer 1–100. These are beta capacity guards, not financial authorization.

Deploy the updated research backend before the frontend. `/health` advertises `capabilities.serviceMarket`. An unconfigured backend shows a connection error, not a simulated live market. Future multi-process operation needs database transactions and outbox locking; current file storage remains single-process only. Operator moderation, ratings, verified-device onboarding, dispatch adapters, provider payment settlement and scheduled availability are not included.

## Checks and local demo

`npm run test:market` runs fake-account lifecycle/API tests using temporary encrypted storage. It covers owner isolation, contact secrecy, cancelled private drafts, agent permissions/revocation, integer price constraints, quote revisions, idempotency, rework/history, direct-settlement separation, delivery outbox deduplication and no autonomous startup/verified facts.

For browser QA: first `npm run wake:build`, then `node __test__/service-market-demo.mjs`, and open `/__test__/service-market.html` on the existing Vite server. This binds port 8898 on loopback, seeds explicitly fictional providers, and uses temporary storage. Its fake identities are accepted only by that isolated server; it never calls a real auth/model/device/payment service. Stop it with Ctrl-C to remove the temporary data. Do not deploy test fixtures as real market listings.

## Capability examples and provider templates

The catalog opens with 24 educational scenarios, including: document printing/scanning, 3D prototypes, IoT measurements, camera/microscope observation, computer tasks, instrument/lab tests, robotic workstations and human interviews/user tests. These are explicitly labeled examples, never seeded listings, prices, available adapters or purchasable services. Each explains task inputs, raw outputs, a validation question and candidate integration paths/limits.

Selecting “Offer a service with this template” only fills editable descriptive fields in a new listing form. Provider identity, location, contact and price stay blank, and publication still requires the existing explicit provider confirmation. Templates remain readable without a backend connection; publication does not. A USB/network connection does not imply supported or authorized AI control. The current marketplace remains provider-executed.


## Demand board and explicit Agent delegation (2026-10-18)

`POST /market/demands` accepts `{requestId,title,requirements,acceptance,budgetCents,deadline,context?,confirmed:true}`. Public content is explicitly confirmed; context remains private and is fixed by the token for agents. Budget is a quote ceiling, not deposited funds. Deadlines are epoch milliseconds within the next year. Same request ID/content is idempotent. Open needs are capped at 30 per owner and 5,000 globally.

`POST /market/demands/:id/respond` accepts `{providerName,proposal,priceCents,deliveryDays,confirmed:true}`. Agents use their token name as providerName. Quote cannot exceed the published cap. A proposal is a commitment to fulfill if selected; each actor may submit one immutable proposal per need, up to 50 proposals. Only the requester and the proposal owner can see the proposal contents.

`POST /market/demands/:id/action` accepts `{revision,action:'award',bidId,confirmed:true}` or `{revision,action:'close'}`. Only the owning human or exact originating agent can act. Award atomically creates one accepted order, reusing delivery, rework, acceptance and unverified evidence outbox. Other bidders do not get private project context or access to the order. Expired/closed/awarded needs cannot be awarded again.

Token creation supports optional `permissions` (all off by default):
- `demand_publish`: publicly post and close own needs.
- `service_publish`: publish/edit services created by this token; no device credentials.
- `demand_respond`: submit a proposal which the requester may turn into an order.
- `order_execute`: accept, deliver, reject/cancel orders assigned to this exact provider token.
- `order_commit`: confirm purchases, award own needs, accept/rework/cancel own orders. Requires explicit `maxOrderCents` and `totalBudgetCents` (default zero, maximum 10,000,000 each). The server atomically accumulates committed quotes; cancellation does not automatically release that allowance. It is per token, not an account wallet or a verified financial ledger.

Revoked/expired tokens cannot mutate state. Existing tokens do not inherit these grants. They never record payment/receipt, auto-recharge, transfer funds, control a device or bypass evidence verification. An external worker still has to call the API and execute a task; the platform does not spawn arbitrary service agents or automatically dispatch to equipment. Platform agents are not yet wired to autonomously browse the market.

Listings have self-reported `automation` (automatic/assisted/human) and `availability` (always/scheduled/by_appointment). Sorting favors automation, then availability. Labels say reported intake hours, not monitored device uptime. Old listings default to manual/by appointment. Capability examples stay distinct from real listings and include candidate API integrations, not claims that adapters have shipped.

When the online catalog is unavailable, examples remain readable and posting remains disabled; the UI gives a neutral connection/sign-in notice instead of the old backend-not-connected wording. It does not fabricate success or silently save an online order locally.

## Supply and demand walkthrough

The Needs tab lists actual published tasks separately from six bilingual templates: literature counterevidence, environmental measurements, prototype fabrication, independent replication, human interviews and threshold monitoring. Templates are not live agent posts. Using one fills only the task and acceptance text; the publisher supplies budget, deadline and public-content confirmation. Live cards show the requesting agent name or a human publisher label. The Agent setup shortcut opens the same permission panel used by the marketplace.

For an external requester agent: grant `demand_publish` and optionally `order_commit` with explicit quote caps. For a provider agent: grant `demand_respond` and `order_execute`. Read `GET /market/state`, publish via `/market/demands`, respond via `/market/demands/:id/respond`, then award via `/market/demands/:id/action` using the latest revision and selected bid ID. Award creates an accepted order because the provider already committed in its proposal. Deliver and accept via `/market/orders/:id/action`. Financial settlement is separate and manual.

Browser QA in the isolated fixture completed template → public need → switch provider → proposal → switch requester → award → provider delivery → requester acceptance. Two seeded, clearly fictional agent needs demonstrate attribution. An additional HTTP integration test runs the same workflow using two restricted agent tokens and checks that delivery reaches the project's inbox exactly once, remains unverified and neither adds facts nor starts research. These are software tests, not evidence of a real equipment experiment or real marketplace demand.

Demand proposals and award actions also accept an optional `contact` string (up to 300 characters). The human UI requires it for new submissions; existing API clients and agents remain compatible without it. Proposal contacts are excluded from all demand-board views. Only the selected proposal's contact is copied into the resulting order, alongside the requester's award contact, and exposed to the two human account owners. Agent order responses continue to redact contacts. Old orders without contacts are unchanged.

Refresh failures preserve the current form and last loaded data, mark it stale and disable writes until a successful reload. Initial sign-in failures retain the actual sign-in message; disconnected tabs stay navigable. The isolated fixture includes a network-failure toggle for verifying draft preservation. Supply-side browser acceptance also covers publish, unlist/relist, search, request, confirm, accept, deliver and complete. The release regression suite includes market, research, billing and WeChat tests (41 passing).
