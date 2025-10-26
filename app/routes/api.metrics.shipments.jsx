import { authenticate } from "../shopify.server";
import { DEFAULT_PERIOD_DAYS, resolveDateRange } from "../utils/dashboard-metrics.server.js";
import { createShippingMetrics } from "../utils/shipping-metrics.server.js";

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
    query OrdersForShipping($first: Int!, $query: String) {
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

  return new Response(JSON.stringify(metrics), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "private, max-age=15",
    },
  });
};

