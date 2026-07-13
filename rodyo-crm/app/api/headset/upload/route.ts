import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function createSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase env vars.");
  return createClient(url, key, { auth: { persistSession: false } });
}

function normalizeForMatch(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s*\([^)]+\)\s*/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type HeadsetRow = {
  day: string;
  storeName: string;
  accountRep: string | null;
  productName: string;
  category: string | null;
  unitSize: string | null;
  brand: string | null;
  totalSales: number;
  totalUnits: number;
  avgItemPrice: number | null;
  pctDaysInStock: number | null;
  avgUnitCost: number | null;
};

export async function POST(request: Request) {
  let rows: HeadsetRow[];
  try {
    const body = await request.json();
    rows = body.rows;
    if (!Array.isArray(rows) || !rows.length) {
      return NextResponse.json({ error: "No rows provided." }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();

  // Load existing store name mappings
  const { data: mapData } = await supabase
    .from("headset_store_map")
    .select("headset_name, store_id");
  const mappedNames = new Map<string, string>(
    (mapData || []).map((r) => [r.headset_name, r.store_id])
  );

  // Load stores for auto-matching
  const { data: storeData } = await supabase
    .from("stores")
    .select("id, store_name");
  const storeNorm = (storeData || []).map((s) => ({
    id: s.id as string,
    norm: normalizeForMatch(s.store_name || "")
  }));

  // Collect unique headset store names and resolve store_id for each
  const uniqueStoreNames = [...new Set(rows.map((r) => r.storeName))];
  const resolvedIds = new Map<string, string | null>();
  const unmatchedNames: string[] = [];

  for (const headsetName of uniqueStoreNames) {
    if (mappedNames.has(headsetName)) {
      resolvedIds.set(headsetName, mappedNames.get(headsetName)!);
      continue;
    }
    const norm = normalizeForMatch(headsetName);
    const match = storeNorm.find((s) => s.norm === norm || s.norm.includes(norm) || norm.includes(s.norm));
    if (match) {
      resolvedIds.set(headsetName, match.id);
      // Persist this auto-match so future imports skip the lookup
      await supabase
        .from("headset_store_map")
        .upsert({ headset_name: headsetName, store_id: match.id }, { onConflict: "headset_name" });
    } else {
      resolvedIds.set(headsetName, null);
      unmatchedNames.push(headsetName);
    }
  }

  // Upsert rows in batches
  const BATCH = 500;
  let imported = 0;
  const records = rows.map((r) => ({
    day: r.day,
    store_name: r.storeName,
    account_rep: r.accountRep,
    product_name: r.productName,
    category: r.category,
    unit_size: r.unitSize,
    brand: r.brand,
    total_sales: r.totalSales,
    total_units: r.totalUnits,
    avg_item_price: r.avgItemPrice,
    pct_days_in_stock: r.pctDaysInStock,
    avg_unit_cost: r.avgUnitCost,
    store_id: resolvedIds.get(r.storeName) ?? null
  }));

  for (let i = 0; i < records.length; i += BATCH) {
    const { error, count } = await supabase
      .from("headset_sales")
      .upsert(records.slice(i, i + BATCH), {
        onConflict: "day,store_name,product_name",
        count: "exact"
      });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    imported += count ?? 0;
  }

  return NextResponse.json({
    imported,
    total: rows.length,
    unmatched: [...new Set(unmatchedNames)].sort()
  });
}
