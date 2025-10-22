import { describe, expect, it } from "vitest";
import {
  DEFAULT_PERIOD_DAYS,
  createDashboardMetrics,
  dashboardSampleOrders,
} from "../app/utils/dashboard-metrics.server.js";

const REFERENCE_DATE = new Date("2025-02-28T00:00:00.000Z");

describe("createDashboardMetrics", () => {
  it("calculates summary totals for the default sample dataset", () => {
    const metrics = createDashboardMetrics({
      orders: dashboardSampleOrders,
      periodDays: DEFAULT_PERIOD_DAYS,
      referenceDate: REFERENCE_DATE,
    });

    expect(metrics.summary).toEqual({
      totalOrders: 8,
      discountedOrders: 6,
      totalRevenue: 2227.4,
      totalDiscountAmount: 198,
      averageOrderValue: 278.43,
      discountRate: 75,
      missedOpportunity: 60,
    });
  });

  it("filters orders outside of the requested period", () => {
    const metrics = createDashboardMetrics({
      orders: dashboardSampleOrders,
      periodDays: 20,
      referenceDate: REFERENCE_DATE,
    });

    expect(metrics.summary.totalOrders).toBe(2);
    expect(metrics.summary.totalRevenue).toBe(765);
  });

  it("returns top discounts sorted by redemptions", () => {
    const metrics = createDashboardMetrics({
      orders: dashboardSampleOrders,
      periodDays: DEFAULT_PERIOD_DAYS,
      referenceDate: REFERENCE_DATE,
    });

    expect(metrics.topDiscounts[0]).toMatchObject({
      title: "Welcome 10%",
      redemptions: 2,
      discountGiven: 59.54,
    });
  });

  it("includes referral and deal performance details", () => {
    const metrics = createDashboardMetrics({
      orders: dashboardSampleOrders,
      periodDays: DEFAULT_PERIOD_DAYS,
      referenceDate: REFERENCE_DATE,
    });

    const referrals = metrics.referralPerformance.map((referral) => referral.source);
    expect(referrals).toEqual([
      "INFLUENCER_JAY",
      "EMAIL_NEWSLETTER",
      "LOYALTY_PROGRAM",
    ]);

    const topDeal = metrics.dealPerformance[0];
    expect(topDeal).toMatchObject({
      id: "deal-volume-1",
      redemptions: 2,
      discountGiven: 80,
    });
  });

  it("sorts trend data chronologically", () => {
    const metrics = createDashboardMetrics({
      orders: dashboardSampleOrders,
      periodDays: DEFAULT_PERIOD_DAYS,
      referenceDate: REFERENCE_DATE,
    });

    const dates = metrics.trend.map((entry) => entry.date);
    const sortedDates = [...dates].sort();
    expect(dates).toEqual(sortedDates);
  });
});
