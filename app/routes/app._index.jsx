// app/routes/app._index.jsx
//
// Replaces the default scaffold index with a simple home screen
// that links to the two main features.

import { Link } from "react-router";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Button,
  Divider,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";

export async function loader({ request }) {
  await authenticate.admin(request);
  return {};
}

export default function Index() {
  return (
    <Page title="iFrame Content Manager">
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">Welcome</Text>
              <Text tone="subdued">
                This app lets you create Shopify pages pre-assigned to one of two
                iFrame embed templates, and deploy those templates directly to
                your active theme.
              </Text>
              <Divider />
              <BlockStack gap="300">
                <InlineStack gap="300">
                  <Link to="/app/deploy">
                    <Button variant="primary">
                      🚀 Deploy templates first
                    </Button>
                  </Link>
                  <Link to="/app/pages">
                    <Button>
                      📄 Manage pages
                    </Button>
                  </Link>
                </InlineStack>
                <Text tone="subdued" variant="bodySm">
                  Start by deploying the templates to your theme, then create pages
                  and assign them.
                </Text>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Layout>
            <Layout.Section variant="oneHalf">
              <Card>
                <BlockStack gap="300">
                  <Text variant="headingMd" as="h2">Template A</Text>
                  <Text tone="subdued">
                    Full-width iFrame layout. The embed spans the entire content
                    area. Ideal for full-screen experiences.
                  </Text>
                  <Text variant="bodySm">
                    <code>page.template-a.json</code>
                  </Text>
                </BlockStack>
              </Card>
            </Layout.Section>

            <Layout.Section variant="oneHalf">
              <Card>
                <BlockStack gap="300">
                  <Text variant="headingMd" as="h2">Template B</Text>
                  <Text tone="subdued">
                    Two-column layout with an optional sidebar for context text,
                    a heading, and a CTA button alongside the iFrame.
                  </Text>
                  <Text variant="bodySm">
                    <code>page.template-b.json</code>
                  </Text>
                </BlockStack>
              </Card>
            </Layout.Section>
          </Layout>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
