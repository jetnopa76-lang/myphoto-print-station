# Print Station ↔ Bedster API contract

This documents the two calls that connect Print Station to Bedster
(the imposition studio at `bedster.vercel.app`). You own both sides, so
build the Bedster endpoints to match this shape.

The flow is **asynchronous with a callback** ("queue for claiming"):

1. Print Station POSTs a bed to Bedster's impose endpoint.
2. Bedster acknowledges immediately (does not block on imposition).
3. When Bedster finishes imposing, it POSTs the finished print file back
   to Print Station's callback webhook.
4. The bed then shows as `imposed` in the Print Station queue, ready for
   an operator to claim, download, and print.

---

## 1. Print Station → Bedster: submit a bed for imposition

```
POST {BEDSTER_API_URL}/api/impose
Authorization: Bearer {BEDSTER_API_KEY}
Content-Type: application/json
```

Request body:

```json
{
  "workOrderNum": "WO-2026-0001",
  "size": "5x7",
  "material": "Acrylic Block",
  "callbackUrl": "https://<print-station-host>/webhooks/bedster",
  "pieces": [
    {
      "orderName": "#1042",
      "imageUrl": "https://cdn.example.com/uploads/abc.jpg",
      "quantity": 2
    }
  ]
}
```

Expected response (any 2xx). Bedster should acknowledge receipt and start
imposing in the background:

```json
{ "accepted": true, "bedsterJobId": "imp_123" }
```

`bedsterJobId` is optional; Print Station stores it if present but keys
everything off `workOrderNum`.

---

## 2. Bedster → Print Station: imposition complete (callback)

When imposition finishes, Bedster POSTs the finished print file back:

```
POST {callbackUrl}          e.g. https://<host>/webhooks/bedster
x-bedster-secret: {BEDSTER_WEBHOOK_SECRET}
Content-Type: application/json
```

Request body:

```json
{
  "workOrderNum": "WO-2026-0001",
  "status": "imposed",
  "printFileUrl": "https://bedster.vercel.app/files/WO-2026-0001.pdf"
}
```

Print Station verifies `x-bedster-secret` (shared secret, timing-safe),
then sets the bed to `imposed`, stamps `imposedAt`, and stores
`printFileUrl` on `bed.bedsterUrl`. It responds `200 { "ok": true }`.

If `status` is anything other than `"imposed"` (e.g. `"failed"`), Print
Station records it and leaves the bed for manual attention.

---

## 3. Print Station → Bedster: bed capacities (templates)

Bedster's imposition templates define how many pieces of each size/material
fit on one bed. Print Station reads them so its "Filled" bars and full-bed
logic always match Bedster (no hardcoded capacities).

```
GET {BEDSTER_API_URL}/api/templates
Authorization: Bearer {BEDSTER_API_KEY}
```

Response — an array (or `{ "templates": [...] }`):

```json
[
  { "size": "6x6", "material": "Acrylic Block", "capacity": 12 },
  { "size": "5x7", "material": "Acrylic Block", "capacity": 9 },
  { "size": "8x10", "material": "Metal Print", "capacity": 4 }
]
```

`size` and `material` must match the strings Print Station stores (case and
spacing are normalized on match). Print Station caches the result for a few
minutes. If this endpoint is missing or errors, capacities show as "—" and
beds can still be created — they just won't show a fill amount.

---

## Environment variables (Print Station side)

| Variable | Purpose |
| --- | --- |
| `BEDSTER_API_URL` | Base URL of the Bedster app, e.g. `https://bedster.vercel.app` |
| `BEDSTER_API_KEY` | Bearer token Print Station sends to Bedster |
| `BEDSTER_WEBHOOK_SECRET` | Shared secret Bedster sends back in `x-bedster-secret` |

`callbackUrl` is derived from the incoming request origin, so it works in
local dev and production without extra config.

---

## Open item: where do piece image URLs come from?

`imageUrl` is currently extracted best-effort from each job's Shopify line
item `properties` (any property whose value looks like a URL). Confirm the
exact property name your storefront uses for the customer's uploaded image
and tighten `extractImageUrl` in `app/lib/bedster.server.ts`.
