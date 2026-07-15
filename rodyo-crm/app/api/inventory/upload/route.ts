import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { revalidateTag } from "next/cache";
import { DASHBOARD_DATA_TAG } from "@/lib/dashboard-data";
import { consumeNewBatches } from "@/lib/packaging-consume";

function createSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase env vars.");
  return createClient(url, key, { auth: { persistSession: false } });
}

type InventoryRow = {
  barcode: string;
  product: string;
  productLine: string | null;
  subProductLine: string | null;
  category: string | null;
  subCategory: string | null;
  room: string | null;
  batchDate: string | null;
  qaThca: number | null;
  qaThc: number | null;
  qaCbd: number | null;
  qaTotal: number | null;
  availability: string | null;
  unitsForSale: number;
  unitsOnHold: number;
  unitsAllocated: number;
  unitsInStock: number;
};

export async function POST(request: Request) {
  let rows: InventoryRow[];
  try {
    const body = await request.json();
    rows = body.rows;
    if (!Array.isArray(rows) || !rows.length) {
      return NextResponse.json({ error: "No rows provided." }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const syncedAt = new Date().toISOString();
  const supabase = createSupabaseAdminClient();

  const records = rows.map((r) => ({
    barcode: r.barcode,
    product: r.product,
    product_line: r.productLine,
    sub_product_line: r.subProductLine,
    category: r.category,
    sub_category: r.subCategory,
    room: r.room,
    batch_date: r.batchDate,
    qa_thca: r.qaThca,
    qa_thc: r.qaThc,
    qa_cbd: r.qaCbd,
    qa_total: r.qaTotal,
    availability: r.availability,
    units_for_sale: r.unitsForSale,
    units_on_hold: r.unitsOnHold,
    units_allocated: r.unitsAllocated,
    units_in_stock: r.unitsInStock,
    synced_at: syncedAt
  }));

  // Upsert in batches of 500
  const BATCH = 500;
  let imported = 0;
  for (let i = 0; i < records.length; i += BATCH) {
    const { error, count } = await supabase
      .from("cultivera_inventory")
      .upsert(records.slice(i, i + BATCH), { onConflict: "barcode", count: "exact" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    imported += count ?? 0;
  }

  // Remove barcodes not present in this export (stale batches)
  const barcodes = rows.map((r) => r.barcode);
  const { error: deleteError } = await supabase
    .from("cultivera_inventory")
    .delete()
    .lt("synced_at", syncedAt);
  if (deleteError) console.error("Stale row cleanup error:", deleteError.message);

  const uniqueProducts = new Set(rows.map((r) => r.subProductLine ?? r.product)).size;

  // Auto-deplete packaging for newly appearing batches (non-fatal).
  try {
    await consumeNewBatches(
      supabase,
      rows.map((r) => ({
        barcode: r.barcode,
        product: r.product,
        subProductLine: r.subProductLine,
        units: r.unitsInStock
      }))
    );
  } catch (err) {
    console.error("Packaging consumption error:", err instanceof Error ? err.message : err);
  }

  revalidateTag(DASHBOARD_DATA_TAG, "max");
  return NextResponse.json({ imported, total: rows.length, products: uniqueProducts });
}
