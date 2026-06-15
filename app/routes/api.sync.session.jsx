import { data } from "react-router";
import { sessionStorage } from "../shopify.server";
import { validateWebhookSecret } from "../lib/sync.server";
import prisma from "../db.server";

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

  const { shop } = body;
  if (!shop) {
    return data({ error: "shop is required" }, { status: 400 });
  }

  const offlineSessionId = `offline_${shop}`;
  const offlineSession = await sessionStorage.loadSession(offlineSessionId);

  const allSessions = await prisma.session.findMany({
    where: { shop },
    select: {
      id: true,
      shop: true,
      isOnline: true,
      scope: true,
      expires: true,
    },
  });

  return data({
    shop,
    offline_session_id: offlineSessionId,
    offline_session_found: Boolean(offlineSession?.accessToken),
    total_sessions_for_shop: allSessions.length,
    sessions: allSessions,
    database_url: process.env.DATABASE_URL || "(not set)",
  });
}
