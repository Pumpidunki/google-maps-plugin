#!/usr/bin/env node
// Zero-dependency MCP server (stdio) for Google Maps Platform.
// Requires Node 18+ and GOOGLE_MAPS_API_KEY with these APIs enabled:
// Places API (New), Routes API and Geocoding API.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

const VERSION = "1.1.0";
const LANG = process.env.GOOGLE_MAPS_LANGUAGE || "es";
const NO_KEY =
  "Falta la clave GOOGLE_MAPS_API_KEY / Missing GOOGLE_MAPS_API_KEY. " +
  "Créala en https://console.cloud.google.com/google/maps-apis/credentials, activa Places API (New), " +
  "Routes API y Geocoding API, y configúrala con /plugin (google-maps → Configure) o como variable de entorno.";

function apiKey() {
  const key = (process.env.GOOGLE_MAPS_API_KEY ?? "").trim();
  if (!key || key.startsWith("${")) throw new Error(NO_KEY);
  return key;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function readGoogle(res, label) {
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg = (data && data.error && data.error.message) || text;
    throw new Error(`Google ${label} (${res.status}): ${msg}`);
  }
  return data;
}

async function googlePost(url, fieldMask, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey(), "X-Goog-FieldMask": fieldMask },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  return readGoogle(res, new URL(url).pathname);
}

async function googleGet(url, fieldMask) {
  const headers = { "X-Goog-Api-Key": apiKey() };
  if (fieldMask) headers["X-Goog-FieldMask"] = fieldMask;
  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  return readGoogle(res, new URL(url).pathname);
}

async function geocodeRequest(params) {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("key", apiKey());
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  const data = await res.json();
  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    throw new Error(`Geocoding: ${data.status} ${data.error_message ?? ""}`.trim());
  }
  return data.results ?? [];
}

// ---------------------------------------------------------------------------
// Location helpers
// ---------------------------------------------------------------------------

const LATLNG_RE = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/;

function parseLatLng(text) {
  const m = String(text).match(LATLNG_RE);
  return m ? { latitude: Number(m[1]), longitude: Number(m[2]) } : null;
}

/** Address, landmark, "lat,lng" or "place_id:<id>" -> Routes API waypoint. */
function toWaypoint(text) {
  const value = String(text).trim();
  if (value.startsWith("place_id:")) return { placeId: value.slice("place_id:".length) };
  const ll = parseLatLng(value);
  return ll ? { location: { latLng: ll } } : { address: value };
}

async function resolveLatLng(text) {
  const ll = parseLatLng(text);
  if (ll) return ll;
  const [r] = await geocodeRequest({ address: text, language: LANG });
  if (!r) throw new Error(`No encuentro la ubicación "${text}" / Location not found`);
  return { latitude: r.geometry.location.lat, longitude: r.geometry.location.lng };
}

const placeIdOf = (text) => String(text).replace(/^place_id:/, "").replace(/^places\//, "");

const slug = (text) =>
  String(text)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "place";

const km = (m) => (m == null ? null : Math.round(m / 100) / 10);
const minutes = (d) => (d ? Math.round(parseFloat(String(d).replace("s", "")) / 60) : null);

const URL_MODES = { DRIVE: "driving", WALK: "walking", BICYCLE: "bicycling", TRANSIT: "transit", TWO_WHEELER: "two-wheeler" };

/** Google Maps URLs open the Google Maps app on phones and the website on desktop. No key needed. */
function mapsLink({ action = "search", query, place_id, origin, destination, waypoints, mode }) {
  const u = new URL(`https://www.google.com/maps/${action === "directions" ? "dir" : "search"}/`);
  u.searchParams.set("api", "1");
  if (action === "directions") {
    if (origin) u.searchParams.set("origin", origin);
    if (destination) u.searchParams.set("destination", destination);
    if (waypoints?.length) u.searchParams.set("waypoints", waypoints.join("|"));
    if (mode) u.searchParams.set("travelmode", URL_MODES[mode] ?? String(mode).toLowerCase());
  } else {
    u.searchParams.set("query", query || place_id || "");
    if (place_id) u.searchParams.set("query_place_id", place_id);
  }
  return u.toString();
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

const MODE = {
  type: "string",
  enum: ["DRIVE", "WALK", "BICYCLE", "TWO_WHEELER", "TRANSIT"],
  description: "Travel mode. Default DRIVE.",
};
const LANGUAGE = { type: "string", description: `Response language code (default "${LANG}")` };

const PLACE_FIELDS = [
  "id",
  "displayName",
  "formattedAddress",
  "location",
  "rating",
  "userRatingCount",
  "currentOpeningHours.openNow",
  "priceLevel",
  "primaryTypeDisplayName",
  "googleMapsUri",
  "websiteUri",
  "internationalPhoneNumber",
  "businessStatus",
];

function shapePlace(p) {
  return {
    name: p.displayName?.text,
    address: p.formattedAddress,
    type: p.primaryTypeDisplayName?.text,
    rating: p.rating,
    reviews: p.userRatingCount,
    open_now: p.currentOpeningHours?.openNow,
    price_level: p.priceLevel,
    business_status: p.businessStatus,
    phone: p.internationalPhoneNumber,
    website: p.websiteUri,
    lat: p.location?.latitude,
    lng: p.location?.longitude,
    place_id: p.id,
    google_maps: p.googleMapsUri,
  };
}

const TOOLS = [
  {
    name: "search_places",
    description:
      "Search Google Maps places (restaurants, shops, clinics, hotels, landmarks...) by free text, optionally near a location. " +
      "Returns name, address, rating, review count, open now, phone, website, coordinates, place_id and a Google Maps link.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to search, e.g. 'pizzería en Alicante' or 'dentist'" },
        near: { type: "string", description: "Optional center: address, place name or 'lat,lng'" },
        radius_km: { type: "number", minimum: 0.1, maximum: 50, description: "Bias radius around `near` (default 5)" },
        open_now: { type: "boolean", description: "Only places open right now" },
        min_rating: { type: "number", minimum: 0, maximum: 5, description: "Minimum rating 0-5" },
        max_results: { type: "integer", minimum: 1, maximum: 20, description: "Default 10" },
        language: LANGUAGE,
      },
      required: ["query"],
    },
    async run(a) {
      const body = { textQuery: a.query, languageCode: a.language ?? LANG, pageSize: a.max_results ?? 10 };
      if (a.near) {
        const center = await resolveLatLng(a.near);
        body.locationBias = { circle: { center, radius: Math.min((a.radius_km ?? 5) * 1000, 50_000) } };
      }
      if (a.open_now) body.openNow = true;
      if (a.min_rating) body.minRating = Math.min(5, Math.round(a.min_rating * 2) / 2);
      const data = await googlePost(
        "https://places.googleapis.com/v1/places:searchText",
        PLACE_FIELDS.map((f) => `places.${f}`).join(","),
        body,
      );
      return { query: a.query, near: a.near, results: (data.places ?? []).map(shapePlace) };
    },
  },
  {
    name: "place_details",
    description:
      "Full details of one place by place_id: opening hours, phone, website, rating, editorial summary and latest reviews.",
    inputSchema: {
      type: "object",
      properties: {
        place_id: { type: "string", description: "Place id from search_places" },
        language: LANGUAGE,
      },
      required: ["place_id"],
    },
    async run(a) {
      const id = placeIdOf(a.place_id);
      const fields = [...PLACE_FIELDS, "regularOpeningHours.weekdayDescriptions", "editorialSummary", "reviews"];
      const p = await googleGet(
        `https://places.googleapis.com/v1/places/${encodeURIComponent(id)}?languageCode=${a.language ?? LANG}`,
        fields.join(","),
      );
      return {
        ...shapePlace(p),
        summary: p.editorialSummary?.text,
        opening_hours: p.regularOpeningHours?.weekdayDescriptions,
        latest_reviews: (p.reviews ?? []).slice(0, 5).map((r) => ({
          rating: r.rating,
          when: r.relativePublishTimeDescription,
          author: r.authorAttribution?.displayName,
          text: r.text?.text ?? r.originalText?.text,
        })),
      };
    },
  },
  {
    name: "place_photos",
    description:
      "Photos of a place on Google Maps by place_id (up to 10). Returns the images so you can see them, " +
      "each photo's author (Google requires showing this attribution), and saves them as image files when save_dir is given.",
    returnsContent: true,
    inputSchema: {
      type: "object",
      properties: {
        place_id: { type: "string", description: "Place id from search_places" },
        max_photos: { type: "integer", minimum: 1, maximum: 10, description: "Default 4" },
        max_width_px: { type: "integer", minimum: 100, maximum: 4800, description: "Image width in pixels (default 800)" },
        save_dir: { type: "string", description: "Optional absolute folder to save the photos into" },
      },
      required: ["place_id"],
    },
    async run(a) {
      const place = await googleGet(
        `https://places.googleapis.com/v1/places/${encodeURIComponent(placeIdOf(a.place_id))}?languageCode=${LANG}`,
        "displayName,googleMapsUri,photos",
      );
      const name = place.displayName?.text ?? "place";
      const width = a.max_width_px ?? 800;
      const photos = await Promise.all(
        (place.photos ?? []).slice(0, a.max_photos ?? 4).map(async (ph) => {
          // skipHttpRedirect gives a short-lived googleusercontent URL, so the key never travels in a URL.
          const { photoUri } = await googleGet(
            `https://places.googleapis.com/v1/${ph.name}/media?maxWidthPx=${width}&skipHttpRedirect=true`,
          );
          const res = await fetch(photoUri, { signal: AbortSignal.timeout(20_000) });
          if (!res.ok) throw new Error(`Google photo (${res.status})`);
          const author = ph.authorAttributions?.[0];
          return {
            data: Buffer.from(await res.arrayBuffer()),
            mimeType: res.headers.get("content-type")?.split(";")[0] || "image/jpeg",
            author: author?.displayName,
            author_url: author?.uri,
            original_size: `${ph.widthPx}x${ph.heightPx}`,
          };
        }),
      );

      let files = [];
      if (a.save_dir && photos.length) {
        const dir = join(a.save_dir, slug(name));
        mkdirSync(dir, { recursive: true });
        files = photos.map((p, i) => {
          const file = join(dir, `${slug(name)}-${i + 1}.${p.mimeType === "image/png" ? "png" : "jpg"}`);
          writeFileSync(file, p.data);
          return file;
        });
      }

      const summary = {
        place: name,
        google_maps: place.googleMapsUri,
        total_photos_on_google: place.photos?.length ?? 0,
        photos: photos.map((p, i) => ({
          n: i + 1,
          author: p.author,
          author_url: p.author_url,
          original_size: p.original_size,
          file: files[i],
        })),
        note: photos.length
          ? "Las fotos son de sus autores; muestra su nombre al usarlas. / Photos belong to their authors; show the attribution."
          : "Este sitio no tiene fotos en Google Maps. / This place has no photos.",
      };
      return [
        { type: "text", text: JSON.stringify(summary, null, 2) },
        ...photos.map((p) => ({ type: "image", data: p.data.toString("base64"), mimeType: p.mimeType })),
      ];
    },
  },
  {
    name: "geocode",
    description: "Convert an address or place name into coordinates, or 'lat,lng' coordinates into an address.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "Address, place or 'lat,lng'" }, language: LANGUAGE },
      required: ["query"],
    },
    async run(a) {
      const ll = parseLatLng(a.query);
      const params = ll ? { latlng: `${ll.latitude},${ll.longitude}` } : { address: a.query };
      const results = await geocodeRequest({ ...params, language: a.language ?? LANG });
      return {
        query: a.query,
        results: results.slice(0, 5).map((r) => ({
          address: r.formatted_address,
          lat: r.geometry.location.lat,
          lng: r.geometry.location.lng,
          place_id: r.place_id,
          types: r.types,
        })),
      };
    },
  },
  {
    name: "directions",
    description:
      "Route from origin to destination with Google Routes: distance, time (with live traffic when driving), " +
      "turn-by-turn steps or public transport lines, alternatives, optional waypoints, and a link that opens it in the Google Maps app.",
    inputSchema: {
      type: "object",
      properties: {
        origin: { type: "string", description: "Address, place, 'lat,lng' or 'place_id:<id>'" },
        destination: { type: "string", description: "Address, place, 'lat,lng' or 'place_id:<id>'" },
        waypoints: { type: "array", items: { type: "string" }, maxItems: 23, description: "Intermediate stops (not for TRANSIT)" },
        optimize_waypoints: { type: "boolean", description: "Reorder waypoints for the fastest route" },
        mode: MODE,
        departure_time: { type: "string", description: "ISO 8601 future time, e.g. 2026-11-02T08:30:00+01:00 (DRIVE/TRANSIT)" },
        avoid_tolls: { type: "boolean" },
        avoid_highways: { type: "boolean" },
        avoid_ferries: { type: "boolean" },
        alternatives: { type: "boolean", description: "Also return alternative routes (not with waypoints)" },
        include_steps: { type: "boolean", description: "Include turn-by-turn steps (default true)" },
        language: LANGUAGE,
      },
      required: ["origin", "destination"],
    },
    async run(a) {
      const mode = a.mode ?? "DRIVE";
      const body = {
        origin: toWaypoint(a.origin),
        destination: toWaypoint(a.destination),
        travelMode: mode,
        languageCode: a.language ?? LANG,
        units: "METRIC",
        computeAlternativeRoutes: Boolean(a.alternatives),
      };
      if (a.waypoints?.length) {
        if (mode === "TRANSIT") throw new Error("TRANSIT no admite paradas intermedias / TRANSIT does not support waypoints");
        body.intermediates = a.waypoints.map(toWaypoint);
        if (a.optimize_waypoints) body.optimizeWaypointOrder = true;
      }
      if (mode === "DRIVE" || mode === "TWO_WHEELER") {
        body.routingPreference = "TRAFFIC_AWARE";
        body.routeModifiers = {
          avoidTolls: Boolean(a.avoid_tolls),
          avoidHighways: Boolean(a.avoid_highways),
          avoidFerries: Boolean(a.avoid_ferries),
        };
      }
      if (a.departure_time) body.departureTime = new Date(a.departure_time).toISOString();

      const fields = [
        "routes.description",
        "routes.distanceMeters",
        "routes.duration",
        "routes.staticDuration",
        "routes.warnings",
        "routes.optimizedIntermediateWaypointIndex",
        "routes.legs.distanceMeters",
        "routes.legs.duration",
        "routes.legs.steps.distanceMeters",
        "routes.legs.steps.navigationInstruction",
        "routes.legs.steps.travelMode",
        "routes.legs.steps.transitDetails",
      ];
      const data = await googlePost("https://routes.googleapis.com/directions/v2:computeRoutes", fields.join(","), body);
      if (!data.routes?.length) throw new Error("No se encontró ruta / No route found");

      const includeSteps = a.include_steps !== false;
      const hasTraffic = mode === "DRIVE" || mode === "TWO_WHEELER";
      return {
        origin: a.origin,
        destination: a.destination,
        mode,
        open_in_google_maps: mapsLink({
          action: "directions",
          origin: a.origin,
          destination: a.destination,
          waypoints: a.waypoints,
          mode,
        }),
        routes: data.routes.map((r, i) => ({
          summary: r.description,
          distance_km: km(r.distanceMeters),
          duration_min: minutes(r.duration),
          duration_without_traffic_min: hasTraffic && r.staticDuration ? minutes(r.staticDuration) : undefined,
          warnings: r.warnings,
          optimized_waypoint_order: r.optimizedIntermediateWaypointIndex?.map((j) => a.waypoints[j]),
          legs: (r.legs ?? []).map((l) => ({ km: km(l.distanceMeters), min: minutes(l.duration) })),
          steps:
            includeSteps && i === 0
              ? (r.legs ?? []).flatMap((l) =>
                  (l.steps ?? []).map((s) => {
                    const t = s.transitDetails;
                    if (t) {
                      const line = t.transitLine?.nameShort || t.transitLine?.name;
                      return {
                        transit: `${t.transitLine?.vehicle?.name?.text ?? ""} ${line ?? ""} → ${t.headsign ?? ""}`.trim(),
                        from: t.stopDetails?.departureStop?.name,
                        to: t.stopDetails?.arrivalStop?.name,
                        departs: t.localizedValues?.departureTime?.time?.text,
                        stops: t.stopCount,
                      };
                    }
                    const instruction = (s.navigationInstruction?.instructions ?? "").replace(/\.?\s*\n\s*/g, ". ");
                    return { instruction, meters: s.distanceMeters };
                  }),
                )
              : undefined,
        })),
      };
    },
  },
  {
    name: "distance_matrix",
    description:
      "Travel distance and time from each origin to each destination (up to 100 pairs). Useful to find the closest option or compare locations.",
    inputSchema: {
      type: "object",
      properties: {
        origins: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 25 },
        destinations: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 25 },
        mode: MODE,
        departure_time: { type: "string", description: "ISO 8601 future time (DRIVE/TRANSIT)" },
      },
      required: ["origins", "destinations"],
    },
    async run(a) {
      if (a.origins.length * a.destinations.length > 100) throw new Error("Máximo 100 pares origen×destino / Max 100 pairs");
      const mode = a.mode ?? "DRIVE";
      const body = {
        origins: a.origins.map((o) => ({ waypoint: toWaypoint(o) })),
        destinations: a.destinations.map((d) => ({ waypoint: toWaypoint(d) })),
        travelMode: mode,
      };
      if (mode === "DRIVE" || mode === "TWO_WHEELER") body.routingPreference = "TRAFFIC_AWARE";
      if (a.departure_time) body.departureTime = new Date(a.departure_time).toISOString();
      const data = await googlePost(
        "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix",
        "originIndex,destinationIndex,distanceMeters,duration,condition,status",
        body,
      );
      const rows = (Array.isArray(data) ? data : []).map((el) => ({
        origin: a.origins[el.originIndex ?? 0],
        destination: a.destinations[el.destinationIndex ?? 0],
        reachable: el.condition === "ROUTE_EXISTS" && !el.status?.code,
        distance_km: km(el.distanceMeters),
        duration_min: minutes(el.duration),
      }));
      rows.sort((x, y) => (x.duration_min ?? Infinity) - (y.duration_min ?? Infinity));
      return { mode, results: rows };
    },
  },
  {
    name: "maps_link",
    description:
      "Build a Google Maps link that opens a search, a place or turn-by-turn navigation directly in the Google Maps app (or website). Needs no API key.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["search", "directions"], description: "Default search" },
        query: { type: "string", description: "For search: text or address" },
        place_id: { type: "string", description: "For search: open this exact place" },
        origin: { type: "string", description: "For directions: omit to use the user's current location" },
        destination: { type: "string" },
        waypoints: { type: "array", items: { type: "string" } },
        mode: MODE,
      },
    },
    async run(a) {
      return { url: mapsLink(a) };
    },
  },
];

// ---------------------------------------------------------------------------
// MCP over stdio (newline-delimited JSON-RPC 2.0)
// ---------------------------------------------------------------------------

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

async function handle(msg) {
  const { id, method, params } = msg;
  const reply = (result) => send({ jsonrpc: "2.0", id, result });
  const fail = (code, message) => send({ jsonrpc: "2.0", id, error: { code, message } });

  if (id === undefined) return; // notification (e.g. notifications/initialized)
  switch (method) {
    case "initialize":
      return reply({
        protocolVersion: params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "google-maps", version: VERSION },
        instructions:
          "Google Maps tools. Prefer search_places to find businesses, place_details for hours/phone/reviews, place_photos for pictures, " +
          "directions for routes (it returns an open_in_google_maps link to share), distance_matrix to compare many places.",
      });
    case "ping":
      return reply({});
    case "tools/list":
      return reply({
        tools: TOOLS.map(({ name, description, inputSchema }) => ({
          name,
          description,
          inputSchema,
          annotations: { readOnlyHint: true, openWorldHint: true },
        })),
      });
    case "tools/call": {
      const tool = TOOLS.find((t) => t.name === params?.name);
      if (!tool) return fail(-32602, `Unknown tool: ${params?.name}`);
      const args = params.arguments ?? {};
      const missing = (tool.inputSchema.required ?? []).filter((k) => args[k] === undefined || args[k] === "");
      try {
        if (missing.length) throw new Error(`Faltan parámetros / Missing arguments: ${missing.join(", ")}`);
        const result = await tool.run(args);
        const content = tool.returnsContent ? result : [{ type: "text", text: JSON.stringify(result, null, 2) }];
        return reply({ content });
      } catch (err) {
        return reply({ isError: true, content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }] });
      }
    }
    default:
      return fail(-32601, `Method not found: ${method}`);
  }
}

createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
  }
  handle(msg).catch((err) => send({ jsonrpc: "2.0", id: msg.id ?? null, error: { code: -32603, message: String(err) } }));
});
