import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { DEFAULT_PERIOD_DAYS } from "../utils/constants.js";
import {
  createDashboardMetrics,
  resolveDateRange,
} from "../utils/dashboard-metrics.server.js";
// Inline styles to avoid CSS module SSR parsing issues
const sx = {
  controls: {
    display: "flex",
    flexWrap: "wrap",
    gap: 12,
    alignItems: "center",
    marginBottom: 16,
  },
  controlItem: { display: "flex", flexDirection: "column", fontSize: 13 },
  label: { color: "#5c5f62", marginBottom: 4, fontWeight: 500 },
  dateControl: { position: "relative", minWidth: 220 },
  dateTrigger: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 12px",
    border: "1px solid #c9ccd0",
    borderRadius: 8,
    fontSize: 14,
    backgroundColor: "#ffffff",
    cursor: "pointer",
    minHeight: 40,
  },
  dateTriggerIcon: { width: 16, height: 16, flexShrink: 0, color: "#1f73ff" },
  dateTriggerLabel: { color: "#202223", fontWeight: 500 },
  datePicker: {
    position: "absolute",
    top: "100%",
    left: 0,
    zIndex: 20,
    marginTop: 8,
    padding: 16,
    backgroundColor: "#ffffff",
    borderRadius: 12,
    border: "1px solid #c9ccd0",
    boxShadow: "0 16px 32px rgba(0, 0, 0, 0.12)",
    width: 280,
  },
  calendarHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  calendarTitle: { fontWeight: 600, fontSize: 16, color: "#202223" },
  calendarNavButton: {
    border: "1px solid #c9ccd0",
    backgroundColor: "#f6f7f8",
    borderRadius: 8,
    width: 32,
    height: 32,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
  },
  calendarNavButtonDisabled: { opacity: 0.4, cursor: "not-allowed" },
  weekdayRow: {
    display: "grid",
    gridTemplateColumns: "repeat(7, 1fr)",
    gap: 4,
    marginBottom: 8,
    fontSize: 12,
    color: "#5c5f62",
    fontWeight: 600,
    textAlign: "center",
  },
  calendarGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(7, 1fr)",
    gap: 4,
  },
  calendarCell: {
    height: 36,
    borderRadius: 8,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 13,
    cursor: "pointer",
  },
  calendarCellEmpty: { cursor: "default" },
  calendarCellDisabled: { color: "#b5b8bb", cursor: "not-allowed" },
  calendarCellInRange: { backgroundColor: "#e3f1ff", color: "#1f3b71" },
  calendarCellSelected: { backgroundColor: "#1f73ff", color: "#ffffff" },
  calendarCellEdge: { borderRadius: 12 },
  calendarFooter: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 12,
    gap: 12,
  },
  calendarFooterText: { fontSize: 12, color: "#5c5f62" },
  calendarFooterActions: { display: "flex", gap: 8 },
  tertiaryButton: {
    border: "1px solid #c9ccd0",
    backgroundColor: "#ffffff",
    borderRadius: 8,
    padding: "6px 12px",
    fontSize: 13,
    cursor: "pointer",
  },
  primaryButton: {
    border: "none",
    background: "linear-gradient(180deg, #3574f2 0%, #2858d6 100%)",
    color: "#ffffff",
    borderRadius: 8,
    padding: "6px 16px",
    fontSize: 13,
    cursor: "pointer",
  },
  primaryButtonDisabled: { opacity: 0.4, cursor: "not-allowed" },
  periodMeta: { color: "#5c5f62", fontSize: 14 },
  metricGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 12,
    marginBottom: 16,
  },
  metricCard: { display: "flex", flexDirection: "column", gap: 4 },
  metricLabel: { fontSize: 14, color: "#5c5f62", textTransform: "uppercase" },
  metricValue: { fontSize: 24, fontWeight: 600 },
  metricHelp: { fontSize: 13, color: "#5c5f62" },
  sectionGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
    gap: 16,
  },
  sectionHeader: { display: "flex", flexDirection: "column", gap: 4, marginBottom: 12 },
  sectionSubhead: { color: "#5c5f62", fontSize: 14 },
  tableWrap: {
    position: "relative",
    maxHeight: 240, // ~3 rows + header (adjust as needed)
    overflowY: "auto",
    borderRadius: 8,
    border: "1px solid #e1e4e8",
  },
  stickyHeader: {
    position: "sticky",
    top: 0,
    zIndex: 1,
  },
  table: { width: "100%", borderCollapse: "collapse" },
  th: { fontWeight: 600, color: "#202223", backgroundColor: "#f6f7f8", padding: "8px 12px", textAlign: "left", borderBottom: "1px solid #e1e4e8" },
  thNowrap: { whiteSpace: "nowrap" },
  td: { padding: "8px 12px", textAlign: "left", borderBottom: "1px solid #e1e4e8", fontSize: 14 },
  badge: { display: "inline-flex", alignItems: "center", padding: "2px 8px", borderRadius: 999, backgroundColor: "#f0f1f3", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.4 },
  emptyState: { textAlign: "center", padding: "20px 0", color: "#5c5f62", fontStyle: "italic" },
};

const MAX_RANGE_DAYS = 180;
const WEEKDAYS = ["Ma", "Di", "Wo", "Do", "Vr", "Za", "Zo"];

const startOfUTCMonth = (value) => {
  const date = new Date(value);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(1);
  return date;
};

const addMonths = (value, step) => {
  const date = startOfUTCMonth(value);
  date.setUTCMonth(date.getUTCMonth() + step);
  return date;
};

const normalizeDate = (value) => {
  const date = new Date(value);
  date.setUTCHours(0, 0, 0, 0);
  return date;
};

const getDateKey = (value) => normalizeDate(value).getTime();

const buildCalendarDays = (month) => {
  const start = startOfUTCMonth(month);
  const leading = (start.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
  const days = [];

  for (let i = 0; i < leading; i += 1) {
    days.push(null);
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    days.push(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), day)));
  }

  while (days.length % 7 !== 0) {
    days.push(null);
  }

  return days;
};

const formatMonthTitle = (value) =>
  new Intl.DateTimeFormat("nl-NL", { month: "long", year: "numeric" }).format(value);

const formatRangeForDisplay = (start, end) => {
  const sameDay = getDateKey(start) === getDateKey(end);
  if (sameDay) {
    return new Intl.DateTimeFormat("nl-NL", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(start);
  }

  const includeYear = start.getUTCFullYear() !== end.getUTCFullYear();
  const startFormatter = new Intl.DateTimeFormat("nl-NL", {
    month: "short",
    day: "numeric",
    ...(includeYear ? { year: "numeric" } : {}),
  });
  const endFormatter = new Intl.DateTimeFormat("nl-NL", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return `${startFormatter.format(start)} – ${endFormatter.format(end)}`;
};

const normalizeRangeOrder = (range) => {
  const startKey = getDateKey(range.start);
  const endKey = getDateKey(range.end);
  if (startKey <= endKey) {
    return {
      start: normalizeDate(range.start),
      end: normalizeDate(range.end),
    };
  }

  return {
    start: normalizeDate(range.end),
    end: normalizeDate(range.start),
  };
};

const renderCalendarIcon = () => (
  <svg style={sx.dateTriggerIcon} viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path
      fill="currentColor"
      d="M6 1a1 1 0 0 1 1 1v1h6V2a1 1 0 1 1 2 0v1h1a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H4a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3h1V2a1 1 0 0 1 1-1Zm9 6H5a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1Z"
    />
  </svg>
);

const renderChevronIcon = (direction) => (
  <svg viewBox="0 0 16 16" width="12" height="12" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    {direction === "left" ? (
      <path
        fill="currentColor"
        d="M9.78 3.22a.75.75 0 0 1 0 1.06L6.06 8l3.72 3.72a.75.75 0 1 1-1.06 1.06L4.97 8.03a.75.75 0 0 1 0-1.06l3.75-3.75a.75.75 0 0 1 1.06 0Z"
      />
    ) : (
      <path
        fill="currentColor"
        d="M6.22 12.78a.75.75 0 0 1 0-1.06L9.94 8 6.22 4.28a.75.75 0 0 1 1.06-1.06l3.75 3.75a.75.75 0 0 1 0 1.06l-3.75 3.75a.75.75 0 0 1-1.06 0Z"
      />
    )}
  </svg>
);

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

    // Sum allocated discount amounts per discount application
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

    // Treat automatic discounts as deals for the "Deal performance" table
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

  return { metrics };
};

const formatCurrency = (value) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value || 0);

const formatPercent = (value) =>
  `${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
  }).format(value || 0)}%`;

export default function DashboardPage() {
  const { metrics: initialMetrics } = useLoaderData();
  const fallbackEnd = normalizeDate(new Date());
  const fallbackStart = (() => {
    const start = new Date(fallbackEnd);
    start.setUTCDate(start.getUTCDate() - (DEFAULT_PERIOD_DAYS - 1));
    return normalizeDate(start);
  })();
  const baseRange =
    initialMetrics?.period?.start && initialMetrics?.period?.end
      ? {
          start: normalizeDate(initialMetrics.period.start),
          end: normalizeDate(initialMetrics.period.end),
        }
      : { start: fallbackStart, end: fallbackEnd };

  const [metrics, setMetrics] = useState(initialMetrics);
  const [dateRange, setDateRange] = useState(baseRange);
  const [draftRange, setDraftRange] = useState(baseRange);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [hoveredDate, setHoveredDate] = useState(null);
  const [pickerMonth, setPickerMonth] = useState(() => startOfUTCMonth(baseRange.end));
  const pickerRef = useRef(null);
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const today = useMemo(() => normalizeDate(new Date()), []);
  const minSelectableDate = useMemo(() => {
    const min = new Date(today);
    min.setUTCDate(min.getUTCDate() - (MAX_RANGE_DAYS - 1));
    return normalizeDate(min);
  }, [today]);
  const minMonth = useMemo(() => startOfUTCMonth(minSelectableDate), [minSelectableDate]);
  const maxMonth = useMemo(() => startOfUTCMonth(today), [today]);
  const calendarDays = useMemo(() => buildCalendarDays(pickerMonth), [pickerMonth]);
  const displayRangeLabel = useMemo(
    () => formatRangeForDisplay(dateRange.start, dateRange.end),
    [dateRange],
  );
  const hoverIsValid =
    Boolean(hoveredDate) &&
    Boolean(draftRange.start) &&
    getDateKey(hoveredDate) >= getDateKey(draftRange.start);
  const previewEnd = draftRange.end || (hoverIsValid ? hoveredDate : draftRange.start || dateRange.end);
  const previewRangeLabel = draftRange.start
    ? formatRangeForDisplay(draftRange.start, previewEnd)
    : "Selecteer twee datums";
  const prevMonthDate = addMonths(pickerMonth, -1);
  const nextMonthDate = addMonths(pickerMonth, 1);
  const canNavigatePrev = prevMonthDate.getTime() >= minMonth.getTime();
  const canNavigateNext = nextMonthDate.getTime() <= maxMonth.getTime();
  const applyDisabled = !draftRange.start || !draftRange.end;

  useEffect(() => {
    if (fetcher.data) {
      setMetrics(fetcher.data);
      if (fetcher.data.period?.start && fetcher.data.period?.end) {
        const nextRange = {
          start: normalizeDate(fetcher.data.period.start),
          end: normalizeDate(fetcher.data.period.end),
        };
        setDateRange(nextRange);
        setDraftRange(nextRange);
        setPickerMonth(startOfUTCMonth(nextRange.end));
      }
      shopify.toast.show("Dashboard bijgewerkt");
    }
  }, [fetcher.data, shopify]);

  useEffect(() => {
    if (!isPickerOpen) {
      return;
    }

    const handleClickAway = (event) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target)) {
        setIsPickerOpen(false);
        setHoveredDate(null);
        setDraftRange(dateRange);
        setPickerMonth(startOfUTCMonth(dateRange.end));
      }
    };

    document.addEventListener("mousedown", handleClickAway);
    return () => document.removeEventListener("mousedown", handleClickAway);
  }, [isPickerOpen, dateRange]);

  useEffect(() => {
    if (!isPickerOpen) {
      return;
    }

    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setIsPickerOpen(false);
        setHoveredDate(null);
        setDraftRange(dateRange);
        setPickerMonth(startOfUTCMonth(dateRange.end));
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isPickerOpen, dateRange]);

  const isRefreshing = fetcher.state === "loading";

  const loadMetrics = async (range) => {
    try {
      await shopify.ready;

      const token = await (typeof shopify.idToken === "function"
        ? shopify.idToken()
        : typeof shopify.getSessionToken === "function"
          ? shopify.getSessionToken()
          : Promise.reject(new Error("Session token API unavailable")));
      fetcher.load(
        `/api/metrics/overview?id_token=${encodeURIComponent(
          token,
        )}&startDate=${encodeURIComponent(range.start.toISOString())}&endDate=${encodeURIComponent(
          range.end.toISOString(),
        )}`,
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("Failed to acquire session token", err);
      shopify.toast.show("Kon gegevens niet vernieuwen. Open de app opnieuw vanuit Shopify-admin.", {
        isError: true,
      });
    }
  };

  const summaryCards = useMemo(
    () => [
      {
        id: "totalRevenue",
        label: "Totale omzet",
        value: formatCurrency(metrics.summary.totalRevenue),
        helpText: "Afkomstig van in aanmerking komende bestellingen",
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
        id: "discountRate",
        label: "Kortingsconversie",
        value: formatPercent(metrics.summary.discountRate),
        helpText: "Bestellingen met een toegepaste korting",
      },
      {
        id: "profitPotential",
        label: "Potentiële omzet",
        value: formatCurrency(metrics.summary.potentialRevenue),
        helpText: "Geschatte omzet zonder kortingen",
      },
    ],
    [metrics.summary],
  );

  const togglePicker = () => {
    setIsPickerOpen((open) => {
      if (open) {
        setHoveredDate(null);
        setDraftRange(dateRange);
        setPickerMonth(startOfUTCMonth(dateRange.end));
        return false;
      }
      setHoveredDate(null);
      setDraftRange(dateRange);
      setPickerMonth(startOfUTCMonth(dateRange.end));
      return true;
    });
  };

  const handleDayClick = (date) => {
    if (!date) {
      return;
    }

    const day = normalizeDate(date);
    if (day.getTime() < getDateKey(minSelectableDate) || day.getTime() > getDateKey(today)) {
      return;
    }

    setDraftRange((current) => {
      if (!current.start || (current.start && current.end)) {
        return { start: day, end: null };
      }

      const startKey = getDateKey(current.start);
      if (day.getTime() < startKey) {
        return { start: day, end: current.start };
      }

      if (day.getTime() === startKey) {
        return { start: day, end: day };
      }

      return { start: current.start, end: day };
    });
    setHoveredDate(null);
  };

  const handleDayHover = (date) => {
    if (!isPickerOpen || !draftRange.start || draftRange.end || !date) {
      setHoveredDate(null);
      return;
    }

    const day = normalizeDate(date);
    const startKey = getDateKey(draftRange.start);
    const dayKey = getDateKey(day);
    if (dayKey < startKey || dayKey > getDateKey(today)) {
      setHoveredDate(null);
      return;
    }

    setHoveredDate(day);
  };

  const applyRange = async () => {
    if (!draftRange.start || !draftRange.end) {
      return;
    }

    const normalized = normalizeRangeOrder(draftRange);
    setDateRange(normalized);
    setDraftRange(normalized);
    setPickerMonth(startOfUTCMonth(normalized.end));
    setIsPickerOpen(false);
    setHoveredDate(null);
    await loadMetrics(normalized);
  };

  const cancelRange = () => {
    setIsPickerOpen(false);
    setHoveredDate(null);
    setDraftRange(dateRange);
    setPickerMonth(startOfUTCMonth(dateRange.end));
  };

  const refreshData = async () => {
    await loadMetrics(dateRange);
  };

  return (
    <s-page heading="Dashboard Kortingsinzichten" secondary-actions="true">
      <div style={sx.controls}>
        <div style={sx.controlItem}>
          <span style={sx.label}>Datumbereik</span>
          <div style={sx.dateControl} ref={pickerRef}>
            <button type="button" style={sx.dateTrigger} onClick={togglePicker}>
              {renderCalendarIcon()}
              <span style={sx.dateTriggerLabel}>{displayRangeLabel}</span>
            </button>
            {isPickerOpen && (
              <div style={sx.datePicker}>
                <div style={sx.calendarHeader}>
                  <button
                    type="button"
                    style={{
                      ...sx.calendarNavButton,
                      ...(canNavigatePrev ? {} : sx.calendarNavButtonDisabled),
                    }}
                    onClick={() => {
                      if (canNavigatePrev) setPickerMonth(prevMonthDate);
                    }}
                    disabled={!canNavigatePrev}
                  >
                    {renderChevronIcon("left")}
                  </button>
                  <span style={sx.calendarTitle}>{formatMonthTitle(pickerMonth)}</span>
                  <button
                    type="button"
                    style={{
                      ...sx.calendarNavButton,
                      ...(canNavigateNext ? {} : sx.calendarNavButtonDisabled),
                    }}
                    onClick={() => {
                      if (canNavigateNext) setPickerMonth(nextMonthDate);
                    }}
                    disabled={!canNavigateNext}
                  >
                    {renderChevronIcon("right")}
                  </button>
                </div>
                <div style={sx.weekdayRow}>
                  {WEEKDAYS.map((weekday) => (
                    <span key={weekday}>{weekday}</span>
                  ))}
                </div>
                <div
                  style={sx.calendarGrid}
                  onMouseLeave={() => {
                    if (!draftRange.end) setHoveredDate(null);
                  }}
                >
                  {calendarDays.map((day, index) => {
                    if (!day) {
                      return (
                        <div
                          key={`empty-${index}`}
                          style={{ ...sx.calendarCell, ...sx.calendarCellEmpty }}
                        />
                      );
                    }

                    const dayKey = getDateKey(day);
                    const disabled =
                      dayKey < getDateKey(minSelectableDate) || dayKey > getDateKey(today);
                    const startKey = draftRange.start ? getDateKey(draftRange.start) : null;
                    const endKey = draftRange.end ? getDateKey(draftRange.end) : null;
                    const hoverKey = hoverIsValid ? getDateKey(hoveredDate) : null;
                    const rangeEndKey = endKey ?? hoverKey;
                    let inRange = false;
                    if (startKey !== null && rangeEndKey !== null) {
                      const rangeStart = Math.min(startKey, rangeEndKey);
                      const rangeFinish = Math.max(startKey, rangeEndKey);
                      inRange = dayKey >= rangeStart && dayKey <= rangeFinish;
                    } else if (startKey !== null && dayKey === startKey) {
                      inRange = true;
                    }
                    const isStart = startKey !== null && dayKey === startKey;
                    const isEnd =
                      rangeEndKey !== null &&
                      dayKey === rangeEndKey &&
                      (endKey !== null || (hoverKey !== null && dayKey !== startKey));

                    const cellStyle = {
                      ...sx.calendarCell,
                      ...(disabled ? sx.calendarCellDisabled : {}),
                      ...(inRange ? sx.calendarCellInRange : {}),
                      ...((isStart || isEnd) ? sx.calendarCellSelected : {}),
                    };

                    if (isStart && isEnd) {
                      cellStyle.borderRadius = 12;
                    } else if (isStart && inRange) {
                      cellStyle.borderRadius = "12px 6px 6px 12px";
                    } else if (isEnd && inRange) {
                      cellStyle.borderRadius = "6px 12px 12px 6px";
                    } else if (inRange) {
                      cellStyle.borderRadius = 8;
                    }

                    return (
                      <button
                        type="button"
                        key={day.toISOString()}
                        style={cellStyle}
                        disabled={disabled}
                        onClick={() => handleDayClick(day)}
                        onMouseEnter={() => handleDayHover(day)}
                        onFocus={() => handleDayHover(day)}
                      >
                        {day.getUTCDate()}
                      </button>
                    );
                  })}
                </div>
                <div style={sx.calendarFooter}>
                  <span style={sx.calendarFooterText}>{previewRangeLabel}</span>
                  <div style={sx.calendarFooterActions}>
                    <button type="button" style={sx.tertiaryButton} onClick={cancelRange}>
                      Annuleren
                    </button>
                    <button
                      type="button"
                      style={{
                        ...sx.primaryButton,
                        ...(applyDisabled ? sx.primaryButtonDisabled : {}),
                      }}
                      onClick={applyRange}
                      disabled={applyDisabled}
                    >
                      Toepassen
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
        <s-button onClick={refreshData} {...(isRefreshing ? { loading: true } : {})}>
          Vernieuwen
        </s-button>
        <span style={sx.periodMeta}>
          {metrics.period.label} · Bestellingen: {metrics.summary.totalOrders}
        </span>
      </div>

      <div style={sx.metricGrid}>
        {summaryCards.map((card) => (
          <s-card key={card.id} padding="tight">
            <div style={sx.metricCard}>
              <span style={sx.metricLabel}>{card.label}</span>
              <span style={sx.metricValue}>{card.value}</span>
              <span style={sx.metricHelp}>{card.helpText}</span>
            </div>
          </s-card>
        ))}
      </div>

      <div style={sx.sectionGrid}>
        <s-card padding="loose">
          <div style={sx.sectionHeader}>
            <h2>Top inwisselprestaties</h2>
            <span style={sx.sectionSubhead}>
              Kortingen en bundels op basis van inwisselingen
            </span>
          </div>
          <div style={sx.tableWrap}>
            <table style={sx.table}>
            <thead style={sx.stickyHeader}>
              <tr>
                <th style={sx.th} scope="col">Code</th>
                <th style={sx.th} scope="col">Type</th>
                <th style={sx.th} scope="col">Inwisselingen</th>
                <th style={sx.th} scope="col">Omzet</th>
                <th style={{...sx.th, ...sx.thNowrap}} scope="col">Gegeven korting</th>
              </tr>
            </thead>
            <tbody>
              {metrics.topDiscounts.map((discount) => (
                <tr key={discount.id}>
                  <td style={sx.td} data-label="Code">{discount.title}</td>
                  <td style={sx.td} data-label="Type">
                    <span style={sx.badge}>{discount.type}</span>
                  </td>
                  <td style={sx.td} data-label="Inwisselingen">{discount.redemptions}</td>
                  <td style={sx.td} data-label="Omzet">{formatCurrency(discount.revenue)}</td>
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
                <th style={sx.th} scope="col">Code</th>
                <th style={sx.th} scope="col">Inwisselingen</th>
                <th style={sx.th} scope="col">Omzet</th>
                <th style={{...sx.th, ...sx.thNowrap}} scope="col">Gegeven korting</th>
              </tr>
            </thead>
            <tbody>
              {metrics.topDiscounts
                .filter((d) => d.type === "code")
                .map((discount) => (
                  <tr key={`code-${discount.id}`}>
                    <td style={sx.td} data-label="Code">{discount.title}</td>
                    <td style={sx.td} data-label="Inwisselingen">{discount.redemptions}</td>
                    <td style={sx.td} data-label="Omzet">{formatCurrency(discount.revenue)}</td>
                    <td style={sx.td} data-label="Gegeven korting">{formatCurrency(discount.discountGiven)}</td>
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
            <h2>Referrals</h2>
            <span style={sx.sectionSubhead}>Toppartners die verkoop stimuleren</span>
          </div>
          <div style={sx.tableWrap}>
            <table style={sx.table}>
            <thead style={sx.stickyHeader}>
              <tr>
                <th style={sx.th} scope="col">Bron</th>
                <th style={sx.th} scope="col">Bestellingen</th>
                <th style={sx.th} scope="col">Omzet</th>
                <th style={sx.th} scope="col">Kortingen</th>
                <th style={sx.th} scope="col">Gemiddelde bestelling</th>
              </tr>
            </thead>
            <tbody>
              {metrics.referralPerformance.map((referral) => (
                <tr key={referral.source}>
                  <td style={sx.td} data-label="Bron">{referral.source}</td>
                  <td style={sx.td} data-label="Bestellingen">{referral.orders}</td>
                  <td style={sx.td} data-label="Omzet">{formatCurrency(referral.revenue)}</td>
                  <td style={sx.td} data-label="Kortingen">
                    {formatCurrency(referral.discountAmount)}
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

        <s-card padding="loose">
          <div style={sx.sectionHeader}>
            <h2>Bundelprestaties</h2>
            <span style={sx.sectionSubhead}>
              Automatische promoties (bundels)
            </span>
          </div>
          <div style={sx.tableWrap}>
            <table style={sx.table}>
            <thead style={sx.stickyHeader}>
              <tr>
                <th style={sx.th} scope="col">Aanbieding</th>
                <th style={sx.th} scope="col">Type</th>
                <th style={sx.th} scope="col">Inwisselingen</th>
                <th style={sx.th} scope="col">Omzet</th>
                <th style={{...sx.th, ...sx.thNowrap}} scope="col">Gegeven korting</th>
              </tr>
            </thead>
            <tbody>
              {metrics.dealPerformance.map((deal) => (
                <tr key={deal.id}>
                  <td style={sx.td} data-label="Aanbieding">{deal.title}</td>
                  <td style={sx.td} data-label="Type">
                    <span style={sx.badge}>{deal.type}</span>
                  </td>
                  <td style={sx.td} data-label="Inwisselingen">{deal.redemptions}</td>
                  <td style={sx.td} data-label="Omzet">{formatCurrency(deal.revenue)}</td>
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
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
