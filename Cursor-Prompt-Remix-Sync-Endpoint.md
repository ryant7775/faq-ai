# Cursor Prompt — Shopify Remix App: FAQ Page Sync Endpoint

Paste this entire prompt into Cursor as your starting instruction.

---

## What This Is

I have a Shopify Remix app scaffolded with `@shopify/create-app`. I need to add a webhook-triggered API endpoint (`POST /api/sync`) that receives FAQ page content from an external system (a Supabase Edge Function) and creates or updates a Shopify Page using the Shopify Admin GraphQL API.

This endpoint is called server-to-server — there is no browser session or Shopify App Bridge involved. Auth is done via a shared secret header, not a Shopify session cookie.

---

## Read These Files First

Before writing anything, read:
1. `app/shopify.server.ts` (or `.js`) — to understand how `shopify` is configured, what session storage adapter is in use, and what `authenticate` exports
2. `prisma/schema.prisma` (if it exists) — to understand how `Session` is stored
3. `app/routes/app._index.tsx` — to understand the existing route conventions in this project
4. `shopify.app.toml` — to confirm the app scopes include `write_content` (needed for page creation)

---

## Architecture

```
[Supabase Edge Function]
  POST https://this-app.fly.dev/api/sync
  Headers:
    x-webhook-secret: <WEBHOOK_SECRET env var>
    Content-Type: application/json
  Body:
    {
      "shop": "mystore.myshopify.com",
      "page_id": "uuid-from-supabase",        // Supabase published_pages.id
      "shopify_page_id": "gid://shopify/Page/123456789",  // null on first publish
      "title": "What is bond origination?",
      "handle": "faq-what-is-bond-origination",
      "body_html": "<div class=\"faq-ai-block\">...</div>",
      "meta_description": "Learn what bond origination means..."
    }

[Remix /api/sync route]
  1. Validates x-webhook-secret
  2. Loads the Shopify session for this shop from session storage (by shop domain)
  3. Calls Shopify Admin GraphQL to create or update the Page
  4. Calls back to Supabase to write the new shopify_page_id onto published_pages
  5. Returns { success: true, shopify_page_id, handle, storefront_url }
```

---

## Task 1: Verify `shopify.app.toml` Has the Right Scope

Check that `shopify.app.toml` includes `write_content` in scopes:

```toml
[access_scopes]
scopes = "write_content"
```

If it's missing, add it. Do not remove any existing scopes.

---

## Task 2: Create `app/routes/api.sync.ts`

Create this file. It must export only an `action` function (no `loader` — this route only accepts POST).

### Full implementation:

```typescript
import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { shopify } from "../shopify.server";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SyncPayload {
  shop: string;                    // e.g. "mystore.myshopify.com"
  page_id: string;                 // Supabase published_pages.id (UUID)
  shopify_page_id: string | null;  // Shopify GID — null means create, set means update
  title: string;
  handle: string;
  body_html: string;
  meta_description?: string;
}

interface SyncResult {
  success: boolean;
  shopify_page_id?: string;
  handle?: string;
  storefront_url?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// GraphQL mutations
// ---------------------------------------------------------------------------

const PAGE_CREATE_MUTATION = `#graphql
  mutation pageCreate($input: PageInput!) {
    pageCreate(input: $input) {
      page {
        id
        handle
        title
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const PAGE_UPDATE_MUTATION = `#graphql
  mutation pageUpdate($id: ID!, $input: PageInput!) {
    pageUpdate(id: $id, input: $input) {
      page {
        id
        handle
        title
      }
      userErrors {
        field
        message
      }
    }
  }
`;

// ---------------------------------------------------------------------------
// Helper: load Shopify Admin GraphQL client for a shop domain
// ---------------------------------------------------------------------------
// This endpoint is called server-to-server with no Shopify browser session.
// We load the persisted OAuth session by shop domain and create the API client
// directly, bypassing authenticate.admin() which requires a session cookie.

async function getAdminClientForShop(shop: string) {
  const { api } = shopify;

  // Load the offline session for this shop (stored during OAuth install).
  // The offline session ID follows Shopify's convention: "offline_{shop}"
  const offlineSessionId = api.session.getOfflineId(shop);
  const session = await api.config.sessionStorage!.loadSession(offlineSessionId);

  if (!session) {
    throw new Error(
      `No Shopify session found for shop: ${shop}. Has the app been installed on this store?`
    );
  }

  if (!session.accessToken) {
    throw new Error(`Session for ${shop} has no access token.`);
  }

  // Create a GraphQL client using the loaded session
  const client = new api.clients.Graphql({ session });
  return { client, session };
}

// ---------------------------------------------------------------------------
// Helper: write shopify_page_id back to Supabase
// ---------------------------------------------------------------------------

async function writeSyncMetadataToSupabase(params: {
  page_id: string;
  shopify_page_id: string;
  shopify_page_handle: string;
}) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    // Non-fatal: log and continue. The caller (Edge Function) can also write this.
    console.warn("[sync] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set — skipping metadata write-back");
    return;
  }

  const res = await fetch(
    `${supabaseUrl}/rest/v1/published_pages?id=eq.${params.page_id}`,
    {
      method: "PATCH",
      headers: {
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`,
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
      },
      body: JSON.stringify({
        shopify_page_id: params.shopify_page_id,
        shopify_page_handle: params.shopify_page_handle,
        shopify_synced_at: new Date().toISOString(),
      }),
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("[sync] Failed to write metadata back to Supabase:", res.status, text);
  }
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export async function action({ request }: ActionFunctionArgs): Promise<Response> {
  // Only accept POST
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  // Validate shared secret
  const incomingSecret = request.headers.get("x-webhook-secret");
  const expectedSecret = process.env.WEBHOOK_SECRET;

  if (!expectedSecret) {
    console.error("[sync] WEBHOOK_SECRET environment variable is not set");
    return json({ error: "Server misconfiguration" }, { status: 500 });
  }

  if (!incomingSecret || incomingSecret !== expectedSecret) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  // Parse body
  let payload: SyncPayload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Validate required fields
  const { shop, page_id, shopify_page_id, title, handle, body_html } = payload;
  if (!shop || !page_id || !title || !handle || !body_html) {
    return json(
      { error: "Missing required fields: shop, page_id, title, handle, body_html" },
      { status: 400 }
    );
  }

  // Load Shopify client for this shop
  let client: Awaited<ReturnType<typeof getAdminClientForShop>>["client"];
  try {
    ({ client } = await getAdminClientForShop(shop));
  } catch (e: any) {
    console.error("[sync] Session load failed:", e.message);
    return json({ error: e.message }, { status: 422 });
  }

  // Build the PageInput
  const pageInput = {
    title,
    body: body_html,
    handle,
    isPublished: true,
    ...(payload.meta_description
      ? {
          seo: {
            description: payload.meta_description,
            title,
          },
        }
      : {}),
  };

  // Create or update
  let result: SyncResult;

  try {
    if (shopify_page_id) {
      // ── UPDATE ──────────────────────────────────────────────────────────
      const response = await client.request(PAGE_UPDATE_MUTATION, {
        variables: { id: shopify_page_id, input: pageInput },
      });

      const { pageUpdate } = response.data as any;

      if (pageUpdate.userErrors?.length > 0) {
        const errors = pageUpdate.userErrors.map((e: any) => `${e.field}: ${e.message}`).join("; ");
        return json({ error: `Shopify page update failed: ${errors}` }, { status: 422 });
      }

      result = {
        success: true,
        shopify_page_id: pageUpdate.page.id,
        handle: pageUpdate.page.handle,
        storefront_url: `https://${shop}/pages/${pageUpdate.page.handle}`,
      };
    } else {
      // ── CREATE ──────────────────────────────────────────────────────────
      const response = await client.request(PAGE_CREATE_MUTATION, {
        variables: { input: pageInput },
      });

      const { pageCreate } = response.data as any;

      if (pageCreate.userErrors?.length > 0) {
        const errors = pageCreate.userErrors.map((e: any) => `${e.field}: ${e.message}`).join("; ");

        // Handle duplicate handle — Shopify returns an error if the handle exists
        // and we're trying to create. Try to find and update the existing page instead.
        if (errors.includes("handle") && errors.includes("taken")) {
          return json(
            {
              error: `A Shopify page with handle "${handle}" already exists. Pass its shopify_page_id to update it instead.`,
              hint: "lookup_existing_handle",
            },
            { status: 409 }
          );
        }

        return json({ error: `Shopify page creation failed: ${errors}` }, { status: 422 });
      }

      result = {
        success: true,
        shopify_page_id: pageCreate.page.id,
        handle: pageCreate.page.handle,
        storefront_url: `https://${shop}/pages/${pageCreate.page.handle}`,
      };
    }
  } catch (e: any) {
    console.error("[sync] Shopify GraphQL error:", e);
    return json({ error: `Shopify API error: ${e.message}` }, { status: 502 });
  }

  // Write metadata back to Supabase (non-blocking — fire and don't await the full chain)
  if (result.shopify_page_id && result.handle) {
    await writeSyncMetadataToSupabase({
      page_id,
      shopify_page_id: result.shopify_page_id,
      shopify_page_handle: result.handle,
    }).catch((e) => console.error("[sync] Supabase write-back failed:", e));
  }

  console.log(`[sync] ${shopify_page_id ? "Updated" : "Created"} Shopify page: ${result.storefront_url}`);
  return json(result, { status: 200 });
}
```

---

## Task 3: Create `app/routes/api.sync.lookup.ts`

This optional but recommended route lets the Supabase Edge Function resolve an existing page's GID when it doesn't have one stored (e.g. if the write-back failed last time). It's a safety net.

```typescript
import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

const PAGE_BY_HANDLE_QUERY = `#graphql
  query pageByHandle($handle: String!) {
    pageByHandle(handle: $handle) {
      id
      handle
      title
    }
  }
`;

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, { status: 405 });

  const incomingSecret = request.headers.get("x-webhook-secret");
  if (!incomingSecret || incomingSecret !== process.env.WEBHOOK_SECRET) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const { shop, handle } = await request.json();
  if (!shop || !handle) return json({ error: "shop and handle are required" }, { status: 400 });

  const { getAdminClientForShop } = await import("./api.sync");
  const { client } = await getAdminClientForShop(shop);

  const response = await client.request(PAGE_BY_HANDLE_QUERY, { variables: { handle } });
  const page = (response.data as any)?.pageByHandle;

  if (!page) return json({ found: false }, { status: 200 });
  return json({ found: true, shopify_page_id: page.id, handle: page.handle });
}
```

> **Note:** If TypeScript complains about the `getAdminClientForShop` import from `api.sync`, extract it to `app/lib/shopify-admin.server.ts` and import from there in both routes.

---

## Task 4: Add Environment Variables to `.env`

Add these to your `.env` file (and to your deployment secrets):

```bash
# Shared secret — must match WEBHOOK_SECRET in your Supabase Edge Function secrets
WEBHOOK_SECRET="generate-a-random-32-char-string-here"

# Supabase — for writing shopify_page_id back to published_pages
SUPABASE_URL="https://iepsllggdwhcggkiixll.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="your-service-role-key-here"
```

---

## Task 5: Verify Session Storage Persists Offline Sessions

The sync endpoint loads sessions by shop domain using `api.session.getOfflineId(shop)`. This only works if your session storage adapter **persists offline (non-online) sessions**.

Check `app/shopify.server.ts`:

```typescript
// The session storage must NOT be in-memory (MemorySessionStorage won't survive restarts)
// It should be one of: PrismaSessionStorage, SQLiteSessionStorage, or a custom adapter
```

If you're using `PrismaSessionStorage` (default from `create-shopify-app`), this works automatically — offline sessions are stored in the `Session` table when the merchant installs the app.

If you're on `MemorySessionStorage`, switch to `PrismaSessionStorage`:

```typescript
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";

const shopify = shopifyApp({
  // ...existing config...
  sessionStorage: new PrismaSessionStorage(prisma),
  useOnlineTokens: false,  // false = store offline tokens, needed for server-to-server calls
});
```

---

## What NOT to Do

- Do not use `authenticate.admin(request)` in `/api/sync` — it requires a Shopify browser session/cookie and will throw for webhook calls
- Do not create a `loader` export in `api.sync.ts` — this route is POST-only
- Do not return Shopify session tokens or access tokens in any response
- Do not modify `app/shopify.server.ts` beyond session storage — leave OAuth config untouched
- Do not add CORS headers — this endpoint is called server-to-server, not from a browser

---

## Acceptance Tests

Verify each case with `curl` or a REST client before wiring up Lovable:

**1. Unauthorized request (wrong secret):**
```bash
curl -X POST https://your-app.fly.dev/api/sync \
  -H "x-webhook-secret: wrong" \
  -H "Content-Type: application/json" \
  -d '{"shop":"test.myshopify.com"}'
# Expected: 401 { "error": "Unauthorized" }
```

**2. Missing fields:**
```bash
curl -X POST https://your-app.fly.dev/api/sync \
  -H "x-webhook-secret: $WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"shop":"test.myshopify.com","page_id":"abc"}'
# Expected: 400 { "error": "Missing required fields: ..." }
```

**3. Shop not installed:**
```bash
curl -X POST https://your-app.fly.dev/api/sync \
  -H "x-webhook-secret: $WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"shop":"notinstalled.myshopify.com","page_id":"uuid","title":"Test","handle":"test-faq","body_html":"<p>test</p>","shopify_page_id":null}'
# Expected: 422 { "error": "No Shopify session found for shop: notinstalled.myshopify.com..." }
```

**4. Successful create (on a store with the app installed):**
```bash
curl -X POST https://your-app.fly.dev/api/sync \
  -H "x-webhook-secret: $WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "shop": "your-dev-store.myshopify.com",
    "page_id": "test-uuid-001",
    "shopify_page_id": null,
    "title": "What is FAQ AI?",
    "handle": "faq-what-is-faq-ai",
    "body_html": "<div class=\"faq-ai-block\"><p>FAQ AI generates FAQ pages.</p></div>",
    "meta_description": "Learn about FAQ AI"
  }'
# Expected: 200 { "success": true, "shopify_page_id": "gid://shopify/Page/...", "handle": "faq-what-is-faq-ai", "storefront_url": "https://your-dev-store.myshopify.com/pages/faq-what-is-faq-ai" }
```

**5. Successful update (use the shopify_page_id returned from test 4):**
```bash
curl -X POST https://your-app.fly.dev/api/sync \
  -H "x-webhook-secret: $WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "shop": "your-dev-store.myshopify.com",
    "page_id": "test-uuid-001",
    "shopify_page_id": "gid://shopify/Page/123456789",
    "title": "What is FAQ AI? (Updated)",
    "handle": "faq-what-is-faq-ai",
    "body_html": "<div class=\"faq-ai-block\"><p>Updated content.</p></div>"
  }'
# Expected: 200 { "success": true, ... }
# Verify the Shopify page in admin shows updated content
```

---

## How the Supabase Edge Function Calls This

Once the Remix app endpoint is deployed, update the Supabase `create-shopify-page` Edge Function to call it instead of hitting Shopify directly:

```typescript
// Inside create-shopify-page Edge Function, replace the direct Shopify call with:
const syncRes = await fetch(`${Deno.env.get('SHOPIFY_APP_URL')}/api/sync`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-webhook-secret': Deno.env.get('WEBHOOK_SECRET')!,
  },
  body: JSON.stringify({
    shop: conn.shop_domain,
    page_id: page_id,
    shopify_page_id: page.shopify_page_id ?? null,
    title: page.h1 || page.title,
    handle: page.slug ?? page.title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    body_html: renderedHtml,
    meta_description: page.meta_description ?? '',
  }),
})

const syncData = await syncRes.json()
if (!syncRes.ok) return json(syncRes.status, { error: syncData.error })

return json(200, { success: true, storefront_url: syncData.storefront_url })
```

And add to Supabase Edge Function secrets:
```
SHOPIFY_APP_URL = https://your-remix-app.fly.dev
WEBHOOK_SECRET  = <same value as in Remix app>
```
