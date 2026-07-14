"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ExternalLink,
  ListPlus,
  Map as MapIcon,
  Pencil,
  Plus,
  SlidersHorizontal,
  Trash2,
  X
} from "lucide-react";
import type { DashboardSnapshot } from "@/lib/dashboard-data";
import {
  TERRITORY_BRANDS,
  TERRITORY_MAP_COLORS,
  formatUsd,
  isStoreOverdue,
  overdueColor,
  type ContactLog,
  type InventoryItem,
  type OrderLine,
  type SalesGoal,
  type StoreRollup
} from "@/lib/rules";

type StoreDashboardProps = {
  snapshot: DashboardSnapshot;
  initialView?: string | null;
};

type ViewMode = "stores" | "map" | "orders" | "skus" | "goals" | "logs" | "sync" | "inventory";
type DetailTab = "contact" | "orders" | "buyer" | "history" | "samples" | "retail";
type SortKey = "store" | "brand" | "priority" | "balaclava" | "storeRevenue" | "lastOrder" | "lastLog" | "group" | "rep" | "log";
type LogSortKey = "date" | "store" | "rep" | "method";
type SkuSortKey = "product" | "category" | "brand" | "units" | "revenue" | "stores" | "coverage" | "avgUnits" | "lastOrdered";
type CatSortKey = "category" | "skuCount" | "units" | "revenue" | "stores" | "coverage";
type SkuGroupMode = "sku" | "category";
type SortDirection = "asc" | "desc";
type BalaclavaSalesFilter = "all" | "1000" | "5000";
type StoreRevenueFilter = "all" | "300" | "50000" | "100000";
type BrandFilter = (typeof TERRITORY_BRANDS)[number];
type ParetoFilter = "all" | "top30" | "eighty";
type PriorityFilter = "all" | "lapsed" | "overdue" | "open-lane";
type MapLibreModule = typeof import("maplibre-gl");
type MapLibreMap = import("maplibre-gl").Map;
type MapLibreMarker = import("maplibre-gl").Marker;

type StoreFilters = {
  balaclavaSales: BalaclavaSalesFilter;
  storeRevenue: StoreRevenueFilter;
  brand: BrandFilter[];
  pareto: ParetoFilter;
  priority: PriorityFilter;
  region: string;
  group: string;
  reorderGap: boolean;
};

type BuyerContactPatch = {
  contactName: string | null;
  phoneNumber: string | null;
  email: string | null;
};

type ContactLogPatch = {
  storeId: string;
  dateContacted: string | null;
  contactMethod: string | null;
  initials: string | null;
  personContacted: string | null;
  notes: string | null;
  savedAt: string | null;
};

type SyncState = "idle" | "syncing" | "success" | "error";

function normalizeViewMode(value?: string | null): ViewMode {
  return value === "map" || value === "orders" || value === "skus" || value === "goals" || value === "logs" || value === "sync" || value === "inventory" ? value : "stores";
}

const defaultStoreFilters: StoreFilters = {
  balaclavaSales: "all",
  storeRevenue: "all",
  brand: [],
  pareto: "all",
  priority: "all",
  region: "all",
  group: "all",
  reorderGap: false
};

const detailTabs: { id: DetailTab; label: string }[] = [
  { id: "contact", label: "Contact" },
  { id: "orders", label: "Orders" },
  { id: "buyer", label: "Buyer" },
  { id: "history", label: "History" },
  { id: "samples", label: "Samples" },
  { id: "retail", label: "Retail" }
];

const sortableColumns: { key: SortKey; label: string; width?: string }[] = [
  { key: "store", label: "Store", width: "20%" },
  { key: "brand", label: "Brand" },
  { key: "priority", label: "Priority", width: "7%" },
  { key: "balaclava", label: "Balaclava" },
  { key: "storeRevenue", label: "Store Revenue" },
  { key: "lastOrder", label: "Last Order" },
  { key: "lastLog", label: "Last Log" },
  { key: "group", label: "Group", width: "9%" },
  { key: "rep", label: "Rep", width: "6%" },
  { key: "log", label: "Log", width: "5%" }
];

const BRAND_DOT_COLORS: Record<BrandFilter, string> = {
  "K. Savage": TERRITORY_MAP_COLORS["Carries K. Savage"],
  Mayfield: TERRITORY_MAP_COLORS["Mayfield placed"],
  "Leisure Land": TERRITORY_MAP_COLORS["Leisure Land Placed"]
};

const DEFAULT_ROUTE_START = {
  label: "Tacoma, WA",
  latitude: 47.2529,
  longitude: -122.4443
};
const GOOGLE_MAPS_ROUTE_STOP_LIMIT = 10;
const ROUTE_LINE_SOURCE_ID = "trip-route-line-source";
const ROUTE_LINE_CASING_LAYER_ID = "trip-route-line-casing";
const ROUTE_LINE_LAYER_ID = "trip-route-line";
type Coordinates = {
  latitude: number;
  longitude: number;
};
type RouteStart = Coordinates & {
  label: string;
};
type RouteSuggestion = {
  store: StoreRollup;
  alongRouteMiles: number;
  offRouteMiles: number;
};
type RouteGeometryResponse = {
  coordinates?: [number, number][];
};

function FilterLabel({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <label className={active ? "filter-label is-active" : "filter-label"}>
      <span>{children}</span>
      {active ? <Check aria-label="Filter applied" size={13} /> : null}
    </label>
  );
}

function CheckState({ active, label }: { active: boolean; label: string }) {
  return (
    <span className="tag" title={label}>
      <Check size={14} color={active ? "var(--green)" : "var(--muted)"} />
      {label}
    </span>
  );
}

function summarizeStores(stores: StoreRollup[]) {
  return {
    totalRetailers: stores.length,
    mappedStores: stores.filter((store) => (
      Number.isFinite(store.latitude) && Number.isFinite(store.longitude)
    )).length,
    overduePriority: stores.filter((store) => matchesPriorityFilter(store, "overdue")).length,
    lapsedPriority: stores.filter((store) => matchesPriorityFilter(store, "lapsed")).length,
    openLanePriority: stores.filter((store) => matchesPriorityFilter(store, "open-lane")).length,
    pitchMayfield: stores.filter((store) => store.mapCategory === "Pitch Mayfield").length
  };
}

function storeKey(store: StoreRollup) {
  return store.storeId || store.licenseKey || store.license;
}

function storeIdentityKeys(store: StoreRollup) {
  return [store.storeId, store.licenseKey, store.license, storeKey(store)]
    .filter((value): value is string => Boolean(value));
}

function hasStoreCoordinates(store: StoreRollup) {
  return Number.isFinite(store.latitude) && Number.isFinite(store.longitude);
}

function storeCoordinates(store: StoreRollup) {
  return {
    latitude: Number(store.latitude),
    longitude: Number(store.longitude)
  };
}

function milesBetween(
  left: Coordinates,
  right: Coordinates
) {
  const earthRadiusMiles = 3958.8;
  const toRadians = (value: number) => value * (Math.PI / 180);
  const latitudeDelta = toRadians(right.latitude - left.latitude);
  const longitudeDelta = toRadians(right.longitude - left.longitude);
  const leftLatitude = toRadians(left.latitude);
  const rightLatitude = toRadians(right.latitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(leftLatitude) * Math.cos(rightLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function optimizeTripStores(stores: StoreRollup[], startLocation: Coordinates = DEFAULT_ROUTE_START) {
  const remaining = stores.filter(hasStoreCoordinates);
  const ordered: StoreRollup[] = [];
  let currentLocation: Coordinates = startLocation;

  while (remaining.length) {
    let closestIndex = 0;
    let closestMiles = Number.POSITIVE_INFINITY;
    remaining.forEach((store, index) => {
      const miles = milesBetween(currentLocation, storeCoordinates(store));
      if (miles < closestMiles) {
        closestMiles = miles;
        closestIndex = index;
      }
    });

    const [nextStore] = remaining.splice(closestIndex, 1);
    ordered.push(nextStore);
    currentLocation = storeCoordinates(nextStore);
  }

  return ordered;
}

function estimatedTripMiles(stores: StoreRollup[], startLocation: Coordinates = DEFAULT_ROUTE_START) {
  let totalMiles = 0;
  let currentLocation: Coordinates = startLocation;
  stores.forEach((store) => {
    const nextLocation = storeCoordinates(store);
    totalMiles += milesBetween(currentLocation, nextLocation);
    currentLocation = nextLocation;
  });
  return totalMiles;
}

function mapsCoordinate(store: StoreRollup) {
  return `${Number(store.latitude)},${Number(store.longitude)}`;
}

function coordinateParam(coordinates: Coordinates) {
  return `${coordinates.latitude},${coordinates.longitude}`;
}

function routeTextPart(value?: string | null) {
  return String(value || "").trim();
}

function storeRouteQuery(store: StoreRollup) {
  const cityState = [routeTextPart(store.city), routeTextPart(store.state)]
    .filter(Boolean)
    .join(", ");
  const address = [routeTextPart(store.address), cityState, routeTextPart(store.zip)]
    .filter(Boolean)
    .join(", ");
  const namedLocation = [routeTextPart(store.storeName), address]
    .filter(Boolean)
    .join(", ");

  return namedLocation || mapsCoordinate(store);
}

function googleMapsRouteUrl(stores: StoreRollup[], startLocation: RouteStart = DEFAULT_ROUTE_START) {
  const routeStores = stores.slice(0, GOOGLE_MAPS_ROUTE_STOP_LIMIT);
  if (!routeStores.length) {
    return "";
  }

  const destination = routeStores[routeStores.length - 1];
  const waypointStores = routeStores.slice(0, -1);
  const params = new URLSearchParams({
    api: "1",
    origin: coordinateParam(startLocation),
    destination: storeRouteQuery(destination),
    travelmode: "driving"
  });
  if (destination.googlePlaceId) {
    params.set("destination_place_id", destination.googlePlaceId);
  }
  if (waypointStores.length) {
    params.set("waypoints", waypointStores.map(storeRouteQuery).join("|"));
    if (waypointStores.every((store) => store.googlePlaceId)) {
      params.set("waypoint_place_ids", waypointStores.map((store) => String(store.googlePlaceId)).join("|"));
    }
  }
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

function routeLineData(
  stores: StoreRollup[],
  startLocation: Coordinates = DEFAULT_ROUTE_START,
  roadCoordinates?: [number, number][] | null,
  isLoadingRoadRoute = false
) {
  const straightCoordinates = [
    [startLocation.longitude, startLocation.latitude],
    ...stores
      .filter(hasStoreCoordinates)
      .map((store) => [Number(store.longitude), Number(store.latitude)])
  ];
  const coordinates = isLoadingRoadRoute
    ? []
    : roadCoordinates && roadCoordinates.length > 1
      ? roadCoordinates
      : straightCoordinates;

  return {
    type: "FeatureCollection" as const,
    features: coordinates.length > 1
      ? [
        {
          type: "Feature" as const,
          properties: {},
          geometry: {
            type: "LineString" as const,
            coordinates
          }
        }
      ]
      : []
  };
}

async function fetchRoadRouteCoordinates(
  origin: Coordinates,
  stops: Coordinates[],
  signal?: AbortSignal
) {
  if (!stops.length) {
    return null;
  }

  const response = await fetch("/api/route-line", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ origin, stops }),
    signal
  });

  if (!response.ok) {
    return null;
  }

  const result = (await response.json()) as RouteGeometryResponse;
  const coordinates = Array.isArray(result.coordinates)
    ? result.coordinates.filter((coordinate) => (
      Array.isArray(coordinate)
      && coordinate.length === 2
      && coordinate.every((value) => Number.isFinite(value))
    ))
    : [];

  return coordinates.length > 1 ? coordinates : null;
}

function routeProjection(start: Coordinates, destination: Coordinates, point: Coordinates) {
  const averageLatitude = ((start.latitude + destination.latitude + point.latitude) / 3) * (Math.PI / 180);
  const milesPerLatitudeDegree = 69;
  const milesPerLongitudeDegree = Math.cos(averageLatitude) * 69.172;
  const destinationX = (destination.longitude - start.longitude) * milesPerLongitudeDegree;
  const destinationY = (destination.latitude - start.latitude) * milesPerLatitudeDegree;
  const pointX = (point.longitude - start.longitude) * milesPerLongitudeDegree;
  const pointY = (point.latitude - start.latitude) * milesPerLatitudeDegree;
  const routeLengthSquared = destinationX ** 2 + destinationY ** 2;

  if (!routeLengthSquared) {
    return {
      alongRouteMiles: 0,
      offRouteMiles: milesBetween(start, point),
      progress: 0
    };
  }

  const progress = ((pointX * destinationX) + (pointY * destinationY)) / routeLengthSquared;
  const clampedProgress = Math.max(0, Math.min(1, progress));
  const projectedX = destinationX * clampedProgress;
  const projectedY = destinationY * clampedProgress;
  const routeLength = Math.sqrt(routeLengthSquared);

  return {
    alongRouteMiles: routeLength * clampedProgress,
    offRouteMiles: Math.sqrt((pointX - projectedX) ** 2 + (pointY - projectedY) ** 2),
    progress
  };
}

function coordinatePairToPoint([longitude, latitude]: [number, number]): Coordinates {
  return { latitude, longitude };
}

function routePolylineProjection(routeCoordinates: [number, number][], point: Coordinates) {
  if (routeCoordinates.length < 2) {
    return null;
  }

  let bestProjection = {
    alongRouteMiles: 0,
    offRouteMiles: Number.POSITIVE_INFINITY,
    progress: 0
  };
  let completedMiles = 0;
  let totalMiles = 0;

  for (let index = 0; index < routeCoordinates.length - 1; index += 1) {
    const start = coordinatePairToPoint(routeCoordinates[index]);
    const end = coordinatePairToPoint(routeCoordinates[index + 1]);
    const segmentMiles = milesBetween(start, end);
    const projection = routeProjection(start, end, point);
    const alongSegmentMiles = Math.max(0, Math.min(segmentMiles, projection.alongRouteMiles));

    if (projection.offRouteMiles < bestProjection.offRouteMiles) {
      bestProjection = {
        alongRouteMiles: completedMiles + alongSegmentMiles,
        offRouteMiles: projection.offRouteMiles,
        progress: 0
      };
    }

    completedMiles += segmentMiles;
    totalMiles += segmentMiles;
  }

  return {
    ...bestProjection,
    progress: totalMiles ? bestProjection.alongRouteMiles / totalMiles : 0
  };
}

function routeCoordinateDistance(routeCoordinates?: [number, number][] | null) {
  if (!routeCoordinates || routeCoordinates.length < 2) {
    return 0;
  }

  return routeCoordinates.reduce((totalMiles, coordinate, index) => {
    if (index === 0) {
      return totalMiles;
    }
    return totalMiles + milesBetween(
      coordinatePairToPoint(routeCoordinates[index - 1]),
      coordinatePairToPoint(coordinate)
    );
  }, 0);
}

function nearbyMappedStoreCount(stores: StoreRollup[], store: StoreRollup, radiusMiles: number) {
  if (!hasStoreCoordinates(store)) {
    return 0;
  }

  const point = storeCoordinates(store);
  return stores.filter((candidate) => (
    storeKey(candidate) !== storeKey(store)
    && hasStoreCoordinates(candidate)
    && milesBetween(point, storeCoordinates(candidate)) <= radiusMiles
  )).length;
}

function suggestedRouteStops({
  stores,
  currentRouteStores,
  destinationStore,
  maxOffRouteMiles,
  maxStops,
  startLocation,
  routeCoordinates
}: {
  stores: StoreRollup[];
  currentRouteStores: StoreRollup[];
  destinationStore?: StoreRollup;
  maxOffRouteMiles: number;
  maxStops: number;
  startLocation: Coordinates;
  routeCoordinates?: [number, number][] | null;
}): RouteSuggestion[] {
  if (!destinationStore || !hasStoreCoordinates(destinationStore) || maxStops <= 0) {
    return [];
  }

  const routeKeys = new Set(currentRouteStores.map(storeKey));
  const destination = storeCoordinates(destinationStore);
  const routeDistanceMiles = routeCoordinateDistance(routeCoordinates) || milesBetween(startLocation, destination);
  const isLongTrip = routeDistanceMiles >= 55;
  const minimumAlongRouteMiles = isLongTrip
    ? Math.min(35, Math.max(12, routeDistanceMiles * 0.16))
    : 0;
  const rankedSuggestions = stores
    .filter((store) => hasStoreCoordinates(store) && !routeKeys.has(storeKey(store)))
    .map((store) => {
      const point = storeCoordinates(store);
      const projection = routeCoordinates && routeCoordinates.length > 1
        ? routePolylineProjection(routeCoordinates, point) || routeProjection(startLocation, destination, point)
        : routeProjection(startLocation, destination, point);
      const localStoreCount = nearbyMappedStoreCount(stores, store, 18);
      const priorityScore = prioritySortValue(store) * 18;
      const marketScore = Math.min(30, Math.log10(Math.max(1, store.marketSalesLastMonth)) * 5);
      const progressScore = isLongTrip ? projection.progress * 32 : projection.progress * 8;
      const sparseAreaBonus = isLongTrip ? Math.max(0, 12 - localStoreCount * 1.6) : 0;
      const offRoutePenalty = maxOffRouteMiles > 0 ? (projection.offRouteMiles / maxOffRouteMiles) * 22 : 0;
      const startBubblePenalty = isLongTrip && projection.alongRouteMiles < minimumAlongRouteMiles ? 80 : 0;

      return {
        store,
        alongRouteMiles: projection.alongRouteMiles,
        offRouteMiles: projection.offRouteMiles,
        progress: projection.progress,
        score: priorityScore + marketScore + progressScore + sparseAreaBonus - offRoutePenalty - startBubblePenalty
      };
    })
    .filter((suggestion) => (
      suggestion.progress >= 0
      && suggestion.progress <= 1
      && suggestion.offRouteMiles <= maxOffRouteMiles
      && suggestion.alongRouteMiles >= minimumAlongRouteMiles
    ))
    .sort((left, right) => (
      right.score - left.score
      || prioritySortValue(right.store) - prioritySortValue(left.store)
      || right.store.marketSalesLastMonth - left.store.marketSalesLastMonth
      || left.offRouteMiles - right.offRouteMiles
      || right.alongRouteMiles - left.alongRouteMiles
    ))
    .slice(0, maxStops);

  return rankedSuggestions
    .sort((left, right) => left.alongRouteMiles - right.alongRouteMiles)
    .map(({ store, alongRouteMiles, offRouteMiles }) => ({ store, alongRouteMiles, offRouteMiles }));
}

function textSortValue(value?: string | null) {
  return String(value || "").trim().toLowerCase();
}

function sortValueForStore(store: StoreRollup, sortKey: SortKey) {
  if (sortKey === "store") {
    return `${textSortValue(store.storeName)} ${textSortValue(store.license)}`;
  }
  if (sortKey === "brand") {
    return brandPlacements(store).join(" ");
  }
  if (sortKey === "priority") {
    return prioritySortValue(store);
  }
  if (sortKey === "balaclava") {
    return latestBalaclavaRevenue(store);
  }
  if (sortKey === "storeRevenue") {
    return store.marketSalesLastMonth;
  }
  if (sortKey === "lastOrder") {
    return orderTimestamp(store.lastOrderAt);
  }
  if (sortKey === "lastLog") {
    return orderTimestamp(store.lastContactDate);
  }
  if (sortKey === "group") {
    return textSortValue(store.groupName);
  }
  if (sortKey === "rep") {
    return textSortValue(store.territoryRep);
  }
  return store.hasContactEver ? 1 : 0;
}

function sortStores(stores: StoreRollup[], sortKey: SortKey, direction: SortDirection) {
  const directionMultiplier = direction === "asc" ? 1 : -1;

  return [...stores].sort((left, right) => {
    const leftValue = sortValueForStore(left, sortKey);
    const rightValue = sortValueForStore(right, sortKey);
    let comparison = 0;

    if (typeof leftValue === "number" && typeof rightValue === "number") {
      comparison = leftValue - rightValue;
    } else {
      comparison = String(leftValue).localeCompare(String(rightValue), undefined, {
        numeric: true,
        sensitivity: "base"
      });
    }

    if (comparison === 0) {
      comparison = textSortValue(left.storeName).localeCompare(textSortValue(right.storeName), undefined, {
        numeric: true,
        sensitivity: "base"
      });
    }

    return comparison * directionMultiplier;
  });
}

function priorityText(store: StoreRollup) {
  return `${store.mapCategory} ${store.recommendation}`.toLowerCase();
}

function matchesPriorityFilter(store: StoreRollup, priority: PriorityFilter) {
  if (priority === "overdue") {
    return isStoreOverdue(store);
  }
  const text = priorityText(store);
  if (priority === "lapsed") {
    return text.includes("lapsed");
  }
  if (priority === "open-lane") {
    return text.includes("open lane");
  }
  return true;
}

function isStoreLapsed(store: StoreRollup) {
  return store.mapCategory.toLowerCase().includes("lapsed");
}

// Overdue gets a red pin/dot, but only until a store fully lapses — lapsed
// stores keep their gold range so both bands stay distinct on the map.
function showsOverdueColor(store: StoreRollup) {
  return isStoreOverdue(store) && !isStoreLapsed(store);
}

function priorityRank(store: StoreRollup) {
  if (!store.mapCategory.includes("Priority")) {
    return 0;
  }
  if (store.priorityLevel === "High") {
    return 3;
  }
  if (store.priorityLevel === "Medium") {
    return 2;
  }
  if (store.priorityLevel === "Low") {
    return 1;
  }
  return 0;
}

function prioritySortValue(store: StoreRollup) {
  const laneRank = matchesPriorityFilter(store, "lapsed")
    ? 2
    : matchesPriorityFilter(store, "open-lane")
    ? 1
    : 0;
  return laneRank * 10 + priorityRank(store);
}

function PriorityDot({ store }: { store: StoreRollup }) {
  if (showsOverdueColor(store)) {
    const label = `Overdue${store.priorityLevel ? ` · ${store.priorityLevel} priority` : ""}`;
    return (
      <span
        aria-label={label}
        className="priority-dot"
        style={{ background: overdueColor(store) }}
        title={label}
      />
    );
  }

  const rank = priorityRank(store);
  if (!rank) {
    return <span aria-label="No priority status" className="priority-empty" />;
  }

  return (
    <span
      aria-label={`${store.mapCategory}`}
      className="priority-dot"
      style={{ background: TERRITORY_MAP_COLORS[store.mapCategory] ?? "var(--muted)" }}
      title={store.mapCategory}
    />
  );
}

function matchesBrandFilter(store: StoreRollup, brand: BrandFilter) {
  if (brand === "K. Savage") {
    return store.kSavageActiveRevenue > 0;
  }
  if (brand === "Mayfield") {
    return store.mayfieldActiveRevenue > 0;
  }
  if (brand === "Leisure Land") {
    return store.leisureLandActiveRevenue > 0;
  }
  return true;
}

function brandPlacements(store: StoreRollup) {
  return TERRITORY_BRANDS.filter((brand) => matchesBrandFilter(store, brand));
}

function BrandPlacementDots({ store }: { store: StoreRollup }) {
  const brands = brandPlacements(store);

  return (
    <span
      aria-label={brands.length ? `Brand placement: ${brands.join(", ")}` : "No brand placement"}
      className="brand-dots"
      title={brands.length ? brands.join(", ") : "No brand placement"}
    >
      {brands.map((brand) => (
        <span
          aria-hidden="true"
          className="brand-dot"
          key={brand}
          style={{ background: BRAND_DOT_COLORS[brand] ?? "var(--muted)" }}
        />
      ))}
    </span>
  );
}

function normalizeBrandFilters(value: StoreFilters["brand"] | BrandFilter | "all" | undefined) {
  if (Array.isArray(value)) {
    return value.filter((brand): brand is BrandFilter => (
      TERRITORY_BRANDS.includes(brand as BrandFilter)
    ));
  }
  if (value && value !== "all" && TERRITORY_BRANDS.includes(value as BrandFilter)) {
    return [value as BrandFilter];
  }
  return [];
}

function brandFilterLabel(brands: BrandFilter[]) {
  if (!brands.length) {
    return "All brands";
  }
  if (brands.length === 1) {
    return brands[0];
  }
  return `${brands.length} brands`;
}

function applyStoreFilters(stores: StoreRollup[], filters: StoreFilters) {
  let nextStores = stores;

  if (filters.balaclavaSales !== "all") {
    const minimum = Number(filters.balaclavaSales);
    nextStores = nextStores.filter((store) => latestBalaclavaRevenue(store) >= minimum);
  }

  if (filters.storeRevenue !== "all") {
    const minimum = Number(filters.storeRevenue);
    nextStores = nextStores.filter((store) => store.marketSalesLastMonth >= minimum);
  }

  const brandFilters = normalizeBrandFilters(filters.brand);
  if (brandFilters.length) {
    nextStores = nextStores.filter((store) => (
      brandFilters.some((brand) => matchesBrandFilter(store, brand))
    ));
  }

  if (filters.priority !== "all") {
    nextStores = nextStores.filter((store) => matchesPriorityFilter(store, filters.priority));
  }

  if (filters.region !== "all") {
    nextStores = nextStores.filter((store) => textSortValue(store.county) === filters.region);
  }

  if (filters.group !== "all") {
    nextStores = nextStores.filter((store) => store.groupName === filters.group);
  }

  if (filters.reorderGap) {
    const now = Date.now();
    const RECENT_SALE_MS = 14 * 86_400_000;
    const STALE_ORDER_MS = 30 * 86_400_000;
    nextStores = nextStores.filter((store) => {
      if (!store.headsetLastSale) return false;
      const lastSaleAge = now - new Date(store.headsetLastSale).getTime();
      if (lastSaleAge > RECENT_SALE_MS) return false;
      if (!store.lastOrderAt) return true;
      return now - new Date(store.lastOrderAt).getTime() > STALE_ORDER_MS;
    });
  }

  if (filters.pareto === "top30") {
    const topKeys = new Set(
      [...nextStores]
        .sort((left, right) => right.marketSalesLastMonth - left.marketSalesLastMonth)
        .slice(0, 30)
        .map(storeKey)
    );
    nextStores = nextStores.filter((store) => topKeys.has(storeKey(store)));
  } else if (filters.pareto === "eighty") {
    const sortedByRevenue = [...nextStores].sort(
      (left, right) => right.marketSalesLastMonth - left.marketSalesLastMonth
    );
    const totalRevenue = sortedByRevenue.reduce((total, store) => total + store.marketSalesLastMonth, 0);
    const paretoKeys = new Set<string>();
    let cumulativeRevenue = 0;

    for (const store of sortedByRevenue) {
      if (totalRevenue <= 0) {
        break;
      }
      paretoKeys.add(storeKey(store));
      cumulativeRevenue += store.marketSalesLastMonth;
      if (cumulativeRevenue / totalRevenue >= 0.8) {
        break;
      }
    }

    nextStores = nextStores.filter((store) => paretoKeys.has(storeKey(store)));
  }

  return nextStores;
}

function countActiveFilters(filters: StoreFilters) {
  return [
    filters.balaclavaSales !== "all",
    filters.storeRevenue !== "all",
    normalizeBrandFilters(filters.brand).length > 0,
    filters.pareto !== "all",
    filters.priority !== "all",
    filters.region !== "all",
    filters.group !== "all",
    filters.reorderGap
  ].filter(Boolean).length;
}

function formatDate(value?: string | null) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  }).format(date);
}

function formatShortDate(value?: string | null) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "2-digit",
    timeZone: "UTC"
  }).format(date);
}

function normalizeCategory(subProductLine?: string | null): string {
  if (!subProductLine) return "Uncategorized";
  const stripped = subProductLine.replace(/^(KS|MF|LL)[- ]/i, "").trim();
  return stripped || subProductLine;
}

function extractUnitSize(productName?: string | null): string {
  if (!productName) return "Other";
  const weightMatch = productName.match(/\b(\d+(?:\.\d+)?)\s*(g|mg|oz|ml)\b/i);
  if (weightMatch) return `${weightMatch[1]}${weightMatch[2].toLowerCase()}`;
  const packMatch = productName.match(/\b(\d+)\s*[-]?\s*(?:pk|pack)\b/i);
  if (packMatch) return `${packMatch[1]}pk`;
  return "Other";
}

function extractStrain(productName?: string | null): string {
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

function formatSyncDateTime(value?: string | null) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
  const day = new Intl.DateTimeFormat("en-US", {
    month: "numeric",
    day: "numeric",
    year: "2-digit"
  }).format(date);
  return `${time} ${day}`;
}

function formatMonth(value?: string | null) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC"
  }).format(date);
}

function dateInputValue(value?: string | null) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toISOString().slice(0, 10);
}

function orderTimestamp(value?: string | null) {
  if (!value) {
    return 0;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function orderLineStoreKey(line: OrderLine) {
  return line.storeId || line.licenseKey || line.license || line.storeName;
}

function orderLineStoreKeys(line: OrderLine) {
  return [line.storeId, line.licenseKey, line.license, orderLineStoreKey(line)]
    .filter((value): value is string => Boolean(value));
}

function orderLineKey(line: OrderLine) {
  return `${line.orderNumber || line.orderId}-${line.licenseKey || line.license || line.storeId || line.storeName}`;
}

function orderStatusValue(line: OrderLine) {
  return String(line.status || "Unknown").trim() || "Unknown";
}

function orderBrandValue(line: OrderLine) {
  return String(line.brand || "Other").trim() || "Other";
}

function isPaidOrderLine(line: OrderLine) {
  return line.lineTotal > 0 && orderBrandValue(line).toLowerCase() !== "bulk";
}

function uniqueOrderCount(lines: OrderLine[]) {
  return new Set(lines.map(orderLineKey)).size;
}

function latestOrderDate(lines: OrderLine[]) {
  const latest = lines.reduce((maxTimestamp, line) => Math.max(maxTimestamp, orderTimestamp(line.submittedAt)), 0);
  return latest ? new Date(latest).toISOString() : null;
}

function orderDateBounds(lines: OrderLine[]) {
  const timestamps = lines
    .map((line) => orderTimestamp(line.submittedAt))
    .filter((timestamp) => timestamp > 0);

  if (!timestamps.length) {
    const today = localDateInputValue();
    return {
      min: today,
      max: today,
      defaultFrom: today,
      defaultTo: today
    };
  }

  const minDate = new Date(Math.min(...timestamps));
  const maxDate = new Date(Math.max(...timestamps));
  const defaultFrom = new Date(maxDate);
  defaultFrom.setUTCDate(1);

  return {
    min: dateInputValue(minDate.toISOString()),
    max: dateInputValue(maxDate.toISOString()),
    defaultFrom: dateInputValue(defaultFrom.toISOString()),
    defaultTo: dateInputValue(maxDate.toISOString())
  };
}

function lineIsInsideDateRange(line: OrderLine, fromDate: string, toDate: string) {
  const lineDate = dateInputValue(line.submittedAt);
  if (!lineDate) {
    return false;
  }
  const start = fromDate <= toDate ? fromDate : toDate;
  const end = fromDate <= toDate ? toDate : fromDate;
  return lineDate >= start && lineDate <= end;
}

type GoalWeek = {
  id: string;
  label: string;
  start: string;
  end: string;
};

type GoalDraft = {
  brandEom: Record<BrandFilter, string>;
  brandWeeks: Record<string, Record<BrandFilter, string>>;
  notes: Record<string, string>;
};

type GoalDailyPoint = {
  date: string;
  dailySales: number;
  actualCumulative: number;
  eomPace: number;
  weeklyPace: number;
  projectedPace: number | null;
};

function emptyBrandGoalStrings() {
  return TERRITORY_BRANDS.reduce((values, brand) => ({
    ...values,
    [brand]: ""
  }), {} as Record<BrandFilter, string>);
}

function emptyBrandGoalNumbers() {
  return TERRITORY_BRANDS.reduce((values, brand) => ({
    ...values,
    [brand]: 0
  }), {} as Record<BrandFilter, number>);
}

function cleanGoalNumber(value: unknown) {
  const parsed = Number(String(value ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function currentMonthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthKeyFromDateValue(value?: string | null) {
  const dateValue = dateInputValue(value);
  return dateValue ? dateValue.slice(0, 7) : "";
}

function monthStartDate(monthKey: string) {
  return `${monthKey}-01`;
}

function monthEndDate(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  if (!year || !month) {
    return monthStartDate(currentMonthKey());
  }
  return dateInputValue(new Date(Date.UTC(year, month, 0)).toISOString());
}

function addUtcDays(dateValue: string, days: number) {
  const date = new Date(`${dateValue}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return dateInputValue(date.toISOString());
}

function daysBetweenInclusive(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00Z`).getTime();
  const end = new Date(`${endDate}T00:00:00Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return 0;
  }
  return Math.floor((end - start) / 86400000) + 1;
}

function enumerateDates(startDate: string, endDate: string) {
  const days = daysBetweenInclusive(startDate, endDate);
  return Array.from({ length: days }, (_, index) => addUtcDays(startDate, index));
}

function shortDateLabel(dateValue: string) {
  const date = new Date(`${dateValue}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    return dateValue;
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  }).format(date);
}

function monthLabel(monthKey: string) {
  const date = new Date(`${monthKey}-01T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    return monthKey;
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  }).format(date);
}

function goalMonthOptions(orderLines: OrderLine[], salesGoals: SalesGoal[]) {
  const months = new Set<string>([currentMonthKey()]);
  orderLines.forEach((line) => {
    const month = monthKeyFromDateValue(line.submittedAt);
    if (month) {
      months.add(month);
    }
  });
  salesGoals.forEach((goal) => {
    const month = monthKeyFromDateValue(goal.goalMonth);
    if (month) {
      months.add(month);
    }
  });
  return [...months].sort((left, right) => right.localeCompare(left));
}

function monthWeeks(monthKey: string): GoalWeek[] {
  const start = monthStartDate(monthKey);
  const end = monthEndDate(monthKey);
  const weeks: GoalWeek[] = [];
  let cursor = start;

  while (cursor <= end) {
    const day = new Date(`${cursor}T00:00:00Z`).getUTCDay();
    const daysUntilSunday = day === 0 ? 0 : 7 - day;
    const weekEnd = [addUtcDays(cursor, daysUntilSunday), end].sort()[0];
    weeks.push({
      id: cursor,
      label: `${shortDateLabel(cursor)} - ${shortDateLabel(weekEnd)}`,
      start: cursor,
      end: weekEnd
    });
    cursor = addUtcDays(weekEnd, 1);
  }

  return weeks;
}

function goalsDraftFromRows(salesGoals: SalesGoal[], monthKey: string, weeks: GoalWeek[]): GoalDraft {
  const brandEom = emptyBrandGoalStrings();
  const brandWeeks = Object.fromEntries(
    weeks.map((week) => [week.id, emptyBrandGoalStrings()])
  ) as Record<string, Record<BrandFilter, string>>;
  const notes: Record<string, string> = {};

  salesGoals
    .filter((goal) => monthKeyFromDateValue(goal.goalMonth) === monthKey)
    .forEach((goal) => {
      const goalType = goal.goalType.trim().toLowerCase();
      const brand = goal.brand as BrandFilter;
      const amount = cleanGoalNumber(goal.goalAmount);
      if (goalType === "eom" && TERRITORY_BRANDS.includes(brand) && amount > 0) {
        brandEom[brand] = String(Math.round(amount));
      }
      if ((goalType === "week" || goalType === "weekly") && goal.weekId) {
        if (!brandWeeks[goal.weekId]) {
          brandWeeks[goal.weekId] = emptyBrandGoalStrings();
        }
        if (TERRITORY_BRANDS.includes(brand) && amount > 0) {
          brandWeeks[goal.weekId][brand] = String(Math.round(amount));
        }
        if (goal.notes) {
          notes[goal.weekId] = goal.notes;
        }
      }
      if ((goalType === "week note" || goalType === "note") && goal.weekId && goal.notes) {
        notes[goal.weekId] = goal.notes;
      }
    });

  return { brandEom, brandWeeks, notes };
}

function goalDraftSignature(draft: GoalDraft) {
  return JSON.stringify(draft);
}

function goalBrandFilterValues(brandFilter: "all" | BrandFilter) {
  return brandFilter === "all" ? [...TERRITORY_BRANDS] : [brandFilter];
}

function sumGoalValues(values: Record<BrandFilter, string>, brands: BrandFilter[]) {
  return brands.reduce((total, brand) => total + cleanGoalNumber(values[brand]), 0);
}

function buildGoalDailyPoints({
  orderLines,
  monthKey,
  weeks,
  eomGoal,
  weeklyGoals,
  brands
}: {
  orderLines: OrderLine[];
  monthKey: string;
  weeks: GoalWeek[];
  eomGoal: number;
  weeklyGoals: Record<string, number>;
  brands: BrandFilter[];
}) {
  const start = monthStartDate(monthKey);
  const end = monthEndDate(monthKey);
  const days = enumerateDates(start, end);
  const dailySales = new Map(days.map((day) => [day, 0]));
  const brandSet = new Set(brands);

  orderLines.forEach((line) => {
    const brand = orderBrandValue(line) as BrandFilter;
    const lineDate = dateInputValue(line.submittedAt);
    if (!isPaidOrderLine(line) || !brandSet.has(brand) || lineDate < start || lineDate > end) {
      return;
    }
    dailySales.set(lineDate, (dailySales.get(lineDate) || 0) + line.lineTotal);
  });

  let actualCumulative = 0;
  let weeklyCumulative = 0;
  const weeklyDailyTargets = new Map<string, number>();
  weeks.forEach((week) => {
    const goal = cleanGoalNumber(weeklyGoals[week.id]);
    if (goal <= 0) {
      return;
    }
    const weekDays = enumerateDates(week.start, week.end);
    const dailyTarget = goal / Math.max(1, weekDays.length);
    weekDays.forEach((day) => weeklyDailyTargets.set(day, dailyTarget));
  });

  const today = localDateInputValue();
  const progressDay = today < start ? start : today > end ? end : today;
  const totalDays = Math.max(1, days.length);
  const elapsedDays = Math.max(1, days.filter((day) => day <= progressDay).length);
  const salesToDate = days
    .filter((day) => day <= progressDay)
    .reduce((total, day) => total + (dailySales.get(day) || 0), 0);
  const projectedEom = progressDay === end ? salesToDate : (salesToDate / elapsedDays) * totalDays;
  const projectionStartIndex = Math.max(0, days.indexOf(progressDay));
  const projectionSteps = Math.max(1, days.length - projectionStartIndex - 1);

  const points = days.map((day, index) => {
    const daily = dailySales.get(day) || 0;
    actualCumulative += daily;
    weeklyCumulative += weeklyDailyTargets.get(day) || 0;
    const projectedPace = day < progressDay
      ? null
      : salesToDate + (projectedEom - salesToDate) * ((index - projectionStartIndex) / projectionSteps);
    return {
      date: day,
      dailySales: daily,
      actualCumulative,
      eomPace: eomGoal * ((index + 1) / totalDays),
      weeklyPace: weeklyCumulative,
      projectedPace
    };
  });

  return { points, progressDay, salesToDate, projectedEom };
}

function percentLabel(value: number, target: number) {
  if (!target) {
    return "0.0%";
  }
  return `${((value / target) * 100).toFixed(1)}%`;
}

function useOrderSync() {
  const router = useRouter();
  const [syncState, setSyncState] = useState<SyncState>("idle");
  const [syncMessage, setSyncMessage] = useState("");

  const syncOrders = useCallback(async () => {
    setSyncState("syncing");
    setSyncMessage("Syncing Cultivera orders...");

    try {
      const response = await fetch("/api/sync-orders", { method: "POST" });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result?.error || "Could not sync orders.");
      }
      setSyncState("success");
      setSyncMessage(
        `Synced ${Number(result.orderRows || 0).toLocaleString()} orders and ${Number(result.itemRows || 0).toLocaleString()} line items.`
      );
      router.refresh();
    } catch (error) {
      setSyncState("error");
      setSyncMessage(error instanceof Error ? error.message : "Could not sync orders.");
    }
  }, [router]);

  return { syncState, syncMessage, syncOrders };
}

function localDateInputValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function localDateFromInput(value?: string | null) {
  const date = value ? new Date(`${value}T00:00:00`) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function startOfWeek(date: Date) {
  const start = new Date(date);
  const daysSinceMonday = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - daysSinceMonday);
  start.setHours(0, 0, 0, 0);
  return start;
}

function isContactThisMonth(dateValue?: string | null) {
  const contactDate = localDateFromInput(dateValue);
  const today = new Date();
  return (
    contactDate.getFullYear() === today.getFullYear()
    && contactDate.getMonth() === today.getMonth()
  );
}

function isContactThisWeek(dateValue?: string | null) {
  const contactDate = localDateFromInput(dateValue);
  contactDate.setHours(0, 0, 0, 0);
  const weekStart = startOfWeek(new Date());
  const nextWeekStart = new Date(weekStart);
  nextWeekStart.setDate(nextWeekStart.getDate() + 7);
  return contactDate >= weekStart && contactDate < nextWeekStart;
}

function DetailStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="metric">
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
    </div>
  );
}

function latestMonthBrandContributions(store: StoreRollup) {
  return [
    {
      brand: "K. Savage" as BrandFilter,
      value: store.kSavageLatestMonthRevenue
    },
    {
      brand: "Mayfield" as BrandFilter,
      value: store.mayfieldLatestMonthRevenue
    },
    {
      brand: "Leisure Land" as BrandFilter,
      value: store.leisureLandLatestMonthRevenue
    }
  ];
}

function latestBalaclavaMonthLabel(store: StoreRollup) {
  // Prefer the latest month the store actually ordered a Balaclava brand (from
  // the orders feed) over the realized monthly-revenue profile, which lags
  // behind orders that aren't Paid yet.
  return formatMonth(store.latestBrandMonth || store.latestMonth || store.kSavageLastOrderAt);
}

// Balaclava revenue for the latest actual order month, falling back to the
// realized monthly figure for stores with no recent brand orders.
function latestBalaclavaRevenue(store: StoreRollup) {
  return store.latestMonthBrandRevenue > 0 ? store.latestMonthBrandRevenue : store.latestMonthRevenue;
}

function LatestMonthStat({ store }: { store: StoreRollup }) {
  const brandTotal = store.latestMonthBrandRevenue || 0;
  const total = brandTotal > 0 ? brandTotal : store.latestMonthRevenue;
  const showContributions = brandTotal > 0;
  const latestMonthLabel = latestBalaclavaMonthLabel(store);

  return (
    <div className="metric latest-month-card">
      <div className="metric-label">{latestMonthLabel ? `Latest Month: ${latestMonthLabel}` : "Latest Month"}</div>
      {showContributions ? (
        <div className="brand-contributions">
          {latestMonthBrandContributions(store).map((contribution) => (
            <div className="brand-contribution-row" key={contribution.brand}>
              <span>
                <span
                  aria-hidden="true"
                  className="brand-dot mini"
                  style={{ background: BRAND_DOT_COLORS[contribution.brand] ?? "var(--muted)" }}
                />
                {contribution.brand}
              </span>
              <strong>{formatUsd(contribution.value)}</strong>
            </div>
          ))}
        </div>
      ) : null}
      <div className="metric-value">{formatUsd(total)}</div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="detail-row">
      <span>{label}</span>
      <strong>{value === null || value === undefined || value === "" ? "-" : value}</strong>
    </div>
  );
}

function StoreDetailSummary({ store }: { store: StoreRollup }) {
  const location = [store.city, store.state, store.zip].filter(Boolean).join(", ");
  const latestMonthLabel = latestBalaclavaMonthLabel(store);

  return (
    <div className="detail-summary">
      <div className="detail-list compact">
        <DetailRow label="License" value={store.license} />
        <DetailRow label="Rep" value={store.territoryRep} />
        <DetailRow label="Location" value={location} />
        <DetailRow
          label={latestMonthLabel ? `Latest Balaclava (${latestMonthLabel})` : "Latest Balaclava"}
          value={formatUsd(latestBalaclavaRevenue(store))}
        />
        <DetailRow label="Market sales" value={formatUsd(store.marketSalesLastMonth)} />
        <DetailRow label="Orders" value={store.orders.toLocaleString()} />
        <DetailRow label="Log entries" value={store.contactLogCount.toLocaleString()} />
      </div>
    </div>
  );
}

function GroupEditor({
  store,
  existingGroups,
  onSaved
}: {
  store: StoreRollup;
  existingGroups: string[];
  onSaved: (storeId: string, groupName: string | null) => void;
}) {
  const [groupName, setGroupName] = useState(store.groupName ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setGroupName(store.groupName ?? "");
    setMessage("");
  }, [store.groupName, store.storeId]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!store.storeId) {
      setMessage("This store is missing a Supabase store id.");
      return;
    }
    setIsSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/store-group", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId: store.storeId, groupName: groupName.trim() || null })
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || "Could not save group.");
      }
      onSaved(store.storeId, result.groupName);
      setMessage("Saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save group.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form className="detail-form" onSubmit={handleSubmit}>
      <div className="detail-form-title">Store Group</div>
      <div className="field">
        <label>Group / Chain</label>
        <input
          type="text"
          list="existing-groups"
          value={groupName}
          onChange={(event) => setGroupName(event.target.value)}
          placeholder="e.g. Hemptown, Green Leaf"
          disabled={isSaving}
        />
        {existingGroups.length ? (
          <datalist id="existing-groups">
            {existingGroups.map((g) => <option key={g} value={g} />)}
          </datalist>
        ) : null}
      </div>
      <div className="detail-form-actions">
        <button className="primary-button" type="submit" disabled={isSaving}>
          {isSaving ? "Saving…" : "Save Group"}
        </button>
      </div>
      {message ? <span className="status-message">{message}</span> : null}
    </form>
  );
}

function ServiceNoteEditor({
  store,
  onSaved
}: {
  store: StoreRollup;
  onSaved: (storeId: string, serviceNote: string | null) => void;
}) {
  const [note, setNote] = useState(store.serviceNote ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setNote(store.serviceNote ?? "");
    setMessage("");
  }, [store.serviceNote, store.storeId]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!store.storeId) {
      setMessage("This store is missing a Supabase store id.");
      return;
    }
    setIsSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/store-service-note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId: store.storeId, serviceNote: note.trim() || null })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save note.");
      onSaved(store.storeId, result.serviceNote);
      setMessage("Saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save note.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form className="detail-form" onSubmit={handleSubmit}>
      <div className="detail-form-title">Service Note</div>
      <div className="field">
        <label>Special Instructions</label>
        <textarea
          rows={3}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="e.g. Call ahead, ask for back-room buyer"
          disabled={isSaving}
          style={{ resize: "vertical" }}
        />
      </div>
      <div className="detail-form-actions">
        <button className="primary-button" type="submit" disabled={isSaving}>
          {isSaving ? "Saving…" : "Save Note"}
        </button>
        {note && !isSaving ? (
          <button
            className="secondary-button"
            type="button"
            onClick={() => { setNote(""); }}
          >
            Clear
          </button>
        ) : null}
      </div>
      {message ? <span className="status-message">{message}</span> : null}
    </form>
  );
}

type BuyerContact = {
  id: string;
  contactName: string | null;
  phoneNumber: string | null;
  email: string | null;
  role: string | null;
};

type BuyerFormState = {
  contactName: string;
  phoneNumber: string;
  email: string;
  role: string;
};

function emptyBuyerForm(): BuyerFormState {
  return { contactName: "", phoneNumber: "", email: "", role: "" };
}

function BuyerContactForm({
  initial,
  isSaving,
  onSubmit,
  onCancel
}: {
  initial: BuyerFormState;
  isSaving: boolean;
  onSubmit: (form: BuyerFormState) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<BuyerFormState>(initial);

  function field(key: keyof BuyerFormState) {
    return (event: React.ChangeEvent<HTMLInputElement>) =>
      setForm((prev) => ({ ...prev, [key]: event.target.value }));
  }

  return (
    <form
      className="buyer-contact-form"
      onSubmit={(event) => { event.preventDefault(); onSubmit(form); }}
    >
      <div className="form-grid">
        <div className="field">
          <label>Name</label>
          <input value={form.contactName} onChange={field("contactName")} placeholder="Buyer name" disabled={isSaving} />
        </div>
        <div className="field">
          <label>Role</label>
          <input value={form.role} onChange={field("role")} placeholder="e.g. Head Buyer, Owner" disabled={isSaving} />
        </div>
        <div className="field">
          <label>Phone</label>
          <input value={form.phoneNumber} onChange={field("phoneNumber")} placeholder="Phone number" type="tel" disabled={isSaving} />
        </div>
        <div className="field">
          <label>Email</label>
          <input value={form.email} onChange={field("email")} placeholder="Email address" type="email" disabled={isSaving} />
        </div>
      </div>
      <div className="buyer-form-actions">
        <button className="primary-button" type="submit" disabled={isSaving}>
          {isSaving ? "Saving…" : "Save"}
        </button>
        <button className="secondary-button" type="button" onClick={onCancel} disabled={isSaving}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function BuyerEditor({
  store,
  onSaved
}: {
  store: StoreRollup;
  onSaved: (storeId: string, buyer: BuyerContactPatch) => void;
}) {
  const [contacts, setContacts] = useState<BuyerContact[]>([]);
  const [loadStatus, setLoadStatus] = useState<"idle" | "loading" | "error">("idle");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!store.storeId) return;
    const controller = new AbortController();
    setLoadStatus("loading");
    setEditingId(null);
    setIsAdding(false);
    setMessage("");

    fetch(`/api/store-contacts?storeId=${encodeURIComponent(store.storeId)}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((result) => {
        setContacts(Array.isArray(result.contacts) ? result.contacts : []);
        setLoadStatus("idle");
      })
      .catch((err) => {
        if (err?.name !== "AbortError") setLoadStatus("error");
      });

    return () => controller.abort();
  }, [store.storeId]);

  function syncSnapshot(nextContacts: BuyerContact[]) {
    const first = nextContacts[0] ?? null;
    if (store.storeId) {
      onSaved(store.storeId, {
        contactName: first?.contactName ?? null,
        phoneNumber: first?.phoneNumber ?? null,
        email: first?.email ?? null
      });
    }
  }

  async function handleSave(form: BuyerFormState, id?: string) {
    if (!store.storeId) return;
    setIsSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/store-contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId: store.storeId, id: id ?? null, ...form })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save.");
      const saved: BuyerContact = result.contact;
      const nextContacts = id
        ? contacts.map((c) => (c.id === id ? saved : c))
        : [...contacts, saved];
      setContacts(nextContacts);
      syncSnapshot(nextContacts);
      setEditingId(null);
      setIsAdding(false);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!store.storeId) return;
    setIsSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/store-contacts", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, storeId: store.storeId })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not delete.");
      const nextContacts = contacts.filter((c) => c.id !== id);
      setContacts(nextContacts);
      syncSnapshot(nextContacts);
      if (editingId === id) setEditingId(null);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not delete.");
    } finally {
      setIsSaving(false);
    }
  }

  if (loadStatus === "loading") {
    return <p className="detail-note">Loading buyers…</p>;
  }

  if (loadStatus === "error") {
    return <p className="detail-note">Could not load buyer contacts.</p>;
  }

  return (
    <div className="buyer-editor">
      <div className="buyer-editor-header">
        <span className="detail-form-title">Buyer Contacts</span>
        {!isAdding && (
          <button
            className="secondary-button"
            type="button"
            onClick={() => { setIsAdding(true); setEditingId(null); }}
          >
            + Add buyer
          </button>
        )}
      </div>

      {contacts.length === 0 && !isAdding ? (
        <p className="detail-note">No buyers added yet.</p>
      ) : null}

      <div className="buyer-contact-list">
        {contacts.map((contact) => (
          <div key={contact.id} className="buyer-contact-card">
            {editingId === contact.id ? (
              <BuyerContactForm
                initial={{
                  contactName: contact.contactName ?? "",
                  phoneNumber: contact.phoneNumber ?? "",
                  email: contact.email ?? "",
                  role: contact.role ?? ""
                }}
                isSaving={isSaving}
                onSubmit={(form) => handleSave(form, contact.id)}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <div className="buyer-contact-row">
                <div className="buyer-contact-info">
                  <span className="buyer-contact-name">
                    {contact.contactName || <em className="muted">No name</em>}
                  </span>
                  {contact.role ? <span className="buyer-contact-role">{contact.role}</span> : null}
                  {contact.phoneNumber ? <span className="buyer-contact-detail">{contact.phoneNumber}</span> : null}
                  {contact.email ? <span className="buyer-contact-detail">{contact.email}</span> : null}
                </div>
                <div className="buyer-contact-actions">
                  <button
                    className="icon-button"
                    type="button"
                    title="Edit"
                    onClick={() => { setEditingId(contact.id); setIsAdding(false); }}
                    disabled={isSaving}
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    className="icon-button"
                    type="button"
                    title="Delete"
                    onClick={() => handleDelete(contact.id)}
                    disabled={isSaving}
                  >
                    <X size={13} />
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {isAdding ? (
        <BuyerContactForm
          initial={emptyBuyerForm()}
          isSaving={isSaving}
          onSubmit={(form) => handleSave(form)}
          onCancel={() => setIsAdding(false)}
        />
      ) : null}

      {message ? <span className="status-message">{message}</span> : null}
    </div>
  );
}

function ContactLogForm({
  store,
  onSaved
}: {
  store: StoreRollup;
  onSaved: (storeId: string, contactLog: ContactLogPatch) => void;
}) {
  const [dateContacted, setDateContacted] = useState(localDateInputValue());
  const [contactMethod, setContactMethod] = useState("");
  const [initials, setInitials] = useState(store.territoryRep ?? "");
  const [personContacted, setPersonContacted] = useState(store.contactName ?? "");
  const [notes, setNotes] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setDateContacted(localDateInputValue());
    setContactMethod("");
    setInitials(store.territoryRep ?? "");
    setPersonContacted(store.contactName ?? "");
    setNotes("");
    setMessage("");
  }, [store.contactName, store.storeId, store.territoryRep]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!store.storeId) {
      setMessage("This store is missing a Supabase store id.");
      return;
    }

    setIsSaving(true);
    setMessage("");

    try {
      const response = await fetch("/api/contact-logs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          storeId: store.storeId,
          license: store.license,
          licenseKey: store.licenseKey,
          storeName: store.storeName,
          dateContacted,
          contactMethod,
          initials,
          personContacted,
          notes
        })
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Could not save contact log.");
      }

      onSaved(result.storeId, {
        storeId: result.storeId,
        dateContacted: result.dateContacted,
        contactMethod: result.contactMethod,
        initials: result.initials,
        personContacted: result.personContacted,
        notes: result.notes,
        savedAt: result.savedAt
      });
      setNotes("");
      setMessage("Saved");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save contact log.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form className="detail-stack" onSubmit={handleSubmit}>
      <div className="detail-tabs">
        <CheckState active={store.hasContactEver} label="Any log" />
        <CheckState active={store.hasContactThisMonth} label="This month" />
        <CheckState active={store.hasContactThisWeek} label="This week" />
      </div>
      <div className="form-grid">
        <div className="field">
          <label>Date contacted</label>
          <input
            value={dateContacted}
            onChange={(event) => setDateContacted(event.target.value)}
            type="date"
          />
        </div>
        <div className="field">
          <label>Contact method</label>
          <select
            value={contactMethod}
            onChange={(event) => setContactMethod(event.target.value)}
          >
            <option value="">Select</option>
            <option>In-person</option>
            <option>Phone</option>
            <option>Email</option>
            <option>Text</option>
          </select>
        </div>
        <div className="field">
          <label>Initials</label>
          <input
            value={initials}
            onChange={(event) => setInitials(event.target.value.toUpperCase())}
            placeholder="Rep initials"
          />
        </div>
        <div className="field">
          <label>Person contacted</label>
          <input
            value={personContacted}
            onChange={(event) => setPersonContacted(event.target.value)}
            placeholder="Buyer or staff name"
          />
        </div>
      </div>
      <div className="field">
        <label>Notes</label>
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="What happened, next step, objection, commitment..."
          rows={4}
        />
      </div>
      <button className="primary-button detail-save-button" type="submit" disabled={isSaving}>
        {isSaving ? "Saving..." : "Save Contact Log"}
      </button>
      {message ? <div className="status-message">{message}</div> : null}
    </form>
  );
}

function createPopupContent(store: StoreRollup) {
  const container = document.createElement("div");
  container.className = "map-popup";

  const title = document.createElement("strong");
  title.textContent = store.storeName;
  container.appendChild(title);

  const license = document.createElement("span");
  license.textContent = `${store.license} · ${store.city || "No city"}`;
  container.appendChild(license);

  const brands = document.createElement("span");
  const placedBrands = brandPlacements(store);
  brands.textContent = placedBrands.length ? `Brands ${placedBrands.join(", ")}` : "No brand placement";
  container.appendChild(brands);

  const revenue = document.createElement("span");
  revenue.textContent = `Balaclava ${formatUsd(latestBalaclavaRevenue(store))} · Market ${formatUsd(store.marketSalesLastMonth)}`;
  container.appendChild(revenue);

  return container;
}

function StoreMap({
  stores,
  routeStart = DEFAULT_ROUTE_START,
  routeStores = [],
  selectedStore,
  onSelect
}: {
  stores: StoreRollup[];
  routeStart?: RouteStart;
  routeStores?: StoreRollup[];
  selectedStore?: StoreRollup;
  onSelect: (storeKeyValue: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const maplibreRef = useRef<MapLibreModule | null>(null);
  const markersRef = useRef<Map<string, { marker: MapLibreMarker; element: HTMLButtonElement }>>(new Map());
  const routeMarkersRef = useRef<Map<string, MapLibreMarker>>(new Map());
  const [isMapReady, setIsMapReady] = useState(false);
  const [roadRouteCoordinates, setRoadRouteCoordinates] = useState<[number, number][] | null | undefined>(null);
  const mappedStores = useMemo(() => stores.filter(hasStoreCoordinates), [stores]);
  const selectedStoreKey = selectedStore ? storeKey(selectedStore) : "";
  const selectedStoreKeyRef = useRef(selectedStoreKey);
  const routeStopCoordinates = useMemo(() => (
    routeStores.filter(hasStoreCoordinates).map(storeCoordinates)
  ), [routeStores]);
  const mappedStoreSignature = useMemo(() => mappedStores.map(storeKey).join("|"), [mappedStores]);
  const routeStoreSignature = useMemo(() => (
    routeStores.filter(hasStoreCoordinates).map(storeKey).join("|")
  ), [routeStores]);
  const routeCoordinateSignature = useMemo(() => (
    routeStopCoordinates.map((coordinates) => `${coordinates.latitude},${coordinates.longitude}`).join("|")
  ), [routeStopCoordinates]);
  const routeData = useMemo(
    () => routeLineData(
      routeStores,
      routeStart,
      roadRouteCoordinates,
      routeStopCoordinates.length > 0 && roadRouteCoordinates === undefined
    ),
    [
      roadRouteCoordinates,
      routeCoordinateSignature,
      routeStart.latitude,
      routeStart.longitude,
      routeStoreSignature,
      routeStopCoordinates.length
    ]
  );

  useEffect(() => {
    let cancelled = false;

    async function initializeMap() {
      const maplibregl = await import("maplibre-gl");
      if (cancelled || !containerRef.current || mapRef.current) {
        return;
      }

      maplibreRef.current = maplibregl;
      const map = new maplibregl.Map({
        container: containerRef.current,
        center: [-120.7401, 47.7511],
        zoom: 6,
        attributionControl: false,
        style: {
          version: 8,
          sources: {
            osm: {
              type: "raster",
              tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
              tileSize: 256,
              attribution: "© OpenStreetMap contributors"
            }
          },
          layers: [
            {
              id: "osm",
              type: "raster",
              source: "osm"
            }
          ]
        }
      });

      map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-right");
      map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
      map.on("load", () => {
        if (!cancelled) {
          setIsMapReady(true);
        }
      });
      mapRef.current = map;
    }

    initializeMap();

    return () => {
      cancelled = true;
      markersRef.current.forEach(({ marker }) => marker.remove());
      markersRef.current.clear();
      routeMarkersRef.current.forEach((marker) => marker.remove());
      routeMarkersRef.current.clear();
      mapRef.current?.remove();
      mapRef.current = null;
      maplibreRef.current = null;
      setIsMapReady(false);
    };
  }, []);

  useEffect(() => {
    if (!routeStopCoordinates.length) {
      setRoadRouteCoordinates(null);
      return;
    }

    const controller = new AbortController();
    setRoadRouteCoordinates(undefined);

    async function fetchRoadRoute() {
      try {
        setRoadRouteCoordinates(await fetchRoadRouteCoordinates(
          routeStart,
          routeStopCoordinates,
          controller.signal
        ));
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setRoadRouteCoordinates(null);
        }
      }
    }

    fetchRoadRoute();

    return () => controller.abort();
  }, [routeCoordinateSignature, routeStart.latitude, routeStart.longitude]);

  useEffect(() => {
    const map = mapRef.current;
    const maplibregl = maplibreRef.current;
    if (!map || !maplibregl || !isMapReady) {
      return;
    }

    markersRef.current.forEach(({ marker }) => marker.remove());
    markersRef.current.clear();

    mappedStores.forEach((store) => {
      const key = storeKey(store);
      const element = document.createElement("button");
      element.type = "button";
      element.className = `map-marker${key === selectedStoreKeyRef.current ? " is-selected" : ""}`;
      element.style.background = showsOverdueColor(store)
        ? overdueColor(store)
        : (TERRITORY_MAP_COLORS[store.mapCategory] ?? "var(--muted)");
      element.setAttribute("aria-label", `Select ${store.storeName}`);
      element.addEventListener("click", () => {
        // Close any other open popup so only the clicked pin's popup shows.
        markersRef.current.forEach(({ marker: openMarker }, markerKey) => {
          if (markerKey !== key) {
            openMarker.getPopup()?.remove();
          }
        });
        onSelect(key);
      });

      const popup = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        offset: 16
      }).setDOMContent(createPopupContent(store));

      const marker = new maplibregl.Marker({
        element,
        anchor: "center"
      })
        .setLngLat([Number(store.longitude), Number(store.latitude)])
        .setPopup(popup)
        .addTo(map);

      markersRef.current.set(key, { marker, element });
    });

    if (routeStopCoordinates.length) {
      return;
    }

    if (mappedStores.length === 1) {
      map.easeTo({
        center: [Number(mappedStores[0].longitude), Number(mappedStores[0].latitude)],
        zoom: 11,
        duration: 500
      });
    } else if (mappedStores.length > 1) {
      const bounds = new maplibregl.LngLatBounds();
      mappedStores.forEach((store) => {
        bounds.extend([Number(store.longitude), Number(store.latitude)]);
      });
      map.fitBounds(bounds, {
        padding: 54,
        maxZoom: 10,
        duration: 500
      });
    }
  }, [isMapReady, mappedStoreSignature, onSelect]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isMapReady) {
      return;
    }

    if (!map.getSource(ROUTE_LINE_SOURCE_ID)) {
      map.addSource(ROUTE_LINE_SOURCE_ID, {
        type: "geojson",
        data: routeData
      });
      map.addLayer({
        id: ROUTE_LINE_CASING_LAYER_ID,
        type: "line",
        source: ROUTE_LINE_SOURCE_ID,
        layout: {
          "line-cap": "round",
          "line-join": "round"
        },
        paint: {
          "line-color": "#101418",
          "line-opacity": 0.72,
          "line-width": 8
        }
      });
      map.addLayer({
        id: ROUTE_LINE_LAYER_ID,
        type: "line",
        source: ROUTE_LINE_SOURCE_ID,
        layout: {
          "line-cap": "round",
          "line-join": "round"
        },
        paint: {
          "line-color": "#7dc2ae",
          "line-opacity": 0.92,
          "line-width": 4
        }
      });
      return;
    }

    const source = map.getSource(ROUTE_LINE_SOURCE_ID) as { setData?: (data: typeof routeData) => void } | undefined;
    source?.setData?.(routeData);
  }, [isMapReady, routeData]);

  useEffect(() => {
    const map = mapRef.current;
    const maplibregl = maplibreRef.current;
    if (!map || !maplibregl || !isMapReady) {
      return;
    }
    const mapInstance = map;
    const maplibre = maplibregl;

    routeMarkersRef.current.forEach((marker) => marker.remove());
    routeMarkersRef.current.clear();

    const routeStops = routeStores.filter(hasStoreCoordinates);
    if (!routeStops.length) {
      return;
    }

    function addRouteMarker(
      key: string,
      label: string,
      title: string,
      coordinates: Coordinates,
      tone: "start" | "waypoint" | "end",
      selectStoreKey?: string
    ) {
      const element = document.createElement(selectStoreKey ? "button" : "div");
      element.className = `route-marker route-marker-${tone}`;
      element.textContent = label;
      element.title = title;
      element.setAttribute("aria-label", title);
      if (selectStoreKey && element instanceof HTMLButtonElement) {
        element.type = "button";
        element.addEventListener("click", () => onSelect(selectStoreKey));
      }

      const marker = new maplibre.Marker({
        element,
        anchor: "center"
      })
        .setLngLat([coordinates.longitude, coordinates.latitude])
        .addTo(mapInstance);

      routeMarkersRef.current.set(key, marker);
    }

    addRouteMarker("start", "S", `Start: ${routeStart.label || "Custom start"}`, routeStart, "start");
    routeStops.forEach((store, index) => {
      const isEnd = index === routeStops.length - 1;
      addRouteMarker(
        storeKey(store),
        isEnd ? "E" : String(index + 1),
        `${isEnd ? "End" : `Waypoint ${index + 1}`}: ${store.storeName}`,
        storeCoordinates(store),
        isEnd ? "end" : "waypoint",
        storeKey(store)
      );
    });
  }, [
    isMapReady,
    onSelect,
    routeStart.label,
    routeStart.latitude,
    routeStart.longitude,
    routeStoreSignature
  ]);

  useEffect(() => {
    selectedStoreKeyRef.current = selectedStoreKey;
    markersRef.current.forEach(({ element }, key) => {
      element.classList.toggle("is-selected", key === selectedStoreKey);
    });
  }, [selectedStoreKey]);

  return (
    <div className="store-map">
      <div ref={containerRef} className="map-canvas" />
      {!mappedStores.length ? (
        <div className="map-empty">No filtered stores have coordinates yet.</div>
      ) : null}
    </div>
  );
}

function TripLogModal({
  stops,
  onSaved,
  onClose
}: {
  stops: StoreRollup[];
  onSaved: (storeId: string, log: ContactLogPatch) => void;
  onClose: () => void;
}) {
  const [date, setDate] = useState(localDateInputValue);
  const [initials, setInitials] = useState("");
  const [method, setMethod] = useState("Visit");
  const [sharedNotes, setSharedNotes] = useState("");
  const [checkedKeys, setCheckedKeys] = useState<Set<string>>(() => new Set(stops.map(storeKey)));
  const [stopNotes, setStopNotes] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [saveError, setSaveError] = useState("");
  const [done, setDone] = useState(false);

  function toggleKey(key: string) {
    setCheckedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const toSave = stops.filter((s) => s.storeId && checkedKeys.has(storeKey(s)));
    if (!toSave.length) { setSaveError("No stops selected."); return; }
    setSaving(true);
    setSaveError("");
    let savedCount = 0;
    setProgress({ done: 0, total: toSave.length });
    const tripId = crypto.randomUUID();

    for (const store of toSave) {
      const perStop = stopNotes[storeKey(store)]?.trim();
      const notes = [sharedNotes.trim(), perStop].filter(Boolean).join(" · ") || null;
      try {
        const response = await fetch("/api/contact-logs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            storeId: store.storeId,
            licenseKey: store.licenseKey,
            storeName: store.storeName,
            dateContacted: date,
            contactMethod: method,
            initials: initials.trim() || null,
            notes,
            tripId
          })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        onSaved(store.storeId!, {
          storeId: store.storeId!,
          dateContacted: date,
          contactMethod: method,
          initials: initials.trim() || null,
          personContacted: null,
          notes,
          savedAt: result.savedAt
        });
        savedCount++;
      } catch {
        // continue to next stop
      }
      setProgress({ done: savedCount, total: toSave.length });
    }

    setSaving(false);
    setDone(true);
  }

  return (
    <div
      className="trip-log-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="trip-log-modal">
        <div className="trip-log-modal-header">
          <h3>Log Trip</h3>
          <button className="icon-button" type="button" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        {done ? (
          <div className="trip-log-done">
            <Check size={28} />
            <p>Logged {progress?.done} of {progress?.total} {progress?.total === 1 ? "stop" : "stops"}.</p>
            <button className="primary-button" type="button" onClick={onClose}>Done</button>
          </div>
        ) : (
          <form className="trip-log-form" onSubmit={handleSubmit}>
            <div className="trip-log-fields">
              <div className="field">
                <label>Date</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                />
              </div>
              <div className="field">
                <label>Rep</label>
                <input
                  type="text"
                  value={initials}
                  onChange={(e) => setInitials(e.target.value)}
                  placeholder="Initials"
                  maxLength={6}
                />
              </div>
              <div className="field">
                <label>Method</label>
                <select value={method} onChange={(e) => setMethod(e.target.value)}>
                  <option>Visit</option>
                  <option>Phone</option>
                  <option>Email</option>
                  <option>Text</option>
                </select>
              </div>
            </div>
            <div className="field">
              <label>Shared notes (applied to all stops)</label>
              <textarea
                rows={2}
                value={sharedNotes}
                onChange={(e) => setSharedNotes(e.target.value)}
                placeholder="Optional"
                style={{ resize: "vertical" }}
              />
            </div>
            <div className="trip-log-stop-list">
              {stops.map((s) => {
                const key = storeKey(s);
                const checked = checkedKeys.has(key);
                return (
                  <div key={key} className="trip-log-stop">
                    <label className="trip-log-stop-label">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleKey(key)}
                      />
                      <span className="trip-log-stop-name">{s.storeName}</span>
                      {s.city ? <span className="trip-log-stop-city">{s.city}</span> : null}
                    </label>
                    {checked ? (
                      <input
                        className="trip-log-stop-note"
                        type="text"
                        placeholder="Stop note (optional)"
                        value={stopNotes[key] ?? ""}
                        onChange={(e) => setStopNotes((prev) => ({ ...prev, [key]: e.target.value }))}
                      />
                    ) : null}
                  </div>
                );
              })}
            </div>
            {saveError ? <span className="status-message">{saveError}</span> : null}
            <div className="trip-log-footer">
              {saving && progress ? (
                <span className="status-message">Saving {progress.done + 1} of {progress.total}…</span>
              ) : null}
              <button
                className="primary-button"
                disabled={saving || checkedKeys.size === 0}
                type="submit"
              >
                Log {checkedKeys.size} Stop{checkedKeys.size !== 1 ? "s" : ""}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function TripPlanner({
  stores,
  orderLines,
  selectedStore,
  activeTab,
  setActiveTab,
  routeDestinationKey,
  tripStoreKeys,
  onAddWaypoint,
  onAddWaypoints,
  onRemoveStore,
  onClearTrip,
  onSetDestination,
  onSelectStore,
  existingGroups,
  onBuyerSaved,
  onGroupSaved,
  onServiceNoteSaved,
  onContactLogSaved,
  onStoreNameSaved
}: {
  stores: StoreRollup[];
  orderLines: OrderLine[];
  selectedStore?: StoreRollup;
  activeTab: DetailTab;
  setActiveTab: (tab: DetailTab) => void;
  routeDestinationKey: string;
  tripStoreKeys: string[];
  onAddWaypoint: (key: string) => void;
  onAddWaypoints: (keys: string[]) => void;
  onRemoveStore: (key: string) => void;
  onClearTrip: () => void;
  onSetDestination: (key: string) => void;
  onSelectStore: (key: string) => void;
  existingGroups: string[];
  onBuyerSaved: (storeId: string, buyer: BuyerContactPatch) => void;
  onGroupSaved: (storeId: string, groupName: string | null) => void;
  onServiceNoteSaved: (storeId: string, serviceNote: string | null) => void;
  onContactLogSaved: (storeId: string, contactLog: ContactLogPatch) => void;
  onStoreNameSaved: (storeId: string, storeName: string) => void;
}) {
  const [routeStart, setRouteStart] = useState<RouteStart>(DEFAULT_ROUTE_START);
  const [maxOffRouteMiles, setMaxOffRouteMiles] = useState(5);
  const [maxSuggestedStops, setMaxSuggestedStops] = useState(6);
  const [destinationRouteCoordinates, setDestinationRouteCoordinates] = useState<[number, number][] | null>(null);
  const [showTripLog, setShowTripLog] = useState(false);
  const mappedStores = useMemo(() => stores.filter(hasStoreCoordinates), [stores]);
  const mappedStoreByKey = useMemo(() => {
    const byKey = new Map<string, StoreRollup>();
    mappedStores.forEach((store) => byKey.set(storeKey(store), store));
    return byKey;
  }, [mappedStores]);
  const selectedKeys = useMemo(() => new Set(tripStoreKeys), [tripStoreKeys]);
  const destinationStore = routeDestinationKey ? mappedStoreByKey.get(routeDestinationKey) : undefined;
  const tripStores = useMemo(() => (
    tripStoreKeys
      .map((key) => mappedStoreByKey.get(key))
      .filter((store): store is StoreRollup => Boolean(store))
  ), [mappedStoreByKey, tripStoreKeys]);
  const farthestRouteStoreKey = useMemo(() => {
    let farthestKey = "";
    let farthestMiles = -1;
    tripStores.forEach((store) => {
      const distanceFromStart = milesBetween(routeStart, storeCoordinates(store));
      if (distanceFromStart > farthestMiles) {
        farthestMiles = distanceFromStart;
        farthestKey = storeKey(store);
      }
    });
    return farthestKey;
  }, [routeStart, tripStores]);
  const waypointStores = useMemo(() => (
    tripStoreKeys
      .filter((key) => key !== routeDestinationKey)
      .map((key) => mappedStoreByKey.get(key))
      .filter((store): store is StoreRollup => Boolean(store))
  ), [mappedStoreByKey, routeDestinationKey, tripStoreKeys]);
  const orderedTripStores = useMemo(() => {
    const orderedWaypoints = optimizeTripStores(waypointStores, routeStart);
    if (destinationStore) {
      return [...orderedWaypoints, destinationStore];
    }
    return optimizeTripStores(tripStores, routeStart);
  }, [destinationStore, routeStart, tripStores, waypointStores]);
  const unselectedCandidateStores = useMemo(() => (
    mappedStores.filter((store) => !selectedKeys.has(storeKey(store)))
  ), [mappedStores, selectedKeys]);
  const candidateStores = useMemo(() => unselectedCandidateStores.slice(0, 80), [unselectedCandidateStores]);
  const routeSuggestions = useMemo(() => suggestedRouteStops({
    stores: mappedStores,
    currentRouteStores: orderedTripStores,
    destinationStore,
    maxOffRouteMiles,
    maxStops: maxSuggestedStops,
    startLocation: routeStart,
    routeCoordinates: destinationRouteCoordinates
  }), [
    destinationRouteCoordinates,
    destinationStore,
    mappedStores,
    maxOffRouteMiles,
    maxSuggestedStops,
    orderedTripStores,
    routeStart
  ]);
  const estimatedMiles = estimatedTripMiles(orderedTripStores, routeStart);
  const routeUrl = googleMapsRouteUrl(orderedTripStores, routeStart);
  const launchStopCount = Math.min(orderedTripStores.length, GOOGLE_MAPS_ROUTE_STOP_LIMIT);
  const tripBalaclava = orderedTripStores.reduce((total, store) => total + latestBalaclavaRevenue(store), 0);
  const tripMarket = orderedTripStores.reduce((total, store) => total + store.marketSalesLastMonth, 0);
  const selectedStoreKey = selectedStore ? storeKey(selectedStore) : "";
  const selectedStoreKeys = useMemo(() => (
    selectedStore ? new Set(storeIdentityKeys(selectedStore)) : new Set<string>()
  ), [selectedStore]);
  const selectedStoreOrderLines = useMemo(() => (
    selectedStoreKeys.size
      ? orderLines.filter((line) => orderLineStoreKeys(line).some((key) => selectedStoreKeys.has(key)))
      : []
  ), [orderLines, selectedStoreKeys]);
  const canAddSelectedStore = Boolean(
    selectedStore && hasStoreCoordinates(selectedStore)
  );
  const isSelectedStoreInRoute = Boolean(selectedStoreKey && selectedKeys.has(selectedStoreKey));

  function updateRouteStartLabel(label: string) {
    setRouteStart((currentStart) => ({ ...currentStart, label }));
  }

  function updateRouteStartCoordinate(key: "latitude" | "longitude", value: number) {
    if (!Number.isFinite(value)) {
      return;
    }
    setRouteStart((currentStart) => ({ ...currentStart, [key]: value }));
  }

  function handleAddRouteStore(nextStoreKey: string) {
    const nextStore = mappedStoreByKey.get(nextStoreKey);
    if (!nextStore) {
      return;
    }

    const currentEndStore = farthestRouteStoreKey ? mappedStoreByKey.get(farthestRouteStoreKey) : undefined;
    const nextStoreMiles = milesBetween(routeStart, storeCoordinates(nextStore));
    const currentEndMiles = currentEndStore ? milesBetween(routeStart, storeCoordinates(currentEndStore)) : -1;

    if (!currentEndStore || nextStoreMiles > currentEndMiles) {
      onSetDestination(nextStoreKey);
      return;
    }

    onAddWaypoint(nextStoreKey);
  }

  function handleRemoveRouteStore(nextStoreKey: string) {
    onRemoveStore(nextStoreKey);
  }

  useEffect(() => {
    if (!destinationStore || !hasStoreCoordinates(destinationStore)) {
      setDestinationRouteCoordinates(null);
      return;
    }

    const destination = destinationStore;
    const controller = new AbortController();
    setDestinationRouteCoordinates(null);

    async function fetchDestinationRoute() {
      try {
        setDestinationRouteCoordinates(await fetchRoadRouteCoordinates(
          routeStart,
          [storeCoordinates(destination)],
          controller.signal
        ));
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setDestinationRouteCoordinates(null);
        }
      }
    }

    fetchDestinationRoute();

    return () => controller.abort();
  }, [destinationStore, routeStart.latitude, routeStart.longitude]);

  useEffect(() => {
    if (farthestRouteStoreKey && routeDestinationKey !== farthestRouteStoreKey) {
      onSetDestination(farthestRouteStoreKey);
    }
  }, [farthestRouteStoreKey, onSetDestination, routeDestinationKey]);

  return (
    <section className="trip-layout">
      <div className="panel map-panel trip-map-panel">
        <div className="panel-header">
          <h3>Store Map</h3>
          <span className="table-meta">
            {mappedStores.length.toLocaleString()} mapped · {orderedTripStores.length.toLocaleString()} stops
          </span>
        </div>
        <div className="trip-map-body">
          <StoreMap
            stores={mappedStores}
            routeStart={routeStart}
            routeStores={orderedTripStores}
            selectedStore={selectedStore}
            onSelect={onSelectStore}
          />
        </div>
      </div>

      <div className="map-side-rail">
        <StoreDetailDrawer
          selectedStore={selectedStore}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          existingGroups={existingGroups}
          onBuyerSaved={onBuyerSaved}
          onGroupSaved={onGroupSaved}
          onServiceNoteSaved={onServiceNoteSaved}
          onContactLogSaved={onContactLogSaved}
          onStoreNameSaved={onStoreNameSaved}
          orderLines={selectedStoreOrderLines}
          routeAction={selectedStore ? {
            disabled: !canAddSelectedStore,
            isAdded: isSelectedStoreInRoute,
            onAdd: () => {
              if (selectedStoreKey) {
                handleAddRouteStore(selectedStoreKey);
              }
            },
            onRemove: () => {
              if (selectedStoreKey) {
                handleRemoveRouteStore(selectedStoreKey);
              }
            }
          } : undefined}
        />

        <aside className="panel trip-planner-panel">
          <div className="panel-header">
            <h3>Trip Planner</h3>
            <span className="table-meta">{routeStart.label || "Custom start"}</span>
          </div>

          <div className="trip-section">
            <div className="trip-summary">
              <div className="metric">
                <div className="metric-label">Stops</div>
                <div className="metric-value">{orderedTripStores.length.toLocaleString()}</div>
              </div>
              <div className="metric">
                <div className="metric-label">Est. Miles</div>
                <div className="metric-value">{Math.round(estimatedMiles).toLocaleString()}</div>
              </div>
              <div className="metric">
                <div className="metric-label">Balaclava</div>
                <div className="metric-value">{formatUsd(tripBalaclava)}</div>
              </div>
              <div className="metric">
                <div className="metric-label">Market</div>
                <div className="metric-value">{formatUsd(tripMarket)}</div>
              </div>
            </div>
            <div className="route-settings" aria-label="Route settings">
              <div className="field">
                <label>Start location</label>
                <input
                  value={routeStart.label}
                  onChange={(event) => updateRouteStartLabel(event.target.value)}
                  placeholder="Start label"
                />
              </div>
              <div className="route-setting-grid">
                <div className="field">
                  <label>Start latitude</label>
                  <input
                    type="number"
                    step="0.0001"
                    value={routeStart.latitude}
                    onChange={(event) => updateRouteStartCoordinate("latitude", event.currentTarget.valueAsNumber)}
                  />
                </div>
                <div className="field">
                  <label>Start longitude</label>
                  <input
                    type="number"
                    step="0.0001"
                    value={routeStart.longitude}
                    onChange={(event) => updateRouteStartCoordinate("longitude", event.currentTarget.valueAsNumber)}
                  />
                </div>
              </div>
              <div className="route-setting-grid">
                <div className="field">
                  <label>Off-route miles</label>
                  <input
                    type="number"
                    min={1}
                    max={75}
                    step={1}
                    value={maxOffRouteMiles}
                    onChange={(event) => {
                      const value = event.currentTarget.valueAsNumber;
                      if (Number.isFinite(value)) {
                        setMaxOffRouteMiles(Math.max(1, Math.min(75, value)));
                      }
                    }}
                  />
                </div>
                <div className="field">
                  <label>Suggested stops</label>
                  <input
                    type="number"
                    min={0}
                    max={25}
                    step={1}
                    value={maxSuggestedStops}
                    onChange={(event) => {
                      const value = event.currentTarget.valueAsNumber;
                      if (Number.isFinite(value)) {
                        setMaxSuggestedStops(Math.max(0, Math.min(25, Math.round(value))));
                      }
                    }}
                  />
                </div>
              </div>
            </div>
            <div className="trip-actions">
              {routeUrl ? (
                <a className="primary-button" href={routeUrl} rel="noreferrer" target="_blank">
                  <ExternalLink size={15} /> Launch Route
                </a>
              ) : (
                <button className="primary-button" disabled type="button">
                  <ExternalLink size={15} /> Launch Route
                </button>
              )}
              <button
                className="secondary-button"
                disabled={!routeSuggestions.length}
                onClick={() => onAddWaypoints(routeSuggestions.map((suggestion) => storeKey(suggestion.store)))}
                type="button"
              >
                <ListPlus size={15} /> Add Suggested
              </button>
              <button
                className="secondary-button"
                disabled={!orderedTripStores.length}
                onClick={onClearTrip}
                type="button"
              >
                <Trash2 size={15} /> Clear
              </button>
            </div>
            {orderedTripStores.length > GOOGLE_MAPS_ROUTE_STOP_LIMIT ? (
              <div className="trip-note">
                Maps launch includes the first {launchStopCount.toLocaleString()} of{" "}
                {orderedTripStores.length.toLocaleString()} planned stops.
              </div>
            ) : null}
          </div>

          <div className="trip-section">
            <div className="trip-section-header">
              <h4>Route</h4>
              <span>{orderedTripStores.length.toLocaleString()}</span>
            </div>
            <ol className="trip-stop-list">
              {orderedTripStores.map((store, index) => {
                const isDestination = Boolean(routeDestinationKey && storeKey(store) === routeDestinationKey);
                return (
                  <li
                    className={selectedStoreKey === storeKey(store) ? "trip-stop-row is-selected" : "trip-stop-row"}
                    key={storeKey(store)}
                  >
                    <span className="trip-stop-index">{isDestination ? "D" : index + 1}</span>
                    <button className="trip-store-button" onClick={() => onSelectStore(storeKey(store))} type="button">
                      <strong>{store.storeName}</strong>
                      <span className="trip-store-meta">
                        <BrandPlacementDots store={store} />
                        <span className="trip-store-subtext">
                          {isDestination ? "Destination · " : ""}{store.city || "No city"} ·{" "}
                          {formatUsd(store.marketSalesLastMonth)} market
                        </span>
                      </span>
                    </button>
                    <button
                      aria-label={`Remove ${store.storeName} from trip`}
                      className="icon-button"
                      onClick={() => onRemoveStore(storeKey(store))}
                      type="button"
                    >
                      <X size={15} />
                    </button>
                  </li>
                );
              })}
              {!orderedTripStores.length ? (
                <li className="trip-empty">No stops selected.</li>
              ) : null}
            </ol>
            {orderedTripStores.length > 0 ? (
              <button
                className="secondary-button"
                style={{ marginTop: 10, width: "100%" }}
                type="button"
                onClick={() => setShowTripLog(true)}
              >
                <ListPlus size={15} /> Log Trip
              </button>
            ) : null}
          </div>

          <div className="trip-section">
            <div className="trip-section-header">
              <h4>Suggested Stops</h4>
              <span>{routeSuggestions.length.toLocaleString()}</span>
            </div>
            <div className="trip-candidate-list">
              {routeSuggestions.map((suggestion) => (
                <div
                  className={selectedStoreKey === storeKey(suggestion.store) ? "trip-candidate-row is-selected" : "trip-candidate-row"}
                  key={storeKey(suggestion.store)}
                >
                  <button
                    className="trip-store-button"
                    onClick={() => onSelectStore(storeKey(suggestion.store))}
                    type="button"
                  >
                    <strong>{suggestion.store.storeName}</strong>
                    <span className="trip-store-meta">
                      <BrandPlacementDots store={suggestion.store} />
                      <span className="trip-store-subtext">
                        {suggestion.store.city || "No city"} · {Math.round(suggestion.alongRouteMiles).toLocaleString()} mi out ·{" "}
                        {suggestion.offRouteMiles.toFixed(1)} mi off route
                      </span>
                    </span>
                  </button>
                  <button
                    aria-label={`Add ${suggestion.store.storeName} as a route stop`}
                    className="icon-button"
                    onClick={() => handleAddRouteStore(storeKey(suggestion.store))}
                    type="button"
                  >
                    <Plus size={15} />
                  </button>
                </div>
              ))}
              {!destinationStore ? (
                <div className="trip-empty">Set a destination to see stops along the way.</div>
              ) : null}
              {destinationStore && !routeSuggestions.length ? (
                <div className="trip-empty">No suggestions inside the current route corridor.</div>
              ) : null}
            </div>
          </div>

          <div className="trip-section">
            <div className="trip-section-header">
              <h4>Candidates</h4>
              <span>
                {candidateStores.length.toLocaleString()} of {unselectedCandidateStores.length.toLocaleString()}
              </span>
            </div>
            <div className="trip-candidate-list">
              {candidateStores.map((store) => (
                <div
                  className={selectedStoreKey === storeKey(store) ? "trip-candidate-row is-selected" : "trip-candidate-row"}
                  key={storeKey(store)}
                >
                  <button className="trip-store-button" onClick={() => onSelectStore(storeKey(store))} type="button">
                    <strong>{store.storeName}</strong>
                    <span className="trip-store-meta">
                      <BrandPlacementDots store={store} />
                      <span className="trip-store-subtext">
                        {store.city || "No city"} · {formatUsd(store.marketSalesLastMonth)} market
                      </span>
                    </span>
                  </button>
                  <button
                    aria-label={`Add ${store.storeName} to route`}
                    className="icon-button"
                    onClick={() => handleAddRouteStore(storeKey(store))}
                    type="button"
                  >
                    <Plus size={15} />
                  </button>
                </div>
              ))}
              {!candidateStores.length ? (
                <div className="trip-empty">No mapped candidates.</div>
              ) : null}
            </div>
          </div>
        </aside>
      </div>
      {showTripLog ? (
        <TripLogModal
          stops={orderedTripStores}
          onSaved={onContactLogSaved}
          onClose={() => setShowTripLog(false)}
        />
      ) : null}
    </section>
  );
}

function OrdersView({
  orderLines,
  cultiveraLastSyncedAt,
  stores,
  selectedStore,
  onSelectStore
}: {
  orderLines: OrderLine[];
  cultiveraLastSyncedAt?: string | null;
  stores: StoreRollup[];
  selectedStore?: StoreRollup;
  onSelectStore: (key: string) => void;
}) {
  const [statusFilter, setStatusFilter] = useState("all");
  const [brandFilter, setBrandFilter] = useState("all");
  const [orderQuery, setOrderQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const { syncState, syncMessage, syncOrders } = useOrderSync();
  const syncTimestampLabel = formatSyncDateTime(cultiveraLastSyncedAt);
  const bounds = useMemo(() => orderDateBounds(orderLines), [orderLines]);
  const effectiveDateFrom = dateFrom || bounds.defaultFrom;
  const effectiveDateTo = dateTo || bounds.defaultTo;
  const selectedStoreKeys = useMemo(() => (
    selectedStore ? new Set(storeIdentityKeys(selectedStore)) : new Set<string>()
  ), [selectedStore]);
  const storesByKey = useMemo(() => {
    const byKey = new Map<string, StoreRollup>();
    stores.forEach((store) => {
      storeIdentityKeys(store).forEach((key) => byKey.set(key, store));
    });
    return byKey;
  }, [stores]);
  const baseOrderLines = useMemo(() => (
    orderLines.filter((line) => orderBrandValue(line).toLowerCase() !== "bulk")
  ), [orderLines]);

  useEffect(() => {
    setDateFrom("");
    setDateTo("");
  }, [bounds.defaultFrom, bounds.defaultTo]);

  const statusOptions = useMemo(() => (
    [...new Set(baseOrderLines.map(orderStatusValue))].sort((left, right) => left.localeCompare(right))
  ), [baseOrderLines]);
  const brandOptions = useMemo(() => {
    const dataBrands = [...new Set(baseOrderLines.map(orderBrandValue))]
      .filter((brand) => !TERRITORY_BRANDS.includes(brand as BrandFilter))
      .sort((left, right) => left.localeCompare(right));
    return [...TERRITORY_BRANDS, ...dataBrands];
  }, [baseOrderLines]);
  const normalizedOrderQuery = orderQuery.trim().toLowerCase();
  const filteredOrderLines = useMemo(() => (
    baseOrderLines.filter((line) => {
      if (statusFilter !== "all" && orderStatusValue(line) !== statusFilter) {
        return false;
      }
      if (brandFilter !== "all" && orderBrandValue(line) !== brandFilter) {
        return false;
      }
      if (!lineIsInsideDateRange(line, effectiveDateFrom, effectiveDateTo)) {
        return false;
      }
      if (!normalizedOrderQuery) {
        return true;
      }
      return [
        line.storeName,
        line.license,
        line.licenseKey,
        line.orderNumber,
        line.brand,
        line.productName,
        line.subProductLine
      ].some((value) => String(value || "").toLowerCase().includes(normalizedOrderQuery));
    })
  ), [baseOrderLines, brandFilter, effectiveDateFrom, effectiveDateTo, normalizedOrderQuery, statusFilter]);
  const paidLines = useMemo(() => filteredOrderLines.filter(isPaidOrderLine), [filteredOrderLines]);
  const orderMetrics = useMemo(() => {
    const revenue = paidLines.reduce((total, line) => total + line.lineTotal, 0);
    const units = paidLines.reduce((total, line) => total + line.units, 0);
    return {
      revenue,
      units,
      orders: uniqueOrderCount(paidLines),
      stores: new Set(paidLines.map(orderLineStoreKey)).size,
      latest: latestOrderDate(paidLines)
    };
  }, [paidLines]);
  const brandSummaries = useMemo(() => (
    TERRITORY_BRANDS.map((brand) => {
      const brandLines = paidLines.filter((line) => orderBrandValue(line) === brand);
      return {
        brand,
        revenue: brandLines.reduce((total, line) => total + line.lineTotal, 0),
        units: brandLines.reduce((total, line) => total + line.units, 0),
        orders: uniqueOrderCount(brandLines)
      };
    })
  ), [paidLines]);
  const maxBrandRevenue = Math.max(1, ...brandSummaries.map((summary) => summary.revenue));
  const storeSummaries = useMemo(() => {
    const byStore = new Map<string, {
      key: string;
      storeName: string;
      license: string;
      revenue: number;
      units: number;
      orderKeys: Set<string>;
      lastOrderAt: string | null;
      lastOrderNumber: string;
      brands: Record<BrandFilter, number>;
    }>();

    paidLines.forEach((line) => {
      const key = orderLineStoreKey(line);
      const current = byStore.get(key) || {
        key,
        storeName: line.storeName,
        license: line.license || line.licenseKey || "",
        revenue: 0,
        units: 0,
        orderKeys: new Set<string>(),
        lastOrderAt: null,
        lastOrderNumber: "",
        brands: {
          "K. Savage": 0,
          Mayfield: 0,
          "Leisure Land": 0
        }
      };
      current.revenue += line.lineTotal;
      current.units += line.units;
      current.orderKeys.add(orderLineKey(line));
      if (orderTimestamp(line.submittedAt) >= orderTimestamp(current.lastOrderAt)) {
        current.lastOrderAt = line.submittedAt || null;
        current.lastOrderNumber = line.orderNumber;
      }
      const brand = orderBrandValue(line);
      if (TERRITORY_BRANDS.includes(brand as BrandFilter)) {
        current.brands[brand as BrandFilter] += line.lineTotal;
      }
      byStore.set(key, current);
    });

    return [...byStore.values()]
      .sort((left, right) => orderTimestamp(right.lastOrderAt) - orderTimestamp(left.lastOrderAt))
      .slice(0, 80);
  }, [paidLines]);
  const recentOrders = useMemo(() => {
    const byOrder = new Map<string, {
      key: string;
      storeKey: string;
      storeName: string;
      license: string;
      orderNumber: string;
      submittedAt: string | null;
      status: string;
      revenue: number;
      units: number;
      brands: Record<BrandFilter, number>;
    }>();

    paidLines.forEach((line) => {
      const key = orderLineKey(line);
      const current = byOrder.get(key) || {
        key,
        storeKey: orderLineStoreKey(line),
        storeName: line.storeName,
        license: line.license || line.licenseKey || "",
        orderNumber: line.orderNumber,
        submittedAt: line.submittedAt || null,
        status: orderStatusValue(line),
        revenue: 0,
        units: 0,
        brands: {
          "K. Savage": 0,
          Mayfield: 0,
          "Leisure Land": 0
        }
      };
      current.revenue += line.lineTotal;
      current.units += line.units;
      const brand = orderBrandValue(line);
      if (TERRITORY_BRANDS.includes(brand as BrandFilter)) {
        current.brands[brand as BrandFilter] += line.lineTotal;
      }
      byOrder.set(key, current);
    });

    return [...byOrder.values()]
      .sort((left, right) => orderTimestamp(right.submittedAt) - orderTimestamp(left.submittedAt))
      .slice(0, 80);
  }, [paidLines]);
  const topProductsByBrand = useMemo(() => (
    TERRITORY_BRANDS.map((brand) => {
      const byProduct = new Map<string, { product: string; units: number; revenue: number }>();
      paidLines
        .filter((line) => orderBrandValue(line) === brand)
        .forEach((line) => {
          const product = line.productName || "Unnamed product";
          const current = byProduct.get(product) || { product, units: 0, revenue: 0 };
          current.units += line.units;
          current.revenue += line.lineTotal;
          byProduct.set(product, current);
        });
      return {
        brand,
        products: [...byProduct.values()]
          .sort((left, right) => right.units - left.units || right.revenue - left.revenue)
          .slice(0, 8)
      };
    })
  ), [paidLines]);

  return (
    <section className="orders-view">
      <div className="panel orders-filter-panel">
        <div className="orders-action-row">
          <div>
            <span className="caption">Cultivera order source</span>
            {syncTimestampLabel ? (
              <div className="sync-timestamp">
                Last Cultivera sync performed at {syncTimestampLabel}
              </div>
            ) : null}
          </div>
          <button
            className="primary-button"
            disabled={syncState === "syncing"}
            onClick={syncOrders}
            type="button"
          >
            {syncState === "syncing" ? "Syncing..." : "Sync Orders"}
          </button>
        </div>
        {syncMessage ? (
          <div className={`sync-message sync-message-${syncState}`} role="status">
            {syncMessage}
          </div>
        ) : null}
        <div className="orders-filter-grid">
          <div className="field">
            <label>Orders</label>
            <input
              type="search"
              value={orderQuery}
              onChange={(event) => setOrderQuery(event.target.value)}
              placeholder="Store, license, order, product"
            />
          </div>
          <div className="field">
            <label>Status</label>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">All statuses</option>
              {statusOptions.map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Brand</label>
            <select value={brandFilter} onChange={(event) => setBrandFilter(event.target.value)}>
              <option value="all">All brands</option>
              {brandOptions.map((brand) => (
                <option key={brand} value={brand}>{brand}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>From</label>
            <input
              max={bounds.max}
              min={bounds.min}
              type="date"
              value={effectiveDateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
            />
          </div>
          <div className="field">
            <label>To</label>
            <input
              max={bounds.max}
              min={bounds.min}
              type="date"
              value={effectiveDateTo}
              onChange={(event) => setDateTo(event.target.value)}
            />
          </div>
        </div>
      </div>

      <section className="metrics orders-metrics">
        <DetailStat label="Revenue" value={formatUsd(orderMetrics.revenue)} />
        <DetailStat label="Orders" value={orderMetrics.orders.toLocaleString()} />
        <DetailStat label="Units" value={Math.round(orderMetrics.units).toLocaleString()} />
        <DetailStat label="Stores" value={orderMetrics.stores.toLocaleString()} />
        <DetailStat label="Latest Order" value={formatDate(orderMetrics.latest)} />
      </section>

      <section className="panel">
        <div className="panel-header">
          <h3>Brand Summary</h3>
          <span className="table-meta">{filteredOrderLines.length.toLocaleString()} lines</span>
        </div>
        <div className="brand-summary-grid">
          {brandSummaries.map((summary) => (
            <div className="brand-summary-card" key={summary.brand}>
              <div className="brand-summary-title">
                <span
                  aria-hidden="true"
                  className="brand-dot"
                  style={{ background: BRAND_DOT_COLORS[summary.brand] ?? "var(--muted)" }}
                />
                <strong>{summary.brand}</strong>
              </div>
              <div className="brand-summary-value">{formatUsd(summary.revenue)}</div>
              <div className="brand-summary-meta">
                {summary.orders.toLocaleString()} orders · {Math.round(summary.units).toLocaleString()} units
              </div>
              <div className="summary-bar">
                <span
                  style={{
                    background: BRAND_DOT_COLORS[summary.brand] ?? "var(--blue)",
                    width: `${Math.max(3, (summary.revenue / maxBrandRevenue) * 100)}%`
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="orders-grid">
        <div className="panel">
          <div className="panel-header">
            <h3>Store Activity</h3>
            <span className="table-meta">{storeSummaries.length.toLocaleString()} stores</span>
          </div>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Store</th>
                  <th>Orders</th>
                  <th>Last Order</th>
                  <th>Revenue</th>
                  <th>Units</th>
                  {TERRITORY_BRANDS.map((brand) => <th key={brand}>{brand}</th>)}
                </tr>
              </thead>
              <tbody>
                {storeSummaries.map((summary) => (
                  <tr
                    className={selectedStoreKeys.has(summary.key) ? "is-selected" : ""}
                    key={summary.key}
                    onClick={() => {
                      const store = storesByKey.get(summary.key);
                      if (store) {
                        onSelectStore(storeKey(store));
                      }
                    }}
                  >
                    <td>
                      <div className="store-name">{summary.storeName}</div>
                      <div className="store-subtext">{summary.license || "-"}</div>
                    </td>
                    <td>{summary.orderKeys.size.toLocaleString()}</td>
                    <td>{formatDate(summary.lastOrderAt)}</td>
                    <td>{formatUsd(summary.revenue)}</td>
                    <td>{Math.round(summary.units).toLocaleString()}</td>
                    {TERRITORY_BRANDS.map((brand) => <td key={brand}>{formatUsd(summary.brands[brand])}</td>)}
                  </tr>
                ))}
                {!storeSummaries.length ? (
                  <tr><td colSpan={8}>No store activity in this selection.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <h3>Recent Orders</h3>
            <span className="table-meta">{recentOrders.length.toLocaleString()} shown</span>
          </div>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Store</th>
                  <th>Date</th>
                  <th>Status</th>
                  <th>Revenue</th>
                  <th>Units</th>
                </tr>
              </thead>
              <tbody>
                {recentOrders.map((order) => (
                  <tr
                    className={selectedStoreKeys.has(order.storeKey) ? "is-selected" : ""}
                    key={order.key}
                    onClick={() => {
                      const store = storesByKey.get(order.storeKey);
                      if (store) {
                        onSelectStore(storeKey(store));
                      }
                    }}
                  >
                    <td>{order.orderNumber}</td>
                    <td>
                      <div className="store-name">{order.storeName}</div>
                      <div className="store-subtext">{order.license || "-"}</div>
                    </td>
                    <td>{formatDate(order.submittedAt)}</td>
                    <td>{order.status}</td>
                    <td>{formatUsd(order.revenue)}</td>
                    <td>{Math.round(order.units).toLocaleString()}</td>
                  </tr>
                ))}
                {!recentOrders.length ? (
                  <tr><td colSpan={6}>No recent orders in this selection.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h3>Top Products</h3>
          <span className="table-meta">Paid lines only</span>
        </div>
        <div className="product-summary-grid">
          {topProductsByBrand.map((brandSummary) => (
            <div className="product-summary" key={brandSummary.brand}>
              <div className="brand-summary-title">
                <span
                  aria-hidden="true"
                  className="brand-dot"
                  style={{ background: BRAND_DOT_COLORS[brandSummary.brand] ?? "var(--muted)" }}
                />
                <strong>{brandSummary.brand}</strong>
              </div>
              <table className="mini-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Units</th>
                    <th>Sales</th>
                  </tr>
                </thead>
                <tbody>
                  {brandSummary.products.map((product) => (
                    <tr key={product.product}>
                      <td>{product.product}</td>
                      <td>{Math.round(product.units).toLocaleString()}</td>
                      <td>{formatUsd(product.revenue)}</td>
                    </tr>
                  ))}
                  {!brandSummary.products.length ? (
                    <tr><td colSpan={3}>No paid lines.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </section>
    </section>
  );
}

function HeadsetSyncPanel({ stores }: { stores: StoreRollup[] }) {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "parsing" | "uploading" | "done" | "error">("idle");
  const [result, setResult] = useState<{ imported: number; total: number; unmatched: string[] } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [mappings, setMappings] = useState<Record<string, string>>({});

  function parseCsv(text: string) {
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return [];
    const headers = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]/g, "_"));
    const col = (name: string) => headers.indexOf(name);
    const dayIdx = col("day");
    const storeIdx = col("store_name");
    const repIdx = col("account_rep");
    const nameIdx = col("name");
    const catIdx = col("category");
    const unitIdx = col("unit");
    const brandIdx = col("brand");
    const salesIdx = col("total_sales");
    const unitsIdx = col("total_units");
    const priceIdx = col("avg_item_price");
    const stockIdx = col("__days_in_stock");
    const costIdx = col("avg_unit_cost");
    return lines.slice(1).map((line) => {
      const cols = line.split(",");
      const get = (i: number) => (i >= 0 ? (cols[i] ?? "").trim().replace(/^"|"$/g, "") : "");
      const parseNum = (i: number) => { const v = parseFloat(get(i).replace(/[$,%]/g, "")); return isNaN(v) ? null : v; };
      return {
        day: get(dayIdx),
        storeName: get(storeIdx),
        accountRep: get(repIdx) || null,
        productName: get(nameIdx),
        category: get(catIdx) || null,
        unitSize: get(unitIdx) || null,
        brand: get(brandIdx) || null,
        totalSales: parseNum(salesIdx) ?? 0,
        totalUnits: Math.round(parseNum(unitsIdx) ?? 0),
        avgItemPrice: parseNum(priceIdx),
        pctDaysInStock: parseNum(stockIdx),
        avgUnitCost: parseNum(costIdx)
      };
    }).filter((r) => r.day && r.storeName && r.productName);
  }

  async function handleUpload() {
    if (!file) return;
    setStatus("parsing");
    setErrorMsg(null);
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      if (!rows.length) throw new Error("No valid rows found in CSV.");
      setStatus("uploading");
      const res = await fetch("/api/headset/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setResult(data);
      setStatus("done");
    } catch (err) {
      setErrorMsg(String((err as Error).message || err));
      setStatus("error");
    }
  }

  async function handleSaveMappings() {
    const entries = Object.entries(mappings).filter(([, v]) => v);
    if (!entries.length) return;
    const res = await fetch("/api/headset/map", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mappings: entries.map(([headsetName, storeId]) => ({ headsetName, storeId })) })
    });
    const data = await res.json();
    if (data.error) { setErrorMsg(data.error); return; }
    setMappings({});
    setResult((prev) => prev ? { ...prev, unmatched: prev.unmatched.filter((n) => !entries.find(([k]) => k === n)) } : null);
  }

  const storeOptions = [...stores].sort((a, b) => a.storeName.localeCompare(b.storeName));

  return (
    <div className="panel headset-sync-panel">
      <div className="panel-header">
        <h3>Headset Sell-Through</h3>
        <span className="table-meta">Upload daily POS CSV</span>
      </div>
      <div className="headset-sync-body">
        <div className="headset-upload-row">
          <input
            type="file"
            accept=".csv"
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); setStatus("idle"); setResult(null); }}
          />
          <button
            className="primary-button"
            type="button"
            disabled={!file || status === "parsing" || status === "uploading"}
            onClick={handleUpload}
          >
            {status === "parsing" ? "Parsing…" : status === "uploading" ? "Uploading…" : "Import CSV"}
          </button>
        </div>
        {status === "done" && result ? (
          <div className="headset-result">
            <span className="headset-result-ok">
              Imported {result.imported.toLocaleString()} / {result.total.toLocaleString()} rows
            </span>
          </div>
        ) : null}
        {status === "error" && errorMsg ? (
          <div className="headset-result headset-result-error">{errorMsg}</div>
        ) : null}
        {result?.unmatched?.length ? (
          <div className="headset-unmatched">
            <div className="headset-unmatched-label">
              {result.unmatched.length} store{result.unmatched.length !== 1 ? "s" : ""} not matched — map them to your CRM stores:
            </div>
            {result.unmatched.map((name) => (
              <div className="headset-map-row" key={name}>
                <span className="headset-map-name">{name}</span>
                <select
                  value={mappings[name] || ""}
                  onChange={(e) => setMappings((prev) => ({ ...prev, [name]: e.target.value }))}
                >
                  <option value="">— select store —</option>
                  {storeOptions.map((s) => {
                    const location = [s.city, s.state].filter(Boolean).join(", ");
                    const detail = [location, s.license].filter(Boolean).join(" · ");
                    return (
                      <option key={s.storeId} value={s.storeId ?? ""}>
                        {s.storeName}{detail ? ` — ${detail}` : ""}
                      </option>
                    );
                  })}
                </select>
              </div>
            ))}
            {Object.values(mappings).some(Boolean) ? (
              <button className="secondary-button" type="button" style={{ marginTop: 8 }} onClick={handleSaveMappings}>
                Save Mappings
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

type InvSortKey = "product" | "subLine" | "strain" | "forSale" | "allocated" | "inStock" | "batches" | "batchDate" | "daysOfStock" | "thc" | "status";
type InvGroupFilter = "all" | "finished" | "3p" | "bulk";
type InvMode = "stock" | "processing";

type ProcessingRun = {
  orderNumber: string;
  sentAt: string;
  items: { productName: string; subProductLine: string | null; units: number; strain: string }[];
};

function useProcessingRuns(orderLines: OrderLine[]): ProcessingRun[] {
  return useMemo(() => {
    const byOrder = new Map<string, ProcessingRun>();
    for (const line of orderLines) {
      if (!line.storeName.toLowerCase().includes("agro couture")) continue;
      if (line.lineTotal !== 0) continue;
      const existing = byOrder.get(line.orderNumber);
      const item = {
        productName: line.productName ?? "",
        subProductLine: line.subProductLine ?? null,
        units: line.units,
        strain: extractStrain(line.productName ?? "")
      };
      if (existing) {
        existing.items.push(item);
      } else {
        byOrder.set(line.orderNumber, {
          orderNumber: line.orderNumber,
          sentAt: line.submittedAt ?? "",
          items: [item]
        });
      }
    }
    return [...byOrder.values()].sort((a, b) => b.sentAt.localeCompare(a.sentAt));
  }, [orderLines]);
}

// "KS | A Grade Flower" → "A Grade Flower"; bulk lots have no prefix and pass through
function stripBrandPrefix(subProductLine: string | null): string {
  if (!subProductLine) return "";
  return subProductLine.replace(/^[A-Z]{2,3}\s*\|\s*/, "").trim();
}

function parseProductBrand(subProductLine: string | null): string {
  if (!subProductLine) return "";
  if (subProductLine.startsWith("KS")) return "K. Savage";
  if (subProductLine.startsWith("MF")) return "Mayfield";
  if (subProductLine.startsWith("LL")) return "Leisure Land";
  return "";
}

function isBulk(item: InventoryItem) {
  return (item.subProductLine ?? "").toLowerCase().startsWith("bulk") ||
    (item.subProductLine ?? "") === "" && (item.category ?? "") === "";
}

// Prerolls, Diamond Doobies, and Skyboxes — the only SKUs Agro Couture processes
function is3pSku(subProductLine: string | null | undefined): boolean {
  if (!subProductLine) return false;
  const s = subProductLine.toLowerCase();
  return s.includes("preroll") || s.includes("pre-roll") || s.includes("pre roll") ||
    s.includes("diamond doobie") || s.includes("skybox");
}

function InventoryView({
  inventoryItems,
  orderLines
}: {
  inventoryItems: InventoryItem[];
  orderLines: OrderLine[];
}) {
  const [mode, setMode] = useState<InvMode>("stock");
  const [sortKey, setSortKey] = useState<InvSortKey>("forSale");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");
  const [groupFilter, setGroupFilter] = useState<InvGroupFilter>("all");
  const [search, setSearch] = useState("");
  const [brandFilter, setBrandFilter] = useState("all");
  const [strainFilter, setStrainFilter] = useState("all");
  const [subLineFilter, setSubLineFilter] = useState("all");
  const [leadTimeDays, setLeadTimeDays] = useState(21);

  const processingRuns = useProcessingRuns(orderLines);

  // For each strain: sum input units + earliest projected return across unconfirmed runs
  const inProcessByStrain = useMemo(() => {
    const map = new Map<string, { units: number; projectedDate: string | null }>();
    for (const run of processingRuns) {
      // Confirmed if any 3P inventory item for a matching strain has batch date > sentAt
      const confirmed = inventoryItems.some(
        (inv) =>
          is3pSku(inv.subProductLine) &&
          inv.latestBatchDate != null &&
          inv.latestBatchDate > run.sentAt &&
          run.items.some((item) => extractStrain(inv.product).toLowerCase() === item.strain.toLowerCase())
      );
      if (confirmed) continue;
      const projected = new Date(new Date(run.sentAt).getTime() + leadTimeDays * 86_400_000).toISOString();
      for (const item of run.items) {
        if (!item.strain) continue;
        const key = item.strain.toLowerCase();
        const existing = map.get(key);
        if (existing) {
          existing.units += item.units;
          if (!existing.projectedDate || projected < existing.projectedDate) existing.projectedDate = projected;
        } else {
          map.set(key, { units: item.units, projectedDate: projected });
        }
      }
    }
    return map;
  }, [processingRuns, inventoryItems, leadTimeDays]);

  // Velocity: paid order lines in last 90 days, units per sub_product_line per day
  const velocityMap = useMemo(() => {
    const cutoff = Date.now() - 90 * 86_400_000;
    const totals = new Map<string, number>();
    for (const line of orderLines) {
      if (!isPaidOrderLine(line)) continue;
      if (orderTimestamp(line.submittedAt) < cutoff) continue;
      if (!line.subProductLine) continue;
      totals.set(line.subProductLine, (totals.get(line.subProductLine) ?? 0) + line.units);
    }
    const result = new Map<string, number>();
    totals.forEach((units, key) => result.set(key, units / 90));
    return result;
  }, [orderLines]);

  const lastSynced = useMemo(() => {
    let latest: string | null = null;
    for (const item of inventoryItems) {
      if (item.syncedAt && (!latest || item.syncedAt > latest)) latest = item.syncedAt;
    }
    return latest;
  }, [inventoryItems]);

  const allBrands = useMemo(() => {
    const set = new Set<string>();
    for (const i of inventoryItems) { const b = parseProductBrand(i.subProductLine); if (b) set.add(b); }
    return [...set].sort();
  }, [inventoryItems]);

  const allStrains = useMemo(() => {
    const set = new Set<string>();
    for (const i of inventoryItems) { const s = extractStrain(i.product); if (s) set.add(s); }
    return [...set].sort();
  }, [inventoryItems]);

  const allSubLines = useMemo(() => {
    const set = new Set<string>();
    for (const i of inventoryItems) { const s = stripBrandPrefix(i.subProductLine); if (s) set.add(s); }
    return [...set].sort();
  }, [inventoryItems]);

  function daysOfStock(item: InventoryItem): number | null {
    const vel = velocityMap.get(item.subProductLine ?? "");
    if (!vel || vel <= 0) return null;
    return Math.round(item.totalForSale / vel);
  }

  function stockStatus(item: InventoryItem): "out" | "low" | "ok" {
    if (item.totalForSale <= 0) return "out";
    const days = daysOfStock(item);
    if (days !== null && days < 14) return "low";
    return "ok";
  }

  function handleSort(key: InvSortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "product" || key === "subLine" || key === "strain" || key === "batchDate" ? "asc" : "desc");
    }
  }

  const filtered = useMemo(() => {
    let items = inventoryItems;
    if (groupFilter === "finished") items = items.filter((i) => !isBulk(i));
    if (groupFilter === "3p") items = items.filter((i) => !isBulk(i) && is3pSku(i.subProductLine));
    if (groupFilter === "bulk") items = items.filter(isBulk);
    if (brandFilter !== "all") items = items.filter((i) => parseProductBrand(i.subProductLine) === brandFilter);
    if (strainFilter !== "all") items = items.filter((i) => extractStrain(i.product) === strainFilter);
    if (subLineFilter !== "all") items = items.filter((i) => stripBrandPrefix(i.subProductLine) === subLineFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter((i) =>
        i.product.toLowerCase().includes(q) ||
        (i.subProductLine ?? "").toLowerCase().includes(q) ||
        (i.subCategory ?? "").toLowerCase().includes(q)
      );
    }
    return [...items].sort((a, b) => {
      let diff = 0;
      const dA = daysOfStock(a), dB = daysOfStock(b);
      switch (sortKey) {
        case "product": diff = a.product.localeCompare(b.product); break;
        case "subLine": diff = stripBrandPrefix(a.subProductLine).localeCompare(stripBrandPrefix(b.subProductLine)); break;
        case "strain": diff = extractStrain(a.product).localeCompare(extractStrain(b.product)); break;
        case "forSale": diff = a.totalForSale - b.totalForSale; break;
        case "allocated": diff = a.totalAllocated - b.totalAllocated; break;
        case "inStock": diff = a.totalInStock - b.totalInStock; break;
        case "batches": diff = a.batchCount - b.batchCount; break;
        case "batchDate": diff = (a.latestBatchDate ?? "").localeCompare(b.latestBatchDate ?? ""); break;
        case "daysOfStock": diff = (dA ?? -1) - (dB ?? -1); break;
        case "thc": diff = (a.avgTotalThc ?? 0) - (b.avgTotalThc ?? 0); break;
        case "status": { const order = { out: 0, low: 1, ok: 2 }; diff = order[stockStatus(a)] - order[stockStatus(b)]; break; }
      }
      return sortDir === "asc" ? diff : -diff;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inventoryItems, groupFilter, brandFilter, strainFilter, subLineFilter, search, sortKey, sortDir, velocityMap]);

  const metrics = useMemo(() => ({
    total: filtered.length,
    totalForSale: filtered.reduce((s, i) => s + i.totalForSale, 0),
    out: filtered.filter((i) => stockStatus(i) === "out").length,
    low: filtered.filter((i) => stockStatus(i) === "low").length,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [filtered]);

  const arrow = (key: InvSortKey) => sortKey === key ? (sortDir === "asc" ? " ▴" : " ▾") : "";
  const thBtn = (key: InvSortKey, label: string) => (
    <button className="sort-header" type="button" onClick={() => handleSort(key)}>
      <span>{label}{arrow(key)}</span>
    </button>
  );

  if (!inventoryItems.length) {
    return (
      <section className="inv-view">
        <div className="panel" style={{ padding: "32px 24px", textAlign: "center" }}>
          <p style={{ color: "var(--muted)", marginBottom: 12 }}>No inventory data yet.</p>
          <p style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
            Go to Sync → Cultivera Inventory and upload the "Export Batches Currently in Stock" CSV.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="inv-view">
      <div className="panel inv-filter-panel">
        <div className="inv-filter-row">
          {/* Mode toggle */}
          <div className="sku-group-tabs">
            <button
              className={`secondary-button${mode === "stock" ? " active-tab" : ""}`}
              type="button"
              onClick={() => setMode("stock")}
            >
              Stock
            </button>
            <button
              className={`secondary-button${mode === "processing" ? " active-tab" : ""}`}
              type="button"
              onClick={() => setMode("processing")}
            >
              Processing{processingRuns.length ? ` (${processingRuns.length})` : ""}
            </button>
          </div>

          {mode === "stock" ? (
            <>
              <div className="sku-group-tabs">
                {(["all", "finished", "3p", "bulk"] as InvGroupFilter[]).map((g) => (
                  <button
                    key={g}
                    className={`secondary-button${groupFilter === g ? " active-tab" : ""}`}
                    type="button"
                    onClick={() => setGroupFilter(g)}
                  >
                    {g === "all" ? "All" : g === "finished" ? "Finished" : g === "3p" ? "3P" : "Bulk"}
                  </button>
                ))}
              </div>
              <div className="field" style={{ flex: 1, minWidth: 0 }}>
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search product or sub-line…"
                />
              </div>
              <div className="field" style={{ minWidth: 0 }}>
                <select value={brandFilter} onChange={(e) => setBrandFilter(e.target.value)} style={{ fontSize: "0.85rem" }}>
                  <option value="all">All Brands</option>
                  {allBrands.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
              <div className="field" style={{ minWidth: 0 }}>
                <select value={strainFilter} onChange={(e) => setStrainFilter(e.target.value)} style={{ fontSize: "0.85rem" }}>
                  <option value="all">All Strains</option>
                  {allStrains.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="field" style={{ minWidth: 0 }}>
                <select value={subLineFilter} onChange={(e) => setSubLineFilter(e.target.value)} style={{ fontSize: "0.85rem" }}>
                  <option value="all">All Sub-Lines</option>
                  {allSubLines.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </>
          ) : (
            <div className="field inv-lead-time-field">
              <label>Lead time (days)</label>
              <input
                type="number"
                min={1}
                max={90}
                value={leadTimeDays}
                onChange={(e) => setLeadTimeDays(Number(e.target.value) || 21)}
                style={{ width: 72 }}
              />
            </div>
          )}

          {lastSynced ? (
            <span className="table-meta inv-sync-date">Synced {formatDate(lastSynced)}</span>
          ) : null}
        </div>
      </div>

      {mode === "stock" ? (
        <>
          <div className="metrics orders-metrics">
            <div className="metric">
              <div className="metric-label">SKUs</div>
              <div className="metric-value">{metrics.total}</div>
            </div>
            <div className="metric">
              <div className="metric-label">Units For Sale</div>
              <div className="metric-value">{metrics.totalForSale.toLocaleString()}</div>
            </div>
            <div className="metric">
              <div className="metric-label">Out of Stock</div>
              <div className="metric-value" style={{ color: metrics.out ? "var(--danger, #ef4444)" : undefined }}>
                {metrics.out}
              </div>
            </div>
            <div className="metric">
              <div className="metric-label">Low Stock (&lt;14d)</div>
              <div className="metric-value" style={{ color: metrics.low ? "#f59e0b" : undefined }}>
                {metrics.low}
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="table-scroll">
              <table className="data-table inv-table">
                <thead>
                  <tr>
                    <th>{thBtn("product", "Product")}</th>
                    <th>{thBtn("subLine", "Sub-Line")}</th>
                    <th>{thBtn("strain", "Strain")}</th>
                    <th style={{ textAlign: "right" }}>{thBtn("forSale", "For Sale")}</th>
                    <th style={{ textAlign: "right" }}>{thBtn("allocated", "Allocated")}</th>
                    <th style={{ textAlign: "right" }}>{thBtn("inStock", "In Stock")}</th>
                    <th style={{ textAlign: "right" }}>{thBtn("daysOfStock", "Days of Stock")}</th>
                    <th style={{ textAlign: "right" }}>{thBtn("thc", "Total THC%")}</th>
                    <th>{thBtn("batchDate", "Latest Batch")}</th>
                    <th style={{ textAlign: "right" }}>{thBtn("batches", "Batches")}</th>
                    {groupFilter === "3p" ? <th>In Process</th> : null}
                    <th>{thBtn("status", "Status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((item) => {
                    const status = stockStatus(item);
                    const days = daysOfStock(item);
                    const brand = parseProductBrand(item.subProductLine);
                    return (
                      <tr key={`${item.product}-${item.subProductLine}`} className={`inv-row inv-row-${status}`}>
                        <td>
                          <div className="inv-product-name">{item.product}</div>
                          {brand ? (
                            <span
                              className="sku-brand-badge"
                              style={{ background: BRAND_DOT_COLORS[brand as BrandFilter] ?? "var(--muted)", marginTop: 2, display: "inline-block" }}
                            >
                              {brand}
                            </span>
                          ) : null}
                        </td>
                        <td style={{ color: "var(--muted)", fontSize: "0.82rem" }}>{stripBrandPrefix(item.subProductLine) || "—"}</td>
                        <td style={{ fontSize: "0.82rem" }}>{extractStrain(item.product) || <span style={{ color: "var(--muted)" }}>—</span>}</td>
                        <td style={{ textAlign: "right", fontWeight: item.totalForSale > 0 ? 600 : undefined }}>
                          {item.totalForSale.toLocaleString()}
                        </td>
                        <td style={{ textAlign: "right", color: item.totalAllocated > 0 ? "#f59e0b" : "var(--muted)" }}>
                          {item.totalAllocated > 0 ? item.totalAllocated.toLocaleString() : "—"}
                        </td>
                        <td style={{ textAlign: "right" }}>{item.totalInStock.toLocaleString()}</td>
                        <td style={{ textAlign: "right" }}>
                          {days !== null ? (
                            <span style={{ color: days < 7 ? "var(--danger, #ef4444)" : days < 14 ? "#f59e0b" : "inherit" }}>
                              {days}d
                            </span>
                          ) : (
                            <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>no velocity</span>
                          )}
                        </td>
                        <td style={{ textAlign: "right", color: "var(--muted)", fontSize: "0.82rem" }}>
                          {item.avgTotalThc != null ? `${item.avgTotalThc}%` : "—"}
                        </td>
                        <td style={{ fontSize: "0.82rem" }}>{formatShortDate(item.latestBatchDate)}</td>
                        <td style={{ textAlign: "right", color: "var(--muted)", fontSize: "0.82rem" }}>{item.batchCount}</td>
                        {groupFilter === "3p" ? (() => {
                          const ip = inProcessByStrain.get(extractStrain(item.product).toLowerCase());
                          return ip ? (
                            <td style={{ fontSize: "0.82rem" }}>
                              <div style={{ fontWeight: 600 }}>{ip.units.toLocaleString()} units</div>
                              {ip.projectedDate ? (
                                <div style={{ color: "var(--muted)", fontSize: "0.78rem" }}>
                                  back ~{formatShortDate(ip.projectedDate)}
                                </div>
                              ) : null}
                            </td>
                          ) : (
                            <td style={{ color: "var(--muted)" }}>—</td>
                          );
                        })() : null}
                        <td>
                          {status === "out" ? (
                            <span className="inv-badge inv-badge-out">Out</span>
                          ) : status === "low" ? (
                            <span className="inv-badge inv-badge-low">Low</span>
                          ) : (
                            <span className="inv-badge inv-badge-ok">OK</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {!filtered.length ? (
                    <tr>
                      <td colSpan={groupFilter === "3p" ? 12 : 11} style={{ textAlign: "center", color: "var(--muted)", padding: "24px" }}>
                        No products match current filters.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        /* Processing mode */
        <div className="panel">
          {processingRuns.length === 0 ? (
            <div style={{ padding: "32px 24px", textAlign: "center", color: "var(--muted)" }}>
              No processing transfers found. These are detected from Cultivera orders to Agro Couture with $0 line total.
            </div>
          ) : (
            <div className="proc-runs">
              {processingRuns.map((run) => {
                const sentDate = new Date(run.sentAt);
                const now = Date.now();
                const daysAgo = Math.round((now - sentDate.getTime()) / 86_400_000);
                const totalUnits = run.items.reduce((s, i) => s + i.units, 0);
                const strains = [...new Set(run.items.map((i) => i.strain).filter((s) => s.length > 0))];
                const strainsLower = strains.map((s) => s.toLowerCase());

                // 1. Inventory: 3P SKU with batch date after sentAt, strain match
                const invMatches = inventoryItems.filter(
                  (inv) =>
                    is3pSku(inv.subProductLine) &&
                    inv.latestBatchDate != null &&
                    inv.latestBatchDate > run.sentAt &&
                    strainsLower.some((s) => extractStrain(inv.product).toLowerCase() === s)
                );
                const invReturnDate = invMatches.length
                  ? invMatches.map((inv) => inv.latestBatchDate!).sort()[0]
                  : null;

                // 2. Orders: first paid non-Agro-Couture order for matching 3P SKU + strain after sentAt
                let orderReturnDate: string | null = null;
                if (!invReturnDate) {
                  const orderMatches = orderLines
                    .filter(
                      (line) =>
                        isPaidOrderLine(line) &&
                        !line.storeName.toLowerCase().includes("agro couture") &&
                        is3pSku(line.subProductLine) &&
                        (line.submittedAt ?? "") > run.sentAt &&
                        strainsLower.some((s) => extractStrain(line.productName ?? "").toLowerCase() === s)
                    )
                    .sort((a, b) => (a.submittedAt ?? "").localeCompare(b.submittedAt ?? ""));
                  if (orderMatches.length) orderReturnDate = orderMatches[0].submittedAt ?? null;
                }

                const actualReturnDate = invReturnDate ?? orderReturnDate;
                const returnSource = invReturnDate ? "inventory" : orderReturnDate ? "orders" : null;

                // 3. Fallback: estimated from lead time
                const expectedReturn = new Date(sentDate.getTime() + leadTimeDays * 86_400_000);
                const daysUntilReturn = Math.round((expectedReturn.getTime() - now) / 86_400_000);
                const isExpected = daysUntilReturn > 0;

                let badgeClass: string;
                let badgeText: string;
                if (actualReturnDate) {
                  const leadActual = Math.round((new Date(actualReturnDate).getTime() - sentDate.getTime()) / 86_400_000);
                  badgeClass = "inv-badge inv-badge-ok";
                  badgeText = returnSource === "inventory"
                    ? `Returned ${formatShortDate(actualReturnDate)} · ${leadActual}d lead (actual)`
                    : `Back by ${formatShortDate(actualReturnDate)} · ${leadActual}d lead (est.)`;
                } else if (isExpected) {
                  badgeClass = "inv-badge inv-badge-low";
                  badgeText = `Expected back in ${daysUntilReturn}d`;
                } else {
                  badgeClass = "inv-badge inv-badge-ok";
                  badgeText = `Est. returned ${Math.abs(daysUntilReturn)}d ago`;
                }

                // Related 3P finished-goods inventory for matching strains
                const relatedStock = strains.flatMap((strain) =>
                  inventoryItems.filter(
                    (inv) =>
                      is3pSku(inv.subProductLine) &&
                      extractStrain(inv.product).toLowerCase() === strain.toLowerCase()
                  )
                );

                return (
                  <div key={run.orderNumber} className="proc-run">
                    <div className="proc-run-header">
                      <div className="proc-run-meta">
                        <strong>{formatDate(run.sentAt)}</strong>
                        <span className="table-meta">Order {run.orderNumber}</span>
                        <span className="table-meta">{daysAgo}d ago · {totalUnits.toLocaleString()} units</span>
                      </div>
                      <div className={badgeClass}>{badgeText}</div>
                    </div>

                    <div className="proc-run-body">
                      <div className="proc-run-inputs">
                        <div className="proc-section-label">Sent to Agro Couture</div>
                        {run.items.map((item, idx) => (
                          <div key={idx} className="proc-item">
                            <span className="proc-item-name">{item.productName || item.subProductLine || "—"}</span>
                            <span className="proc-item-units">{item.units.toLocaleString()} units</span>
                          </div>
                        ))}
                      </div>

                      {relatedStock.length > 0 ? (
                        <div className="proc-run-stock">
                          <div className="proc-section-label">Current finished goods</div>
                          {relatedStock.map((inv) => {
                            const days = daysOfStock(inv);
                            const status = stockStatus(inv);
                            return (
                              <div key={`${inv.product}-${inv.subProductLine}`} className="proc-item">
                                <span className="proc-item-name">{inv.product}</span>
                                <span className="proc-item-units">
                                  {inv.totalForSale.toLocaleString()} for sale
                                  {days !== null ? ` · ${days}d stock` : ""}
                                </span>
                                <span className={`inv-badge inv-badge-${status}`} style={{ marginLeft: 6 }}>
                                  {status === "out" ? "Out" : status === "low" ? "Low" : "OK"}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function SyncView({
  orderLines,
  salesGoals,
  stores
}: {
  orderLines: OrderLine[];
  salesGoals: SalesGoal[];
  stores: StoreRollup[];
}) {
  const { syncState, syncMessage, syncOrders } = useOrderSync();
  const paidLines = useMemo(() => orderLines.filter(isPaidOrderLine), [orderLines]);
  const latestOrder = latestOrderDate(orderLines);
  const paidRevenue = paidLines.reduce((total, line) => total + line.lineTotal, 0);
  const syncedStoreCount = new Set(orderLines.map(orderLineStoreKey).filter(Boolean)).size;
  const brandRows = TERRITORY_BRANDS.map((brand) => {
    const brandLines = paidLines.filter((line) => orderBrandValue(line) === brand);
    return {
      brand,
      orders: uniqueOrderCount(brandLines),
      lines: brandLines.length,
      revenue: brandLines.reduce((total, line) => total + line.lineTotal, 0)
    };
  });

  return (
    <section className="sync-view">
      <section className="panel sync-hero">
        <div>
          <h3>Cultivera Orders</h3>
          <div className="caption">Google Sheet to Supabase</div>
        </div>
        <button className="primary-button" disabled={syncState === "syncing"} onClick={syncOrders} type="button">
          {syncState === "syncing" ? "Syncing..." : "Sync Orders"}
        </button>
      </section>

      {syncMessage ? (
        <div className={`sync-message sync-message-${syncState}`} role="status">
          {syncMessage}
        </div>
      ) : null}

      <section className="metrics orders-metrics">
        <DetailStat label="Orders" value={uniqueOrderCount(orderLines).toLocaleString()} />
        <DetailStat label="Line Items" value={orderLines.length.toLocaleString()} />
        <DetailStat label="Paid Revenue" value={formatUsd(paidRevenue)} />
        <DetailStat label="Stores Matched" value={syncedStoreCount.toLocaleString()} />
        <DetailStat label="Latest Order" value={formatDate(latestOrder)} />
      </section>

      <section className="sync-grid">
        <div className="panel">
          <div className="panel-header">
            <h3>Sources</h3>
            <span className="table-meta">Current snapshot</span>
          </div>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Rows</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Cultivera Orders</td>
                  <td>{uniqueOrderCount(orderLines).toLocaleString()} / {orderLines.length.toLocaleString()}</td>
                  <td>{syncState === "syncing" ? "Syncing" : "Ready"}</td>
                </tr>
                <tr>
                  <td>Sales Goals</td>
                  <td>{salesGoals.length.toLocaleString()}</td>
                  <td>Saved directly</td>
                </tr>
                <tr>
                  <td>Store Rollup</td>
                  <td>{stores.length.toLocaleString()}</td>
                  <td>Live snapshot</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <h3>Brand Coverage</h3>
            <span className="table-meta">Paid order lines</span>
          </div>
          <div className="brand-summary-grid sync-brand-grid">
            {brandRows.map((row) => (
              <div className="brand-summary-card" key={row.brand}>
                <div className="brand-summary-title">
                  <span
                    aria-hidden="true"
                    className="brand-dot"
                    style={{ background: BRAND_DOT_COLORS[row.brand] ?? "var(--muted)" }}
                  />
                  <strong>{row.brand}</strong>
                </div>
                <div className="brand-summary-value">{formatUsd(row.revenue)}</div>
                <div className="brand-summary-meta">
                  {row.orders.toLocaleString()} orders · {row.lines.toLocaleString()} lines
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <HeadsetSyncPanel stores={stores} />
      <InventorySyncPanel />
    </section>
  );
}

function InventorySyncPanel() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "parsing" | "uploading" | "done" | "error">("idle");
  const [result, setResult] = useState<{ imported: number; total: number; products: number } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "done" | "error">("idle");
  const [syncResult, setSyncResult] = useState<{ imported: number; total: number; syncedAt: string } | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  async function handleAutoSync() {
    setSyncStatus("syncing");
    setSyncResult(null);
    setSyncError(null);
    try {
      const res = await fetch("/api/inventory/sync", { method: "POST" });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSyncResult(data);
      setSyncStatus("done");
    } catch (err) {
      setSyncError(String((err as Error).message || err));
      setSyncStatus("error");
    }
  }

  function parseCultiveraInventoryCsv(text: string) {
    // Auto-detect delimiter: tab if more tabs than commas on header line
    const firstLine = text.split(/\r?\n/)[0] ?? "";
    const delim = (firstLine.match(/\t/g) ?? []).length > (firstLine.match(/,/g) ?? []).length ? "\t" : ",";

    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return [];

    const rawHeaders = lines[0].split(delim).map((h) => h.trim().replace(/^"|"$/g, ""));
    const col = (name: string) => rawHeaders.findIndex((h) => h.toLowerCase() === name.toLowerCase());

    const barcodeIdx  = col("Barcode");
    const productIdx  = col("Product");
    const plIdx       = col("Product-Line");
    const splIdx      = col("Sub-Product-Line");
    const catIdx      = col("Category");
    const subcatIdx   = col("Sub-Category");
    const roomIdx     = col("Room");
    const batchIdx    = col("Batch Date");
    const thcaIdx     = col("QA THCA");
    const thcIdx      = col("QA THC");
    const cbdIdx      = col("QA CBD");
    const totalIdx    = col("QA Total");
    const availIdx    = col("Availability");
    const forSaleIdx  = col("Units For Sale");
    const onHoldIdx   = col("Units On Hold");
    const allocIdx    = col("Units Allocated");
    const inStockIdx  = col("Units in Stocks");

    const parseNum = (v: string) => { const n = parseFloat(v.replace(/[^0-9.-]/g, "")); return isNaN(n) ? null : n; };
    const get = (cols: string[], i: number) => (i >= 0 ? (cols[i] ?? "").trim().replace(/^"|"$/g, "") : "");

    return lines.slice(1).map((line) => {
      const cols = line.split(delim);
      const barcode = get(cols, barcodeIdx);
      const product = get(cols, productIdx);
      if (!barcode || !product) return null;
      const batchRaw = get(cols, batchIdx);
      const batchDate = batchRaw ? new Date(batchRaw).toISOString() : null;
      return {
        barcode,
        product,
        productLine: get(cols, plIdx) || null,
        subProductLine: get(cols, splIdx) || null,
        category: get(cols, catIdx) || null,
        subCategory: get(cols, subcatIdx) || null,
        room: get(cols, roomIdx) || null,
        batchDate: isNaN(Date.parse(batchRaw)) ? null : batchDate,
        qaThca: parseNum(get(cols, thcaIdx)),
        qaThc: parseNum(get(cols, thcIdx)),
        qaCbd: parseNum(get(cols, cbdIdx)),
        qaTotal: parseNum(get(cols, totalIdx)),
        availability: get(cols, availIdx) || null,
        unitsForSale: parseNum(get(cols, forSaleIdx)) ?? 0,
        unitsOnHold: parseNum(get(cols, onHoldIdx)) ?? 0,
        unitsAllocated: parseNum(get(cols, allocIdx)) ?? 0,
        unitsInStock: parseNum(get(cols, inStockIdx)) ?? 0
      };
    }).filter((r): r is NonNullable<typeof r> => r !== null);
  }

  async function handleUpload() {
    if (!file) return;
    setStatus("parsing");
    setErrorMsg(null);
    try {
      const text = await file.text();
      const rows = parseCultiveraInventoryCsv(text);
      if (!rows.length) throw new Error("No valid rows found. Make sure you exported from Cultivera batch products.");
      setStatus("uploading");
      const res = await fetch("/api/inventory/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setResult(data);
      setStatus("done");
    } catch (err) {
      setErrorMsg(String((err as Error).message || err));
      setStatus("error");
    }
  }

  return (
    <div className="panel headset-sync-panel">
      <div className="panel-header">
        <h3>Cultivera Inventory</h3>
        <span className="table-meta">Syncs every 4 hours · also runs on-demand</span>
      </div>
      <div className="headset-sync-body">
        {/* Auto sync */}
        <div className="headset-upload-row">
          <button
            className="primary-button"
            type="button"
            disabled={syncStatus === "syncing"}
            onClick={handleAutoSync}
          >
            {syncStatus === "syncing" ? "Syncing…" : "Sync Now"}
          </button>
          {syncStatus === "done" && syncResult ? (
            <span className="headset-result">
              {syncResult.total.toLocaleString()} batches synced · {formatDate(syncResult.syncedAt)}
            </span>
          ) : null}
          {syncStatus === "error" && syncError ? (
            <span className="headset-result headset-result-error">{syncError}</span>
          ) : null}
        </div>

        {/* CSV fallback */}
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border, #e5e7eb)" }}>
          <div className="table-meta" style={{ marginBottom: 8 }}>Manual CSV fallback — use if auto-sync isn&apos;t configured</div>
          <div className="headset-upload-row">
            <input
              type="file"
              accept=".csv,.tsv,.txt"
              onChange={(e) => { setFile(e.target.files?.[0] ?? null); setStatus("idle"); setResult(null); }}
            />
            <button
              className="secondary-button"
              type="button"
              disabled={!file || status === "parsing" || status === "uploading"}
              onClick={handleUpload}
            >
              {status === "parsing" ? "Parsing…" : status === "uploading" ? "Uploading…" : "Import CSV"}
            </button>
          </div>
          {status === "done" && result ? (
            <div className="headset-result">
              {result.products} products · {result.imported.toLocaleString()} batch rows imported
            </div>
          ) : null}
          {status === "error" && errorMsg ? (
            <div className="headset-result headset-result-error">{errorMsg}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function GoalPaceChart({
  points,
  eomGoal,
  weeklyGoalTotal
}: {
  points: GoalDailyPoint[];
  eomGoal: number;
  weeklyGoalTotal: number;
}) {
  const width = 900;
  const height = 280;
  const padding = { top: 18, right: 18, bottom: 30, left: 54 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(
    1,
    eomGoal,
    weeklyGoalTotal,
    ...points.flatMap((point) => [
      point.dailySales,
      point.actualCumulative,
      point.eomPace,
      point.weeklyPace,
      point.projectedPace || 0
    ])
  );
  const xForIndex = (index: number) => (
    padding.left + (points.length <= 1 ? 0 : (index / (points.length - 1)) * chartWidth)
  );
  const yForValue = (value: number) => padding.top + chartHeight - (value / maxValue) * chartHeight;
  const linePath = (values: (number | null)[]) => values.reduce((path, value, index) => {
    if (value === null) {
      return path;
    }
    const command = path ? "L" : "M";
    return `${path} ${command} ${xForIndex(index).toFixed(1)} ${yForValue(value).toFixed(1)}`.trim();
  }, "");
  const barWidth = Math.max(4, chartWidth / Math.max(1, points.length) - 3);
  const ticks = [0, maxValue / 2, maxValue];

  return (
    <div className="goal-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Goal pace chart">
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={padding.left}
              x2={width - padding.right}
              y1={yForValue(tick)}
              y2={yForValue(tick)}
              className="goal-grid-line"
            />
            <text x={padding.left - 10} y={yForValue(tick) + 4} textAnchor="end" className="goal-axis-label">
              {formatUsd(tick)}
            </text>
          </g>
        ))}
        {points.map((point, index) => {
          const barHeight = chartHeight - (yForValue(point.dailySales) - padding.top);
          return (
            <rect
              className="goal-daily-bar"
              key={point.date}
              x={xForIndex(index) - barWidth / 2}
              y={yForValue(point.dailySales)}
              width={barWidth}
              height={Math.max(0, barHeight)}
              rx={2}
            />
          );
        })}
        <path className="goal-line goal-line-actual" d={linePath(points.map((point) => point.actualCumulative))} />
        {eomGoal > 0 ? (
          <path className="goal-line goal-line-eom" d={linePath(points.map((point) => point.eomPace))} />
        ) : null}
        {weeklyGoalTotal > 0 ? (
          <path className="goal-line goal-line-weekly" d={linePath(points.map((point) => point.weeklyPace))} />
        ) : null}
        {points.some((point) => point.projectedPace !== null) ? (
          <path className="goal-line goal-line-projected" d={linePath(points.map((point) => point.projectedPace))} />
        ) : null}
        {points.length ? (
          <>
            <text x={padding.left} y={height - 8} className="goal-axis-label">{shortDateLabel(points[0].date)}</text>
            <text x={width - padding.right} y={height - 8} textAnchor="end" className="goal-axis-label">
              {shortDateLabel(points[points.length - 1].date)}
            </text>
          </>
        ) : null}
      </svg>
      <div className="goal-legend">
        <span><i className="legend-dot legend-actual" /> Actual</span>
        <span><i className="legend-dot legend-eom" /> EOM pace</span>
        <span><i className="legend-dot legend-weekly" /> Weekly pace</span>
        <span><i className="legend-dot legend-projected" /> Projected</span>
      </div>
    </div>
  );
}

function GoalsView({
  orderLines,
  salesGoals
}: {
  orderLines: OrderLine[];
  salesGoals: SalesGoal[];
}) {
  const router = useRouter();
  const monthOptions = useMemo(() => goalMonthOptions(orderLines, salesGoals), [orderLines, salesGoals]);
  const [selectedMonth, setSelectedMonth] = useState(() => (
    monthOptions.includes(currentMonthKey()) ? currentMonthKey() : monthOptions[0] || currentMonthKey()
  ));
  const [brandFilter, setBrandFilter] = useState<"all" | BrandFilter>("all");
  const weeks = useMemo(() => monthWeeks(selectedMonth), [selectedMonth]);
  const savedDraft = useMemo(() => (
    goalsDraftFromRows(salesGoals, selectedMonth, weeks)
  ), [salesGoals, selectedMonth, weeks]);
  const [draft, setDraft] = useState<GoalDraft>(savedDraft);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "success" | "error">("idle");
  const [saveMessage, setSaveMessage] = useState("");

  useEffect(() => {
    if (!monthOptions.includes(selectedMonth)) {
      setSelectedMonth(monthOptions[0] || currentMonthKey());
    }
  }, [monthOptions, selectedMonth]);

  useEffect(() => {
    setDraft(savedDraft);
    setSaveState("idle");
    setSaveMessage("");
  }, [savedDraft]);

  const selectedBrands = useMemo(() => goalBrandFilterValues(brandFilter), [brandFilter]);
  const eomGoal = sumGoalValues(draft.brandEom, selectedBrands);
  const weeklyGoals = useMemo(() => (
    Object.fromEntries(
      weeks.map((week) => [week.id, sumGoalValues(draft.brandWeeks[week.id] || emptyBrandGoalStrings(), selectedBrands)])
    )
  ), [draft.brandWeeks, selectedBrands, weeks]);
  const weeklyGoalTotal = Object.values(weeklyGoals).reduce((total, value) => total + value, 0);
  const { points, progressDay, salesToDate, projectedEom } = useMemo(() => (
    buildGoalDailyPoints({
      orderLines,
      monthKey: selectedMonth,
      weeks,
      eomGoal,
      weeklyGoals,
      brands: selectedBrands
    })
  ), [eomGoal, orderLines, selectedBrands, selectedMonth, weeklyGoals, weeks]);
  const activeGoal = eomGoal || weeklyGoalTotal;
  const remainingDays = Math.max(0, daysBetweenInclusive(addUtcDays(progressDay, 1), monthEndDate(selectedMonth)));
  const goalGap = eomGoal ? Math.max(0, eomGoal - salesToDate) : 0;
  const requiredPerDay = remainingDays ? goalGap / remainingDays : 0;
  const isDirty = goalDraftSignature(draft) !== goalDraftSignature(savedDraft);

  function updateEomGoal(brand: BrandFilter, value: string) {
    setDraft((currentDraft) => ({
      ...currentDraft,
      brandEom: {
        ...currentDraft.brandEom,
        [brand]: value
      }
    }));
  }

  function updateWeekGoal(weekId: string, brand: BrandFilter, value: string) {
    setDraft((currentDraft) => ({
      ...currentDraft,
      brandWeeks: {
        ...currentDraft.brandWeeks,
        [weekId]: {
          ...(currentDraft.brandWeeks[weekId] || emptyBrandGoalStrings()),
          [brand]: value
        }
      }
    }));
  }

  function updateWeekNote(weekId: string, value: string) {
    setDraft((currentDraft) => ({
      ...currentDraft,
      notes: {
        ...currentDraft.notes,
        [weekId]: value
      }
    }));
  }

  async function saveGoals() {
    setSaveState("saving");
    setSaveMessage("Saving goals...");
    const rows = [
      ...TERRITORY_BRANDS.flatMap((brand) => {
        const goalAmount = cleanGoalNumber(draft.brandEom[brand]);
        return goalAmount > 0 ? [{
          goalType: "EOM",
          brand,
          goalAmount
        }] : [];
      }),
      ...weeks.flatMap((week) => (
        TERRITORY_BRANDS.flatMap((brand) => {
          const goalAmount = cleanGoalNumber(draft.brandWeeks[week.id]?.[brand]);
          return goalAmount > 0 ? [{
            goalType: "Week",
            weekId: week.id,
            weekLabel: week.label,
            brand,
            goalAmount
          }] : [];
        })
      )),
      ...weeks.flatMap((week) => {
        const note = String(draft.notes[week.id] || "").trim();
        return note ? [{
          goalType: "Week Note",
          weekId: week.id,
          weekLabel: week.label,
          notes: note
        }] : [];
      })
    ];

    try {
      const response = await fetch("/api/sales-goals", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          month: selectedMonth,
          rows
        })
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result?.error || "Could not save goals.");
      }
      setSaveState("success");
      setSaveMessage(`Saved ${Number(result.rows || 0).toLocaleString()} goal rows for ${monthLabel(selectedMonth)}.`);
      router.refresh();
    } catch (error) {
      setSaveState("error");
      setSaveMessage(error instanceof Error ? error.message : "Could not save goals.");
    }
  }

  const weeklyRows = weeks.map((week) => {
    const weekActual = points
      .filter((point) => point.date >= week.start && point.date <= week.end)
      .reduce((total, point) => total + point.dailySales, 0);
    const weekGoal = weeklyGoals[week.id] || 0;
    return {
      week,
      actual: weekActual,
      goal: weekGoal,
      variance: weekActual - weekGoal
    };
  });

  return (
    <section className="goals-view">
      <section className="panel goals-controls">
        <div className="field">
          <label>Month</label>
          <select value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)}>
            {monthOptions.map((month) => (
              <option key={month} value={month}>{monthLabel(month)}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Brand Filter</label>
          <select value={brandFilter} onChange={(event) => setBrandFilter(event.target.value as "all" | BrandFilter)}>
            <option value="all">All brands</option>
            {TERRITORY_BRANDS.map((brand) => (
              <option key={brand} value={brand}>{brand}</option>
            ))}
          </select>
        </div>
        <div className="goals-save">
          <button className="primary-button" disabled={saveState === "saving"} type="button" onClick={saveGoals}>
            {saveState === "saving" ? "Saving..." : "Save Goals"}
          </button>
          {isDirty ? <span className="caption">Unsaved changes</span> : <span className="caption">Supabase goals</span>}
        </div>
      </section>

      {saveMessage ? (
        <div className={`sync-message sync-message-${saveState}`} role="status">
          {saveMessage}
        </div>
      ) : null}

      <section className="metrics orders-metrics">
        <DetailStat label="Sales to Date" value={formatUsd(salesToDate)} />
        <DetailStat label="EOM Goal" value={formatUsd(eomGoal)} />
        <DetailStat label="Progress" value={percentLabel(salesToDate, activeGoal)} />
        <DetailStat label="Projected EOM" value={formatUsd(projectedEom)} />
        <DetailStat label="Per Day Needed" value={formatUsd(requiredPerDay)} />
      </section>

      <section className="goals-grid">
        <div className="panel">
          <div className="panel-header">
            <h3>Brand Goals</h3>
            <span className="table-meta">{monthLabel(selectedMonth)}</span>
          </div>
          <div className="goal-input-grid">
            {TERRITORY_BRANDS.map((brand) => (
              <div className="field" key={brand}>
                <label>
                  <span
                    aria-hidden="true"
                    className="brand-dot"
                    style={{ background: BRAND_DOT_COLORS[brand] ?? "var(--muted)" }}
                  />
                  {brand} EOM
                </label>
                <input
                  inputMode="numeric"
                  min="0"
                  type="number"
                  value={draft.brandEom[brand]}
                  onChange={(event) => updateEomGoal(brand, event.target.value)}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <h3>Pace</h3>
            <span className="table-meta">{shortDateLabel(monthStartDate(selectedMonth))} - {shortDateLabel(monthEndDate(selectedMonth))}</span>
          </div>
          <GoalPaceChart points={points} eomGoal={eomGoal} weeklyGoalTotal={weeklyGoalTotal} />
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h3>Weekly Goals</h3>
          <span className="table-meta">{formatUsd(goalGap)} remaining</span>
        </div>
        <div className="table-scroll">
          <table className="data-table goal-table">
            <thead>
              <tr>
                <th>Week</th>
                {TERRITORY_BRANDS.map((brand) => <th key={brand}>{brand}</th>)}
                <th>Goal</th>
                <th>Actual</th>
                <th>Progress</th>
                <th>Variance</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {weeklyRows.map(({ week, actual, goal, variance }) => (
                <tr key={week.id}>
                  <td>{week.label}</td>
                  {TERRITORY_BRANDS.map((brand) => (
                    <td key={brand}>
                      <input
                        className="table-input"
                        inputMode="numeric"
                        min="0"
                        type="number"
                        value={draft.brandWeeks[week.id]?.[brand] || ""}
                        onChange={(event) => updateWeekGoal(week.id, brand, event.target.value)}
                      />
                    </td>
                  ))}
                  <td>{formatUsd(goal)}</td>
                  <td>{formatUsd(actual)}</td>
                  <td>{percentLabel(actual, goal)}</td>
                  <td>{formatUsd(variance)}</td>
                  <td>
                    <input
                      className="table-input notes-input"
                      value={draft.notes[week.id] || ""}
                      onChange={(event) => updateWeekNote(week.id, event.target.value)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}

function SkuAnalyticsView({
  orderLines
}: {
  orderLines: OrderLine[];
  stores: StoreRollup[];
}) {
  const [skuQuery, setSkuQuery] = useState("");
  const [brandFilter, setBrandFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [groupMode, setGroupMode] = useState<SkuGroupMode>("sku");
  const [skuSortKey, setSkuSortKey] = useState<SkuSortKey>("units");
  const [skuSortDir, setSkuSortDir] = useState<SortDirection>("desc");
  const [catSortKey, setCatSortKey] = useState<CatSortKey>("units");
  const [catSortDir, setCatSortDir] = useState<SortDirection>("desc");
  const [catDetailMode, setCatDetailMode] = useState<"size" | "strain">("size");
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(() => new Set());

  function toggleExpanded(cat: string) {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  }

  const baseLines = useMemo(() => orderLines.filter(isPaidOrderLine), [orderLines]);
  const bounds = useMemo(() => orderDateBounds(baseLines), [baseLines]);
  const effectiveDateFrom = dateFrom || bounds.defaultFrom;
  const effectiveDateTo = dateTo || bounds.defaultTo;

  useEffect(() => {
    setDateFrom("");
    setDateTo("");
  }, [bounds.defaultFrom, bounds.defaultTo]);

  const windowLines = useMemo(() => (
    baseLines.filter((line) => lineIsInsideDateRange(line, effectiveDateFrom, effectiveDateTo))
  ), [baseLines, effectiveDateFrom, effectiveDateTo]);

  const allActiveStoreCount = useMemo(() => (
    new Set(windowLines.map(orderLineStoreKey)).size
  ), [windowLines]);

  const categoryOptions = useMemo(() => {
    const cats = new Set(windowLines.map((line) => normalizeCategory(line.subProductLine)));
    return [...cats].filter(Boolean).sort();
  }, [windowLines]);

  const brandOptions = useMemo(() => {
    const extra = [...new Set(windowLines.map(orderBrandValue))]
      .filter((b) => !TERRITORY_BRANDS.includes(b as BrandFilter))
      .sort();
    return [...TERRITORY_BRANDS, ...extra];
  }, [windowLines]);

  const normalizedSkuQuery = skuQuery.trim().toLowerCase();

  const brandSearchLines = useMemo(() => (
    windowLines.filter((line) => {
      if (brandFilter !== "all" && orderBrandValue(line) !== brandFilter) return false;
      if (normalizedSkuQuery) {
        return [line.productName, line.subProductLine, line.brand]
          .some((v) => String(v ?? "").toLowerCase().includes(normalizedSkuQuery));
      }
      return true;
    })
  ), [windowLines, brandFilter, normalizedSkuQuery]);

  const filteredLines = useMemo(() => (
    brandSearchLines.filter((line) => {
      if (categoryFilter !== "all" && normalizeCategory(line.subProductLine) !== categoryFilter) return false;
      return true;
    })
  ), [brandSearchLines, categoryFilter]);

  type SkuRow = {
    key: string;
    product: string;
    category: string;
    brand: string;
    units: number;
    revenue: number;
    storeCount: number;
    coverage: number;
    avgUnitsPerStore: number;
    lastOrdered: string | null;
  };

  const skuRows = useMemo((): SkuRow[] => {
    const byKey = new Map<string, {
      product: string; category: string; brand: string;
      units: number; revenue: number; storeKeys: Set<string>; maxTs: number;
    }>();

    filteredLines.forEach((line) => {
      const product = line.productName || "Unnamed";
      const brand = orderBrandValue(line);
      const key = `${brand}\x00${product}`;
      const current = byKey.get(key) ?? {
        product, brand, category: normalizeCategory(line.subProductLine),
        units: 0, revenue: 0, storeKeys: new Set<string>(), maxTs: 0
      };
      current.units += line.units;
      current.revenue += line.lineTotal;
      const sk = orderLineStoreKey(line);
      if (sk) current.storeKeys.add(sk);
      const ts = orderTimestamp(line.submittedAt);
      if (ts > current.maxTs) current.maxTs = ts;
      byKey.set(key, current);
    });

    return [...byKey.entries()].map(([key, data]) => {
      const storeCount = data.storeKeys.size;
      return {
        key,
        product: data.product,
        category: data.category,
        brand: data.brand,
        units: data.units,
        revenue: data.revenue,
        storeCount,
        coverage: allActiveStoreCount > 0 ? storeCount / allActiveStoreCount : 0,
        avgUnitsPerStore: storeCount > 0 ? data.units / storeCount : 0,
        lastOrdered: data.maxTs ? new Date(data.maxTs).toISOString() : null
      };
    });
  }, [filteredLines, allActiveStoreCount]);

  type CatRow = {
    category: string;
    skuCount: number;
    units: number;
    revenue: number;
    storeCount: number;
    coverage: number;
  };

  const categoryRows = useMemo((): CatRow[] => {
    const byCat = new Map<string, {
      skuKeys: Set<string>; units: number; revenue: number; storeKeys: Set<string>;
    }>();

    filteredLines.forEach((line) => {
      const cat = normalizeCategory(line.subProductLine);
      const current = byCat.get(cat) ?? {
        skuKeys: new Set<string>(), units: 0, revenue: 0, storeKeys: new Set<string>()
      };
      current.skuKeys.add(`${orderBrandValue(line)}\x00${line.productName || "Unnamed"}`);
      current.units += line.units;
      current.revenue += line.lineTotal;
      const sk = orderLineStoreKey(line);
      if (sk) current.storeKeys.add(sk);
      byCat.set(cat, current);
    });

    return [...byCat.entries()].map(([category, data]) => {
      const storeCount = data.storeKeys.size;
      return {
        category,
        skuCount: data.skuKeys.size,
        units: data.units,
        revenue: data.revenue,
        storeCount,
        coverage: allActiveStoreCount > 0 ? storeCount / allActiveStoreCount : 0
      };
    });
  }, [filteredLines, allActiveStoreCount]);

  const sortedSkuRows = useMemo(() => {
    const dir = skuSortDir === "asc" ? 1 : -1;
    return [...skuRows].sort((a, b) => {
      let diff = 0;
      switch (skuSortKey) {
        case "product": diff = a.product.localeCompare(b.product); break;
        case "category": diff = a.category.localeCompare(b.category); break;
        case "brand": diff = a.brand.localeCompare(b.brand); break;
        case "units": diff = a.units - b.units; break;
        case "revenue": diff = a.revenue - b.revenue; break;
        case "stores": diff = a.storeCount - b.storeCount; break;
        case "coverage": diff = a.coverage - b.coverage; break;
        case "avgUnits": diff = a.avgUnitsPerStore - b.avgUnitsPerStore; break;
        case "lastOrdered": diff = orderTimestamp(a.lastOrdered) - orderTimestamp(b.lastOrdered); break;
      }
      return diff * dir || a.product.localeCompare(b.product);
    });
  }, [skuRows, skuSortKey, skuSortDir]);

  const sortedCatRows = useMemo(() => {
    const dir = catSortDir === "asc" ? 1 : -1;
    return [...categoryRows].sort((a, b) => {
      let diff = 0;
      switch (catSortKey) {
        case "category": diff = a.category.localeCompare(b.category); break;
        case "skuCount": diff = a.skuCount - b.skuCount; break;
        case "units": diff = a.units - b.units; break;
        case "revenue": diff = a.revenue - b.revenue; break;
        case "stores": diff = a.storeCount - b.storeCount; break;
        case "coverage": diff = a.coverage - b.coverage; break;
      }
      return diff * dir || a.category.localeCompare(b.category);
    });
  }, [categoryRows, catSortKey, catSortDir]);

  const sizeRows = useMemo(() => {
    const bySize = new Map<string, {
      units: number; revenue: number; stores: Set<string>;
      strains: Map<string, { units: number; revenue: number }>;
    }>();
    filteredLines.forEach((line) => {
      const size = extractUnitSize(line.productName);
      if (!bySize.has(size)) bySize.set(size, { units: 0, revenue: 0, stores: new Set(), strains: new Map() });
      const entry = bySize.get(size)!;
      entry.units += line.units;
      entry.revenue += line.lineTotal;
      const sk = orderLineStoreKey(line);
      if (sk) entry.stores.add(sk);
      const strain = extractStrain(line.productName);
      if (strain) {
        const c = entry.strains.get(strain) ?? { units: 0, revenue: 0 };
        c.units += line.units; c.revenue += line.lineTotal;
        entry.strains.set(strain, c);
      }
    });
    return [...bySize.entries()].map(([size, e]) => ({
      size,
      units: e.units,
      revenue: e.revenue,
      storeCount: e.stores.size,
      coverage: allActiveStoreCount > 0 ? e.stores.size / allActiveStoreCount : 0,
      strains: [...e.strains.entries()]
        .map(([label, { units: u, revenue: r }]) => ({ label, units: u, revenue: r }))
        .sort((a, b) => b.units - a.units)
    }));
  }, [filteredLines, allActiveStoreCount]);

  const strainRows = useMemo(() => {
    const byStrain = new Map<string, {
      units: number; revenue: number; stores: Set<string>;
      sizes: Map<string, { units: number; revenue: number }>;
    }>();
    filteredLines.forEach((line) => {
      const strain = extractStrain(line.productName);
      if (!strain) return;
      if (!byStrain.has(strain)) byStrain.set(strain, { units: 0, revenue: 0, stores: new Set(), sizes: new Map() });
      const entry = byStrain.get(strain)!;
      entry.units += line.units;
      entry.revenue += line.lineTotal;
      const sk = orderLineStoreKey(line);
      if (sk) entry.stores.add(sk);
      const size = extractUnitSize(line.productName);
      const c = entry.sizes.get(size) ?? { units: 0, revenue: 0 };
      c.units += line.units; c.revenue += line.lineTotal;
      entry.sizes.set(size, c);
    });
    return [...byStrain.entries()].map(([strain, e]) => ({
      strain,
      units: e.units,
      revenue: e.revenue,
      storeCount: e.stores.size,
      coverage: allActiveStoreCount > 0 ? e.stores.size / allActiveStoreCount : 0,
      sizes: [...e.sizes.entries()]
        .map(([label, { units: u, revenue: r }]) => ({ label, units: u, revenue: r }))
        .sort((a, b) => b.units - a.units)
    }));
  }, [filteredLines, allActiveStoreCount]);

  const sortedSizeRows = useMemo(() => {
    return [...sizeRows].sort((a, b) => {
      if (catSortKey === "category") return catSortDir === "asc" ? a.size.localeCompare(b.size) : b.size.localeCompare(a.size);
      if (catSortKey === "units") return catSortDir === "asc" ? a.units - b.units : b.units - a.units;
      if (catSortKey === "revenue") return catSortDir === "asc" ? a.revenue - b.revenue : b.revenue - a.revenue;
      if (catSortKey === "stores") return catSortDir === "asc" ? a.storeCount - b.storeCount : b.storeCount - a.storeCount;
      if (catSortKey === "coverage") return catSortDir === "asc" ? a.coverage - b.coverage : b.coverage - a.coverage;
      return b.units - a.units;
    });
  }, [sizeRows, catSortKey, catSortDir]);

  const sortedStrainRows = useMemo(() => {
    return [...strainRows].sort((a, b) => {
      if (catSortKey === "category") return catSortDir === "asc" ? a.strain.localeCompare(b.strain) : b.strain.localeCompare(a.strain);
      if (catSortKey === "units") return catSortDir === "asc" ? a.units - b.units : b.units - a.units;
      if (catSortKey === "revenue") return catSortDir === "asc" ? a.revenue - b.revenue : b.revenue - a.revenue;
      if (catSortKey === "stores") return catSortDir === "asc" ? a.storeCount - b.storeCount : b.storeCount - a.storeCount;
      if (catSortKey === "coverage") return catSortDir === "asc" ? a.coverage - b.coverage : b.coverage - a.coverage;
      return b.units - a.units;
    });
  }, [strainRows, catSortKey, catSortDir]);

  const skuMetrics = useMemo(() => ({
    skuCount: skuRows.length,
    storeCount: allActiveStoreCount,
    units: filteredLines.reduce((sum, l) => sum + l.units, 0),
    revenue: filteredLines.reduce((sum, l) => sum + l.lineTotal, 0),
    avgCoverage: skuRows.length
      ? skuRows.reduce((sum, r) => sum + r.coverage, 0) / skuRows.length
      : 0
  }), [filteredLines, skuRows, allActiveStoreCount]);

  const topCategories = useMemo(() => {
    const byCat = new Map<string, { units: number; revenue: number }>();
    brandSearchLines.forEach((line) => {
      const cat = normalizeCategory(line.subProductLine);
      const current = byCat.get(cat) ?? { units: 0, revenue: 0 };
      current.units += line.units;
      current.revenue += line.lineTotal;
      byCat.set(cat, current);
    });
    return [...byCat.entries()]
      .sort((a, b) => b[1].units - a[1].units)
      .slice(0, 8)
      .map(([cat, { units, revenue }]) => ({ cat, units, revenue }));
  }, [brandSearchLines]);

  const maxCategoryUnits = Math.max(1, ...topCategories.map((c) => c.units));
  const maxSkuUnits = Math.max(1, ...skuRows.map((r) => r.units));

  const categoryBreakdowns = useMemo(() => {
    const sizeMaps = new Map<string, Map<string, number>>();
    const strainMaps = new Map<string, Map<string, number>>();

    brandSearchLines.forEach((line) => {
      const cat = normalizeCategory(line.subProductLine);

      if (!sizeMaps.has(cat)) sizeMaps.set(cat, new Map());
      const sizeKey = extractUnitSize(line.productName);
      const sizeMap = sizeMaps.get(cat)!;
      sizeMap.set(sizeKey, (sizeMap.get(sizeKey) ?? 0) + line.units);

      if (!strainMaps.has(cat)) strainMaps.set(cat, new Map());
      const strainKey = extractStrain(line.productName);
      if (strainKey) {
        const strainMap = strainMaps.get(cat)!;
        strainMap.set(strainKey, (strainMap.get(strainKey) ?? 0) + line.units);
      }
    });

    const result = new Map<string, {
      sizes: { label: string; units: number }[];
      strains: { label: string; units: number }[];
    }>();

    sizeMaps.forEach((sizeMap, cat) => {
      result.set(cat, {
        sizes: [...sizeMap.entries()]
          .map(([label, units]) => ({ label, units }))
          .sort((a, b) => b.units - a.units),
        strains: [...(strainMaps.get(cat)?.entries() ?? [])]
          .map(([label, units]) => ({ label, units }))
          .sort((a, b) => b.units - a.units)
          .slice(0, 10)
      });
    });

    return result;
  }, [brandSearchLines]);

  function handleSkuSort(key: SkuSortKey) {
    if (key === skuSortKey) {
      setSkuSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSkuSortKey(key);
      setSkuSortDir(key === "product" || key === "category" || key === "brand" ? "asc" : "desc");
    }
  }

  function handleCatSort(key: CatSortKey) {
    if (key === catSortKey) {
      setCatSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setCatSortKey(key);
      setCatSortDir(key === "category" ? "asc" : "desc");
    }
  }

  const skuTableColumns: { key: SkuSortKey; label: string }[] = [
    { key: "product", label: "Product" },
    { key: "category", label: "Category" },
    { key: "brand", label: "Brand" },
    { key: "units", label: "Units" },
    { key: "revenue", label: "Revenue" },
    { key: "stores", label: "Stores" },
    { key: "coverage", label: "Sell-Through" },
    { key: "avgUnits", label: "Avg Units/Store" },
    { key: "lastOrdered", label: "Last Ordered" }
  ];

  const catTableColumns: { key: CatSortKey; label: string }[] = [
    { key: "category", label: "Category" },
    { key: "skuCount", label: "SKUs" },
    { key: "units", label: "Units" },
    { key: "revenue", label: "Revenue" },
    { key: "stores", label: "Stores" },
    { key: "coverage", label: "Sell-Through" }
  ];

  return (
    <section className="sku-view">
      <div className="panel sku-filter-panel">
        <div className="sku-filter-top">
          <div className="sku-group-tabs">
            <button
              className={`secondary-button${groupMode === "sku" ? " active-tab" : ""}`}
              type="button"
              onClick={() => setGroupMode("sku")}
            >
              By SKU
            </button>
            <button
              className={`secondary-button${groupMode === "category" ? " active-tab" : ""}`}
              type="button"
              onClick={() => setGroupMode("category")}
            >
              By Category
            </button>
          </div>
          <div className="sku-filter-grid">
            <div className="field">
              <label>Search</label>
              <input
                type="search"
                value={skuQuery}
                onChange={(e) => setSkuQuery(e.target.value)}
                placeholder="Product name or category"
              />
            </div>
            <div className="field">
              <label>Brand</label>
              <select value={brandFilter} onChange={(e) => setBrandFilter(e.target.value)}>
                <option value="all">All brands</option>
                {brandOptions.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Category</label>
              <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
                <option value="all">All categories</option>
                {categoryOptions.map((cat) => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>From</label>
              <input
                type="date"
                value={dateFrom}
                min={bounds.min}
                max={bounds.max}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div className="field">
              <label>To</label>
              <input
                type="date"
                value={dateTo}
                min={bounds.min}
                max={bounds.max}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="metrics orders-metrics">
        <div className="metric">
          <div className="metric-label">SKUs</div>
          <div className="metric-value">{skuMetrics.skuCount.toLocaleString()}</div>
        </div>
        <div className="metric">
          <div className="metric-label">Active Stores</div>
          <div className="metric-value">{skuMetrics.storeCount.toLocaleString()}</div>
        </div>
        <div className="metric">
          <div className="metric-label">Total Units</div>
          <div className="metric-value">{skuMetrics.units.toLocaleString()}</div>
        </div>
        <div className="metric">
          <div className="metric-label">Revenue</div>
          <div className="metric-value">{formatUsd(skuMetrics.revenue)}</div>
        </div>
        <div className="metric">
          <div className="metric-label">Avg Coverage</div>
          <div className="metric-value">
            {skuMetrics.skuCount ? `${Math.round(skuMetrics.avgCoverage * 100)}%` : "—"}
          </div>
        </div>
      </div>

      {topCategories.length > 0 ? (
        <div className="panel">
          <div className="panel-header">
            <h3>Categories</h3>
            <span className="table-meta">
              {topCategories.length} product lines · click to filter
            </span>
          </div>
          <div className="sku-category-rail">
            <div className="sku-category-cards">
              {topCategories.map(({ cat, units, revenue }) => {
                const isExpanded = expandedCategories.has(cat);
                const breakdown = categoryBreakdowns.get(cat);
                const maxSize = breakdown?.sizes[0]?.units ?? 1;
                const maxStrain = breakdown?.strains[0]?.units ?? 1;
                return (
                  <div
                    key={cat}
                    className={`sku-category-card${categoryFilter === cat ? " is-active" : ""}${isExpanded ? " is-expanded" : ""}`}
                  >
                    <div className="sku-category-header">
                      <button
                        className="sku-category-main"
                        type="button"
                        onClick={() => setCategoryFilter((prev) => (prev === cat ? "all" : cat))}
                      >
                        <div className="sku-category-name">{cat}</div>
                        <div className="sku-category-units">{units.toLocaleString()} units · {formatUsd(revenue)}</div>
                        <div className="summary-bar" style={{ marginTop: 6 }}>
                          <span style={{ width: `${(units / maxCategoryUnits) * 100}%` }} />
                        </div>
                      </button>
                      <button
                        className="sku-expand-btn"
                        type="button"
                        title={isExpanded ? "Collapse" : "Expand"}
                        onClick={() => toggleExpanded(cat)}
                      >
                        {isExpanded ? "↑" : "↓"}
                      </button>
                    </div>
                    {isExpanded && breakdown ? (
                      <div className="sku-category-detail">
                        {breakdown.sizes.length > 0 ? (
                          <div className="sku-detail-section">
                            <div className="sku-detail-section-title">By Size</div>
                            {breakdown.sizes.map(({ label, units: u }) => (
                              <div key={label} className="sku-detail-row">
                                <span className="sku-detail-label">{label}</span>
                                <div className="sku-detail-bar">
                                  <span style={{ width: `${(u / maxSize) * 100}%` }} />
                                </div>
                                <span className="sku-detail-count">{u.toLocaleString()}</span>
                              </div>
                            ))}
                          </div>
                        ) : null}
                        {breakdown.strains.length > 0 ? (
                          <div className="sku-detail-section">
                            <div className="sku-detail-section-title">By Strain</div>
                            {breakdown.strains.map(({ label, units: u }) => (
                              <div key={label} className="sku-detail-row">
                                <span className="sku-detail-label">{label}</span>
                                <div className="sku-detail-bar">
                                  <span style={{ width: `${(u / maxStrain) * 100}%` }} />
                                </div>
                                <span className="sku-detail-count">{u.toLocaleString()}</span>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      <div className="panel">
        <div className="panel-header">
          <h3>{groupMode === "sku" ? "SKU Performance" : "Category Performance"}</h3>
          <span className="table-meta">
            {groupMode === "sku"
              ? `${sortedSkuRows.length.toLocaleString()} products · sell-through vs ${allActiveStoreCount} active accounts`
              : `${sortedCatRows.length.toLocaleString()} categories`}
          </span>
        </div>
        <div className="table-scroll">
          {groupMode === "sku" ? (
            <table className="data-table">
              <thead>
                <tr>
                  {skuTableColumns.map((col) => (
                    <th key={col.key}>
                      <button className="sort-header" type="button" onClick={() => handleSkuSort(col.key)}>
                        <span>{col.label}</span>
                        <span className="sort-indicator" aria-hidden="true">
                          {skuSortKey === col.key ? (skuSortDir === "asc" ? "↑" : "↓") : "↕"}
                        </span>
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedSkuRows.map((row) => (
                  <tr key={row.key}>
                    <td>
                      <div className="sku-product-name">{row.product}</div>
                      <div className="summary-bar" style={{ marginTop: 4, maxWidth: 140 }}>
                        <span style={{ width: `${(row.units / maxSkuUnits) * 100}%` }} />
                      </div>
                    </td>
                    <td style={{ color: "var(--muted)", fontSize: "0.82rem" }}>{row.category}</td>
                    <td>
                      <span
                        className="sku-brand-badge"
                        style={{ background: BRAND_DOT_COLORS[row.brand as BrandFilter] ?? "var(--muted)" }}
                      >
                        {row.brand}
                      </span>
                    </td>
                    <td>{row.units.toLocaleString()}</td>
                    <td>{formatUsd(row.revenue)}</td>
                    <td>{row.storeCount}</td>
                    <td>
                      <div className="sku-coverage">
                        <span>{Math.round(row.coverage * 100)}%</span>
                        <div className="sku-coverage-bar">
                          <span style={{ width: `${row.coverage * 100}%` }} />
                        </div>
                      </div>
                    </td>
                    <td>{row.avgUnitsPerStore.toFixed(1)}</td>
                    <td>{formatShortDate(row.lastOrdered)}</td>
                  </tr>
                ))}
                {!sortedSkuRows.length ? (
                  <tr>
                    <td colSpan={9} style={{ color: "var(--muted)", textAlign: "center", padding: "24px" }}>
                      No SKUs match the current filters.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          ) : (
            <>
              <div className="sku-detail-toggle">
                <button
                  className={`sku-group-tab${catDetailMode === "size" ? " active-tab" : ""}`}
                  type="button"
                  onClick={() => { setCatDetailMode("size"); setExpandedCategories(new Set()); }}
                >
                  By Size
                </button>
                <button
                  className={`sku-group-tab${catDetailMode === "strain" ? " active-tab" : ""}`}
                  type="button"
                  onClick={() => { setCatDetailMode("strain"); setExpandedCategories(new Set()); }}
                >
                  By Strain
                </button>
              </div>
              {catDetailMode === "size" ? (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{ width: 36 }} />
                      {([
                        { key: "category" as CatSortKey, label: "Size" },
                        { key: "units" as CatSortKey, label: "Units" },
                        { key: "revenue" as CatSortKey, label: "Revenue" },
                        { key: "stores" as CatSortKey, label: "Stores" },
                        { key: "coverage" as CatSortKey, label: "Coverage" }
                      ]).map((col) => (
                        <th key={col.key}>
                          <button className="sort-header" type="button" onClick={() => handleCatSort(col.key)}>
                            <span>{col.label}</span>
                            <span className="sort-indicator" aria-hidden="true">
                              {catSortKey === col.key ? (catSortDir === "asc" ? "↑" : "↓") : "↕"}
                            </span>
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedSizeRows.flatMap((row) => {
                      const isExpanded = expandedCategories.has(row.size);
                      const maxStrain = row.strains[0]?.units ?? 1;
                      const mainRow = (
                        <tr key={row.size}>
                          <td>
                            <button
                              className="sku-row-expand-btn"
                              type="button"
                              title={isExpanded ? "Collapse" : "Expand"}
                              onClick={() => toggleExpanded(row.size)}
                            >
                              {isExpanded ? "↑" : "↓"}
                            </button>
                          </td>
                          <td><strong>{row.size}</strong></td>
                          <td>{row.units.toLocaleString()}</td>
                          <td>{formatUsd(row.revenue)}</td>
                          <td>{row.storeCount}</td>
                          <td>
                            <div className="sku-coverage">
                              <span>{Math.round(row.coverage * 100)}%</span>
                              <div className="sku-coverage-bar">
                                <span style={{ width: `${row.coverage * 100}%` }} />
                              </div>
                            </div>
                          </td>
                        </tr>
                      );
                      if (!isExpanded || !row.strains.length) return [mainRow];
                      const detailRow = (
                        <tr key={`${row.size}-detail`} className="sku-cat-detail-row">
                          <td colSpan={6} className="sku-cat-detail-cell">
                            <div className="sku-detail-section">
                              <div className="sku-detail-section-title">By Strain</div>
                              {row.strains.map(({ label, units: u, revenue: r }) => (
                                <div key={label} className="sku-detail-row">
                                  <span className="sku-detail-label">{label}</span>
                                  <div className="sku-detail-bar">
                                    <span style={{ width: `${(u / maxStrain) * 100}%` }} />
                                  </div>
                                  <span className="sku-detail-count">{u.toLocaleString()}</span>
                                  <span className="sku-detail-revenue">{formatUsd(r)}</span>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      );
                      return [mainRow, detailRow];
                    })}
                    {!sortedSizeRows.length ? (
                      <tr>
                        <td colSpan={6} style={{ color: "var(--muted)", textAlign: "center", padding: "24px" }}>
                          No sizes match the current filters.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{ width: 36 }} />
                      {([
                        { key: "category" as CatSortKey, label: "Strain" },
                        { key: "units" as CatSortKey, label: "Units" },
                        { key: "revenue" as CatSortKey, label: "Revenue" },
                        { key: "stores" as CatSortKey, label: "Stores" },
                        { key: "coverage" as CatSortKey, label: "Coverage" }
                      ]).map((col) => (
                        <th key={col.key}>
                          <button className="sort-header" type="button" onClick={() => handleCatSort(col.key)}>
                            <span>{col.label}</span>
                            <span className="sort-indicator" aria-hidden="true">
                              {catSortKey === col.key ? (catSortDir === "asc" ? "↑" : "↓") : "↕"}
                            </span>
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedStrainRows.flatMap((row) => {
                      const isExpanded = expandedCategories.has(row.strain);
                      const maxSize = row.sizes[0]?.units ?? 1;
                      const mainRow = (
                        <tr key={row.strain}>
                          <td>
                            <button
                              className="sku-row-expand-btn"
                              type="button"
                              title={isExpanded ? "Collapse" : "Expand"}
                              onClick={() => toggleExpanded(row.strain)}
                            >
                              {isExpanded ? "↑" : "↓"}
                            </button>
                          </td>
                          <td><strong>{row.strain}</strong></td>
                          <td>{row.units.toLocaleString()}</td>
                          <td>{formatUsd(row.revenue)}</td>
                          <td>{row.storeCount}</td>
                          <td>
                            <div className="sku-coverage">
                              <span>{Math.round(row.coverage * 100)}%</span>
                              <div className="sku-coverage-bar">
                                <span style={{ width: `${row.coverage * 100}%` }} />
                              </div>
                            </div>
                          </td>
                        </tr>
                      );
                      if (!isExpanded || !row.sizes.length) return [mainRow];
                      const detailRow = (
                        <tr key={`${row.strain}-detail`} className="sku-cat-detail-row">
                          <td colSpan={6} className="sku-cat-detail-cell">
                            <div className="sku-detail-section">
                              <div className="sku-detail-section-title">By Size</div>
                              {row.sizes.map(({ label, units: u, revenue: r }) => (
                                <div key={label} className="sku-detail-row">
                                  <span className="sku-detail-label">{label}</span>
                                  <div className="sku-detail-bar">
                                    <span style={{ width: `${(u / maxSize) * 100}%` }} />
                                  </div>
                                  <span className="sku-detail-count">{u.toLocaleString()}</span>
                                  <span className="sku-detail-revenue">{formatUsd(r)}</span>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      );
                      return [mainRow, detailRow];
                    })}
                    {!sortedStrainRows.length ? (
                      <tr>
                        <td colSpan={6} style={{ color: "var(--muted)", textAlign: "center", padding: "24px" }}>
                          No strains match the current filters.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function LogEntriesView({
  contactLogs,
  stores
}: {
  contactLogs: ContactLog[];
  stores: StoreRollup[];
}) {
  const [logMode, setLogMode] = useState<"all" | "trips">("all");
  const [logQuery, setLogQuery] = useState("");
  const [methodFilter, setMethodFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [logSortKey, setLogSortKey] = useState<LogSortKey>("date");
  const [logSortDir, setLogSortDir] = useState<SortDirection>("desc");
  const [expandedTrips, setExpandedTrips] = useState<Set<string>>(() => new Set());

  const storeById = useMemo(() => {
    const map = new Map<string, StoreRollup>();
    stores.forEach((store) => {
      if (store.storeId) map.set(store.storeId, store);
    });
    return map;
  }, [stores]);

  const storeByLicenseKey = useMemo(() => {
    const map = new Map<string, StoreRollup>();
    stores.forEach((store) => {
      if (store.licenseKey) map.set(store.licenseKey, store);
    });
    return map;
  }, [stores]);

  type EnrichedLog = ContactLog & { store?: StoreRollup };

  const enrichedLogs = useMemo<EnrichedLog[]>(() =>
    contactLogs.map((log) => ({
      ...log,
      store: (log.storeId ? storeById.get(log.storeId) : undefined)
        || (log.licenseKey ? storeByLicenseKey.get(log.licenseKey) : undefined)
    })),
    [contactLogs, storeById, storeByLicenseKey]
  );

  const methodOptions = useMemo(() => {
    const methods = new Set(contactLogs.map((l) => l.contactMethod || "").filter(Boolean));
    return [...methods].sort();
  }, [contactLogs]);

  const filteredLogs = useMemo(() => {
    const normalized = logQuery.trim().toLowerCase();
    return enrichedLogs.filter((log) => {
      const logDate = log.dateContacted || (log.savedAt ? log.savedAt.slice(0, 10) : null);
      if (dateFrom && logDate && logDate < dateFrom) return false;
      if (dateTo && logDate && logDate > dateTo) return false;
      if (methodFilter !== "all" && (log.contactMethod || "").toLowerCase() !== methodFilter.toLowerCase()) return false;
      const store = log.store;
      if (priorityFilter !== "all") {
        if (!store || !matchesPriorityFilter(store, priorityFilter)) return false;
      }
      if (normalized) {
        return [log.storeName, log.licenseKey, log.personContacted, log.initials, log.notes]
          .some((v) => String(v ?? "").toLowerCase().includes(normalized));
      }
      return true;
    });
  }, [enrichedLogs, logQuery, dateFrom, dateTo, methodFilter, priorityFilter]);

  const sortedLogs = useMemo(() => {
    const dir = logSortDir === "asc" ? 1 : -1;
    return [...filteredLogs].sort((a, b) => {
      if (logSortKey === "store") {
        const aName = a.store?.storeName || a.storeName || "";
        const bName = b.store?.storeName || b.storeName || "";
        return textSortValue(aName).localeCompare(textSortValue(bName)) * dir;
      }
      if (logSortKey === "method") {
        return (a.contactMethod || "").localeCompare(b.contactMethod || "") * dir;
      }
      if (logSortKey === "rep") {
        return (a.initials || "").localeCompare(b.initials || "") * dir;
      }
      const aDate = a.dateContacted || (a.savedAt ? a.savedAt.slice(0, 10) : "");
      const bDate = b.dateContacted || (b.savedAt ? b.savedAt.slice(0, 10) : "");
      return aDate.localeCompare(bDate) * dir;
    });
  }, [filteredLogs, logSortKey, logSortDir]);

  const tripGroups = useMemo(() => {
    const byTrip = new Map<string, (ContactLog & { store?: StoreRollup })[]>();
    enrichedLogs.forEach((log) => {
      if (!log.tripId) return;
      const group = byTrip.get(log.tripId) ?? [];
      group.push(log);
      byTrip.set(log.tripId, group);
    });
    return [...byTrip.values()]
      .map((stops) => {
        const sorted = [...stops].sort((a, b) => (a.savedAt || "").localeCompare(b.savedAt || ""));
        const date = sorted[0].dateContacted || (sorted[0].savedAt ? sorted[0].savedAt.slice(0, 10) : "");
        // apply date/search filters
        const normalized = logQuery.trim().toLowerCase();
        if (dateFrom && date && date < dateFrom) return null;
        if (dateTo && date && date > dateTo) return null;
        if (normalized && !sorted.some((s) =>
          [s.storeName, s.initials, s.notes, s.store?.storeName]
            .some((v) => String(v ?? "").toLowerCase().includes(normalized))
        )) return null;
        return {
          tripId: sorted[0].tripId!,
          date,
          initials: sorted[0].initials,
          method: sorted[0].contactMethod,
          stops: sorted
        };
      })
      .filter((g): g is NonNullable<typeof g> => g !== null)
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [enrichedLogs, logQuery, dateFrom, dateTo]);

  function toggleLogSort(key: LogSortKey) {
    if (key === logSortKey) {
      setLogSortDir(logSortDir === "asc" ? "desc" : "asc");
    } else {
      setLogSortKey(key);
      setLogSortDir(key === "date" ? "desc" : "asc");
    }
  }

  function toggleTrip(tripId: string) {
    setExpandedTrips((prev) => {
      const next = new Set(prev);
      if (next.has(tripId)) next.delete(tripId); else next.add(tripId);
      return next;
    });
  }

  const logColumns: { key: LogSortKey; label: string }[] = [
    { key: "date", label: "Date" },
    { key: "store", label: "Store" },
    { key: "rep", label: "Rep" },
    { key: "method", label: "Method" }
  ];

  return (
    <div className="logs-view">
      <div className="panel logs-filter-panel">
        <div className="logs-filter-grid">
          <div className="field">
            <label>Search</label>
            <input
              type="search"
              value={logQuery}
              onChange={(event) => setLogQuery(event.target.value)}
              placeholder="Store, person, notes…"
            />
          </div>
          <div className="field">
            <label>Method</label>
            <select value={methodFilter} onChange={(event) => setMethodFilter(event.target.value)}>
              <option value="all">All methods</option>
              {methodOptions.map((m) => (
                <option key={m} value={m.toLowerCase()}>{m}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Store priority</label>
            <select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value as PriorityFilter)}>
              <option value="all">All stores</option>
              <option value="lapsed">Lapsed</option>
              <option value="overdue">Overdue</option>
              <option value="open-lane">Open Lane</option>
            </select>
          </div>
          <div className="field">
            <label>From</label>
            <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
          </div>
          <div className="field">
            <label>To</label>
            <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
          </div>
        </div>
      </div>
      <div className="panel">
        <div className="panel-header">
          <h3>{logMode === "trips" ? "Trip Logs" : "Log Entries"}</h3>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span className="table-meta">
              {logMode === "trips"
                ? `${tripGroups.length.toLocaleString()} trip${tripGroups.length !== 1 ? "s" : ""}`
                : `${filteredLogs.length.toLocaleString()} of ${contactLogs.length.toLocaleString()}`}
            </span>
            <div className="sku-group-tabs">
              <button
                className={`sku-group-tab${logMode === "all" ? " active-tab" : ""}`}
                type="button"
                onClick={() => setLogMode("all")}
              >
                All Logs
              </button>
              <button
                className={`sku-group-tab${logMode === "trips" ? " active-tab" : ""}`}
                type="button"
                onClick={() => setLogMode("trips")}
              >
                Trips
              </button>
            </div>
          </div>
        </div>
        {logMode === "all" ? (
          <table className="store-table">
            <thead>
              <tr>
                {logColumns.map((col) => (
                  <th key={col.key}>
                    <button className="sort-header" type="button" onClick={() => toggleLogSort(col.key)}>
                      <span>{col.label}</span>
                      <span aria-hidden="true" className="sort-indicator">
                        {logSortKey === col.key ? (logSortDir === "asc" ? "↑" : "↓") : "↕"}
                      </span>
                    </button>
                  </th>
                ))}
                <th>Person</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {sortedLogs.map((log) => (
                <tr key={log.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{formatShortDate(log.dateContacted || log.savedAt)}</td>
                  <td>
                    <div className="store-name">{log.store?.storeName || log.storeName || "-"}</div>
                    <div className="store-subtext">{log.licenseKey}</div>
                  </td>
                  <td>{log.initials || "-"}</td>
                  <td>{log.contactMethod || "-"}</td>
                  <td>{log.personContacted || "-"}</td>
                  <td className="log-notes-cell">{log.notes || "-"}</td>
                </tr>
              ))}
              {!sortedLogs.length ? (
                <tr>
                  <td colSpan={6} style={{ color: "var(--muted)", textAlign: "center", padding: "24px" }}>
                    No log entries match that search.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        ) : (
          <div className="trip-log-groups">
            {tripGroups.map((group) => {
              const isExpanded = expandedTrips.has(group.tripId);
              return (
                <div key={group.tripId} className="trip-log-group">
                  <button
                    className="trip-log-group-header"
                    type="button"
                    onClick={() => toggleTrip(group.tripId)}
                  >
                    <span className="trip-log-group-date">{formatShortDate(group.date)}</span>
                    <span className="trip-log-group-meta">
                      {group.initials ? <strong>{group.initials}</strong> : null}
                      {group.method ? <span>{group.method}</span> : null}
                      <span>{group.stops.length} stop{group.stops.length !== 1 ? "s" : ""}</span>
                    </span>
                    <span className="trip-log-group-caret">{isExpanded ? "↑" : "↓"}</span>
                  </button>
                  {isExpanded ? (
                    <ol className="trip-log-group-stops">
                      {group.stops.map((stop, i) => (
                        <li key={stop.id} className="trip-log-group-stop">
                          <span className="trip-stop-index">{i + 1}</span>
                          <div className="trip-log-stop-detail">
                            <span className="trip-log-stop-name">
                              {stop.store?.storeName || stop.storeName || "-"}
                            </span>
                            {stop.notes ? (
                              <span className="trip-log-stop-note-text">{stop.notes}</span>
                            ) : null}
                          </div>
                        </li>
                      ))}
                    </ol>
                  ) : null}
                </div>
              );
            })}
            {!tripGroups.length ? (
              <div style={{ color: "var(--muted)", textAlign: "center", padding: "32px" }}>
                No trip logs yet. Plan a route in Map view and use Log Trip.
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

function StoreNameEditor({
  store,
  onSaved
}: {
  store: StoreRollup;
  onSaved: (storeId: string, storeName: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState(store.storeName);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setValue(store.storeName);
    setIsEditing(false);
    setMessage("");
  }, [store.storeId, store.storeName]);

  function cancelEdit() {
    setIsEditing(false);
    setValue(store.storeName);
    setMessage("");
  }

  async function handleSave() {
    const nextName = value.trim();
    if (!store.storeId) {
      setMessage("This store is missing a Supabase store id.");
      return;
    }
    if (!nextName) {
      setMessage("Store name can’t be empty.");
      return;
    }
    if (nextName === store.storeName) {
      setIsEditing(false);
      return;
    }

    setIsSaving(true);
    setMessage("");

    try {
      const response = await fetch("/api/store-name", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId: store.storeId, storeName: nextName })
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Could not save store name.");
      }

      onSaved(result.storeId, result.storeName);
      setIsEditing(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save store name.");
    } finally {
      setIsSaving(false);
    }
  }

  if (!isEditing) {
    return (
      <div className="detail-title">
        <h3>
          <span>{store.storeName}</span>
          <button
            aria-label="Edit store name"
            className="icon-button"
            onClick={() => setIsEditing(true)}
            title="Edit store name"
            type="button"
          >
            <Pencil size={14} />
          </button>
        </h3>
        <span className="caption">License {store.license}</span>
      </div>
    );
  }

  return (
    <div className="detail-title">
      <div className="store-name-edit">
        <input
          autoFocus
          aria-label="Store name"
          disabled={isSaving}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              handleSave();
            } else if (event.key === "Escape") {
              cancelEdit();
            }
          }}
          value={value}
        />
        <button className="primary-button" disabled={isSaving} onClick={handleSave} type="button">
          {isSaving ? "Saving…" : "Save"}
        </button>
        <button className="secondary-button" disabled={isSaving} onClick={cancelEdit} type="button">
          Cancel
        </button>
      </div>
      {message ? <span className="status-message">{message}</span> : null}
    </div>
  );
}

function StoreDetailDrawer({
  selectedStore,
  activeTab,
  setActiveTab,
  existingGroups,
  onBuyerSaved,
  onGroupSaved,
  onServiceNoteSaved,
  onContactLogSaved,
  onStoreNameSaved,
  orderLines = [],
  routeAction
}: {
  selectedStore?: StoreRollup;
  activeTab: DetailTab;
  setActiveTab: (tab: DetailTab) => void;
  existingGroups: string[];
  onBuyerSaved: (storeId: string, buyer: BuyerContactPatch) => void;
  onGroupSaved: (storeId: string, groupName: string | null) => void;
  onServiceNoteSaved: (storeId: string, serviceNote: string | null) => void;
  onContactLogSaved: (storeId: string, contactLog: ContactLogPatch) => void;
  onStoreNameSaved: (storeId: string, storeName: string) => void;
  orderLines?: OrderLine[];
  routeAction?: {
    disabled: boolean;
    isAdded: boolean;
    onAdd: () => void;
    onRemove: () => void;
  };
}) {
  return (
    <aside className="panel store-detail">
      {selectedStore ? (
        <StoreNameEditor store={selectedStore} onSaved={onStoreNameSaved} />
      ) : (
        <div className="detail-title">
          <h3>
            <span>Select a store</span>
          </h3>
          <span className="caption">Store detail drawer</span>
        </div>
      )}
      {selectedStore && routeAction ? (
        <div className="detail-actions">
          <button
            className={routeAction.isAdded ? "secondary-button" : "primary-button"}
            disabled={routeAction.disabled}
            onClick={routeAction.isAdded ? routeAction.onRemove : routeAction.onAdd}
            type="button"
          >
            {routeAction.isAdded ? <X size={15} /> : <Plus size={15} />}
            {routeAction.isAdded ? "Remove from route" : "Add to route"}
          </button>
        </div>
      ) : null}
      {selectedStore ? <StoreDetailSummary store={selectedStore} /> : null}
      {selectedStore ? (
        <div className="metrics detail-metrics">
          <LatestMonthStat store={selectedStore} />
          <DetailStat label="Market Sales" value={formatUsd(selectedStore.marketSalesLastMonth)} />
        </div>
      ) : null}
      <div className="detail-tabs" role="tablist" aria-label="Store detail sections">
        {detailTabs.map((tab) => (
          <button
            key={tab.id}
            className={activeTab === tab.id ? "active" : ""}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {selectedStore ? (
        <StoreDetailContent
          activeTab={activeTab}
          store={selectedStore}
          existingGroups={existingGroups}
          onBuyerSaved={onBuyerSaved}
          onGroupSaved={onGroupSaved}
          onServiceNoteSaved={onServiceNoteSaved}
          onContactLogSaved={onContactLogSaved}
          orderLines={orderLines}
        />
      ) : null}
    </aside>
  );
}

type ContactLogEntry = {
  id: string;
  dateContacted: string | null;
  contactMethod: string | null;
  initials: string | null;
  personContacted: string | null;
  notes: string | null;
  savedAt: string | null;
};

function ContactLogHistory({ store }: { store: StoreRollup }) {
  const [logs, setLogs] = useState<ContactLogEntry[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!store.storeId && !store.licenseKey) {
      setLogs([]);
      setStatus("idle");
      return;
    }

    const controller = new AbortController();
    setStatus("loading");
    setError("");
    setExpandedId(null);

    async function loadLogs() {
      try {
        const params = new URLSearchParams();
        if (store.storeId) {
          params.set("storeId", store.storeId);
        }
        if (store.licenseKey) {
          params.set("licenseKey", store.licenseKey);
        }
        const response = await fetch(`/api/contact-logs?${params.toString()}`, {
          signal: controller.signal
        });
        const result = await response.json();
        if (!response.ok) {
          throw new Error(result.error || "Could not load contact history.");
        }
        setLogs(Array.isArray(result.logs) ? result.logs : []);
        setStatus("idle");
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "Could not load contact history.");
        setStatus("error");
      }
    }

    loadLogs();
    return () => controller.abort();
  }, [store.storeId, store.licenseKey, store.contactLogCount]);

  if (status === "loading") {
    return <p className="detail-note">Loading contact history…</p>;
  }

  if (status === "error") {
    return <p className="detail-note">{error}</p>;
  }

  if (!logs.length) {
    return <p className="detail-note">No contact logs recorded yet.</p>;
  }

  return (
    <div className="contact-log-history">
      <div className="contact-log-history-title">Contact history · {logs.length.toLocaleString()}</div>
      <ul className="contact-log-list">
        {logs.map((log) => {
          const isOpen = expandedId === log.id;
          const person = log.personContacted || log.initials || "";
          return (
            <li className="contact-log-item" key={log.id}>
              <button
                type="button"
                className="contact-log-summary"
                aria-expanded={isOpen}
                onClick={() => setExpandedId(isOpen ? null : log.id)}
              >
                <span className="contact-log-date">{formatDate(log.dateContacted || log.savedAt)}</span>
                <span className="contact-log-method">{log.contactMethod || "—"}</span>
                {person ? <span className="contact-log-person">{person}</span> : null}
                <span aria-hidden="true" className="contact-log-caret">{isOpen ? "▾" : "▸"}</span>
              </button>
              {isOpen ? (
                <div className="contact-log-detail">
                  {log.initials ? <DetailRow label="Rep" value={log.initials} /> : null}
                  {log.personContacted ? <DetailRow label="Person" value={log.personContacted} /> : null}
                  <p className="detail-note">{log.notes || "No notes recorded."}</p>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

type HeadsetSaleRow = {
  day: string;
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

type RetailSortKey = "product" | "units" | "revenue" | "lastSale";

function RetailTab({ store }: { store: StoreRollup }) {
  const [sales, setSales] = useState<HeadsetSaleRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<RetailSortKey>("units");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");

  function handleSort(key: RetailSortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "product" || key === "lastSale" ? "asc" : "desc");
    }
  }

  useEffect(() => {
    if (!store.storeId) return;
    setLoading(true);
    setError(null);
    fetch(`/api/headset/store?storeId=${encodeURIComponent(store.storeId)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setSales(data.sales || []);
      })
      .catch((err) => setError(String(err.message || err)))
      .finally(() => setLoading(false));
  }, [store.storeId]);

  const hasHeadset = store.headsetLastSale || (store.headsetUnits30d ?? 0) > 0;

  if (!hasHeadset && !loading && sales !== null && sales.length === 0) {
    return (
      <div className="detail-stack">
        <p className="detail-note">No Headset sell-through data for this store. Upload a CSV in Sync → Headset to get started.</p>
      </div>
    );
  }

  if (loading) {
    return <div className="detail-stack"><p className="detail-note">Loading…</p></div>;
  }

  if (error) {
    return <div className="detail-stack"><p className="detail-note" style={{ color: "var(--danger)" }}>{error}</p></div>;
  }

  const byProduct = new Map<string, { units: number; sales: number; brand: string | null; category: string | null; lastDay: string }>();
  for (const row of (sales || [])) {
    const existing = byProduct.get(row.productName);
    if (existing) {
      existing.units += row.totalUnits;
      existing.sales += row.totalSales;
      if (row.day > existing.lastDay) existing.lastDay = row.day;
    } else {
      byProduct.set(row.productName, {
        units: row.totalUnits,
        sales: row.totalSales,
        brand: row.brand,
        category: row.category,
        lastDay: row.day
      });
    }
  }

  const productRows = [...byProduct.entries()].sort((a, b) => {
    const [nameA, dataA] = a;
    const [nameB, dataB] = b;
    let cmp = 0;
    if (sortKey === "product") cmp = nameA.localeCompare(nameB);
    else if (sortKey === "units") cmp = dataA.units - dataB.units;
    else if (sortKey === "revenue") cmp = dataA.sales - dataB.sales;
    else if (sortKey === "lastSale") cmp = dataA.lastDay.localeCompare(dataB.lastDay);
    return sortDir === "asc" ? cmp : -cmp;
  });

  const arrow = (key: RetailSortKey) => sortKey === key ? (sortDir === "asc" ? " ▴" : " ▾") : "";
  const thProps = (key: RetailSortKey): React.ThHTMLAttributes<HTMLTableCellElement> => ({
    onClick: () => handleSort(key),
    style: { cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" },
    "aria-sort": sortKey === key ? (sortDir === "asc" ? "ascending" : "descending") : undefined
  });

  return (
    <div className="detail-stack">
      <div className="metrics detail-metrics">
        <DetailStat label="Last Sale" value={formatDate(store.headsetLastSale)} />
        <DetailStat label="Units (30d)" value={(store.headsetUnits30d ?? 0).toLocaleString()} />
        <DetailStat label="Revenue (30d)" value={formatUsd(store.headsetSales30d ?? 0)} />
      </div>
      {productRows.length > 0 ? (
        <>
          <div className="panel-header" style={{ marginTop: 8 }}>
            <span className="table-meta">Products (90d) · {productRows.length}</span>
          </div>
          <table className="mini-table">
            <thead>
              <tr>
                <th {...thProps("product")}>Product{arrow("product")}</th>
                <th {...thProps("units")}>Units{arrow("units")}</th>
                <th {...thProps("revenue")}>Revenue{arrow("revenue")}</th>
                <th {...thProps("lastSale")}>Last Sale{arrow("lastSale")}</th>
              </tr>
            </thead>
            <tbody>
              {productRows.map(([name, data]) => (
                <tr key={name}>
                  <td>{name}</td>
                  <td>{data.units.toLocaleString()}</td>
                  <td>{formatUsd(data.sales)}</td>
                  <td>{formatShortDate(data.lastDay)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        <p className="detail-note">No sell-through data in the last 90 days.</p>
      )}
    </div>
  );
}

function StoreDetailContent({
  activeTab,
  store,
  existingGroups,
  onBuyerSaved,
  onGroupSaved,
  onServiceNoteSaved,
  onContactLogSaved,
  orderLines = []
}: {
  activeTab: DetailTab;
  store: StoreRollup;
  existingGroups: string[];
  onBuyerSaved: (storeId: string, buyer: BuyerContactPatch) => void;
  onGroupSaved: (storeId: string, groupName: string | null) => void;
  onServiceNoteSaved: (storeId: string, serviceNote: string | null) => void;
  onContactLogSaved: (storeId: string, contactLog: ContactLogPatch) => void;
  orderLines?: OrderLine[];
}) {
  if (activeTab === "orders") {
    const paidLines = orderLines.filter(isPaidOrderLine);
    const recentLines = [...paidLines]
      .sort((left, right) => orderTimestamp(right.submittedAt) - orderTimestamp(left.submittedAt))
      .slice(0, 8);

    return (
      <div className="detail-stack">
        <div className="metrics detail-metrics">
          <DetailStat label="Orders" value={(paidLines.length ? uniqueOrderCount(paidLines) : store.orders).toLocaleString()} />
          <DetailStat
            label="Brand Revenue"
            value={formatUsd(paidLines.length ? paidLines.reduce((total, line) => total + line.lineTotal, 0) : store.brandRevenue)}
          />
        </div>
        <div className="detail-list">
          <DetailRow label="Last order" value={formatDate(store.lastOrderAt)} />
          <DetailRow label="Order #" value={store.lastOrderNumber} />
          <DetailRow label="K. Savage last order" value={formatDate(store.kSavageLastOrderAt)} />
          <DetailRow label="K. Savage history" value={formatUsd(store.kSavageHistoricalRevenue)} />
          <DetailRow label="Mayfield active" value={formatUsd(store.mayfieldActiveRevenue)} />
          <DetailRow label="Leisure Land active" value={formatUsd(store.leisureLandActiveRevenue)} />
        </div>
        {recentLines.length ? (
          <table className="mini-table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Brand</th>
                <th>Product</th>
                <th>Units</th>
                <th>Sales</th>
              </tr>
            </thead>
            <tbody>
              {recentLines.map((line) => (
                <tr key={line.orderItemId}>
                  <td>{line.orderNumber}</td>
                  <td>{line.brand}</td>
                  <td>{line.productName || "-"}</td>
                  <td>{line.units.toLocaleString()}</td>
                  <td>{formatUsd(line.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
    );
  }

  if (activeTab === "buyer") {
    return (
      <div className="detail-stack">
        <GroupEditor store={store} existingGroups={existingGroups} onSaved={onGroupSaved} />
        <ServiceNoteEditor store={store} onSaved={onServiceNoteSaved} />
        <BuyerEditor store={store} onSaved={onBuyerSaved} />
      </div>
    );
  }

  if (activeTab === "history") {
    return (
      <div className="detail-stack">
        <div className="detail-tabs">
          <CheckState active={store.hasContactEver} label="Any log" />
          <CheckState active={store.hasContactThisMonth} label="This month" />
          <CheckState active={store.hasContactThisWeek} label="This week" />
        </div>
        <div className="detail-list">
          <DetailRow label="Log count" value={store.contactLogCount.toLocaleString()} />
          <DetailRow label="Last contact" value={formatDate(store.lastContactDate)} />
          <DetailRow label="Method" value={store.lastContactMethod} />
          <DetailRow label="Person" value={store.lastContactPerson} />
        </div>
        <ContactLogHistory store={store} />
      </div>
    );
  }

  if (activeTab === "samples") {
    return (
      <div className="detail-stack">
        <div className="metrics detail-metrics">
          <DetailStat label="Sample Drops" value={store.sampleDropCount.toLocaleString()} />
          <DetailStat label="Latest Drop" value={formatDate(store.latestSampleDate)} />
        </div>
        <div className="detail-list">
          <DetailRow label="Brand" value={store.latestSampleBrand} />
          <DetailRow label="Product" value={store.latestSampleProduct} />
        </div>
      </div>
    );
  }

  if (activeTab === "retail") {
    return <RetailTab store={store} />;
  }

  return (
    <div className="detail-stack">
      <ContactLogForm store={store} onSaved={onContactLogSaved} />
      <ContactLogHistory store={store} />
    </div>
  );
}

export function StoreDashboard({ snapshot, initialView }: StoreDashboardProps) {
  const [stores, setStores] = useState(snapshot.stores);
  const orderLines = snapshot.orderLines || [];
  const salesGoals = snapshot.salesGoals || [];
  const cultiveraLastSyncedAt = snapshot.cultiveraLastSyncedAt || null;
  const [storeQuery, setStoreQuery] = useState("");
  const [draftFilters, setDraftFilters] = useState<StoreFilters>(defaultStoreFilters);
  const [appliedFilters, setAppliedFilters] = useState<StoreFilters>(defaultStoreFilters);
  const [activeView, setActiveView] = useState<ViewMode>(() => normalizeViewMode(initialView));
  const [activeTab, setActiveTab] = useState<DetailTab>("contact");
  const [sortKey, setSortKey] = useState<SortKey>("storeRevenue");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [tripStoreKeys, setTripStoreKeys] = useState<string[]>([]);
  const [routeDestinationKey, setRouteDestinationKey] = useState("");
  const [selectedStoreKey, setSelectedStoreKey] = useState(() => (
    snapshot.stores[0] ? storeKey(snapshot.stores[0]) : ""
  ));
  const existingGroups = useMemo(() =>
    [...new Set(stores.map((s) => s.groupName).filter((g): g is string => Boolean(g)))].sort(),
    [stores]
  );
  const normalizedStoreQuery = storeQuery.trim().toLowerCase();
  const filteredStores = useMemo(() => {
    const searchedStores = normalizedStoreQuery
      ? stores.filter((store) => (
        store.storeName.toLowerCase().includes(normalizedStoreQuery) ||
        store.license.toLowerCase().includes(normalizedStoreQuery) ||
        store.licenseKey.toLowerCase().includes(normalizedStoreQuery)
      ))
      : stores;

    return applyStoreFilters(searchedStores, appliedFilters);
  }, [appliedFilters, normalizedStoreQuery, stores]);
  const sortedStores = useMemo(
    () => sortStores(filteredStores, sortKey, sortDirection),
    [filteredStores, sortDirection, sortKey]
  );
  const metrics = useMemo(() => summarizeStores(sortedStores), [sortedStores]);
  const mappedStoreCount = useMemo(() => sortedStores.filter(hasStoreCoordinates).length, [sortedStores]);
  const tripEligibleKeySet = useMemo(() => new Set(
    sortedStores.filter(hasStoreCoordinates).map(storeKey)
  ), [sortedStores]);
  const regionOptions = useMemo(() => (
    [...new Set(stores.map((store) => textSortValue(store.county)).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right))
  ), [stores]);
  const draftBrandFilters = normalizeBrandFilters(draftFilters.brand);
  const appliedBrandFilters = normalizeBrandFilters(appliedFilters.brand);
  const draftActiveFilterCount = countActiveFilters(draftFilters);
  const appliedActiveFilterCount = countActiveFilters(appliedFilters);
  const selectedStore = stores.find((store) => storeKey(store) === selectedStoreKey) || sortedStores[0] || stores[0];
  const selectedStoreKeys = useMemo(() => (
    selectedStore ? new Set(storeIdentityKeys(selectedStore)) : new Set<string>()
  ), [selectedStore]);
  const selectedStoreOrderLines = useMemo(() => (
    selectedStoreKeys.size
      ? orderLines.filter((line) => orderLineStoreKeys(line).some((key) => selectedStoreKeys.has(key)))
      : []
  ), [orderLines, selectedStoreKeys]);
  const viewTitle = activeView === "map"
    ? "Map"
    : activeView === "orders"
    ? "Orders"
    : activeView === "skus"
    ? "SKU Analytics"
    : activeView === "goals"
    ? "Goals"
    : activeView === "logs"
    ? "Log Entries"
    : activeView === "sync"
    ? "Sync"
    : activeView === "inventory"
    ? "Inventory"
    : "Stores";
  const viewCaption = activeView === "map"
    ? `${mappedStoreCount.toLocaleString()} mapped of ${sortedStores.length.toLocaleString()} filtered stores · ${tripStoreKeys.length.toLocaleString()} stops planned`
    : activeView === "orders"
    ? `${orderLines.length.toLocaleString()} order lines · ${uniqueOrderCount(orderLines).toLocaleString()} orders`
    : activeView === "skus"
    ? `${orderLines.filter(isPaidOrderLine).length.toLocaleString()} paid lines · sell-through by store coverage`
    : activeView === "goals"
    ? `${salesGoals.length.toLocaleString()} saved goal rows · ${uniqueOrderCount(orderLines).toLocaleString()} orders feeding actuals`
    : activeView === "logs"
    ? `${snapshot.contactLogs.length.toLocaleString()} total log entries`
    : activeView === "sync"
    ? `${uniqueOrderCount(orderLines).toLocaleString()} synced orders · ${orderLines.length.toLocaleString()} line items`
    : activeView === "inventory"
    ? `${snapshot.inventoryItems.length.toLocaleString()} SKUs in stock snapshot`
    : snapshot.source === "demo"
    ? "Demo shell. Connect Supabase to load live CRM data."
    : "Live Supabase data";
  const rowMetaBase = normalizedStoreQuery
    ? `${sortedStores.length.toLocaleString()} of ${stores.length.toLocaleString()} rows`
    : `${sortedStores.length.toLocaleString()} rows`;
  const rowMeta = appliedActiveFilterCount
    ? `${rowMetaBase} · ${appliedActiveFilterCount} filter${appliedActiveFilterCount === 1 ? "" : "s"}`
    : rowMetaBase;

  useEffect(() => {
    setStores(snapshot.stores);
  }, [snapshot.stores]);

  useEffect(() => {
    setActiveView(normalizeViewMode(initialView));
  }, [initialView]);

  useEffect(() => {
    function handlePopState() {
      const params = new URLSearchParams(window.location.search);
      setActiveView(normalizeViewMode(params.get("view")));
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    const selectionScope = activeView === "orders" || activeView === "skus" || activeView === "goals" || activeView === "logs" || activeView === "sync" || activeView === "inventory" ? stores : sortedStores;
    if (!selectionScope.length) {
      setSelectedStoreKey("");
      return;
    }
    if (!selectionScope.some((store) => storeKey(store) === selectedStoreKey)) {
      setSelectedStoreKey(storeKey(selectionScope[0]));
    }
  }, [activeView, selectedStoreKey, sortedStores, stores]);

  useEffect(() => {
    setTripStoreKeys((currentKeys) => {
      const nextKeys = currentKeys.filter((key) => tripEligibleKeySet.has(key));
      return nextKeys.length === currentKeys.length ? currentKeys : nextKeys;
    });
  }, [tripEligibleKeySet]);

  useEffect(() => {
    if (routeDestinationKey && !tripEligibleKeySet.has(routeDestinationKey)) {
      setRouteDestinationKey("");
    }
  }, [routeDestinationKey, tripEligibleKeySet]);

  function handleBuyerSaved(storeId: string, buyer: BuyerContactPatch) {
    setStores((currentStores) => currentStores.map((store) => (
      store.storeId === storeId ? { ...store, ...buyer } : store
    )));
  }

  function handleStoreNameSaved(storeId: string, storeName: string) {
    setStores((currentStores) => currentStores.map((store) => (
      store.storeId === storeId ? { ...store, storeName } : store
    )));
  }

  function handleGroupSaved(storeId: string, groupName: string | null) {
    setStores((currentStores) => currentStores.map((store) => (
      store.storeId === storeId ? { ...store, groupName } : store
    )));
  }

  function handleServiceNoteSaved(storeId: string, serviceNote: string | null) {
    setStores((currentStores) => currentStores.map((store) => (
      store.storeId === storeId ? { ...store, serviceNote } : store
    )));
  }

  function handleContactLogSaved(storeId: string, contactLog: ContactLogPatch) {
    setStores((currentStores) => currentStores.map((store) => (
      store.storeId === storeId
        ? {
          ...store,
          contactLogCount: store.contactLogCount + 1,
          hasContactEver: true,
          hasContactThisMonth: store.hasContactThisMonth || isContactThisMonth(contactLog.dateContacted),
          hasContactThisWeek: store.hasContactThisWeek || isContactThisWeek(contactLog.dateContacted),
          lastContactDate: contactLog.dateContacted || contactLog.savedAt,
          lastContactMethod: contactLog.contactMethod,
          lastContactPerson: contactLog.personContacted,
          lastContactNotes: contactLog.notes
        }
        : store
    )));
  }

  const handleStoreSelect = useCallback((nextStoreKey: string) => {
    setSelectedStoreKey(nextStoreKey);
  }, []);

  const handleViewChange = useCallback((nextView: ViewMode) => {
    setActiveView(nextView);
    if (typeof window === "undefined") {
      return;
    }
    const nextUrl = nextView === "stores"
      ? window.location.pathname
      : `${window.location.pathname}?view=${nextView}`;
    window.history.pushState(null, "", nextUrl);
  }, []);

  const handleSetRouteDestination = useCallback((nextStoreKey: string) => {
    setTripStoreKeys((currentKeys) => (
      currentKeys.includes(nextStoreKey) ? currentKeys : [...currentKeys, nextStoreKey]
    ));
    setRouteDestinationKey(nextStoreKey);
  }, []);

  const handleAddRouteWaypoint = useCallback((nextStoreKey: string) => {
    setTripStoreKeys((currentKeys) => (
      currentKeys.includes(nextStoreKey) ? currentKeys : [...currentKeys, nextStoreKey]
    ));
  }, []);

  const handleAddRouteWaypoints = useCallback((nextStoreKeys: string[]) => {
    setTripStoreKeys((currentKeys) => {
      const keySet = new Set(currentKeys);
      nextStoreKeys.forEach((key) => keySet.add(key));
      return [...keySet];
    });
  }, []);

  const handleRemoveTripStore = useCallback((nextStoreKey: string) => {
    setTripStoreKeys((currentKeys) => currentKeys.filter((key) => key !== nextStoreKey));
    setRouteDestinationKey((currentKey) => (currentKey === nextStoreKey ? "" : currentKey));
  }, []);

  const handleClearTrip = useCallback(() => {
    setTripStoreKeys([]);
    setRouteDestinationKey("");
  }, []);

  function updateDraftFilter<K extends keyof StoreFilters>(key: K, value: StoreFilters[K]) {
    setDraftFilters((currentFilters) => ({
      ...currentFilters,
      [key]: value
    }));
  }

  function toggleDraftBrand(brand: BrandFilter, checked: boolean) {
    setDraftFilters((currentFilters) => {
      const currentBrands = normalizeBrandFilters(currentFilters.brand);
      const nextBrands = checked
        ? [...currentBrands, brand].filter((value, index, values) => values.indexOf(value) === index)
        : currentBrands.filter((value) => value !== brand);

      return {
        ...currentFilters,
        brand: nextBrands
      };
    });
  }

  function handleApplyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAppliedFilters(draftFilters);
  }

  function handleSort(nextSortKey: SortKey) {
    if (nextSortKey === sortKey) {
      setSortDirection((currentDirection) => (currentDirection === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(nextSortKey);
    setSortDirection(
      nextSortKey === "balaclava" || nextSortKey === "storeRevenue" || nextSortKey === "lastOrder" || nextSortKey === "lastLog" || nextSortKey === "priority" || nextSortKey === "log" ? "desc" : "asc"
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <img className="brand-logo" src="/logo.png" alt="RODYO" />
          <span>Balaclava Brands</span>
        </div>
        <nav className="nav" aria-label="Main navigation">
          <a className={activeView === "stores" ? "active" : ""} href="/">
            Stores
          </a>
          <a className={activeView === "map" ? "active" : ""} href="/?view=map">
            Map
          </a>
          <a className={activeView === "orders" ? "active" : ""} href="/?view=orders">
            Orders
          </a>
          <a className={activeView === "skus" ? "active" : ""} href="/?view=skus">
            SKUs
          </a>
          <a className={activeView === "goals" ? "active" : ""} href="/?view=goals">
            Goals
          </a>
          <a className={activeView === "logs" ? "active" : ""} href="/?view=logs">
            Logs
          </a>
          <a className={activeView === "inventory" ? "active" : ""} href="/?view=inventory">
            Inventory
          </a>
          <a className={activeView === "sync" ? "active" : ""} href="/?view=sync">
            Sync
          </a>
        </nav>
      </aside>

      <main className="main">
        <section className="toolbar">
          <div className="toolbar-title">
            <div>
              <h2>{viewTitle}</h2>
              <div className="caption">{viewCaption}</div>
            </div>
            <button className="primary-button" type="button" onClick={() => handleViewChange("map")}>
              <MapIcon size={16} /> Launch Map
            </button>
          </div>

          {activeView === "stores" || activeView === "map" ? (
            <form className="filters" aria-label="Store filters" onSubmit={handleApplyFilters}>
              <div className="field store-filter-field">
                <label>Stores</label>
                <input
                  type="search"
                  value={storeQuery}
                  onChange={(event) => setStoreQuery(event.target.value)}
                  placeholder="Name or license"
                />
              </div>
              <div className="field">
                <FilterLabel active={appliedFilters.balaclavaSales !== "all"}>Balaclava Sales</FilterLabel>
                <select
                  value={draftFilters.balaclavaSales}
                  onChange={(event) => (
                    updateDraftFilter("balaclavaSales", event.target.value as BalaclavaSalesFilter)
                  )}
                >
                  <option value="all">Any range</option>
                  <option value="1000">$1k+</option>
                  <option value="5000">$5k+</option>
                </select>
              </div>
              <div className="field">
                <FilterLabel active={appliedFilters.storeRevenue !== "all"}>Store Revenue</FilterLabel>
                <select
                  value={draftFilters.storeRevenue}
                  onChange={(event) => (
                    updateDraftFilter("storeRevenue", event.target.value as StoreRevenueFilter)
                  )}
                >
                  <option value="all">Any range</option>
                  <option value="300">$300+</option>
                  <option value="50000">$50k+</option>
                  <option value="100000">$100k+</option>
                </select>
              </div>
              <div className="field">
                <FilterLabel active={appliedBrandFilters.length > 0}>Brand</FilterLabel>
                <details className="multi-select">
                  <summary className="multi-select-trigger">{brandFilterLabel(draftBrandFilters)}</summary>
                  <div className="multi-select-menu">
                    <label className="check-option">
                      <input
                        checked={!draftBrandFilters.length}
                        onChange={() => updateDraftFilter("brand", [])}
                        type="checkbox"
                      />
                      <span className="check-option-label">All brands</span>
                      <span aria-hidden="true" className="filter-brand-dots">
                        {TERRITORY_BRANDS.map((brand) => (
                          <span
                            className="filter-brand-dot"
                            key={brand}
                            style={{ background: BRAND_DOT_COLORS[brand] ?? "var(--muted)" }}
                          />
                        ))}
                      </span>
                    </label>
                    {TERRITORY_BRANDS.map((brand) => (
                      <label className="check-option" key={brand}>
                        <input
                          checked={draftBrandFilters.includes(brand)}
                          onChange={(event) => toggleDraftBrand(brand, event.target.checked)}
                          type="checkbox"
                        />
                        <span className="check-option-label">{brand}</span>
                        <span
                          aria-hidden="true"
                          className="filter-brand-dot"
                          style={{ background: BRAND_DOT_COLORS[brand] ?? "var(--muted)" }}
                        />
                      </label>
                    ))}
                  </div>
                </details>
              </div>
              <div className="field">
                <FilterLabel active={appliedFilters.pareto !== "all"}>Pareto</FilterLabel>
                <select
                  value={draftFilters.pareto}
                  onChange={(event) => updateDraftFilter("pareto", event.target.value as ParetoFilter)}
                >
                  <option value="all">All stores</option>
                  <option value="top30">Top 30</option>
                  <option value="eighty">80% revenue set</option>
                </select>
              </div>
              <div className="field">
                <FilterLabel active={appliedFilters.priority !== "all"}>Priority</FilterLabel>
                <select
                  value={draftFilters.priority}
                  onChange={(event) => updateDraftFilter("priority", event.target.value as PriorityFilter)}
                >
                  <option value="all">All priorities</option>
                  <option value="overdue">Overdue</option>
                  <option value="lapsed">Lapsed</option>
                  <option value="open-lane">Open lane</option>
                </select>
              </div>
              <div className="field">
                <FilterLabel active={appliedFilters.region !== "all"}>Region</FilterLabel>
                <select
                  value={draftFilters.region}
                  onChange={(event) => updateDraftFilter("region", event.target.value)}
                >
                  <option value="all">All regions</option>
                  {regionOptions.map((region) => (
                    <option key={region} value={region}>
                      {region.replace(/\b\w/g, (letter) => letter.toUpperCase())}
                    </option>
                  ))}
                </select>
              </div>
              {existingGroups.length > 0 ? (
                <div className="field">
                  <FilterLabel active={appliedFilters.group !== "all"}>Group</FilterLabel>
                  <select
                    value={draftFilters.group}
                    onChange={(event) => updateDraftFilter("group", event.target.value)}
                  >
                    <option value="all">All groups</option>
                    {existingGroups.map((g) => (
                      <option key={g} value={g}>{g}</option>
                    ))}
                  </select>
                </div>
              ) : null}
              <div className="field">
                <FilterLabel active={appliedFilters.reorderGap}>Reorder Gap</FilterLabel>
                <label className="check-option" style={{ paddingTop: 6 }}>
                  <input
                    type="checkbox"
                    checked={draftFilters.reorderGap}
                    onChange={(event) => updateDraftFilter("reorderGap", event.target.checked)}
                  />
                  <span className="check-option-label">Sell-through, no reorder</span>
                </label>
              </div>
              <button className="primary-button" type="submit">
                <SlidersHorizontal size={16} /> Apply{draftActiveFilterCount ? ` (${draftActiveFilterCount})` : ""}
              </button>
            </form>
          ) : null}
        </section>

        {activeView === "stores" || activeView === "map" ? (
          <section className="metrics">
            <div className="metric">
              <div className="metric-label">Retailers</div>
              <div className="metric-value">{metrics.totalRetailers.toLocaleString()}</div>
            </div>
            <div className="metric">
              <div className="metric-label">Mapped</div>
              <div className="metric-value">{metrics.mappedStores.toLocaleString()}</div>
            </div>
            <div className="metric">
              <div className="metric-label">Overdue</div>
              <div className="metric-value">{metrics.overduePriority.toLocaleString()}</div>
            </div>
            <div className="metric">
              <div className="metric-label">Lapsed Priority</div>
              <div className="metric-value">{metrics.lapsedPriority.toLocaleString()}</div>
            </div>
            <div className="metric">
              <div className="metric-label">Open Lane</div>
              <div className="metric-value">{metrics.openLanePriority.toLocaleString()}</div>
            </div>
            <div className="metric">
              <div className="metric-label">Pitch Mayfield</div>
              <div className="metric-value">{metrics.pitchMayfield.toLocaleString()}</div>
            </div>
          </section>
        ) : null}

        {activeView === "stores" ? (
          <section className="content-grid">
            <div className="panel">
              <div className="panel-header">
                <h3>Filtered Stores</h3>
                <span className="table-meta">{rowMeta}</span>
              </div>
              <table className="store-table">
                <thead>
                  <tr>
                    {sortableColumns.map((column) => {
                      const isActive = column.key === sortKey;
                      return (
                        <th
                          key={column.key}
                          aria-sort={isActive ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}
                          style={column.width ? { width: column.width } : undefined}
                        >
                          <button
                            className="sort-header"
                            type="button"
                            onClick={() => handleSort(column.key)}
                          >
                            <span>{column.label}</span>
                            <span aria-hidden="true" className="sort-indicator">
                              {isActive ? (sortDirection === "asc" ? "↑" : "↓") : "↕"}
                            </span>
                          </button>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {sortedStores.map((store) => (
                    <tr
                      key={storeKey(store)}
                      className={selectedStore && storeKey(store) === storeKey(selectedStore) ? "is-selected" : ""}
                      tabIndex={0}
                      onClick={() => handleStoreSelect(storeKey(store))}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          handleStoreSelect(storeKey(store));
                        }
                      }}
                    >
                      <td>
                        <div className="store-name">{store.storeName}</div>
                        <div className="store-subtext">
                          {store.license} · {store.city || "No city"} {store.zip || ""}
                        </div>
                      </td>
                      <td>
                        <BrandPlacementDots store={store} />
                      </td>
                      <td className="priority-cell">
                        <PriorityDot store={store} />
                      </td>
                      <td>{formatUsd(latestBalaclavaRevenue(store))}</td>
                      <td>{formatUsd(store.marketSalesLastMonth)}</td>
                      <td>{formatShortDate(store.lastOrderAt)}</td>
                      <td>{formatShortDate(store.lastContactDate)}</td>
                      <td className="group-cell">{store.groupName || "-"}</td>
                      <td>{store.territoryRep || "-"}</td>
                      <td>{store.hasContactEver ? "✅" : ""}</td>
                    </tr>
                  ))}
                  {!sortedStores.length ? (
                    <tr>
                      <td colSpan={10}>No stores match that search.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <StoreDetailDrawer
              selectedStore={selectedStore}
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              existingGroups={existingGroups}
              onBuyerSaved={handleBuyerSaved}
              onGroupSaved={handleGroupSaved}
              onServiceNoteSaved={handleServiceNoteSaved}
              onContactLogSaved={handleContactLogSaved}
              onStoreNameSaved={handleStoreNameSaved}
              orderLines={selectedStoreOrderLines}
            />
          </section>
        ) : activeView === "map" ? (
          <TripPlanner
            stores={sortedStores}
            orderLines={orderLines}
            selectedStore={selectedStore}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            routeDestinationKey={routeDestinationKey}
            tripStoreKeys={tripStoreKeys}
            onAddWaypoint={handleAddRouteWaypoint}
            onAddWaypoints={handleAddRouteWaypoints}
            onRemoveStore={handleRemoveTripStore}
            onClearTrip={handleClearTrip}
            onSetDestination={handleSetRouteDestination}
            onSelectStore={handleStoreSelect}
            existingGroups={existingGroups}
            onBuyerSaved={handleBuyerSaved}
            onGroupSaved={handleGroupSaved}
            onServiceNoteSaved={handleServiceNoteSaved}
            onContactLogSaved={handleContactLogSaved}
            onStoreNameSaved={handleStoreNameSaved}
          />
        ) : activeView === "orders" ? (
          <OrdersView
            orderLines={orderLines}
            cultiveraLastSyncedAt={cultiveraLastSyncedAt}
            stores={stores}
            selectedStore={selectedStore}
            onSelectStore={handleStoreSelect}
          />
        ) : activeView === "skus" ? (
          <SkuAnalyticsView
            orderLines={orderLines}
            stores={stores}
          />
        ) : activeView === "logs" ? (
          <LogEntriesView
            contactLogs={snapshot.contactLogs}
            stores={stores}
          />
        ) : activeView === "inventory" ? (
          <InventoryView
            inventoryItems={snapshot.inventoryItems}
            orderLines={orderLines}
          />
        ) : activeView === "sync" ? (
          <SyncView
            orderLines={orderLines}
            salesGoals={salesGoals}
            stores={stores}
          />
        ) : (
          <GoalsView
            orderLines={orderLines}
            salesGoals={salesGoals}
          />
        )}
      </main>
    </div>
  );
}
