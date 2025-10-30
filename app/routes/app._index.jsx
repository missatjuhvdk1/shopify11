/* eslint-disable react/prop-types */
import { useMemo, useEffect, useRef, useState } from "react";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { withCache } from "../utils/cache.server.js";
import { DEFAULT_PERIOD_DAYS } from "../utils/constants.js";
import {
  createDashboardMetrics,
  resolveDateRange,
} from "../utils/dashboard-metrics.server.js";
import {
  MetricsPageLayout,
  formatCurrencyEUR as formatCurrency,
  formatPercent,
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
    query OrdersForMetrics($first: Int!, $query: String, $after: String) {
      orders(first: $first, query: $query, sortKey: CREATED_AT, reverse: true, after: $after) {
        edges {
          cursor
          node {
            id
            createdAt
            tags
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
        pageInfo { hasNextPage endCursor }
      }
    }
  `;
  const cacheKey = `orders:overview:${shopId}:${start.toISOString()}:${end.toISOString()}`;
  const { value: orders } = await withCache(
    cacheKey,
    async () => {
      let after = null;
      let edges = [];
      for (let i = 0; i < 10; i += 1) {
        const resp = await admin.graphql(query, {
          variables: { first: 250, query: createdFilter, after },
        });
        const result = await resp.json();
        const page = result?.data?.orders;
        if (!page) break;
        edges = edges.concat(page.edges || []);
        if (!page.pageInfo?.hasNextPage) break;
        after = page.pageInfo.endCursor;
      }
      return edges.map((e) => {
        const n = e.node;

        // Sum allocated discount amounts per discount application
        const allocationSums = new Map();
        const liEdges = n.lineItems?.edges || [];
        liEdges.forEach((li) => {
          const allocs = li?.node?.discountAllocations || [];
          allocs.forEach((alloc) => {
            const app = alloc.discountApplication;
            if (!app) return;
            const key =
              app.__typename === "AutomaticDiscountApplication" ? `auto::${app.title}` : `code::${app.code}`;
            const amt = Number(alloc.allocatedAmountSet?.shopMoney?.amount || 0);
            allocationSums.set(key, (allocationSums.get(key) || 0) + amt);
          });
        });

        const apps = (n.discountApplications?.nodes || []).map((a) => {
          const key =
            a.__typename === "AutomaticDiscountApplication" ? `auto::${a.title}` : `code::${a.code}`;
          const amount = Number(allocationSums.get(key) || 0);
          return {
            code: a.code,
            title: a.title,
            type: a.__typename === "AutomaticDiscountApplication" ? "auto" : "code",
            amount,
          };
        });

        // Treat automatic discounts as deals for the "Deal performance" table
        const dealApplications = apps
          .filter((a) => a.type === "auto")
          .map((a) => ({ id: a.title, title: a.title, type: a.type, amount: a.amount }));

        // Referral detection: tag of form "Referral - ...". Payout = 30% of final price
        const referralTag = (n.tags || []).find((t) => typeof t === "string" && t.startsWith("Referral - "));
        const referralSource = referralTag ? referralTag.replace(/^Referral -\s*/, "").trim() : null;

        const totalPrice = Number(n.totalPriceSet?.shopMoney?.amount || 0);
        const totalDiscounts = Number(n.totalDiscountsSet?.shopMoney?.amount || 0);

        return {
          id: n.id,
          createdAt: n.createdAt,
          totalPrice,
          totalDiscounts,
          discountApplications: apps,
          dealApplications,
          isReferral: Boolean(referralSource),
          referralSource: referralSource || undefined,
          referralPayout: referralSource ? totalPrice * 0.3 : 0,
        };
      });
    },
  );

  const metrics = createDashboardMetrics({
    orders,
    startDate: start,
    endDate: end,
    periodDays: days,
    referenceDate: end,
  });

  return { metrics };
};

export default function DiscountsPage() {
  const { metrics: initialMetrics } = useLoaderData();
  const controller = useMetricsController(initialMetrics);
  const { metrics } = controller;

  const summaryCards = useMemo(
    () => [
      {
        id: "totalRevenue",
        label: "Totale omzet",
        value: formatCurrency(
          Math.max(0, metrics.summary.totalRevenue - metrics.summary.referralPayoutTotal),
        ),
        helpText: "Netto (na referral-uitbetalingen)",
      },
      {
        id: "totalDiscountAmount",
        label: "Gegeven kortingen",
        value: formatCurrency(metrics.summary.totalDiscountAmount),
        helpText: `${metrics.summary.discountedOrders} bestellingen`,
      },
      {
        id: "averageOrderValue",
        label: "Gemiddelde bestelwaarde",
        value: formatCurrency(metrics.summary.averageOrderValue),
        helpText: `${metrics.summary.totalOrders} bestellingen in periode`,
      },
      {
        id: "totalDiscountedOrders",
        label: "Totale Kortingen",
        value: String(metrics.summary.discountedOrders),
        helpText: "Bestellingen met een toegepaste korting",
      },
      {
        id: "profitPotential",
        label: "Potentiële omzet",
        value: formatCurrency(metrics.summary.potentialRevenue),
        helpText: "Zonder kortingen en referrals",
      },
    ],
    [metrics.summary],
  );

  const trendData = useMemo(
    () =>
      (metrics.trend || []).map((entry) => ({
        date: entry.date,
        // Actual: net after referral payouts
        total: Math.max(0, entry.revenue - (entry.payoutAmount || 0)),
        // Potential: before discounts and referral payouts
        potential: entry.revenue + entry.discountAmount + (entry.payoutAmount || 0),
      })),
    [metrics.trend],
  );

  return (
    <MetricsPageLayout heading="Discounts" controller={controller} summaryCards={summaryCards}>
      <s-card padding="loose" style={{ marginBottom: 16 }}>
        <div style={sx.sectionHeader}>
          <h2>Omzetontwikkeling</h2>
          <span style={sx.sectionSubhead}>
            Vergelijk potentiële omzet zonder kortingen met gerealiseerde omzet
          </span>
        </div>
        <RevenueComparisonChart data={trendData} />
      </s-card>

      <div style={sx.sectionGrid}>
        <s-card padding="loose">
          <div style={sx.sectionHeader}>
            <h2>Top inwisselprestaties</h2>
            <span style={sx.sectionSubhead}>Kortingen en bundels op basis van inwisselingen</span>
          </div>
          <div style={sx.tableWrap}>
            <table style={sx.table}>
              <thead style={sx.stickyHeader}>
                <tr>
                  <th style={sx.th} scope="col">
                    Code
                  </th>
                  <th style={sx.th} scope="col">
                    Type
                  </th>
                  <th style={sx.th} scope="col">
                    Inwisselingen
                  </th>
                  <th style={sx.th} scope="col">
                    Omzet
                  </th>
                  <th style={{ ...sx.th, ...sx.thNowrap }} scope="col">
                    Gegeven korting
                  </th>
                </tr>
              </thead>
              <tbody>
                {metrics.topDiscounts.map((discount) => (
                  <tr key={discount.id}>
                    <td style={sx.td} data-label="Code">
                      {discount.title}
                    </td>
                    <td style={sx.td} data-label="Type">
                      <span style={sx.badge}>{discount.type}</span>
                    </td>
                    <td style={sx.td} data-label="Inwisselingen">
                      {discount.redemptions}
                    </td>
                    <td style={sx.td} data-label="Omzet">
                      {formatCurrency(discount.revenue)}
                    </td>
                    <td style={sx.td} data-label="Gegeven korting">
                      {formatCurrency(discount.discountGiven)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </s-card>

        <s-card padding="loose">
          <div style={sx.sectionHeader}>
            <h2>Kortingsprestaties</h2>
            <span style={sx.sectionSubhead}>Alleen kortingscodes</span>
          </div>
          <div style={sx.tableWrap}>
            <table style={sx.table}>
              <thead style={sx.stickyHeader}>
                <tr>
                  <th style={sx.th} scope="col">
                    Code
                  </th>
                  <th style={sx.th} scope="col">
                    Inwisselingen
                  </th>
                  <th style={sx.th} scope="col">
                    Omzet
                  </th>
                  <th style={{ ...sx.th, ...sx.thNowrap }} scope="col">
                    Gegeven korting
                  </th>
                </tr>
              </thead>
              <tbody>
                {metrics.topDiscounts
                  .filter((d) => d.type === "code")
                  .map((discount) => (
                    <tr key={`code-${discount.id}`}>
                      <td style={sx.td} data-label="Code">
                        {discount.title}
                      </td>
                      <td style={sx.td} data-label="Inwisselingen">
                        {discount.redemptions}
                      </td>
                      <td style={sx.td} data-label="Omzet">
                        {formatCurrency(discount.revenue)}
                      </td>
                      <td style={sx.td} data-label="Gegeven korting">
                        {formatCurrency(discount.discountGiven)}
                      </td>
                    </tr>
                  ))}
                {metrics.topDiscounts.filter((d) => d.type === "code").length === 0 && (
                  <tr>
                    <td colSpan={4} style={sx.emptyState}>
                      Geen kortingscodes gebruikt in deze periode.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </s-card>

        <s-card padding="loose">
          <div style={sx.sectionHeader}>
            <h2>Bundelprestaties</h2>
            <span style={sx.sectionSubhead}>Automatische promoties (bundels)</span>
          </div>
          <div style={sx.tableWrap}>
            <table style={sx.table}>
              <thead style={sx.stickyHeader}>
                <tr>
                  <th style={sx.th} scope="col">
                    Aanbieding
                  </th>
                  <th style={sx.th} scope="col">
                    Type
                  </th>
                  <th style={sx.th} scope="col">
                    Inwisselingen
                  </th>
                  <th style={sx.th} scope="col">
                    Omzet
                  </th>
                  <th style={{ ...sx.th, ...sx.thNowrap }} scope="col">
                    Gegeven korting
                  </th>
                </tr>
              </thead>
              <tbody>
                {metrics.dealPerformance.map((deal) => (
                  <tr key={deal.id}>
                    <td style={sx.td} data-label="Aanbieding">
                      {deal.title}
                    </td>
                    <td style={sx.td} data-label="Type">
                      <span style={sx.badge}>{deal.type}</span>
                    </td>
                    <td style={sx.td} data-label="Inwisselingen">
                      {deal.redemptions}
                    </td>
                    <td style={sx.td} data-label="Omzet">
                      {formatCurrency(deal.revenue)}
                    </td>
                    <td style={sx.td} data-label="Gegeven korting">
                      {formatCurrency(deal.discountGiven)}
                    </td>
                  </tr>
                ))}
                {metrics.dealPerformance.length === 0 && (
                  <tr>
                    <td colSpan={5} style={sx.emptyState}>
                      Geen dealactiviteit voor de geselecteerde periode.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </s-card>
      </div>
    </MetricsPageLayout>
  );
}

const RevenueComparisonChart = ({ data }) => {
  if (!Array.isArray(data) || data.length === 0) {
    return (
      <div style={sx.emptyState}>
        Nog geen omzetactiviteit voor dit bereik. Pas de filter aan of probeer een langere periode.
      </div>
    );
  }

  const chartHeight = 300;
  const paddingTop = 24;
  const paddingBottom = 80; // extra room for rotated date labels
  const paddingLeft = 70;
  const paddingRight = 40;

  const wrapperRef = useRef(null);
  const svgRef = useRef(null);
  const [wrapperWidth, setWrapperWidth] = useState(null);
  const [hoverIndex, setHoverIndex] = useState(null);
  const [hoverX, setHoverX] = useState(null);
  useEffect(() => {
    if (!wrapperRef.current) return;
    const el = wrapperRef.current;
    const update = () => setWrapperWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const daysCount = Math.max(1, data.length);
  const perDay = daysCount <= 14 ? 70 : daysCount <= 30 ? 38 : daysCount <= 60 ? 24 : 14;
  const plotWidth = Math.max(1, daysCount - 1);
  const naturalWidth = Math.max(640, paddingLeft + paddingRight + plotWidth * perDay);
  // Make the chart always fit the wrapper (no horizontal scroll) while
  // keeping text at a constant size by avoiding SVG viewBox scaling.
  const layoutWidth = Math.max(320, wrapperWidth || naturalWidth);
  const stepX = data.length > 1 ? (layoutWidth - paddingLeft - paddingRight) / (data.length - 1) : 0;
  const baseY = chartHeight - paddingBottom;

  const allValues = data.flatMap((p) => [p.total, p.potential]);
  const rawMax = Math.max(...allValues, 0);

  const niceMax = (v) => {
    if (v <= 0) return 0;
    const pow10 = Math.pow(10, Math.floor(Math.log10(v)));
    const scaled = Math.ceil(v / pow10);
    return scaled * pow10;
  };
  const maxValue = niceMax(rawMax * 1.05); // small headroom

  const scaleY = (value) => {
    if (!maxValue) return baseY;
    const usable = chartHeight - paddingTop - paddingBottom;
    const ratio = Math.max(0, Math.min(1, value / maxValue));
    return paddingTop + (1 - ratio) * usable;
  };

  const points = data.map((point, index) => {
    const x = paddingLeft + index * stepX;
    return {
      x,
      date: point.date,
      totalY: scaleY(point.total),
      potentialY: scaleY(point.potential),
    };
  });

  const buildMonotonePath = (yKey) => {
    if (points.length === 1) {
      const { x } = points[0];
      const y = points[0][yKey];
      return `M ${x} ${y} L ${x + 1} ${y}`;
    }

    const series = points.map((p) => ({ x: p.x, y: p[yKey] }));
    const slopes = [];
    for (let i = 0; i < series.length - 1; i += 1) {
      const dx = series[i + 1].x - series[i].x;
      const dy = series[i + 1].y - series[i].y;
      slopes.push(dx === 0 ? 0 : dy / dx);
    }

    const tangents = new Array(series.length).fill(0);
    if (slopes.length > 0) {
      tangents[0] = slopes[0];
      for (let i = 1; i < series.length - 1; i += 1) {
        tangents[i] = (slopes[i - 1] + slopes[i]) / 2;
      }
      tangents[series.length - 1] = slopes[slopes.length - 1];

      for (let i = 0; i < slopes.length; i += 1) {
        if (slopes[i] === 0) {
          tangents[i] = 0;
          tangents[i + 1] = 0;
          continue;
        }
        const a = tangents[i] / slopes[i];
        const b = tangents[i + 1] / slopes[i];
        const s = a * a + b * b;
        if (s > 9) {
          const tau = 3 / Math.sqrt(s);
          tangents[i] = tau * a * slopes[i];
          tangents[i + 1] = tau * b * slopes[i];
        }
      }
    }

    let path = `M ${series[0].x} ${series[0].y}`;
    for (let i = 0; i < series.length - 1; i += 1) {
      const p0 = series[i];
      const p1 = series[i + 1];
      const dx = p1.x - p0.x;
      const c1x = p0.x + dx / 3;
      const c1y = p0.y + (tangents[i] * dx) / 3;
      const c2x = p1.x - dx / 3;
      const c2y = p1.y - (tangents[i + 1] * dx) / 3;
      path += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${p1.x} ${p1.y}`;
    }
    return path;
  };

  const buildAreaPath = (yKey) => {
    if (points.length === 1) {
      const { x } = points[0];
      const y = points[0][yKey];
      return `M ${x} ${baseY} L ${x} ${y} L ${x + 1} ${y} L ${x + 1} ${baseY} Z`;
    }
    const linePath = buildMonotonePath(yKey);
    const firstX = points[0].x;
    const lastX = points[points.length - 1].x;
    return `${linePath} L ${lastX} ${baseY} L ${firstX} ${baseY} Z`;
  };

  const ticks =
    maxValue === 0
      ? [0]
      : [0, Math.round(maxValue / 3), Math.round((maxValue * 2) / 3), Math.round(maxValue)];

  const dateFormatter = new Intl.DateTimeFormat("nl-NL", { month: "short", day: "numeric" });
  // Generate day labels at a fixed cadence to avoid "random" skips.
  // We target at most 7 labels and step by whole days.
  const maxLabels = 7;
  const stepDays = Math.max(1, Math.ceil(data.length / maxLabels));
  const labelList = [];
  for (let i = 0; i < data.length; i += stepDays) {
    labelList.push(i);
  }
  if (labelList[labelList.length - 1] !== data.length - 1) {
    labelList.push(data.length - 1);
  }

  const totalPath = buildMonotonePath("totalY");
  const potentialPath = buildMonotonePath("potentialY");

  const onMouseMove = (e) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const scrollLeft = wrapperRef.current ? wrapperRef.current.scrollLeft : 0;
    const x = e.clientX - rect.left + scrollLeft; // svg coord
    const clampedX = Math.max(paddingLeft, Math.min(layoutWidth - paddingRight, x));
    if (stepX === 0) {
      setHoverIndex(0);
      setHoverX(points[0].x);
      return;
    }
    const index = Math.round((clampedX - paddingLeft) / stepX);
    const safeIndex = Math.max(0, Math.min(points.length - 1, index));
    setHoverIndex(safeIndex);
    setHoverX(paddingLeft + safeIndex * stepX);
  };

  const onMouseLeave = () => {
    setHoverIndex(null);
    setHoverX(null);
  };

  return (
    <div style={{ ...sx.chartContainer, position: "relative", overflowX: "hidden" }} ref={wrapperRef}>
      <svg
        ref={svgRef}
        width={layoutWidth}
        height={chartHeight}
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
      >
        <defs>
          <linearGradient id="fill-actual" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#754FFE" stopOpacity="0.20" />
            <stop offset="95%" stopColor="#754FFE" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="fill-potential" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#FFB743" stopOpacity="0.20" />
            <stop offset="95%" stopColor="#FFB743" stopOpacity="0" />
          </linearGradient>
        </defs>

        {ticks.map((tick) => {
          const y = scaleY(tick);
          return (
            <g key={`tick-${tick}`}>
              <line
                x1={paddingLeft}
                x2={layoutWidth - paddingRight}
                y1={y}
                y2={y}
                stroke="#dfe3e8"
                strokeDasharray="4 4"
                strokeWidth="1"
              />
              <text x={paddingLeft - 12} y={y + 4} fontSize="11" textAnchor="end" fill="#5c5f62">
                {formatCurrency(tick)}
              </text>
            </g>
          );
        })}

        {/* Areas and lines */}
        <path d={buildAreaPath("potentialY")} fill="url(#fill-potential)" stroke="none" />
        <path d={buildAreaPath("totalY")} fill="url(#fill-actual)" stroke="none" />
        <path d={potentialPath} fill="none" stroke="#FFB743" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <path d={totalPath} fill="none" stroke="#754FFE" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

        {/* X-axis date labels inside SVG */}
        {labelList.map((index) => {
          const p = points[index];
          const labelY = baseY + 26;
          const text = dateFormatter.format(new Date(`${p.date}T00:00:00Z`));
          return (
            <g key={`xlab-${p.date}`}>
              <text
                x={p.x}
                y={labelY}
                fontSize="12"
                fill="#5c5f62"
                transform={`rotate(45 ${p.x} ${labelY})`}
                textAnchor="start"
              >
                {text}
              </text>
            </g>
          );
        })}

        {/* Hover guide */}
        {hoverIndex !== null && points[hoverIndex] && (
          <g>
            <line
              x1={hoverX}
              x2={hoverX}
              y1={paddingTop}
              y2={baseY}
              stroke="#c9ccd0"
              strokeWidth="1"
            />
            <circle cx={hoverX} cy={points[hoverIndex].totalY} r="4" fill="#754FFE" stroke="#ffffff" strokeWidth="1.5" />
            <circle cx={hoverX} cy={points[hoverIndex].potentialY} r="4" fill="#FFB743" stroke="#ffffff" strokeWidth="1.5" />
          </g>
        )}
      </svg>

      {/* Tooltip */}
      {hoverIndex !== null && points[hoverIndex] && data[hoverIndex] && (
        (() => {
          const p = points[hoverIndex];
          const dataPoint = data[hoverIndex];
          const tooltipWidth = 220;
          // Push tooltip farther from the cursor/markers for clarity
          const offset = 35;
          const leftPreferred = (hoverX || 0) + offset;
          const leftAlt = (hoverX || 0) - tooltipWidth - offset;
          const maxLeft = layoutWidth - paddingRight - tooltipWidth;
          const left = Math.min(Math.max(leftPreferred, paddingLeft), maxLeft);
          const useAlt = leftPreferred > maxLeft;
          const finalLeft = useAlt ? Math.max(leftAlt, paddingLeft) : left;
          const top = paddingTop + 18;
          const dateLabel = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "long", year: "numeric" }).format(
            new Date(`${p.date}T00:00:00Z`),
          );
          return (
            <div
              style={{
                position: "absolute",
                left: finalLeft,
                top,
                width: tooltipWidth,
                background: "#ffffff",
                border: "1px solid #e1e4e8",
                borderRadius: 8,
                boxShadow: "0 8px 20px rgba(0,0,0,0.08)",
                padding: 12,
                pointerEvents: "none",
                fontSize: 13,
                color: "#202223",
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 6 }}>{dateLabel}</div>
              <div style={{ color: "#FFB743", marginBottom: 2 }}>Potentieel: {formatCurrency(dataPoint.potential)}</div>
              <div style={{ color: "#754FFE" }}>Gerealiseerd: {formatCurrency(dataPoint.total)}</div>
            </div>
          );
        })()
      )}

      <div style={{ display: "flex", gap: 16, marginTop: 12 }}>
        <LegendPill color="#754FFE" label="Gerealiseerd" />
        <LegendPill color="#FFB743" label="Potentieel" />
      </div>
    </div>
  );
};

const LegendPill = ({ color, label }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, color: "#202223" }}>
    <span style={{ width: 12, height: 12, borderRadius: 999, backgroundColor: color, display: "inline-block" }} />
    {label}
  </span>
);

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
