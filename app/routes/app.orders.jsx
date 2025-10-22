import { useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { DEFAULT_PERIOD_DAYS } from "../utils/constants.js";

const clampPeriod = (value) => {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return DEFAULT_PERIOD_DAYS;
  return Math.min(Math.max(parsed, 7), 180);
};

export const loader = async ({ request }) => {
  const { admin, scopes } = await authenticate.admin(request);

  const url = new URL(request.url);
  const periodParam = url.searchParams.get("periodDays");
  const periodDays = periodParam ? clampPeriod(periodParam) : DEFAULT_PERIOD_DAYS;

  const since = new Date();
  since.setUTCDate(since.getUTCDate() - periodDays);
  const createdFilter = `created_at:>=${since.toISOString()}`;

  const query = `#graphql
    query Orders($first: Int!, $query: String) {
      orders(first: $first, query: $query, sortKey: CREATED_AT, reverse: true) {
        edges {
          node {
            id
            name
            createdAt
            displayFinancialStatus
            displayFulfillmentStatus
            totalPriceSet { shopMoney { amount currencyCode } }
            totalDiscountsSet { shopMoney { amount currencyCode } }
            discountApplications(first: 10) {
              nodes {
                __typename
                ... on DiscountCodeApplication {
                  code
                  allocationMethod
                  targetType
                  value {
                    __typename
                    ... on MoneyV2 { amount currencyCode }
                    ... on PricingPercentageValue { percentage }
                  }
                }
                ... on AutomaticDiscountApplication { title }
              }
            }
          }
        }
      }
    }
  `;

  // Check granted scopes before querying orders to avoid hard errors
  let grantedScopes = [];
  try {
    const detail = await scopes.query();
    grantedScopes = detail?.granted || [];
  } catch (_) {
    // ignore and try anyway
  }
  const needsReadOrders = !grantedScopes.includes("read_orders") &&
    !grantedScopes.includes("read_all_orders");
  if (needsReadOrders) {
    return {
      periodDays,
      orders: [],
      missingScope: true,
      grantedScopes,
    };
  }

  const resp = await admin.graphql(query, {
    variables: { first: 25, query: createdFilter },
  });
  const result = await resp.json();
  const edges = result?.data?.orders?.edges || [];
  const orders = edges.map((e) => {
    const n = e.node;
    return {
      id: n.id,
      name: n.name,
      createdAt: n.createdAt,
      financialStatus: n.displayFinancialStatus,
      fulfillmentStatus: n.displayFulfillmentStatus,
      total: n.totalPriceSet?.shopMoney,
      discounts: n.totalDiscountsSet?.shopMoney,
      discountApplications: n.discountApplications?.nodes || [],
    };
  });

  return { periodDays, orders, raw: result };
};

export default function OrdersDebugPage() {
  const { periodDays, orders, missingScope, grantedScopes } = useLoaderData();

  return (
    <s-page heading="Bestellingen Debug">
      <s-section heading={`Nieuwste bestellingen in de laatste ${periodDays} dagen`}>
        {missingScope ? (
          <s-empty-state heading="Ontbrekende read_orders-scope">
            <p>
              De app heeft geen <code>read_orders</code>-rechten. Open de app opnieuw om
              OAuth te starten, of verwijder en installeer opnieuw. Toegekend: {grantedScopes?.join(", ") || "(onbekend)"}
            </p>
          </s-empty-state>
        ) : orders.length === 0 ? (
          <s-empty-state heading="Geen bestellingen gevonden">
            <p>We hebben geen bestellingen gevonden voor de gekozen periode.</p>
          </s-empty-state>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "8px" }}>Naam</th>
                <th style={{ textAlign: "left", padding: "8px" }}>Aangemaakt</th>
                <th style={{ textAlign: "right", padding: "8px" }}>Totaal</th>
                <th style={{ textAlign: "right", padding: "8px" }}>Kortingen</th>
                <th style={{ textAlign: "left", padding: "8px" }}>Kortingstoepassingen</th>
                <th style={{ textAlign: "left", padding: "8px" }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td style={{ padding: "8px" }}>{o.name}</td>
                  <td style={{ padding: "8px" }}>{new Date(o.createdAt).toLocaleString()}</td>
                  <td style={{ padding: "8px", textAlign: "right" }}>
                    {o.total?.amount} {o.total?.currencyCode}
                  </td>
                  <td style={{ padding: "8px", textAlign: "right" }}>
                    {o.discounts?.amount} {o.discounts?.currencyCode}
                  </td>
                  <td style={{ padding: "8px" }}>
                    {o.discountApplications.length === 0
                      ? "—"
                      : o.discountApplications
                          .map((a) => (a.code || a.title || a.__typename))
                          .join(", ")}
                  </td>
                  <td style={{ padding: "8px" }}>
                    {o.financialStatus} / {o.fulfillmentStatus}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </s-section>
      <s-section slot="aside" heading="Tips">
        <s-paragraph>
          - Zorg dat de app de scope <code>read_orders</code> heeft.
        </s-paragraph>
        <s-paragraph>
          - Bestellingen ouder dan de geselecteerde periode worden gefilterd met
          <code> created_at:>=ISO</code>.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
