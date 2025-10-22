const ORDERS_QUERY = `#graphql
  query OrdersSince($first: Int!, $after: String, $query: String!) {
    orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT, reverse: false) {
      edges {
        cursor
        node {
          id
          name
          createdAt
          currentTotalPriceSet { shopMoney { amount } }
          totalDiscountsSet { shopMoney { amount } }
          discountApplications(first: 20) {
            edges {
              node {
                __typename
                value { __typename ... on MoneyV2 { amount } ... on PricingPercentageValue { percentage } }
                ... on DiscountCodeApplication { code }
                ... on ManualDiscountApplication { title description }
                ... on AutomaticDiscountApplication { title }
              }
            }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

const mapDiscountApp = (app) => {
  const t = app.__typename;
  let type = "AUTOMATIC";
  let code = null;
  let title;
  if (t === "DiscountCodeApplication") {
    type = "DISCOUNT_CODE";
    code = app.code || null;
  } else if (t === "ManualDiscountApplication") {
    type = "MANUAL";
    title = app.title || app.description || "Handmatig";
  } else if (t === "AutomaticDiscountApplication") {
    type = "AUTOMATIC";
    title = app.title || "Automatisch";
  }
  const valueType = app.value?.__typename;
  const amount = valueType === "MoneyV2" ? n(app.value.amount) : 0;
  return { type, code, title, valueType, amount };
};

export async function fetchRecentOrders(admin, { sinceISO, limit = 1000 }) {
  const pageSize = 100;
  let after = null;
  const out = [];
  const query = `created_at:>\"${sinceISO}\"`;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const resp = await admin.graphql(ORDERS_QUERY, {
      variables: { first: pageSize, after, query },
    });
    const data = await resp.json();
    const edges = data?.data?.orders?.edges || [];
    for (const { node } of edges) {
      const totalPrice = n(node.currentTotalPriceSet?.shopMoney?.amount);
      const totalDiscounts = n(node.totalDiscountsSet?.shopMoney?.amount);
      const discountApplications = (node.discountApplications?.edges || []).map((e) =>
        mapDiscountApp(e.node),
      );

      out.push({
        id: node.id,
        name: node.name,
        createdAt: node.createdAt,
        totalPrice,
        subtotalPrice: totalPrice + totalDiscounts,
        totalDiscounts,
        discountApplications,
        referralSource: null,
        dealApplications: [],
        lineItems: [],
        estimatedMissedDiscount: 0,
      });
      if (out.length >= limit) break;
    }

    if (out.length >= limit) break;
    const pageInfo = data?.data?.orders?.pageInfo;
    if (!pageInfo?.hasNextPage) break;
    after = pageInfo.endCursor;
  }

  return out;
}

export function sinceFromDays(days, referenceDate = new Date()) {
  const d = new Date(referenceDate);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}
