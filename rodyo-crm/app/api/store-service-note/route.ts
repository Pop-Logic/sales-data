import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import { DASHBOARD_DATA_TAG } from "@/lib/dashboard-data";

function createSupabaseAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY.");
  }
  return createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
}

export async function POST(request: Request) {
  let payload: { storeId?: string; serviceNote?: string | null };

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const storeId = String(payload.storeId ?? "").trim();
  if (!storeId) {
    return NextResponse.json({ error: "Missing storeId." }, { status: 400 });
  }

  const serviceNote = payload.serviceNote ? String(payload.serviceNote).trim() || null : null;

  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("stores")
      .update({ service_note: serviceNote })
      .eq("id", storeId)
      .select("id, service_note")
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: error?.message || "Could not save service note." },
        { status: 500 }
      );
    }

    revalidateTag(DASHBOARD_DATA_TAG, "max");

    return NextResponse.json({ storeId: data.id, serviceNote: data.service_note });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save service note." },
      { status: 500 }
    );
  }
}
