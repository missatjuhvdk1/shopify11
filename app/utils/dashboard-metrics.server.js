import { SAMPLE_ORDERS } from "../data/sample-orders.js";
import { DEFAULT_PERIOD_DAYS } from "./constants.js";
export { DEFAULT_PERIOD_DAYS } from "./constants.js";

const MILLISECONDS_IN_DAY = 24 * 60 * 60 * 1000;

const toDate = (value) => new Date(value);

const roundTo = (value, precision = 2) => {
  const multiplier = 10 ** precision;
  return Math.round((Number(value) + Number.EPSILON) * multiplier) / multiplier;
};

const clampNumber = (value) => (Number.isFinite(value) ? value : 0);

const startOfUTCDate = (value) => {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  date.setUTCHours(0, 0, 0, 0);
  return date;
};

const endOfUTCDate = (value) => {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  date.setUTCHours(23, 59, 59, 999);
  return date;
};

const daysBetweenInclusive = (start, end) => {
  const diff = end.getTime() - start.getTime();
  return Math.max(1, Math.round(diff / MILLISECONDS_IN_DAY) + 1);
};

const filterOrdersByDateRange = (orders, start, end) => {
  return orders.filter((order) => {
    const createdAt = toDate(order.createdAt);
    return createdAt >= start && createdAt <= end;
  });
};

const formatRangeLabel = (start, end) => {
  const sameDay = start.toISOString().slice(0, 10) === end.toISOString().slice(0, 10);
  if (sameDay) {
    return new Intl.DateTimeFormat("nl-NL", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(start);
  }

  const includeStartYear = start.getUTCFullYear() !== end.getUTCFullYear();
  const startFormatter = new Intl.DateTimeFormat("nl-NL", {
    month: "short",
    day: "numeric",
    ...(includeStartYear ? { year: "numeric" } : {}),
  });
  const endFormatter = new Intl.DateTimeFormat("nl-NL", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return `${startFormatter.format(start)} – ${endFormatter.format(end)}`;
};

export const resolveDateRange = ({
  startDate,
  endDate,
  referenceDate = new Date(),
  fallbackDays = DEFAULT_PERIOD_DAYS,
  maxRangeDays = 180,
} = {}) => {
  const safeFallbackDays = Math.max(1, fallbackDays);
  const safeMaxRangeDays = Math.max(safeFallbackDays, maxRangeDays);

  const now = endOfUTCDate(referenceDate) || endOfUTCDate(new Date());
  let resolvedEnd = endDate ? endOfUTCDate(endDate) : now;
  if (!resolvedEnd || Number.isNaN(resolvedEnd.getTime())) {
    resolvedEnd = now;
  }
  if (resolvedEnd > now) {
    resolvedEnd = now;
  }

  const minAllowedStart = new Date(resolvedEnd);
  minAllowedStart.setUTCDate(resolvedEnd.getUTCDate() - (safeMaxRangeDays - 1));
  minAllowedStart.setUTCHours(0, 0, 0, 0);

  let resolvedStart = startDate ? startOfUTCDate(startDate) : null;
  if (!resolvedStart || Number.isNaN(resolvedStart.getTime()) || resolvedStart > resolvedEnd) {
    resolvedStart = new Date(resolvedEnd);
    resolvedStart.setUTCDate(resolvedEnd.getUTCDate() - (safeFallbackDays - 1));
    resolvedStart.setUTCHours(0, 0, 0, 0);
  }

  if (resolvedStart < minAllowedStart) {
    resolvedStart = minAllowedStart;
  }

  const days = daysBetweenInclusive(resolvedStart, resolvedEnd);

  return { start: resolvedStart, end: resolvedEnd, days };
};

const calculateSummary = (orders) => {
  if (orders.length === 0) {
    return {
      totalOrders: 0,
      discountedOrders: 0,
      totalRevenue: 0,
      totalDiscountAmount: 0,
      averageOrderValue: 0,
      discountRate: 0,
      missedOpportunity: 0,
    };
  }

  const totals = orders.reduce(
    (acc, order) => {
      acc.totalRevenue += clampNumber(order.totalPrice);
      acc.totalDiscount += clampNumber(order.totalDiscounts);
      acc.missedOpportunity += clampNumber(order.estimatedMissedDiscount);

      if (Array.isArray(order.discountApplications) && order.discountApplications.length > 0) {
        acc.discountedOrders += 1;
      }

      return acc;
    },
    {
      totalRevenue: 0,
      totalDiscount: 0,
      discountedOrders: 0,
      missedOpportunity: 0,
    },
  );

  const averageOrderValue = roundTo(totals.totalRevenue / orders.length || 0);
  const discountRate =
    orders.length === 0 ? 0 : roundTo((totals.discountedOrders / orders.length) * 100);

  return {
    totalOrders: orders.length,
    discountedOrders: totals.discountedOrders,
    totalRevenue: roundTo(totals.totalRevenue),
    totalDiscountAmount: roundTo(totals.totalDiscount),
    averageOrderValue,
    discountRate,
    missedOpportunity: roundTo(totals.missedOpportunity),
  };
};

const buildTopDiscounts = (orders, totalRevenue) => {
  const discountMap = new Map();

  orders.forEach((order) => {
    order.discountApplications?.forEach((application) => {
      const key = application.code || application.title || application.type;
      if (!discountMap.has(key)) {
        discountMap.set(key, {
          id: key,
          code: application.code,
          title: application.title || application.code || application.type,
          type: application.type,
          redemptions: 0,
          discountGiven: 0,
          revenue: 0,
        });
      }

      const record = discountMap.get(key);
      record.redemptions += 1;
      record.discountGiven += clampNumber(application.amount);
      record.revenue += clampNumber(order.totalPrice);
    });
  });

  const discounts = Array.from(discountMap.values()).map((discount) => ({
    ...discount,
    discountGiven: roundTo(discount.discountGiven),
    revenue: roundTo(discount.revenue),
    revenueShare:
      totalRevenue === 0 ? 0 : roundTo((clampNumber(discount.revenue) / totalRevenue) * 100),
  }));

  return discounts.sort((a, b) => b.redemptions - a.redemptions);
};

const buildReferralPerformance = (orders) => {
  const referralMap = new Map();

  orders.forEach((order) => {
    if (!order.referralSource) {
      return;
    }

    if (!referralMap.has(order.referralSource)) {
      referralMap.set(order.referralSource, {
        source: order.referralSource,
        orders: 0,
        revenue: 0,
        discountAmount: 0,
      });
    }

    const record = referralMap.get(order.referralSource);
    record.orders += 1;
    record.revenue += clampNumber(order.totalPrice);
    record.discountAmount += clampNumber(order.totalDiscounts);
  });

  return Array.from(referralMap.values())
    .map((record) => ({
      ...record,
      revenue: roundTo(record.revenue),
      discountAmount: roundTo(record.discountAmount),
      averageOrderValue: roundTo(record.revenue / (record.orders || 1)),
    }))
    .sort((a, b) => b.revenue - a.revenue);
};

const buildDealPerformance = (orders) => {
  const dealMap = new Map();

  orders.forEach((order) => {
    order.dealApplications?.forEach((deal) => {
      const key = deal.id || deal.title;
      if (!dealMap.has(key)) {
        dealMap.set(key, {
          id: key,
          title: deal.title,
          type: deal.type,
          redemptions: 0,
          discountGiven: 0,
          revenue: 0,
        });
      }

      const record = dealMap.get(key);
      record.redemptions += 1;
      record.discountGiven += clampNumber(deal.amount);
      record.revenue += clampNumber(order.totalPrice);
    });
  });

  return Array.from(dealMap.values())
    .map((deal) => ({
      ...deal,
      discountGiven: roundTo(deal.discountGiven),
      revenue: roundTo(deal.revenue),
    }))
    .sort((a, b) => b.redemptions - a.redemptions);
};

const buildDailyTrend = (orders) => {
  const trendMap = new Map();

  orders.forEach((order) => {
    const dateKey = toDate(order.createdAt).toISOString().slice(0, 10);
    if (!trendMap.has(dateKey)) {
      trendMap.set(dateKey, {
        date: dateKey,
        orders: 0,
        discountedOrders: 0,
        revenue: 0,
        discountAmount: 0,
      });
    }

    const record = trendMap.get(dateKey);
    record.orders += 1;
    record.revenue += clampNumber(order.totalPrice);
    record.discountAmount += clampNumber(order.totalDiscounts);

    if (order.discountApplications?.length) {
      record.discountedOrders += 1;
    }
  });

  return Array.from(trendMap.values())
    .sort((a, b) => (a.date > b.date ? 1 : -1))
    .map((entry) => ({
      ...entry,
      revenue: roundTo(entry.revenue),
      discountAmount: roundTo(entry.discountAmount),
    }));
};

export const createDashboardMetrics = ({
  orders = SAMPLE_ORDERS,
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
  const filteredOrders = filterOrdersByDateRange(orders, start, end);
  const summary = calculateSummary(filteredOrders);

  // Derive potential revenue without discounts as a convenience value
  const potentialRevenue = roundTo(summary.totalRevenue + summary.totalDiscountAmount);

  return {
    period: {
      label: formatRangeLabel(start, end),
      start: start.toISOString(),
      end: end.toISOString(),
      days,
      orderCount: summary.totalOrders,
    },
    summary: {
      ...summary,
      potentialRevenue,
    },
    topDiscounts: buildTopDiscounts(filteredOrders, summary.totalRevenue),
    referralPerformance: buildReferralPerformance(filteredOrders),
    dealPerformance: buildDealPerformance(filteredOrders),
    trend: buildDailyTrend(filteredOrders),
  };
};

export const dashboardSampleOrders = SAMPLE_ORDERS;
