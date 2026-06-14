import { unauthenticated } from "../shopify.server";

/**
 * Load an Admin GraphQL client for a shop using the persisted offline OAuth session.
 * Server-to-server callers must not use authenticate.admin() (requires a browser session).
 */
export async function getAdminForShop(shop) {
  try {
    const { admin, session } = await unauthenticated.admin(shop);

    if (!session?.accessToken) {
      throw new Error(`Session for ${shop} has no access token.`);
    }

    return { admin, session };
  } catch (error) {
    const message = error?.message || String(error);

    if (
      error?.name === "SessionNotFoundError" ||
      message.includes("Could not find a session")
    ) {
      throw new Error(
        `No Shopify session found for shop: ${shop}. Has the app been installed on this store?`,
      );
    }

    throw error;
  }
}
