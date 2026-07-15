import type { SupabaseClient } from "@supabase/supabase-js";
import { extractStrain, extractUnitSize } from "@/lib/product-parse";

// Automatic packaging depletion. Called after every inventory sync/upload:
// any batch barcode never seen before represents freshly packaged goods, so
// its product family's BOM components are consumed (units × qty_per_unit).
//
// Safety properties:
// - packaging_seen_batches gates each barcode to a single evaluation, so
//   pre-existing stock at feature launch never consumes retroactively.
// - The unique (packaging_item_id, source_barcode) index makes the ledger
//   insert idempotent even if two syncs race on the same batch.

export type BatchForConsumption = {
  barcode: string;
  product: string;
  subProductLine: string | null;
  units: number;
};

type BomRow = {
  packaging_item_id: string;
  sub_product_line: string;
  unit_size: string | null;
  strain: string | null;
  qty_per_unit: number;
};

export async function consumeNewBatches(
  db: SupabaseClient,
  batches: BatchForConsumption[]
): Promise<{ newBatches: number; consumeEntries: number }> {
  const byBarcode = new Map(batches.filter((b) => b.barcode).map((b) => [b.barcode, b]));
  const barcodes = [...byBarcode.keys()];
  if (!barcodes.length) return { newBatches: 0, consumeEntries: 0 };

  // Which barcodes have we already evaluated?
  const seen = new Set<string>();
  for (let i = 0; i < barcodes.length; i += 500) {
    const chunk = barcodes.slice(i, i + 500);
    const { data, error } = await db
      .from("packaging_seen_batches")
      .select("barcode")
      .in("barcode", chunk);
    if (error) throw new Error(`Seen-batch lookup failed: ${error.message}`);
    for (const row of data || []) seen.add(String(row.barcode));
  }

  const fresh = barcodes.filter((b) => !seen.has(b));
  if (!fresh.length) return { newBatches: 0, consumeEntries: 0 };

  const { data: bomData, error: bomError } = await db
    .from("packaging_boms")
    .select("packaging_item_id, sub_product_line, unit_size, strain, qty_per_unit");
  if (bomError) throw new Error(`BOM lookup failed: ${bomError.message}`);
  const boms = (bomData || []) as BomRow[];

  // One ledger entry per (item, barcode) — if multiple BOM rows for the same
  // item match one batch (e.g. an "any size" row plus a size-specific row),
  // their quantities sum instead of producing a same-statement conflict.
  const entryMap = new Map<string, {
    packaging_item_id: string;
    entry_type: "consume";
    qty: number;
    source_barcode: string;
    note: string;
  }>();

  for (const barcode of fresh) {
    const batch = byBarcode.get(barcode)!;
    if (!batch.subProductLine || batch.units <= 0) continue;
    const size = extractUnitSize(batch.product);
    const strain = extractStrain(batch.product).toLowerCase();
    for (const bom of boms) {
      if (bom.sub_product_line !== batch.subProductLine) continue;
      if (bom.unit_size && bom.unit_size.toLowerCase() !== size.toLowerCase()) continue;
      if (bom.strain && bom.strain.toLowerCase() !== strain) continue;
      const qty = batch.units * Number(bom.qty_per_unit || 1);
      if (qty <= 0) continue;
      const key = `${bom.packaging_item_id}:${barcode}`;
      const existing = entryMap.get(key);
      if (existing) {
        existing.qty += qty;
      } else {
        entryMap.set(key, {
          packaging_item_id: bom.packaging_item_id,
          entry_type: "consume",
          qty,
          source_barcode: barcode,
          note: `${batch.product} · ${batch.units} units`
        });
      }
    }
  }
  const entries = [...entryMap.values()];

  for (let i = 0; i < entries.length; i += 500) {
    const { error } = await db
      .from("packaging_ledger")
      .upsert(entries.slice(i, i + 500), {
        onConflict: "packaging_item_id,source_barcode",
        ignoreDuplicates: true
      });
    if (error) throw new Error(`Consume insert failed: ${error.message}`);
  }

  // Mark every fresh barcode as seen — including BOM-less ones, so adding a
  // BOM later never retro-consumes batches packaged before the mapping existed.
  const seenRows = fresh.map((barcode) => ({ barcode }));
  for (let i = 0; i < seenRows.length; i += 500) {
    const { error } = await db
      .from("packaging_seen_batches")
      .upsert(seenRows.slice(i, i + 500), { onConflict: "barcode", ignoreDuplicates: true });
    if (error) throw new Error(`Seen-batch insert failed: ${error.message}`);
  }

  return { newBatches: fresh.length, consumeEntries: entries.length };
}
