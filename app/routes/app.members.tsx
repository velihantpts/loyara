import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Card,
  DataTable,
  Text,
  BlockStack,
  Box,
  EmptyState,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { displayBalance } from "../loyalty/balance.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const customers = await prisma.customer.findMany({
    where: { shop: session.shop },
    orderBy: { balance: "desc" },
    take: 100,
  });
  return {
    members: customers.map((c) => ({
      label: c.email ?? c.shopifyGid.replace("gid://shopify/Customer/", "#"),
      balance: displayBalance(c.balance),
      lifetime: c.lifetimeEarned,
      vip: c.vipTier ?? "—",
    })),
  };
};

export default function Members() {
  const { members } = useLoaderData<typeof loader>();
  const nf = new Intl.NumberFormat("en-US");

  return (
    <Page>
      <TitleBar title="Members" />
      <Card padding="0">
        {members.length === 0 ? (
          <Box>
            <EmptyState
              heading="No members yet"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>
                Members appear here as customers earn points. Add the widget to
                your theme and set your earn rate in Settings to get started.
              </p>
            </EmptyState>
          </Box>
        ) : (
          <BlockStack>
            <DataTable
              columnContentTypes={["text", "numeric", "numeric", "text"]}
              headings={["Customer", "Points", "Lifetime", "VIP tier"]}
              rows={members.map((m) => [
                m.label,
                nf.format(m.balance),
                nf.format(m.lifetime),
                m.vip,
              ])}
            />
            <Box padding="300">
              <Text as="p" variant="bodyXs" tone="subdued">
                Showing up to 100 members by balance.
              </Text>
            </Box>
          </BlockStack>
        )}
      </Card>
    </Page>
  );
}
