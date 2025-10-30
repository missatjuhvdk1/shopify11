import { resolveDateRange } from "./dashboard-metrics.server.js";
import { getShippingCostForCountry } from "./shipping-costs.js";

const roundTo = (value, precision = 2) => {
  const m = 10 ** precision;
  return Math.round((Number(value) + Number.EPSILON) * m) / m;
};

const toDateKey = (iso) => new Date(iso).toISOString().slice(0, 10);

export const createFinalMetrics = ({
  orders = [], // with: createdAt, totalPrice, totalDiscounts, referralPayout, shippingCountryCode, totalShippingPrice, productCost?
  startDate,
  endDate,
  periodDays,
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

  let grossTotal = 0;
  let netTotal = 0;
  let totalDiscounts = 0;
  let totalReferralPayout = 0;
  let totalShippingCharged = 0;
  let totalShippingCost = 0;
  let totalProductCost = 0;

  const trendMap = new Map();

  const ensureTrend = (key) => {
    if (!trendMap.has(key)) {
      trendMap.set(key, { date: key, gross: 0, net: 0 });
    }
    return trendMap.get(key);
  };

  orders.forEach((o) => {
    const discounts = Number(o.totalDiscounts || 0);
    const price = Number(o.totalPrice || 0);
    const payout = Number(o.referralPayout || 0);
    const shipCharged = Number(o.totalShippingPrice || 0);
    const shipCost = getShippingCostForCountry(o.shippingCountryCode);
    const prodCost = Number(o.productCost || 0);

    // Gross: before discounts and referral payouts, plus shipping charged
    // -> price + discounts + payout + shipCharged
    const gross = price + discounts + payout + shipCharged;

    // Net: realized revenue minus referral payout and product costs + shipping income (charged - cost)
    // -> (price - payout - prodCost) + (shipCharged - shipCost)
    const net = price - payout - prodCost + (shipCharged - shipCost);

    grossTotal += gross;
    netTotal += net;
    totalDiscounts += discounts;
    totalReferralPayout += payout;
    totalShippingCharged += shipCharged;
    totalShippingCost += shipCost;
    totalProductCost += prodCost;

    const key = toDateKey(o.createdAt);
    const t = ensureTrend(key);
    t.gross += gross;
    t.net += net;
  });

  // Fill empty dates in range
  const cursor = new Date(start);
  cursor.setUTCHours(0, 0, 0, 0);
  const endDay = new Date(end);
  endDay.setUTCHours(0, 0, 0, 0);
  while (cursor.getTime() <= endDay.getTime()) {
    const key = cursor.toISOString().slice(0, 10);
    ensureTrend(key);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const trend = Array.from(trendMap.values())
    .sort((a, b) => (a.date > b.date ? 1 : -1))
    .map((d) => ({
      date: d.date,
      gross: roundTo(d.gross),
      net: roundTo(d.net),
    }));

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
      bruto: roundTo(grossTotal),
      netto: roundTo(netTotal),
      totalOrders: orders.length,
      totalDiscounts: roundTo(totalDiscounts),
      totalReferralPayout: roundTo(totalReferralPayout),
      totalShippingCharged: roundTo(totalShippingCharged),
      totalShippingCost: roundTo(totalShippingCost),
      totalProductCost: roundTo(totalProductCost),
    },
    trend,
  };
};
