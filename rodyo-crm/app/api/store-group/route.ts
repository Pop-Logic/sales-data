import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import { DASHBOARD_DATA_TAG } from "@/lib/dashboard-data";

type StoreGroupPayload = {
  storeId?: string;
  groupName?: string | null;
};

function createSupabaseAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY.");
  }

  return createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false
    }
  });
}

export async function POST(request: Request) {
  let payload: StoreGroupPayload;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const storeId = String(payload.storeId ?? "").trim();
  if (!storeId) {
    return NextResponse.json({ error: "Missing storeId." }, { status: 400 });
  }

  const groupName = payload.groupName ? String(payload.groupName).trim() || null : null;

  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("stores")
      .update({ group_name: groupName })
      .eq("id", storeId)
      .select("id, group_name")
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: error?.message || "Could not save group." },
        { status: 500 }
      );
    }

    revalidateTag(DASHBOARD_DATA_TAG, "max");

    return NextResponse.json({
      storeId: data.id,
      groupName: data.group_name
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save group." },
      { status: 500 }
    );
  }
}
