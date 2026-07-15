import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import { DASHBOARD_DATA_TAG } from "@/lib/dashboard-data";

function createSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase env vars.");
  return createClient(url, key, { auth: { persistSession: false } });
}

type BomPayload = {
  packagingItemId?: string;
  subProductLine?: string;
  unitSize?: string | null;
  strain?: string | null;
  qtyPerUnit?: number;
};

export async function POST(request: Request) {
  let payload: BomPayload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const packagingItemId = String(payload.packagingItemId ?? "").trim();
  const subProductLine = String(payload.subProductLine ?? "").trim();
  if (!packagingItemId || !subProductLine) {
    return NextResponse.json({ error: "Missing packagingItemId or subProductLine." }, { status: 400 });
  }

  const qtyPerUnit = Number(payload.qtyPerUnit ?? 1);
  if (!Number.isFinite(qtyPerUnit) || qtyPerUnit <= 0) {
    return NextResponse.json({ error: "qtyPerUnit must be a positive number." }, { status: 400 });
  }

  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("packaging_boms")
      .insert({
        packaging_item_id: packagingItemId,
        sub_product_line: subProductLine,
        unit_size: payload.unitSize ? String(payload.unitSize).trim() || null : null,
        strain: payload.strain ? String(payload.strain).trim() || null : null,
        qty_per_unit: qtyPerUnit
      })
      .select("id")
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: error?.message || "Could not save BOM row." },
        { status: 500 }
      );
    }

    revalidateTag(DASHBOARD_DATA_TAG, "max");
    return NextResponse.json({ id: data.id });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save BOM row." },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id." }, { status: 400 });

  try {
    const supabase = createSupabaseAdminClient();
    const { error } = await supabase.from("packaging_boms").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    revalidateTag(DASHBOARD_DATA_TAG, "max");
    return NextResponse.json({ deleted: id });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not delete BOM row." },
      { status: 500 }
    );
  }
}
