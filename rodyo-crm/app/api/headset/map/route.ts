import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function createSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase env vars.");
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function POST(request: Request) {
  let mappings: { headsetName: string; storeId: string }[];
  try {
    const body = await request.json();
    mappings = body.mappings;
    if (!Array.isArray(mappings) || !mappings.length) {
      return NextResponse.json({ error: "No mappings provided." }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();

  // Upsert mappings
  const { error: mapError } = await supabase
    .from("headset_store_map")
    .upsert(
      mappings.map((m) => ({ headset_name: m.headsetName, store_id: m.storeId })),
      { onConflict: "headset_name" }
    );
  if (mapError) return NextResponse.json({ error: mapError.message }, { status: 500 });

  // Back-fill store_id on existing headset_sales rows for each mapped name
  for (const { headsetName, storeId } of mappings) {
    await supabase
      .from("headset_sales")
      .update({ store_id: storeId })
      .eq("store_name", headsetName)
      .is("store_id", null);
  }

  return NextResponse.json({ saved: mappings.length });
}
