// Heuristic buy price matcher based on product title text
// Note: simple contains/and-contains rules as provided. Case-insensitive.

const toKey = (s) => (typeof s === "string" ? s.toLowerCase() : "");

export function getBuyPriceForTitle(title = "") {
  const t = toKey(title);

  // Most specific first
  if (t.includes("delicates laundry bag (3x)")) return 2.10;
  if (t.includes("delicates laundry bag (2x)")) return 1.40;

  // Contains rules
  if (t.includes("trial kit")) return 7.50;

  if (t.includes("laundry perfume") && t.includes("250ml")) return 5.50;
  if (t.includes("laundry perfume") && t.includes("500ml")) return 9.90;

  if (t.includes("cleaner tabs")) return 0.50; // Washing Machine Cleaner Tabs

  if (t.includes("delicates laundry bag")) return 0.70; // after (2x)/(3x)
  if (t.includes("wool dryer balls")) return 1.50;
  if (t.includes("laundry sheets bio")) return 1.80;
  if (t.includes("premium laundry sheets")) return 2.50;

  if (t.includes("handheld steamer")) return 15.80;
  if (t.includes("steamer xl")) return 49.0;
  if (t.includes("fabric shaver")) return 9.0;
  if (t.includes("space saving hanger")) return 5.50;

  return 0;
}

export function sumCOGSFromLineItems(lineItemsEdges = []) {
  let total = 0;
  for (const edge of lineItemsEdges) {
    const n = edge?.node || {};
    const title = n.title || n.name || "";
    const qty = Number(n.quantity || 0);
    const unitCost = getBuyPriceForTitle(title);
    total += unitCost * qty;
  }
  return Number.isFinite(total) ? total : 0;
}

