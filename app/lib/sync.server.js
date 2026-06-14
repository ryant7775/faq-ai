import { data } from "react-router";

export function validateWebhookSecret(request) {
  const incomingSecret = request.headers.get("x-webhook-secret");
  const expectedSecret = process.env.WEBHOOK_SECRET;

  if (!expectedSecret) {
    console.error("[sync] WEBHOOK_SECRET environment variable is not set");
    return data({ error: "Server misconfiguration" }, { status: 500 });
  }

  if (!incomingSecret || incomingSecret !== expectedSecret) {
    return data({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}

/**
 * Write shopify_page_id back to Supabase published_pages.
 * Non-fatal: logs and continues if env vars or columns are missing.
 */
export async function writeSyncMetadataToSupabase(params) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.warn(
      "[sync] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set — skipping metadata write-back",
    );
    return;
  }

  const res = await fetch(
    `${supabaseUrl}/rest/v1/published_pages?id=eq.${params.page_id}`,
    {
      method: "PATCH",
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        shopify_page_id: params.shopify_page_id,
        shopify_page_handle: params.shopify_page_handle,
        shopify_synced_at: new Date().toISOString(),
      }),
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.warn(
      "[sync] Failed to write metadata back to Supabase:",
      res.status,
      text,
    );
  }
}
