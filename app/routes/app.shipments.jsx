import { useMemo } from "react";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { withCache } from "../utils/cache.server.js";
import { DEFAULT_PERIOD_DAYS, resolveDateRange } from "../utils/dashboard-metrics.server.js";
import { createShippingMetrics } from "../utils/shipping-metrics.server.js";
import {
  MetricsPageLayout,
  formatCurrencyEUR as formatCurrency,
  metricsStyles as sx,
  useMetricsController,
} from "../components/metrics-page.jsx";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

  const url = new URL(request.url);
  const shopId = (session && session.shop) || url.searchParams.get("shop") || request.headers.get("x-shopify-shop-domain") || "unknown";
  const startParam = url.searchParams.get("startDate");
  const endParam = url.searchParams.get("endDate");
  const useMonthDefault = !startParam && !endParam;
  let start, end, days;
  if (useMonthDefault) {
    const ref = new Date();
    const monthStart = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), 1, 0, 0, 0, 0));
    const monthEnd = new Date(
      Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() + 1, 0, 23, 59, 59, 999),
    );
    const nowEnd = new Date();
    nowEnd.setUTCHours(23, 59, 59, 999);
    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    start = monthStart;
    end = monthEnd > nowEnd ? nowEnd : monthEnd;
    days = Math.round((end.getTime() - start.getTime()) / MS_PER_DAY) + 1;
  } else {
    const r = resolveDateRange({
      startDate: startParam,
      endDate: endParam,
      referenceDate: new Date(),
      fallbackDays: DEFAULT_PERIOD_DAYS,
    });
    start = r.start;
    end = r.end;
    days = r.days;
  }
  const createdFilter = `created_at:>=${start.toISOString()} created_at:<=${end.toISOString()}`;

  const query = `#graphql
    query OrdersForShippingPage($first: Int!, $query: String, $after: String) {
      orders(first: $first, query: $query, sortKey: CREATED_AT, reverse: true, after: $after) {
        edges {
          cursor
          node {
            id
            createdAt
            shippingAddress { countryCodeV2 country }
            totalShippingPriceSet { shopMoney { amount currencyCode } }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  `;
  const cacheKey = `orders:shipments:${shopId}:${start.toISOString()}:${end.toISOString()}`;
  const { value: orders } = await withCache(
    cacheKey,
    async () => {
      let after = null;
      let edges = [];
      for (let i = 0; i < 10; i += 1) {
        const resp = await admin.graphql(query, { variables: { first: 250, query: createdFilter, after } });
        const result = await resp.json();
        const page = result?.data?.orders;
        if (!page) break;
        edges = edges.concat(page.edges || []);
        if (!page.pageInfo?.hasNextPage) break;
        after = page.pageInfo.endCursor;
      }
      return edges.map((e) => {
        const n = e.node;
        return {
          id: n.id,
          createdAt: n.createdAt,
          shippingCountryCode: n?.shippingAddress?.countryCodeV2 || null,
          shippingCountryName: n?.shippingAddress?.country || null,
          totalShippingPrice: Number(n?.totalShippingPriceSet?.shopMoney?.amount || 0),
        };
      });
    },
  );

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

  // Dutch country names via Intl.DisplayNames with fallback
  let regionNames;
  try {
    regionNames = new Intl.DisplayNames(["nl-NL", "nl"], { type: "region" });
  } catch (_) {
    regionNames = null;
  }

  // Sort countries by order count, high → low
  const sortedCountries = useMemo(() => {
    const arr = Array.isArray(metrics?.shipments?.byCountry) ? [...metrics.shipments.byCountry] : [];
    return arr.sort((a, b) => (Number(b?.orders || 0) - Number(a?.orders || 0)));
  }, [metrics?.shipments?.byCountry]);

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
              {sortedCountries.map((c) => {
                const dutchName = c.countryCode && regionNames ? regionNames.of(c.countryCode) : null;
                const displayName = dutchName || c.countryName || c.countryCode || "Onbekend";
                return (
                <tr key={c.countryCode || c.countryName}>
                  <td style={sx.td} data-label="Land">{displayName}</td>
                  <td style={sx.td} data-label="Bestellingen">{c.orders}</td>
                  <td style={sx.td} data-label="Afgerekend">{formatCurrency(c.charged)}</td>
                  <td style={sx.td} data-label="Kosten">{formatCurrency(c.cost)}</td>
                  <td style={sx.td} data-label="Inkomen">{formatCurrency(c.income)}</td>
                </tr>
              );})}
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
