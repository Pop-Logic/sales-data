import { extractUnitSize } from "@/lib/product-parse";

// SKU-level economics from the "SKU INPUT" tab (gid=0) of the BALACLAVA
// DISTRO DATA sheet. Three header rows; field names live on row 3:
//   I: Gram_Material_Cost (wholesale — price paid for material)
//   J: Unit_Material_Cost
//   X: Unit_Revenue / Y: Gram_Revenue (retail — unrealized revenue)

const SKU_SHEET_URL =
  "https://docs.google.com/spreadsheets/d/1VBSJsh5JGXrLYibMd4XQqldYg4JDpH8GYDAb_HD6jYU/export?format=csv&gid=0";
const HEADER_ROW_INDEX = 2;

export type SkuEconomics = {
  skuName: string;
  active: boolean;
  category: string;     // A Grade | B Grade | Preroll | Cured Oil | Live Oil | Solventless
  productType: string;  // Flower | Infused | Vape | Dab
  size: number | null;  // grams per unit
  brand: string;        // K Savage | Mayfield | Leisure Land
  gramMaterialCost: number | null;
  unitMaterialCost: number | null;
  unitRevenue: number | null;
  gramRevenue: number | null;
};

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === "\"") {
      if (inQuotes && next === "\"") { cell += "\""; i += 1; }
      else inQuotes = !inQuotes;
      continue;
    }
    if (char === "," && !inQuotes) { row.push(cell); cell = ""; continue; }
    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell); rows.push(row); row = []; cell = "";
      continue;
    }
    cell += char;
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

function money(value: string | undefined): number | null {
  const s = (value ?? "").replace(/[$,%\s]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export async function fetchSkuEconomics(): Promise<SkuEconomics[]> {
  const url = process.env.SKU_ECONOMICS_SHEET_URL || SKU_SHEET_URL;
  const res = await fetch(url, { redirect: "follow", next: { revalidate: 300 } });
  if (!res.ok) throw new Error(`SKU sheet fetch failed: HTTP ${res.status}`);
  const rows = parseCsvRows(await res.text());
  if (rows.length <= HEADER_ROW_INDEX) return [];

  const headers = rows[HEADER_ROW_INDEX].map((h) => h.trim());
  const col = (name: string) => headers.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const C = {
    skuName: col("SKU_Name"),
    active: col("Active?"),
    category: col("Category"),
    productType: col("Product_Type"),
    size: col("Size"),
    brand: col("Brand"),
    gramMaterialCost: col("Gram_Material_Cost"),
    unitMaterialCost: col("Unit_Material_Cost"),
    unitRevenue: col("Unit_Revenue"),
    gramRevenue: col("Gram_Revenue"),
  };
  if (C.skuName < 0 || C.unitRevenue < 0 || C.gramMaterialCost < 0) {
    throw new Error(`SKU sheet header row not recognized: ${headers.slice(0, 8).join(", ")}`);
  }

  const out: SkuEconomics[] = [];
  for (const row of rows.slice(HEADER_ROW_INDEX + 1)) {
    const skuName = (row[C.skuName] ?? "").trim();
    if (!skuName) continue;
    out.push({
      skuName,
      active: (row[C.active] ?? "").trim().toUpperCase() === "Y",
      category: (row[C.category] ?? "").trim(),
      productType: (row[C.productType] ?? "").trim(),
      size: money(row[C.size]),
      brand: (row[C.brand] ?? "").trim(),
      gramMaterialCost: money(row[C.gramMaterialCost]),
      unitMaterialCost: money(row[C.unitMaterialCost]),
      unitRevenue: money(row[C.unitRevenue]),
      gramRevenue: money(row[C.gramRevenue]),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Inventory → SKU matching
// ---------------------------------------------------------------------------

const BRAND_BY_PREFIX: Record<string, string> = {
  KS: "K Savage",
  MF: "Mayfield",
  LL: "Leisure Land",
};

// sub_product_line keywords → (category, productType). Order matters:
// "Diamond Doobie Infused Pre-Rolls" must hit before the generic pre-roll rule.
function familyFromSubline(subline: string): { category: string; productType: string } | null {
  const s = subline.toLowerCase();
  if (s.includes("diamond doobie")) return { category: "Preroll", productType: "Infused" };
  if (s.includes("skybox") && s.includes("live")) return { category: "Live Oil", productType: "Vape" };
  if (s.includes("skybox") && s.includes("cured")) return { category: "Cured Oil", productType: "Vape" };
  if (s.includes("pre-roll") || s.includes("preroll") || s.includes("pre roll")) return { category: "Preroll", productType: "Flower" };
  if (s.includes("hash rosin")) return { category: "Solventless", productType: "Dab" };
  if (s.includes("live bho")) return { category: "Live Oil", productType: "Dab" };
  if (s.includes("cured bho")) return { category: "Cured Oil", productType: "Dab" };
  if (s.includes("b grade") || s.includes("shorts") || s.includes("smalls")) return { category: "B Grade", productType: "Flower" };
  if (s.includes("a grade")) return { category: "A Grade", productType: "Flower" };
  return null;
}

// Bulk lots (unbranded material, tracked in grams) — valued at K Savage gram
// rates as the reference tier; flagged as estimates in the UI.
function bulkFamily(subline: string): { category: string; productType: string } | null {
  const s = subline.toLowerCase();
  if (!s.startsWith("bulk")) return null;
  if (s.includes("a flower")) return { category: "A Grade", productType: "Flower" };
  if (s.includes("b flower")) return { category: "B Grade", productType: "Flower" };
  if (s.includes("hash rosin")) return { category: "Solventless", productType: "Dab" };
  if (s.includes("live bho")) return { category: "Live Oil", productType: "Dab" };
  if (s.includes("cured bho")) return { category: "Cured Oil", productType: "Dab" };
  return null; // trim, fresh frozen — no SKU economics
}

function sizeGrams(product: string): number | null {
  const size = extractUnitSize(product);
  const m = size.match(/^(\d+(?:\.\d+)?)(g|mg|oz|ml)$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (m[2] === "mg") return n / 1000;
  if (m[2] === "oz") return n * 28;
  return n; // g and ml treated 1:1
}

export type InventoryValuation = {
  wholesale: number | null; // price paid for material in this stock
  retail: number | null;    // unrealized revenue at sheet pricing
  estimated: boolean;       // true when priced per-gram (no exact SKU row) or bulk
};

export function valueInventory(
  product: string,
  subProductLine: string | null,
  units: number,
  skus: SkuEconomics[]
): InventoryValuation {
  const none: InventoryValuation = { wholesale: null, retail: null, estimated: false };
  if (!subProductLine || units <= 0) return none;

  // Bulk material: units are grams, K Savage gram rates
  const bulk = bulkFamily(subProductLine);
  if (bulk) {
    const row = skus.find(
      (s) => s.brand === "K Savage" && s.category === bulk.category && s.productType === bulk.productType
    ) ?? skus.find((s) => s.brand === "K Savage" && s.category === bulk.category);
    if (!row) return none;
    return {
      wholesale: row.gramMaterialCost != null ? units * row.gramMaterialCost : null,
      retail: row.gramRevenue != null ? units * row.gramRevenue : null,
      estimated: true,
    };
  }

  const brand = BRAND_BY_PREFIX[subProductLine.slice(0, 2).toUpperCase()];
  const family = familyFromSubline(subProductLine);
  if (!brand || !family) return none;

  const candidates = skus.filter(
    (s) => s.brand === brand && s.category === family.category && s.productType === family.productType
  );
  if (!candidates.length) return none;

  const grams = sizeGrams(product);

  // Exact size match (active rows win on duplicates)
  const exact = grams != null
    ? [...candidates].sort((a, b) => Number(b.active) - Number(a.active)).find((s) => s.size === grams)
    : undefined;
  if (exact) {
    return {
      wholesale: exact.unitMaterialCost != null ? units * exact.unitMaterialCost : null,
      retail: exact.unitRevenue != null ? units * exact.unitRevenue : null,
      estimated: false,
    };
  }

  // Per-gram fallback for sizes the sheet doesn't list (e.g. the new 2g line)
  if (grams != null) {
    const ref = candidates.find((s) => s.active) ?? candidates[0];
    return {
      wholesale: ref.gramMaterialCost != null ? units * grams * ref.gramMaterialCost : null,
      retail: ref.gramRevenue != null ? units * grams * ref.gramRevenue : null,
      estimated: true,
    };
  }
  return none;
}
