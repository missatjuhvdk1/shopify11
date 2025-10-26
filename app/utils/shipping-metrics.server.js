import { DEFAULT_PERIOD_DAYS, resolveDateRange } from "./dashboard-metrics.server.js";
import { getShippingCostForCountry } from "./shipping-costs.js";

const roundTo = (value, precision = 2) => {
  const m = 10 ** precision;
  return Math.round((Number(value) + Number.EPSILON) * m) / m;
};

export const createShippingMetrics = ({
  orders = [], // { createdAt, shippingCountryCode, shippingCountryName, totalShippingPrice }
  startDate,
  endDate,
  periodDays = DEFAULT_PERIOD_DAYS,
  referenceDate = new Date(),
  maxRangeDays = 180,
} = {}) => {
  const { start, end, days } = resolveDateRange({
    startDate,
    endDate,
    referenceDate,
    fallbackDays: periodDays,
    maxRangeDays,
  });

  // Aggregate by country
  const byCountryMap = new Map();
  let totalCharged = 0;
  let totalCost = 0;
  let ordersWithShipping = 0;

  orders.forEach((o) => {
    const code = o.shippingCountryCode || "";
    const name = o.shippingCountryName || code || "Unknown";
    const charged = Number(o.totalShippingPrice || 0);
    const perOrderCost = getShippingCostForCountry(code);

    if (!byCountryMap.has(code)) {
      byCountryMap.set(code, {
        countryCode: code,
        countryName: name,
        orders: 0,
        charged: 0,
        cost: 0,
      });
    }

    const rec = byCountryMap.get(code);
    rec.orders += 1;
    rec.charged += charged;
    rec.cost += perOrderCost;

    totalCharged += charged;
    totalCost += perOrderCost;
    if (charged > 0) ordersWithShipping += 1;
  });

  const byCountry = Array.from(byCountryMap.values())
    .map((r) => ({ ...r, charged: roundTo(r.charged), cost: roundTo(r.cost), income: roundTo(r.charged - r.cost) }))
    .sort((a, b) => b.income - a.income);

  const income = roundTo(totalCharged - totalCost);

  return {
    period: {
      label: new Intl.DateTimeFormat("nl-NL", { month: "short", day: "numeric", year: "numeric" })
        .format(new Date(start)) +
        " – " +
        new Intl.DateTimeFormat("nl-NL", { month: "short", day: "numeric", year: "numeric" }).format(new Date(end)),
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      days,
      orderCount: orders.length,
    },
    summary: {
      totalOrders: orders.length,
      ordersWithShipping,
      totalCharged: roundTo(totalCharged),
      totalCost: roundTo(totalCost),
      income,
    },
    shipments: {
      totalCharged: roundTo(totalCharged),
      totalCost: roundTo(totalCost),
      income,
      ordersWithShipping,
      byCountry,
    },
  };
};

