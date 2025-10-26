import { useMemo } from "react";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  MetricsPageLayout,
  formatCurrency,
  metricsStyles as sx,
  useMetricsController,
} from "../components/metrics-page.jsx";

export { loader } from "./app._index.jsx";

export default function ReferralsPage() {
  const { metrics: initialMetrics } = useLoaderData();
  const controller = useMetricsController(initialMetrics);
  const { metrics } = controller;

  const referralSummary = useMemo(() => {
    return (metrics.referralPerformance || []).reduce(
      (acc, item) => {
        acc.orders += item.orders || 0;
        acc.revenue += item.revenue || 0;
        acc.payout += item.payout || 0; // 30% of final checkout price
        acc.discounts += item.discountAmount || 0; // discounts applied on these orders
        return acc;
      },
      { orders: 0, revenue: 0, payout: 0, discounts: 0 },
    );
  }, [metrics.referralPerformance]);

  const avgOrderValue =
    referralSummary.orders === 0 ? 0 : referralSummary.revenue / referralSummary.orders;

  const summaryCards = [
    {
      id: "ref-revenue",
      label: "Totale omzet",
      value: formatCurrency(referralSummary.revenue),
      helpText: "Totaal omzet via referrals",
    },
    {
      id: "ref-payout",
      label: "Ambassadeur uitbetalingen",
      value: formatCurrency(referralSummary.payout),
      helpText: "Uitbetaling (30% van eindprijs)",
    },
    {
      id: "ref-avg",
      label: "Gemiddelde bestelwaarde",
      value: formatCurrency(avgOrderValue),
      helpText: "Per referral-bestelling",
    },
    {
      id: "ref-orders",
      label: "Referral-bestellingen",
      value: referralSummary.orders.toString(),
      helpText: "Bestellingen met verwijzingsbron",
    },
    {
      id: "ref-potential",
      label: "Potentiële omzet",
      value: formatCurrency(
        referralSummary.revenue + referralSummary.payout + referralSummary.discounts,
      ),
      helpText: "Zonder kortingen en referrals",
    },
  ];

  return (
    <MetricsPageLayout heading="Referrals" controller={controller} summaryCards={summaryCards}>
      <s-card padding="loose">
        <div style={sx.sectionHeader}>
          <h2>Referral-prestaties</h2>
          <span style={sx.sectionSubhead}>
            Toppartners die verkoop stimuleren binnen het geselecteerde bereik
          </span>
        </div>
        <div style={sx.tableWrap}>
          <table style={sx.table}>
            <thead style={sx.stickyHeader}>
              <tr>
                <th style={sx.th} scope="col">
                  Bron
                </th>
                <th style={sx.th} scope="col">
                  Bestellingen
                </th>
                <th style={sx.th} scope="col">
                  Omzet
                </th>
                <th style={sx.th} scope="col">
                  Referrals
                </th>
                <th style={sx.th} scope="col">
                  Gemiddelde bestelling
                </th>
              </tr>
            </thead>
            <tbody>
              {metrics.referralPerformance.map((referral) => (
                <tr key={referral.source}>
                  <td style={sx.td} data-label="Bron">
                    {referral.codes && referral.codes.length > 0 ? referral.codes : referral.source}
                  </td>
                  <td style={sx.td} data-label="Bestellingen">
                    {referral.orders}
                  </td>
                  <td style={sx.td} data-label="Omzet">
                    {formatCurrency(referral.revenue)}
                  </td>
                  <td style={sx.td} data-label="Referrals">
                    {formatCurrency(referral.payout)}
                  </td>
                  <td style={sx.td} data-label="Gemiddelde bestelling">
                    {formatCurrency(referral.averageOrderValue)}
                  </td>
                </tr>
              ))}
              {metrics.referralPerformance.length === 0 && (
                <tr>
                  <td colSpan={5} style={sx.emptyState}>
                    Geen verwijzingsactiviteit in deze periode.
                  </td>
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
