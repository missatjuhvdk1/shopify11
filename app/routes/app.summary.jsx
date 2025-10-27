import { useMemo, useRef, useState, useEffect } from "react";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { DEFAULT_PERIOD_DAYS, resolveDateRange } from "../utils/dashboard-metrics.server.js";
import { createFinalMetrics } from "../utils/final-metrics.server.js";
import {
  MetricsPageLayout,
  formatCurrency,
  metricsStyles as sx,
  useMetricsController,
} from "../components/metrics-page.jsx";

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  const url = new URL(request.url);
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
    query OrdersForFinalSummaryPage($first: Int!, $query: String) {
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

  return { metrics };
};

export default function SummaryPage() {
  const { metrics: initialMetrics } = useLoaderData();
  const controller = useMetricsController(initialMetrics, { fetchPath: "/api/metrics/summary" });
  const { metrics } = controller;

  const summaryCards = useMemo(
    () => [
      {
        id: "gross",
        label: "Bruto Omzet",
        value: formatCurrency(metrics.summary.bruto),
        helpText: "Voor kortingen en referrals + verzendkosten",
      },
      {
        id: "net",
        label: "Netto Omzet",
        value: formatCurrency(metrics.summary.netto),
        helpText: "Na kortingen/referrals + verzend-inkomen",
      },
    ],
    [metrics.summary],
  );

  const chartData = useMemo(
    () => metrics.trend.map((d) => ({ date: d.date, total: d.net, potential: d.gross })),
    [metrics.trend],
  );

  return (
    <MetricsPageLayout heading="Totaal" controller={controller} summaryCards={summaryCards}>
      <s-card padding="loose">
        <div style={sx.sectionHeader}>
          <h2>Omzetontwikkeling</h2>
          <span style={sx.sectionSubhead}>Bruto vs. Netto over gekozen periode</span>
        </div>
        <RevenueComparisonChart data={chartData} />
      </s-card>
    </MetricsPageLayout>
  );
}

// Local copy of the Discounts page chart for reuse
const RevenueComparisonChart = ({ data }) => {
  const svgRef = useRef(null);
  const wrapperRef = useRef(null);
  const [hoverIndex, setHoverIndex] = useState(null);
  const [hoverX, setHoverX] = useState(null);
  const [wrapperWidth, setWrapperWidth] = useState(null);

  const height = 260;
  const paddingLeft = 60;
  const paddingRight = 40;
  const paddingTop = 16;
  const paddingBottom = 40;

  // Match the Discounts chart behavior: scale to wrapper width so
  // long ranges do not get cut off by the container.
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
  const layoutWidth = Math.max(320, wrapperWidth || naturalWidth);
  const chartWidth = layoutWidth - paddingLeft - paddingRight;
  const chartHeight = height;
  const baseY = chartHeight - paddingBottom;

  const yMax = Math.max(0, ...data.map((d) => Math.max(d.total || 0, d.potential || 0)));
  const stepX = data.length > 1 ? chartWidth / (data.length - 1) : 0;

  const scaleY = (value) => {
    if (!yMax) return baseY;
    const usable = chartHeight - paddingTop - paddingBottom;
    const ratio = Math.max(0, Math.min(1, value / yMax));
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

  const ticks = yMax === 0 ? [0] : [0, Math.round(yMax / 3), Math.round((yMax * 2) / 3), Math.round(yMax)];

  const dateFormatter = new Intl.DateTimeFormat("nl-NL", { month: "short", day: "numeric" });
  const maxLabels = 7;
  const stepDays = Math.max(1, Math.ceil(data.length / maxLabels));
  const labelList = [];
  for (let i = 0; i < data.length; i += stepDays) labelList.push(i);
  if (labelList[labelList.length - 1] !== data.length - 1) labelList.push(data.length - 1);

  return (
    <div style={{ ...sx.chartContainer, position: "relative", overflowX: "hidden" }} ref={wrapperRef}>
      <svg
        ref={svgRef}
        width={layoutWidth}
        height={height}
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
      >
        {/* Axes */}
        <line x1={paddingLeft} y1={height - paddingBottom} x2={layoutWidth - paddingRight} y2={height - paddingBottom} stroke="#d9dce0" />
        <line x1={paddingLeft} y1={paddingTop} x2={paddingLeft} y2={height - paddingBottom} stroke="#d9dce0" />

        {/* Grid + ticks */}
        {ticks.map((t, i) => {
          const y = paddingTop + (1 - (yMax ? t / yMax : 0)) * (height - paddingTop - paddingBottom);
          return (
            <g key={`tick-${i}`}>
              <line x1={paddingLeft} x2={layoutWidth - paddingRight} y1={y} y2={y} stroke="#f0f2f4" />
              <text x={paddingLeft - 8} y={y + 4} textAnchor="end" fontSize="11" fill="#5c5f62">
                {formatCurrency(t)}
              </text>
            </g>
          );
        })}

        {/* Potential (Gross) area + line */}
        <path d={(() => {
          if (points.length === 0) return "";
          if (points.length === 1) {
            const { x, potentialY } = points[0];
            return `M ${x} ${height - paddingBottom} L ${x} ${potentialY} L ${x + 1} ${potentialY} L ${x + 1} ${height - paddingBottom} Z`;
          }
          const firstX = points[0].x;
          const lastX = points[points.length - 1].x;
          const linePath = potentialPath;
          return `${linePath} L ${lastX} ${height - paddingBottom} L ${firstX} ${height - paddingBottom} Z`;
        })()} fill="#e3f1ff" />
        <path d={potentialPath} stroke="#1f73ff" strokeWidth="2" fill="none" />

        {/* Total (Net) line */}
        <path d={totalPath} stroke="#34a853" strokeWidth="2" fill="none" />

        {/* Hover */}
        {hoverIndex !== null && points[hoverIndex] && (
          <g>
            <line x1={hoverX} x2={hoverX} y1={paddingTop} y2={height - paddingBottom} stroke="#aeb4b9" strokeDasharray="4 3" />
            <circle cx={hoverX} cy={points[hoverIndex].totalY} r="4" fill="#34a853" stroke="#ffffff" strokeWidth="1.5" />
            <circle cx={hoverX} cy={points[hoverIndex].potentialY} r="4" fill="#1f73ff" stroke="#ffffff" strokeWidth="1.5" />
          </g>
        )}
      
        {/* X-axis labels */}
        {labelList.map((i) => (
          <text
            key={`lbl-${i}`}
            x={paddingLeft + i * (stepX || 0)}
            y={height - 6}
            textAnchor="middle"
            fontSize="11"
            fill="#5c5f62"
          >
            {dateFormatter.format(new Date(`${data[i].date}T00:00:00Z`))}
          </text>
        ))}
      </svg>

      {/* Tooltip */}
      {hoverIndex !== null && points[hoverIndex] && data[hoverIndex] && (
        (() => {
          const p = points[hoverIndex];
          const dataPoint = data[hoverIndex];
          const tooltipWidth = 220;
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
              <div style={{ color: "#1f73ff", marginBottom: 2 }}>Bruto: {formatCurrency(dataPoint.potential)}</div>
              <div style={{ color: "#34a853" }}>Netto: {formatCurrency(dataPoint.total)}</div>
            </div>
          );
        })()
      )}
    </div>
  );
};

export const headers = (headersArgs) => boundary.headers(headersArgs);
