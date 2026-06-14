// app/routes/app.pages.jsx
//
// Route: /app/pages
// Handles listing and creating Shopify pages via the Admin REST API.
// The `authenticate.admin` call handles auth automatically — no manual
// token management needed.

import { useLoaderData, useSubmit, useNavigation, useActionData, data } from "react-router";
import { useState } from "react";
import {
  Page,
  Layout,
  Card,
  FormLayout,
  TextField,
  Select,
  Button,
  DataTable,
  Banner,
  Spinner,
  Badge,
  Modal,
  Text,
  EmptyState,
  BlockStack,
  InlineStack,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";

// ── Loader: fetch all pages ─────────────────────────────────────────────────
export async function loader({ request }) {
  const { admin } = await authenticate.admin(request);

  const response = await admin.graphql(`
    #graphql
    query Pages {
      pages(first: 250) {
        nodes {
          id
          title
          templateSuffix
          updatedAt
        }
      }
    }
  `);

  const { data: result } = await response.json();
  const pages = (result?.pages?.nodes || []).map((page) => ({
    id: page.id,
    title: page.title,
    template_suffix: page.templateSuffix,
    updated_at: page.updatedAt,
  }));

  return { pages };
}

// ── Action: create or delete a page ────────────────────────────────────────
export async function action({ request }) {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  // Create
  if (intent === "create") {
    const title = formData.get("title");
    const templateSuffix = formData.get("template_suffix");

    if (!title) {
      return data({ error: "Title is required." }, { status: 400 });
    }

    const response = await admin.graphql(
      `
        #graphql
        mutation PageCreate($page: PageCreateInput!) {
          pageCreate(page: $page) {
            page {
              id
              title
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
          page: {
            title,
            templateSuffix,
            isPublished: true,
          },
        },
      },
    );

    const { data: result } = await response.json();
    const createResult = result?.pageCreate;
    const userErrors = createResult?.userErrors || [];

    if (userErrors.length > 0) {
      return data(
        { error: userErrors.map((error) => error.message).join(", ") },
        { status: 400 },
      );
    }

    return {
      success: `Page "${createResult.page.title}" created successfully.`,
    };
  }

  // Delete
  if (intent === "delete") {
    const pageId = formData.get("page_id");

    const response = await admin.graphql(
      `
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
      `,
      {
        variables: { id: pageId },
      },
    );

    const { data: result } = await response.json();
    const deleteResult = result?.pageDelete;
    const userErrors = deleteResult?.userErrors || [];

    if (userErrors.length > 0) {
      return data(
        { error: userErrors.map((error) => error.message).join(", ") },
        { status: 400 },
      );
    }

    return { success: "Page deleted." };
  }

  return data({ error: "Unknown intent." }, { status: 400 });
}

// ── Template options ─────────────────────────────────────────────────────────
const TEMPLATE_OPTIONS = [
  { label: "Template A — Full-width iFrame", value: "template-a" },
  { label: "Template B — Sidebar + iFrame", value: "template-b" },
];

// ── Component ─────────────────────────────────────────────────────────────────
export default function PagesRoute() {
  const { pages } = useLoaderData();
  const actionData = useActionData();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const [title, setTitle] = useState("");
  const [templateSuffix, setTemplateSuffix] = useState("template-a");
  const [deleteTarget, setDeleteTarget] = useState(null);

  function handleCreate() {
    const form = new FormData();
    form.append("intent", "create");
    form.append("title", title);
    form.append("template_suffix", templateSuffix);
    submit(form, { method: "post" });
    setTitle("");
  }

  function handleDelete() {
    const form = new FormData();
    form.append("intent", "delete");
    form.append("page_id", deleteTarget.id);
    submit(form, { method: "post" });
    setDeleteTarget(null);
  }

  const rows = pages.map((p) => [
    p.title,
    <Badge tone={p.template_suffix ? "info" : "enabled"}>
      {p.template_suffix ? `page.${p.template_suffix}` : "default"}
    </Badge>,
    new Date(p.updated_at).toLocaleDateString(),
    <Button
      variant="plain"
      tone="critical"
      onClick={() => setDeleteTarget({ id: p.id, title: p.title })}
    >
      Delete
    </Button>,
  ]);

  return (
    <Page
      title="Pages"
      subtitle="Create storefront pages and assign an iFrame embed template to each one."
    >
      <BlockStack gap="500">

        {/* Success / error feedback */}
        {actionData?.success && (
          <Banner tone="success">{actionData.success}</Banner>
        )}
        {actionData?.error && (
          <Banner tone="critical">{actionData.error}</Banner>
        )}

        {/* Create form */}
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">Create a new page</Text>
                <FormLayout>
                  <TextField
                    label="Page title"
                    value={title}
                    onChange={setTitle}
                    placeholder="e.g. Our Latest Webinar"
                    autoComplete="off"
                  />
                  <Select
                    label="Template"
                    options={TEMPLATE_OPTIONS}
                    value={templateSuffix}
                    onChange={setTemplateSuffix}
                    helpText={
                      templateSuffix === "template-a"
                        ? "Full-width iFrame — clean, single-column layout."
                        : "Sidebar + iFrame — two-column with optional context text."
                    }
                  />
                  <Button
                    variant="primary"
                    onClick={handleCreate}
                    loading={isSubmitting}
                    disabled={!title.trim()}
                  >
                    Create page
                  </Button>
                </FormLayout>
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* Pages table */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">
                  All pages ({pages.length})
                </Text>
                {isSubmitting ? (
                  <InlineStack align="center">
                    <Spinner />
                  </InlineStack>
                ) : pages.length === 0 ? (
                  <EmptyState heading="No pages yet" image="">
                    <p>Create your first page using the form above.</p>
                  </EmptyState>
                ) : (
                  <DataTable
                    columnContentTypes={["text", "text", "text", "text"]}
                    headings={["Title", "Template", "Last updated", ""]}
                    rows={rows}
                  />
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

      </BlockStack>

      {/* Delete confirmation */}
      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title={`Delete "${deleteTarget?.title}"?`}
        primaryAction={{
          content: "Delete",
          destructive: true,
          onAction: handleDelete,
        }}
        secondaryActions={[
          { content: "Cancel", onAction: () => setDeleteTarget(null) },
        ]}
      >
        <Modal.Section>
          <p>This will permanently remove the page from your store.</p>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
