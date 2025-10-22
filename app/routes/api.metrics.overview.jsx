import { authenticate } from "../shopify.server";
import {
  DEFAULT_PERIOD_DAYS,
  createDashboardMetrics,
  resolveDateRange,
} from "../utils/dashboard-metrics.server.js";

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
    query OrdersForMetrics($first: Int!, $query: String) {
      orders(first: $first, query: $query, sortKey: CREATED_AT, reverse: true) {
        edges {
          node {
            id
            createdAt
            name
            totalPriceSet { shopMoney { amount currencyCode } }
            totalDiscountsSet { shopMoney { amount currencyCode } }
            discountApplications(first: 20) {
              nodes {
                __typename
                ... on DiscountCodeApplication {
                  code
                  allocationMethod
                  targetType
                  value { __typename ... on MoneyV2 { amount } ... on PricingPercentageValue { percentage } }
                }
                ... on AutomaticDiscountApplication { title }
              }
            }
            lineItems(first: 100) {
              edges {
                node {
                  discountAllocations {
                    allocatedAmountSet { shopMoney { amount } }
                    discountApplication {
                      __typename
                      ... on DiscountCodeApplication { code }
                      ... on AutomaticDiscountApplication { title }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  const resp = await admin.graphql(query, {
    variables: { first: 100, query: createdFilter },
  });
  const result = await resp.json();
  const edges = result?.data?.orders?.edges || [];
  const orders = edges.map((e) => {
    const n = e.node;

    const allocationSums = new Map();
    const liEdges = n.lineItems?.edges || [];
    liEdges.forEach((li) => {
      const allocs = li?.node?.discountAllocations || [];
      allocs.forEach((alloc) => {
        const app = alloc.discountApplication;
        if (!app) return;
        const key = app.__typename === "AutomaticDiscountApplication"
          ? `auto::${app.title}`
          : `code::${app.code}`;
        const amt = Number(alloc.allocatedAmountSet?.shopMoney?.amount || 0);
        allocationSums.set(key, (allocationSums.get(key) || 0) + amt);
      });
    });

    const apps = (n.discountApplications?.nodes || []).map((a) => {
      const key = a.__typename === "AutomaticDiscountApplication" ? `auto::${a.title}` : `code::${a.code}`;
      const amount = Number(allocationSums.get(key) || 0);
      return {
        code: a.code,
        title: a.title,
        type: a.__typename === "AutomaticDiscountApplication" ? "auto" : "code",
        amount,
      };
    });

    const dealApplications = apps
      .filter((a) => a.type === "auto")
      .map((a) => ({ id: a.title, title: a.title, type: a.type, amount: a.amount }));

    return {
      id: n.id,
      createdAt: n.createdAt,
      totalPrice: Number(n.totalPriceSet?.shopMoney?.amount || 0),
      totalDiscounts: Number(n.totalDiscountsSet?.shopMoney?.amount || 0),
      discountApplications: apps,
      dealApplications,
    };
  });

  const metrics = createDashboardMetrics({
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
