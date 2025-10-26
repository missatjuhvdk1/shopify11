import { authenticate } from "../shopify.server";
import { DEFAULT_PERIOD_DAYS, resolveDateRange } from "../utils/dashboard-metrics.server.js";
import { createFinalMetrics } from "../utils/final-metrics.server.js";

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
    query OrdersForFinalSummary($first: Int!, $query: String) {
      orders(first: $first, query: $query, sortKey: CREATED_AT, reverse: true) {
        edges {
          node {
            id
            createdAt
            tags
            totalPriceSet { shopMoney { amount currencyCode } }
            totalDiscountsSet { shopMoney { amount currencyCode } }
            shippingAddress { countryCodeV2 country }
            totalShippingPriceSet { shopMoney { amount currencyCode } }
            discountApplications(first: 20) { nodes { __typename ... on AutomaticDiscountApplication { title } } }
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
    const referralTag = (n.tags || []).find((t) => typeof t === "string" && t.startsWith("Referral - "));
    const referralSource = referralTag ? referralTag.replace(/^Referral -\s*/, "").trim() : null;
    const totalPrice = Number(n.totalPriceSet?.shopMoney?.amount || 0);
    return {
      id: n.id,
      createdAt: n.createdAt,
      totalPrice,
      totalDiscounts: Number(n.totalDiscountsSet?.shopMoney?.amount || 0),
      referralPayout: referralSource ? totalPrice * 0.3 : 0,
      shippingCountryCode: n?.shippingAddress?.countryCodeV2 || null,
      shippingCountryName: n?.shippingAddress?.country || null,
      totalShippingPrice: Number(n?.totalShippingPriceSet?.shopMoney?.amount || 0),
    };
  });

  const metrics = createFinalMetrics({
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

