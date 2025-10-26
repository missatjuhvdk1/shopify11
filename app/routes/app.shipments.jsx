import { useMemo } from "react";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { DEFAULT_PERIOD_DAYS, resolveDateRange } from "../utils/dashboard-metrics.server.js";
import { createShippingMetrics } from "../utils/shipping-metrics.server.js";
import {
  MetricsPageLayout,
  formatCurrency,
  metricsStyles as sx,
  useMetricsController,
} from "../components/metrics-page.jsx";

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  const url = new URL(request.url);
  const startParam = url.searchParams.get("startDate");
  const endParam = url.searchParams.get("endDate");
  const { start, end, days } = resolveDateRange({
    startDate: startParam,
    endDate: endParam,
    referenceDate: new Date(),
    fallbackDays: DEFAULT_PERIOD_DAYS,
  });
  const createdFilter = `created_at:>=${start.toISOString()} created_at:<=${end.toISOString()}`;

  const query = `#graphql
    query OrdersForShippingPage($first: Int!, $query: String) {
      orders(first: $first, query: $query, sortKey: CREATED_AT, reverse: true) {
        edges {
          node {
            id
            createdAt
            shippingAddress { countryCodeV2 country }
            totalShippingPriceSet { shopMoney { amount currencyCode } }
          }
        }
      }
    }
  `;

  const resp = await admin.graphql(query, { variables: { first: 100, query: createdFilter } });
  const result = await resp.json();
  const edges = result?.data?.orders?.edges || [];
  const orders = edges.map((e) => {
    const n = e.node;
    return {
      id: n.id,
      createdAt: n.createdAt,
      shippingCountryCode: n?.shippingAddress?.countryCodeV2 || null,
      shippingCountryName: n?.shippingAddress?.country || null,
      totalShippingPrice: Number(n?.totalShippingPriceSet?.shopMoney?.amount || 0),
    };
  });

  const metrics = createShippingMetrics({
    orders,
    startDate: start,
    endDate: end,
    periodDays: days,
    referenceDate: end,
  });

  return { metrics };
};

export default function ShipmentsPage() {
  const { metrics: initialMetrics } = useLoaderData();
  const controller = useMetricsController(initialMetrics, { fetchPath: "/api/metrics/shipments" });
  const { metrics } = controller;

  const summaryCards = useMemo(
    () => [
      {
        id: "ship-charged",
        label: "Verzendkosten afgerekend",
        value: formatCurrency(metrics.shipments.totalCharged),
        helpText: `${metrics.summary.ordersWithShipping} afgerekende verzendkosten`,
      },
      {
        id: "ship-cost",
        label: "Geschatte verzendkosten",
        value: formatCurrency(metrics.shipments.totalCost),
        helpText: "Op basis van hoogste tarief per land",
      },
      {
        id: "ship-income",
        label: "Verzend-inkomsten",
        value: formatCurrency(metrics.shipments.income),
        helpText: "Afgerekend – geschatte kosten",
      },
      {
        id: "orders",
        label: "Bestellingen (periode)",
        value: String(metrics.summary.totalOrders),
        helpText: metrics.period.label,
      },
    ],
    [metrics],
  );

  return (
    <MetricsPageLayout heading="Verzending" controller={controller} summaryCards={summaryCards}>
      <s-card padding="loose">
        <div style={sx.sectionHeader}>
          <h2>Inkomen per land</h2>
          <span style={sx.sectionSubhead}>Verzendkosten afgerekend vs. geschatte kosten</span>
        </div>
        <div style={sx.tableWrap}>
          <table style={sx.table}>
            <thead style={sx.stickyHeader}>
              <tr>
                <th style={sx.th} scope="col">Land</th>
                <th style={sx.th} scope="col">Bestellingen</th>
                <th style={sx.th} scope="col">Afgerekend</th>
                <th style={sx.th} scope="col">Kosten (geschat)</th>
                <th style={sx.th} scope="col">Inkomen</th>
              </tr>
            </thead>
            <tbody>
              {metrics.shipments.byCountry.map((c) => (
                <tr key={c.countryCode || c.countryName}>
                  <td style={sx.td} data-label="Land">{c.countryName || c.countryCode || "Onbekend"}</td>
                  <td style={sx.td} data-label="Bestellingen">{c.orders}</td>
                  <td style={sx.td} data-label="Afgerekend">{formatCurrency(c.charged)}</td>
                  <td style={sx.td} data-label="Kosten">{formatCurrency(c.cost)}</td>
                  <td style={sx.td} data-label="Inkomen">{formatCurrency(c.income)}</td>
                </tr>
              ))}
              {metrics.shipments.byCountry.length === 0 && (
                <tr>
                  <td colSpan={5} style={sx.emptyState}>Geen bestellingen met verzending in deze periode.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </s-card>
    </MetricsPageLayout>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};

