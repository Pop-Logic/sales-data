import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function createSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase env vars.");
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const storeId = searchParams.get("storeId")?.trim();
  if (!storeId) return NextResponse.json({ error: "Missing storeId." }, { status: 400 });

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("headset_sales")
    .select("day, product_name, category, unit_size, brand, total_sales, total_units, avg_item_price, pct_days_in_stock, avg_unit_cost")
    .eq("store_id", storeId)
    .gte("day", cutoffStr)
    .order("day", { ascending: false })
    .limit(2000);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    sales: (data || []).map((r) => ({
      day: r.day,
      productName: r.product_name,
      category: r.category,
      unitSize: r.unit_size,
      brand: r.brand,
      totalSales: r.total_sales,
      totalUnits: r.total_units,
      avgItemPrice: r.avg_item_price,
      pctDaysInStock: r.pct_days_in_stock,
      avgUnitCost: r.avg_unit_cost
    }))
  });
}
