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

const PAGE_DELETE_MUTATION = `
  #graphql
  mutation PageDelete($id: ID!) {
    pageDelete(id: $id) {
      deletedPageId
      userErrors {
        field
        message
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

  const { shop, shopify_page_id, handle } = body;

  if (!shop) {
    return data({ error: "shop is required" }, { status: 400 });
  }

  if (!shopify_page_id && !handle) {
    return data(
      { error: "shopify_page_id or handle is required" },
      { status: 400 },
    );
  }

  let admin;
  try {
    ({ admin } = await getAdminForShop(shop));
  } catch (error) {
    console.error("[sync/delete] Session load failed:", error.message);
    return data({ error: error.message }, { status: 422 });
  }

  let shopifyPageId = shopify_page_id;

  try {
    if (!shopifyPageId) {
      const lookupResponse = await admin.graphql(PAGE_BY_HANDLE_QUERY, {
        variables: { query: `handle:${handle}` },
      });
      const { data: lookupResult } = await lookupResponse.json();
      const page = lookupResult?.pages?.nodes?.[0];

      if (!page) {
        return data({ success: true, deleted_page_id: null }, { status: 200 });
      }

      shopifyPageId = page.id;
    }

    const response = await admin.graphql(PAGE_DELETE_MUTATION, {
      variables: { id: shopifyPageId },
    });
    const { data: result } = await response.json();
    const errors = result?.pageDelete?.userErrors ?? [];

    if (errors.length) {
      const notFound = errors.some((e) =>
        /does not exist|not found/i.test(e.message),
      );
      if (!notFound) {
        return data(
          {
            success: false,
            error: `pageDelete failed: ${JSON.stringify(errors)}`,
          },
          { status: 502 },
        );
      }
    }

    return data(
      { success: true, deleted_page_id: shopifyPageId },
      { status: 200 },
    );
  } catch (error) {
    console.error("[sync/delete] Shopify GraphQL error:", error);
    return data(
      { error: `Shopify API error: ${error.message}` },
      { status: 502 },
    );
  }
}
