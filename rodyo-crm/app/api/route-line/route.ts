import { NextResponse } from "next/server";

type RoutePoint = {
  latitude?: number;
  longitude?: number;
};

type RouteLinePayload = {
  origin?: RoutePoint;
  stops?: RoutePoint[];
};

type GoogleDirectionsResponse = {
  status?: string;
  error_message?: string;
  routes?: {
    overview_polyline?: {
      points?: string;
    };
  }[];
};

const MAX_ROUTE_STOPS = 25;

function googleMapsServerKey() {
  return (
    process.env.GOOGLE_MAPS_SERVER_KEY
    || process.env.GOOGLE_MAPS_API_KEY
    || process.env.google_maps_api_key
    || process.env.google_maps_server_key
    || ""
  );
}

function cleanPoint(point?: RoutePoint) {
  const latitude = Number(point?.latitude);
  const longitude = Number(point?.longitude);

  if (
    !Number.isFinite(latitude)
    || !Number.isFinite(longitude)
    || latitude < -90
    || latitude > 90
    || longitude < -180
    || longitude > 180
  ) {
    return null;
  }

  return { latitude, longitude };
}

function coordinateParam(point: Required<RoutePoint>) {
  return `${point.latitude},${point.longitude}`;
}

function decodePolyline(polyline: string): [number, number][] {
  const coordinates: [number, number][] = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;

  while (index < polyline.length) {
    let shift = 0;
    let result = 0;
    let byte: number;

    do {
      byte = polyline.charCodeAt(index) - 63;
      index += 1;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < polyline.length);

    latitude += (result & 1) ? ~(result >> 1) : (result >> 1);
    shift = 0;
    result = 0;

    do {
      byte = polyline.charCodeAt(index) - 63;
      index += 1;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < polyline.length);

    longitude += (result & 1) ? ~(result >> 1) : (result >> 1);
    coordinates.push([longitude / 1e5, latitude / 1e5]);
  }

  return coordinates;
}

export async function POST(request: Request) {
  let payload: RouteLinePayload;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const origin = cleanPoint(payload.origin);
  const routeStops = (payload.stops || [])
    .map(cleanPoint)
    .filter((point): point is Required<RoutePoint> => Boolean(point))
    .slice(0, MAX_ROUTE_STOPS);

  if (!origin || !routeStops.length) {
    return NextResponse.json({ coordinates: [] });
  }

  const googleMapsKey = googleMapsServerKey();
  if (!googleMapsKey) {
    return NextResponse.json({ coordinates: [] });
  }

  const destination = routeStops[routeStops.length - 1];
  const waypoints = routeStops.slice(0, -1);
  const params = new URLSearchParams({
    origin: coordinateParam(origin),
    destination: coordinateParam(destination),
    mode: "driving",
    key: googleMapsKey
  });

  if (waypoints.length) {
    params.set("waypoints", waypoints.map(coordinateParam).join("|"));
  }

  try {
    const response = await fetch(`https://maps.googleapis.com/maps/api/directions/json?${params.toString()}`);
    const result = (await response.json()) as GoogleDirectionsResponse;

    if (!response.ok || result.status !== "OK") {
      return NextResponse.json({
        coordinates: [],
        error: result.error_message || result.status || "Could not build route line."
      }, { status: 502 });
    }

    const encodedPolyline = result.routes?.[0]?.overview_polyline?.points;
    if (!encodedPolyline) {
      return NextResponse.json({ coordinates: [] });
    }

    return NextResponse.json({ coordinates: decodePolyline(encodedPolyline) });
  } catch (error) {
    return NextResponse.json({
      coordinates: [],
      error: error instanceof Error ? error.message : "Could not build route line."
    }, { status: 502 });
  }
}
