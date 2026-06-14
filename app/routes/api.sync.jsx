import { data } from "react-router";
import { getAdminForShop } from "../lib/shopify-admin.server";
import {
  validateWebhookSecret,
  writeSyncMetadataToSupabase,
} from "../lib/sync.server";

const PAGE_CREATE_MUTATION = `
  #graphql
  mutation PageCreate($page: PageCreateInput!) {
    pageCreate(page: $page) {
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

const PAGE_UPDATE_MUTATION = `
  #graphql
  mutation PageUpdate($id: ID!, $page: PageUpdateInput!) {
    pageUpdate(id: $id, page: $page) {
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

function buildPageInput(payload) {
  const templateSuffix = payload.template_suffix || "template-a";

  return {
    title: payload.title,
    body: payload.body_html,
    handle: payload.handle,
    isPublished: true,
    templateSuffix,
    ...(payload.meta_description
      ? {
          seo: {
            description: payload.meta_description,
            title: payload.title,
          },
        }
      : {}),
  };
}

function formatUserErrors(userErrors) {
  return userErrors.map((error) => `${error.field}: ${error.message}`).join("; ");
}

export async function action({ request }) {
  if (request.method !== "POST") {
    return data({ error: "Method not allowed" }, { status: 405 });
  }

  const authError = validateWebhookSecret(request);
  if (authError) return authError;

  let payload;
  try {
    payload = await request.json();
  } catch {
    return data({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { shop, page_id, shopify_page_id, title, handle, body_html } = payload;

  if (!shop || !page_id || !title || !handle || !body_html) {
    return data(
      {
        error:
          "Missing required fields: shop, page_id, title, handle, body_html",
      },
      { status: 400 },
    );
  }

  let admin;
  try {
    ({ admin } = await getAdminForShop(shop));
  } catch (error) {
    console.error("[sync] Session load failed:", error.message);
    return data({ error: error.message }, { status: 422 });
  }

  const pageInput = buildPageInput(payload);

  try {
    if (shopify_page_id) {
      const response = await admin.graphql(PAGE_UPDATE_MUTATION, {
        variables: { id: shopify_page_id, page: pageInput },
      });
      const { data: result } = await response.json();
      const pageUpdate = result?.pageUpdate;
      const userErrors = pageUpdate?.userErrors || [];

      if (userErrors.length > 0) {
        return data(
          {
            error: `Shopify page update failed: ${formatUserErrors(userErrors)}`,
          },
          { status: 422 },
        );
      }

      const syncResult = {
        success: true,
        shopify_page_id: pageUpdate.page.id,
        handle: pageUpdate.page.handle,
        storefront_url: `https://${shop}/pages/${pageUpdate.page.handle}`,
      };

      await writeSyncMetadataToSupabase({
        page_id,
        shopify_page_id: syncResult.shopify_page_id,
        shopify_page_handle: syncResult.handle,
      }).catch((error) =>
        console.warn("[sync] Supabase write-back failed:", error),
      );

      console.log(`[sync] Updated Shopify page: ${syncResult.storefront_url}`);
      return data(syncResult, { status: 200 });
    }

    const response = await admin.graphql(PAGE_CREATE_MUTATION, {
      variables: { page: pageInput },
    });
    const { data: result } = await response.json();
    const pageCreate = result?.pageCreate;
    const userErrors = pageCreate?.userErrors || [];

    if (userErrors.length > 0) {
      const errors = formatUserErrors(userErrors);

      if (errors.includes("handle") && errors.includes("taken")) {
        return data(
          {
            error: `A Shopify page with handle "${handle}" already exists. Pass its shopify_page_id to update it instead.`,
            hint: "lookup_existing_handle",
          },
          { status: 409 },
        );
      }

      return data(
        { error: `Shopify page creation failed: ${errors}` },
        { status: 422 },
      );
    }

    const syncResult = {
      success: true,
      shopify_page_id: pageCreate.page.id,
      handle: pageCreate.page.handle,
      storefront_url: `https://${shop}/pages/${pageCreate.page.handle}`,
    };

    await writeSyncMetadataToSupabase({
      page_id,
      shopify_page_id: syncResult.shopify_page_id,
      shopify_page_handle: syncResult.handle,
    }).catch((error) =>
      console.warn("[sync] Supabase write-back failed:", error),
    );

    console.log(`[sync] Created Shopify page: ${syncResult.storefront_url}`);
    return data(syncResult, { status: 200 });
  } catch (error) {
    console.error("[sync] Shopify GraphQL error:", error);
    return data(
      { error: `Shopify API error: ${error.message}` },
      { status: 502 },
    );
  }
}
