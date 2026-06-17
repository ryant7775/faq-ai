import { data } from "react-router";
import { getAdminForShop } from "../lib/shopify-admin.server";
import { validateWebhookSecret } from "../lib/sync.server";

const SHOP_NAME_QUERY = `
  #graphql
  query SessionStatusShop {
    shop {
      name
    }
  }
`;

export async function loader({ request }) {
  if (request.method !== "GET") {
    return data({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const authError = validateWebhookSecret(request);
    if (authError) return authError;

    const url = new URL(request.url);
    const shop = url.searchParams.get("shop");

    if (!shop) {
      return data(
        { error: "shop query parameter is required." },
        { status: 400 },
      );
    }

    try {
      const { admin } = await getAdminForShop(shop);

      let shopName = null;
      try {
        const response = await admin.graphql(SHOP_NAME_QUERY);
        const { data: result } = await response.json();
        shopName = result?.shop?.name ?? null;
      } catch (error) {
        console.warn("[session-status] Shop name query failed:", error.message);
      }

      return data({ installed: true, shop_name: shopName });
    } catch {
      return data({ installed: false });
    }
  } catch (error) {
    console.error("[session-status] Unexpected error:", error);
    throw error;
  }
}
