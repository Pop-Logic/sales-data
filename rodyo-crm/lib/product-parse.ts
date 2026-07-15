import { TERRITORY_BRANDS } from "@/lib/rules";

// Shared product-name parsing for Cultivera data. Used by both the dashboard
// UI and server-side packaging consumption — keep the two in lockstep by
// only ever editing these here.

// "KS | A Grade Flower" → "A Grade Flower"; bulk lots have no prefix and pass through
export function stripBrandPrefix(subProductLine: string | null): string {
  if (!subProductLine) return "";
  return subProductLine.replace(/^[A-Z]{2,3}\s*\|\s*/, "").trim();
}

export function extractUnitSize(productName?: string | null): string {
  if (!productName) return "Other";
  const weightMatch = productName.match(/\b(\d+(?:\.\d+)?)\s*(g|mg|oz|ml)\b/i);
  if (weightMatch) return `${weightMatch[1]}${weightMatch[2].toLowerCase()}`;
  const packMatch = productName.match(/\b(\d+)\s*[-]?\s*(?:pk|pack)\b/i);
  if (packMatch) return `${packMatch[1]}pk`;
  return "Other";
}

export function extractStrain(productName?: string | null): string {
  if (!productName) return "";
  let name = productName.trim();

  // Strip "KS | ", "MF | ", "LL | " style brand-code prefix
  name = name.replace(/^[A-Z]{2,3}\s*\|\s*/i, "");

  // Strip territory brand name prefix (K. Savage, Mayfield, Leisure Land)
  for (const brand of [...TERRITORY_BRANDS].sort((a, b) => b.length - a.length)) {
    if (name.toLowerCase().startsWith(brand.toLowerCase())) {
      name = name.slice(brand.length).replace(/^\s*[-|]\s*/, "").trim();
      break;
    }
  }

  // Cultivera format: "[Product Type] - [Strain] - [Size] -"
  // Take the last non-empty, non-size segment.
  const parts = name.split(" - ").map((s) => s.trim()).filter((s) => s.length > 0);
  if (parts.length >= 2) {
    while (parts.length > 1 && /^\d+(?:\.\d+)?\s*(?:g|mg|oz|ml|pk|pack)(?:\s*\([^)]*\))?$/i.test(parts[parts.length - 1])) {
      parts.pop();
    }
    return parts[parts.length - 1];
  }

  // Fallback: strip product-type words
  name = name.replace(/\b\d+(?:\.\d+)?\s*(?:g|mg|oz|ml)\b/gi, "").trim();
  name = name.replace(/\b\d+\s*[-]?\s*(?:pk|pack)\b/gi, "").trim();
  name = name.replace(
    /\b(?:flower|pre[-\s]?rolls?|prerolls?|cartridge|cart|concentrate|extract|live\s+resin|live\s+rosin|rosin|resin|wax|shatter|crumble|vape|pod|disposable|tincture|topical|capsule|gummy|gummies|infused|edible|hash|kief|distillate|oil|sugar|badder|batter|diamonds|sauce)\b/gi,
    ""
  ).replace(/\s+/g, " ").trim();
  return name;
}
