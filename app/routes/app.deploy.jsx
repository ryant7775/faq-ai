// app/routes/app.deploy.jsx
//
// Route: /app/deploy
// Reads the local Liquid + JSON theme files and pushes them to the
// merchant's active theme via the Shopify Assets REST API.

import { useLoaderData, useSubmit, useNavigation, useActionData, data } from "react-router";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  Page,
  Layout,
  Card,
  Button,
  Banner,
  Badge,
  List,
  Text,
  BlockStack,
  InlineStack,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";

async function getActiveTheme(admin) {
  const response = await admin.graphql(`
    #graphql
    query ActiveTheme {
      themes(roles: MAIN, first: 1) {
        nodes {
          id
          name
          role
        }
      }
    }
  `);
  const { data: result } = await response.json();
  return result?.themes?.nodes?.[0] || null;
}

// Helper: read a theme file from the /theme directory at the project root
function readThemeFile(relativePath) {
  // `theme/` lives at the project root, one level above /app
  const fullPath = resolve(process.cwd(), "theme", relativePath);
  return readFileSync(fullPath, "utf8");
}

// Files this route will deploy
const DEPLOY_FILES = [
  {
    themeKey: "sections/iframe-embed.liquid",
    localPath: "sections/iframe-embed.liquid",
    label: "Section — Template A (full-width iFrame)",
  },
  {
    themeKey: "sections/iframe-embed-b.liquid",
    localPath: "sections/iframe-embed-b.liquid",
    label: "Section — Template B (sidebar + iFrame)",
  },
  {
    themeKey: "templates/page.template-a.json",
    localPath: "templates/page.template-a.json",
    label: "Page template A JSON",
  },
  {
    themeKey: "templates/page.template-b.json",
    localPath: "templates/page.template-b.json",
    label: "Page template B JSON",
  },
];

// ── Loader: get active theme ─────────────────────────────────────────────────
export async function loader({ request }) {
  const { admin } = await authenticate.admin(request);
  const activeTheme = await getActiveTheme(admin);

  return { activeTheme };
}

// ── Action: deploy all theme files ──────────────────────────────────────────
export async function action({ request }) {
  const { admin } = await authenticate.admin(request);
  const activeTheme = await getActiveTheme(admin);

  if (!activeTheme) {
    return data({ error: "No active theme found." }, { status: 404 });
  }

  const files = DEPLOY_FILES.map((file) => ({
    filename: file.themeKey,
    body: {
      type: "TEXT",
      value: readThemeFile(file.localPath),
    },
  }));

  const response = await admin.graphql(
    `
      #graphql
      mutation ThemeFilesUpsert(
        $themeId: ID!
        $files: [OnlineStoreThemeFilesUpsertFileInput!]!
      ) {
        themeFilesUpsert(themeId: $themeId, files: $files) {
          upsertedThemeFiles {
            filename
          }
          userErrors {
            field
            message
          }
        }
      }
    `,
    {
      variables: {
        themeId: activeTheme.id,
        files,
      },
    },
  );

  const { data: result } = await response.json();
  const upsertResult = result?.themeFilesUpsert;
  const userErrors = upsertResult?.userErrors || [];
  const upsertedFiles = new Set(
    (upsertResult?.upsertedThemeFiles || []).map((file) => file.filename),
  );

  const deployed = DEPLOY_FILES.filter((file) =>
    upsertedFiles.has(file.themeKey),
  ).map((file) => ({ file: file.themeKey, label: file.label }));

  const errors = [
    ...userErrors.map((error) => ({
      file: error.field?.join(".") || "themeFilesUpsert",
      error: error.message,
    })),
    ...DEPLOY_FILES.filter((file) => !upsertedFiles.has(file.themeKey)).map(
      (file) => ({
        file: file.themeKey,
        error: "File was not upserted.",
      }),
    ),
  ];

  return {
    themeId: activeTheme.id,
    themeName: activeTheme.name,
    deployed,
    errors,
    success: errors.length === 0,
  };
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function DeployRoute() {
  const { activeTheme } = useLoaderData();
  const actionData = useActionData();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isDeploying = navigation.state === "submitting";

  function handleDeploy() {
    submit({}, { method: "post" });
  }

  return (
    <Page
      title="Deploy templates"
      subtitle="Push the iFrame embed sections and page templates to your active theme."
    >
      <BlockStack gap="500">

        {/* Active theme */}
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd" as="h2">Active theme</Text>
                {activeTheme ? (
                  <InlineStack gap="300" align="start">
                    <Text>{activeTheme.name}</Text>
                    <Badge tone="success">Active</Badge>
                    <Text tone="subdued" variant="bodySm">ID: {activeTheme.id}</Text>
                  </InlineStack>
                ) : (
                  <Text tone="subdued">No active theme found.</Text>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* Files to deploy */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">Files that will be deployed</Text>
                <List type="bullet">
                  {DEPLOY_FILES.map((f) => (
                    <List.Item key={f.themeKey}>
                      <Text as="span" variant="bodyMd">
                        <code>{f.themeKey}</code>
                      </Text>
                      {"  "}
                      <Text as="span" tone="subdued" variant="bodySm">
                        {f.label}
                      </Text>
                    </List.Item>
                  ))}
                </List>

                <InlineStack>
                  <Button
                    variant="primary"
                    onClick={handleDeploy}
                    loading={isDeploying}
                    disabled={!activeTheme}
                  >
                    Deploy to active theme
                  </Button>
                </InlineStack>

                <Text tone="subdued" variant="bodySm">
                  Existing files with the same keys will be overwritten. No other theme files are affected.
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* Deploy results */}
          {actionData && (
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <InlineStack gap="300" align="start">
                    <Text variant="headingMd" as="h2">Deploy results</Text>
                    <Badge tone={actionData.success ? "success" : "warning"}>
                      {actionData.success ? "All files deployed" : "Partial success"}
                    </Badge>
                  </InlineStack>

                  {actionData.error && (
                    <Banner tone="critical">{actionData.error}</Banner>
                  )}

                  {actionData.deployed?.length > 0 && (
                    <List type="bullet">
                      {actionData.deployed.map((d) => (
                        <List.Item key={d.file}>
                          ✅ <code>{d.file}</code>
                        </List.Item>
                      ))}
                    </List>
                  )}

                  {actionData.errors?.length > 0 && (
                    <BlockStack gap="200">
                      <Text tone="critical" variant="bodyMd">Errors:</Text>
                      <List type="bullet">
                        {actionData.errors.map((e, i) => (
                          <List.Item key={i}>
                            ❌ <code>{e.file}</code> — {e.error}
                          </List.Item>
                        ))}
                      </List>
                    </BlockStack>
                  )}

                  {actionData.success && (
                    <Banner tone="info">
                      <p>
                        <strong>Next:</strong> Go to{" "}
                        <strong>Online Store → Themes → Customize</strong>, open
                        a page using Template A or B, and paste your iFrame URL
                        into the section settings panel.
                      </p>
                    </Banner>
                  )}
                </BlockStack>
              </Card>
            </Layout.Section>
          )}
        </Layout>

      </BlockStack>
    </Page>
  );
}
