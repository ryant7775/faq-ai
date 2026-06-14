import { data } from "react-router";
import { getAdminForShop } from "../lib/shopify-admin.server";
import { validateWebhookSecret } from "../lib/sync.server";

const PAGE_BY_HANDLE_QUERY = `
  #graphql
  query PageByHandle($query: String!) {
    pages(first: 1, query: $query) {
      nodes {
        id
        handle
        title
      }
    }
  }
`;

export async function action({ request }) {
  if (request.method !== "POST") {
    return data({ error: "Method not allowed" }, { status: 405 });
  }

  const authError = validateWebhookSecret(request);
  if (authError) return authError;

  let body;
  try {
    body = await request.json();
  } catch {
    return data({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { shop, handle } = body;

  if (!shop || !handle) {
    return data({ error: "shop and handle are required" }, { status: 400 });
  }

  let admin;
  try {
    ({ admin } = await getAdminForShop(shop));
  } catch (error) {
    console.error("[sync/lookup] Session load failed:", error.message);
    return data({ error: error.message }, { status: 422 });
  }

  try {
    const response = await admin.graphql(PAGE_BY_HANDLE_QUERY, {
      variables: { query: `handle:${handle}` },
    });
    const { data: result } = await response.json();
    const page = result?.pages?.nodes?.[0];

    if (!page) {
      return data({ found: false }, { status: 200 });
    }

    return data(
      {
        found: true,
        shopify_page_id: page.id,
        handle: page.handle,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("[sync/lookup] Shopify GraphQL error:", error);
    return data(
      { error: `Shopify API error: ${error.message}` },
      { status: 502 },
    );
  }
}
