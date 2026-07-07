# Deploy to Fly + connect Shopify (and Bedster)

Goal: get a public URL so your Shopify **dev store** can send real orders to
Print Station, watch them appear in the Bed Maker, batch them, and (once
Bedster's endpoints exist) impose them.

Do the steps in order. Anything in `ALL_CAPS` is a value you'll fill in.

---

## 1. Deploy to Fly

Install the CLI and sign in (one time):

```
brew install flyctl        # or: curl -L https://fly.io/install.sh | sh
fly auth login
```

From the project folder, create the app and its database. The app name in
`fly.toml` is already `myphoto-print`.

```
cd ~/Desktop/myphoto-print-station
fly apps create myphoto-print
fly postgres create --name myphoto-print-db --region <your-region>
fly postgres attach myphoto-print-db --app myphoto-print
```

`attach` sets `DATABASE_URL` for you. Now set the remaining secrets:

```
fly secrets set \
  SESSION_SECRET="$(openssl rand -hex 32)" \
  SHOPIFY_WEBHOOK_SECRET="CHOOSE_A_LONG_RANDOM_STRING" \
  SHOPIFY_STORE_DOMAIN="YOUR-STORE.myshopify.com" \
  SHOPIFY_ADMIN_TOKEN="shpat_YOUR_ADMIN_TOKEN" \
  BEDSTER_API_URL="https://bedster.vercel.app" \
  BEDSTER_API_KEY="YOUR_BEDSTER_KEY" \
  BEDSTER_WEBHOOK_SECRET="CHOOSE_ANOTHER_RANDOM_STRING" \
  --app myphoto-print
```

Deploy (the release step runs `prisma migrate deploy` automatically):

```
fly deploy
```

Seed your staff logins once the app is up:

```
fly ssh console --app myphoto-print -C "npx prisma db seed"
```

Your app is now at `https://myphoto-print.fly.dev`. Confirm
`https://myphoto-print.fly.dev/healthcheck` returns `OK`, then sign in at the
root URL with a seeded PIN (Admin / 1234).

---

## 2. Create a custom Shopify app (Admin API + webhook)

In your dev store admin: **Settings → Apps and sales channels → Develop apps
→ Create an app**. Name it "Print Station".

**Admin API scopes** (Configuration → Admin API integration):
- `read_products` — needed so Print Station can read a product's tags/metafield
  to resolve **material**.
- `read_orders` — for order data.

Install the app, then copy the **Admin API access token** (`shpat_…`) into the
`SHOPIFY_ADMIN_TOKEN` secret above (re-run `fly secrets set` if you already
deployed).

### Where does material come from?

Print Station reads material from the product. By default it matches known
keywords (acrylic, metal, canvas, wood, glass, frame, paper) in the product's
**tags** or **product type**. If you keep material in a **metafield** instead,
set `SHOPIFY_MATERIAL_METAFIELD="namespace.key"` (e.g. `custom.material`) as a
secret and it'll read that first.

---

## 3. Point the order webhook at Print Station

Create a webhook that fires when an order is created. Easiest via the Admin API
or **Settings → Notifications → Webhooks**:

- **Event:** `orders/create` (or `orders/paid`)
- **Format:** JSON
- **URL:** `https://myphoto-print.fly.dev/webhooks/orders`

The webhook is HMAC-signed. Set `SHOPIFY_WEBHOOK_SECRET` to the store's webhook
signing secret so Print Station can verify it. (For webhooks created in the
admin, the signing secret is the store's shared secret; for app-created
webhooks it's the app's API secret. If verification fails you'll get a `401`
in the Fly logs — that's the value to fix.)

---

## 4. Tag orders `myphoto`

Print Station **only** processes orders carrying the `myphoto` tag (case-
insensitive). Options:
- Add the tag manually to a test order, or
- Use a **Shopify Flow** automation to tag qualifying orders, or
- Tag at checkout via your app/order logic.

Untagged orders are received and acknowledged but ignored (by design).

---

## 5. Place a test order

Create a test order in the dev store, make sure it's tagged `myphoto`, and
place it. Within a few seconds:

- **Fly logs** (`fly logs --app myphoto-print`) show a `POST /webhooks/orders`
  returning `200`.
- The order's line items appear in **Bed Maker** as work orders, with material
  resolved from the product.

If material shows `unknown`, the product's tags/metafield didn't match — check
scopes, the tag/metafield value, or set `SHOPIFY_MATERIAL_METAFIELD`.

Then: select same-size/material rows → **Create bed** → download the **ticket**.

---

## 6. Bedster

For the imposition step to work, Bedster needs the two endpoints described in
`docs/bedster-api.md`:
- `POST /api/impose` — accept a bed, start imposing.
- callback `POST https://myphoto-print.fly.dev/webhooks/bedster` — return the
  finished print-file URL.

Until those exist, use the **Simulate imposition** button (set
`ALLOW_SIMULATE_IMPOSITION=true` as a Fly secret if you want it in the deployed
app) to move a bed to `imposed` and exercise the claim/download flow.

---

## Redeploying after code changes

```
git push            # keep GitHub in sync
fly deploy
```
