---
name: google-maps
description: Use Google Maps from Claude Code. Use when the user asks to find places or businesses, check opening hours, phone numbers or reviews, get coordinates or an address, plan a route or trip, compare travel times or distances, or open something in the Google Maps app.
---

# Google Maps

The `google-maps` MCP server of this plugin gives you these tools:

- `search_places`: find businesses or landmarks by free text, optionally `near` an address or `lat,lng`. Filters: `open_now`, `min_rating`, `max_results`.
- `place_details`: hours, phone, website, editorial summary and latest reviews for a `place_id`.
- `geocode`: address to coordinates, or `lat,lng` to address.
- `directions`: route between two points, with live traffic when driving, public transport lines with `TRANSIT`, waypoints, avoid tolls/highways/ferries and alternatives. It returns `open_in_google_maps`.
- `distance_matrix`: time and distance from several origins to several destinations, sorted by time.
- `maps_link`: a link that opens a search or navigation in the Google Maps app. It needs no API key.

## How to use them

1. Search first, then fetch details only for the places the user cares about, since `place_details` costs more per call.
2. To answer "which one is closest", run `search_places` and then `distance_matrix` from the user's location to the results.
3. Whenever you give a route or a place, include the Google Maps link (`open_in_google_maps`, `google_maps` or `maps_link`) so the user can open it on their phone.
4. Origins and destinations accept an address, a place name, `lat,lng` or `place_id:<id>`.
5. Answer in the user's language and round times and distances.

## When a tool fails

- If the error says `GOOGLE_MAPS_API_KEY` is missing, tell the user to run `/plugin`, open `google-maps` and set the key, then `/reload-plugins`. A key comes from https://console.cloud.google.com/google/maps-apis/credentials with Places API (New), Routes API and Geocoding API enabled.
- If Google says an API is not enabled or the key is restricted, name the API from the error so the user can enable it in Google Cloud Console.
- `maps_link` still works without a key, so offer it as a fallback.
