import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { revalidateTag } from "next/cache";
import * as XLSX from "xlsx";
import { DASHBOARD_DATA_TAG } from "@/lib/dashboard-data";

// ---------------------------------------------------------------------------
// Cultivera API constants
// ---------------------------------------------------------------------------
const AUTH_URL = "https://api-wa.cultiverapro.com/api/v1/auth/sign-in";
const TRANSACTION_STATUS_PREFIX = "https://api-wa.cultiverapro.com/api/v1/transactions/status/";
const POLL_ATTEMPTS = 12;
const POLL_INTERVAL_MS = 5000;

// Confirmed endpoint (report-batches-currently-stock → returns transaction ID → poll → download)
// Set CULTIVERA_INVENTORY_EXPORT_URL to override.
const DEFAULT_EXPORT_URL =
  "https://api-wa.cultiverapro.com/api/v1/product/report-batches-currently-stock";

// Column/field aliases for both CSV/Excel headers and JSON property names
const COL = {
  barcode:        ["Barcode", "Barcode #", "Tag", "Tag #", "TagId", "tagId", "BarCode", "barcode", "PackageId", "packageId"],
  product:        ["Product", "Product Name", "Inventory Name", "ProductName", "productName", "InventoryName", "inventoryName", "Name", "name"],
  productLine:    ["Product-Line", "Product Line", "ProductLine", "productLine"],
  subProductLine: ["Sub-Product-Line", "Sub Product Line", "Subproduct Line", "SubProductLine", "subProductLine"],
  category:       ["Category", "category", "CategoryName", "categoryName"],
  subCategory:    ["Sub-Category", "Sub Category", "SubCategory", "subCategory"],
  room:           ["Room", "room", "Location", "RoomName", "roomName"],
  batchDate:      ["Batch Date", "BatchDate", "batchDate", "Batch", "ManifestDate", "manifestDate", "CreatedDate", "createdDate"],
  qaThca:         ["QA THCA", "THCA %", "THCA", "Thca", "thca", "QaThca", "qaThca"],
  qaThc:          ["QA THC", "THC %", "THC", "Thc", "thc", "QaThc", "qaThc"],
  qaCbd:          ["QA CBD", "CBD %", "CBD", "Cbd", "cbd", "QaCbd", "qaCbd"],
  qaTotal:        ["QA Total", "Total THC %", "Total THC", "TotalThc", "totalThc", "QaTotal", "qaTotal"],
  availability:   ["Availability", "availability", "Status", "status", "AvailabilityType", "availabilityType"],
  unitsForSale:   ["Units For Sale", "For Sale", "Qty For Sale", "UnitsForSale", "unitsForSale", "ForSale", "forSale", "QtyForSale"],
  unitsOnHold:    ["Units On Hold", "On Hold", "UnitsOnHold", "unitsOnHold", "OnHold", "onHold"],
  unitsAllocated: ["Units Allocated", "Allocated", "UnitsAllocated", "unitsAllocated"],
  unitsInStock:   ["Units in Stocks", "Units in Stock", "In Stock", "Qty", "UnitsInStock", "unitsInStock", "InStock", "inStock", "TotalQty", "totalQty", "Quantity", "quantity"],
};

// ---------------------------------------------------------------------------
// Supabase client
// ---------------------------------------------------------------------------
function supabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase env vars.");
  return createClient(url, key, { auth: { persistSession: false } });
}

// ---------------------------------------------------------------------------
// Cultivera auth
// ---------------------------------------------------------------------------
function cultiveraTzo() {
  const n = Number(process.env.CULTIVERA_TZO_MINUTES ?? -420);
  return Number.isFinite(n) ? n : -420;
}

function baseHeaders(token?: string): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/json, text/javascript, */*; q=0.01",
    "Accept-Language": "en-US,en;q=0.9",
    Origin: "https://wa.cultiverapro.com",
    Referer: "https://wa.cultiverapro.com/",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
    "x-rts": String(Math.floor(Date.now() / 1000)),
    "x-tzo": String(cultiveraTzo()),
  };
  if (token) h.Authorization = `Bearer ${token.replace(/^Bearer\s+/i, "")}`;
  return h;
}

async function signIn(): Promise<string> {
  const username = process.env.CULTIVERA_USERNAME;
  const password = process.env.CULTIVERA_PASSWORD;
  if (!username || !password)
    throw new Error("Set CULTIVERA_USERNAME and CULTIVERA_PASSWORD in Vercel env vars.");

  const res = await fetch(AUTH_URL, {
    method: "POST",
    headers: { ...baseHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ username, password, utcOffset: cultiveraTzo() }),
  });
  if (!res.ok) throw new Error(`Cultivera sign-in failed: HTTP ${res.status}`);

  const text = await res.text();
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(text.trim())) return text.trim();
  try {
    const token = findToken(JSON.parse(text));
    if (token) return token;
  } catch { /* fall through */ }
  throw new Error("Cultivera sign-in succeeded but no bearer token found in response.");
}

function findToken(obj: unknown): string {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return "";
  const preferred = ["access_token","accessToken","bearer_token","bearerToken","jwt","id_token","idToken","token","Token"];
  for (const key of preferred) {
    const val = (obj as Record<string, unknown>)[key];
    if (typeof val === "string" && val.trim() && !/refresh/i.test(key)) return val.trim();
  }
  for (const val of Object.values(obj as Record<string, unknown>)) {
    const found = findToken(val);
    if (found) return found;
  }
  return "";
}

// ---------------------------------------------------------------------------
// Fetch inventory data from Cultivera
// ---------------------------------------------------------------------------
type RawRow = Record<string, unknown>;

const DEFAULT_INVENTORY_PAYLOAD = {
  filterKey: "",
  filterStatus: 0,
  Barcode: "",
  Rooms: [],
  Locations: [],
  ShowNoTestResult: false,
  HideLockedBatches: true,
  IsNonCannabis: false,
  ScanBarcodes: [],
  ShowOnlyB2BListed: false,
  UseScanBarcodes: false,
};

function exportPayload(): Record<string, unknown> {
  const raw = process.env.CULTIVERA_INVENTORY_PAYLOAD_JSON;
  if (!raw) return DEFAULT_INVENTORY_PAYLOAD;
  try { return JSON.parse(raw); } catch { return DEFAULT_INVENTORY_PAYLOAD; }
}

async function fetchInventoryRows(token: string): Promise<RawRow[]> {
  const url = process.env.CULTIVERA_INVENTORY_EXPORT_URL || DEFAULT_EXPORT_URL;
  const payload = exportPayload();

  const res = await fetch(url, {
    method: "POST",
    headers: { ...baseHeaders(token), "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Cultivera batch request failed: HTTP ${res.status}`);

  const ct = res.headers.get("content-type") ?? "";

  // JSON response (direct data or async transaction)
  if (ct.includes("json") || ct.includes("javascript")) {
    const json = await res.json() as unknown;
    const txId = extractTransactionId(json);
    if (txId) {
      const finalBuf = await pollTransaction(token, txId);
      return parseBinaryToRows(finalBuf);
    }
    return jsonToRows(json);
  }

  // Binary (Excel / CSV)
  return parseBinaryToRows(await res.arrayBuffer());
}

function extractTransactionId(json: unknown): string {
  if (!json || typeof json !== "object" || Array.isArray(json)) return "";
  const j = json as Record<string, unknown>;
  return String(j.TransactionId || j.transactionId || j.transactionID || "").trim();
}

// Find the array of batch rows inside a JSON response
function jsonToRows(json: unknown): RawRow[] {
  if (Array.isArray(json)) return json as RawRow[];
  if (!json || typeof json !== "object") return [];
  const j = json as Record<string, unknown>;
  // Common envelope keys
  for (const key of ["data", "Data", "items", "Items", "batches", "Batches", "results", "Results", "value", "Value"]) {
    if (Array.isArray(j[key])) return j[key] as RawRow[];
  }
  // DataTables-style response
  if (Array.isArray(j.aaData)) return j.aaData as RawRow[];
  return [];
}

async function pollTransaction(token: string, txId: string): Promise<ArrayBuffer> {
  for (let i = 1; i <= POLL_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const res = await fetch(TRANSACTION_STATUS_PREFIX + encodeURIComponent(txId), {
      headers: baseHeaders(token),
    });
    if (!res.ok) throw new Error(`Transaction poll failed: HTTP ${res.status}`);
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("json")) return res.arrayBuffer();
    const json = await res.json() as Record<string, unknown>;
    const dlUrl = findDownloadUrl(json);
    if (dlUrl) {
      const dl = await fetch(dlUrl, { headers: baseHeaders(token) });
      if (!dl.ok) throw new Error(`Download failed: HTTP ${dl.status}`);
      return dl.arrayBuffer();
    }
    const failed = json.Failed || json.failed || json.HasError || json.hasError;
    if (failed) throw new Error(`Transaction ${txId} failed.`);
  }
  throw new Error(`Transaction ${txId} did not complete after ${POLL_ATTEMPTS} attempts.`);
}

function findDownloadUrl(json: Record<string, unknown>): string {
  const keys = /finalvalue|download|file|url|uri|href/i;
  function search(v: unknown): string {
    if (!v || typeof v !== "object") return "";
    for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
      if (keys.test(k) && typeof child === "string" && /^https?:\/\//i.test(child)) return child;
      const found = search(child);
      if (found) return found;
    }
    return "";
  }
  return search(json);
}

function parseBinaryToRows(buf: ArrayBuffer): RawRow[] {
  const wb = XLSX.read(new Uint8Array(buf), { type: "array", cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json<RawRow>(sheet, { defval: null, raw: false });
}

// ---------------------------------------------------------------------------
// Map rows → Supabase records
// ---------------------------------------------------------------------------
function firstKey(row: RawRow, aliases: string[]): string {
  const keys = new Map(Object.keys(row).map((k) => [k.toLowerCase(), k]));
  for (const a of aliases) {
    const found = keys.get(a.toLowerCase());
    if (found !== undefined) return found;
  }
  return "";
}

function str(row: RawRow, key: string): string {
  if (!key) return "";
  const v = row[key];
  return v == null ? "" : String(v).trim();
}

function num(row: RawRow, key: string): number | null {
  const s = str(row, key).replace(/[$,%\s]/g, "");
  if (!s || ["nan","none","null"].includes(s.toLowerCase())) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function dt(row: RawRow, key: string): string | null {
  if (!key) return null;
  const v = row[key];
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString();
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d.toISOString();
}

async function upsertRows(rows: RawRow[], syncedAt: string) {
  if (!rows.length) throw new Error("Cultivera returned no batch rows.");

  const sample = rows[0];
  const C = Object.fromEntries(
    Object.entries(COL).map(([field, aliases]) => [field, firstKey(sample, aliases)])
  );

  if (!C.barcode) throw new Error(`Could not find a barcode/tag field. Keys found: ${Object.keys(sample).join(", ")}`);
  if (!C.product)  throw new Error(`Could not find a product name field. Keys found: ${Object.keys(sample).join(", ")}`);

  const records = rows
    .map((row) => ({
      barcode:          str(row, C.barcode),
      product:          str(row, C.product),
      product_line:     str(row, C.productLine)    || null,
      sub_product_line: str(row, C.subProductLine) || null,
      category:         str(row, C.category)       || null,
      sub_category:     str(row, C.subCategory)    || null,
      room:             str(row, C.room)            || null,
      batch_date:       dt(row, C.batchDate),
      qa_thca:          num(row, C.qaThca),
      qa_thc:           num(row, C.qaThc),
      qa_cbd:           num(row, C.qaCbd),
      qa_total:         num(row, C.qaTotal),
      availability:     str(row, C.availability)   || null,
      units_for_sale:   num(row, C.unitsForSale)   ?? 0,
      units_on_hold:    num(row, C.unitsOnHold)    ?? 0,
      units_allocated:  num(row, C.unitsAllocated) ?? 0,
      units_in_stock:   num(row, C.unitsInStock)   ?? 0,
      synced_at:        syncedAt,
    }))
    .filter((r) => r.barcode && r.product);

  const db = supabase();
  let imported = 0;
  for (let i = 0; i < records.length; i += 500) {
    const { count, error } = await db
      .from("cultivera_inventory")
      .upsert(records.slice(i, i + 500), { onConflict: "barcode", count: "exact" });
    if (error) throw new Error(error.message);
    imported += count ?? 0;
  }

  // Remove stale batches not present in this sync
  await db.from("cultivera_inventory").delete().lt("synced_at", syncedAt);

  return { imported, total: records.length };
}

// ---------------------------------------------------------------------------
// Core sync
// ---------------------------------------------------------------------------
export const maxDuration = 60;

async function runSync() {
  const syncedAt = new Date().toISOString();
  const token = await signIn();
  const rows  = await fetchInventoryRows(token);
  const result = await upsertRows(rows, syncedAt);
  revalidateTag(DASHBOARD_DATA_TAG, "max");
  return { ...result, syncedAt };
}

// Manual trigger (Sync Now button)
export async function POST() {
  try {
    return NextResponse.json(await runSync());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Inventory sync failed." },
      { status: 500 }
    );
  }
}

// Vercel Cron entry point
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret)
    return NextResponse.json({ error: "Set CRON_SECRET to enable scheduled sync." }, { status: 401 });

  const headerToken = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const queryToken  = new URL(request.url).searchParams.get("secret") || "";
  if (headerToken !== secret && queryToken !== secret)
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  try {
    return NextResponse.json(await runSync());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Inventory sync failed." },
      { status: 500 }
    );
  }
}
