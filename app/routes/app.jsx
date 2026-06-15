import { forwardRef } from "react";
import { Link, Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { AppProvider as PolarisAppProvider } from "@shopify/polaris";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import englishI18n from "@shopify/polaris/locales/en.json";
import { authenticate } from "../shopify.server";

const PolarisLink = forwardRef(({ url, children, external, ...rest }, ref) => {
  if (external) {
    return (
      <a href={url} ref={ref} {...rest}>
        {children}
      </a>
    );
  }

  return (
    <Link to={url} ref={ref} {...rest}>
      {children}
    </Link>
  );
});
PolarisLink.displayName = "PolarisLink";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  // eslint-disable-next-line no-undef
  return { apiKey: (process.env.SHOPIFY_API_KEY || "").trim() };
};

export default function App() {
  const { apiKey } = useLoaderData();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <PolarisAppProvider i18n={englishI18n} linkComponent={PolarisLink}>
        <s-app-nav>
          <s-link href="/app">Home</s-link>
          <s-link href="/app/pages">Pages</s-link>
          <s-link href="/app/deploy">Deploy Templates</s-link>
        </s-app-nav>
        <Outlet />
      </PolarisAppProvider>
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
