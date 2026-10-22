# Google Maps para Claude Code

Plugin que conecta Claude Code con Google Maps: buscar sitios, ver horarios, teléfono y reseñas, calcular rutas con tráfico o transporte público, comparar distancias y abrir el resultado directamente en la app de Google Maps.

Solo necesita **Node.js 18 o superior**. No hay que ejecutar `npm install`.

## Instalación

1. Consigue una clave en [Google Cloud Console](https://console.cloud.google.com/google/maps-apis/credentials) y activa **Places API (New)**, **Routes API** y **Geocoding API**.
2. En Claude Code:

```
/plugin marketplace add Pumpidunki/google-maps-plugin
/plugin install google-maps@google-maps-tools
```

   Para probarlo desde una carpeta local: `/plugin marketplace add C:\ruta\a\google-maps-plugin`.
3. Claude Code te pedirá la clave al activar el plugin y la guarda en el almacén seguro del sistema. Ejecuta `/reload-plugins` o abre una sesión nueva.

## Herramientas

| Herramienta | Para qué sirve |
| --- | --- |
| `search_places` | Buscar negocios o lugares, opcionalmente cerca de un punto |
| `place_details` | Horarios, teléfono, web, valoración y últimas reseñas |
| `geocode` | Pasar de dirección a coordenadas y al revés |
| `directions` | Ruta en coche (con tráfico), a pie, en bici, en moto o en transporte público, con enlace para abrirla en la app |
| `distance_matrix` | Tiempos y distancias de varios orígenes a varios destinos |
| `maps_link` | Enlace que abre una búsqueda o una navegación en la app de Google Maps (no usa la clave) |

Ejemplos: *"Busca farmacias abiertas cerca de la Playa de San Juan"*, *"¿Cuánto tardo en coche de Alicante a Valencia a las 8:00 del lunes?"*, *"Dame el enlace para ir andando al Castillo de Santa Bárbara"*.

## Sin plugin (solo el conector MCP)

```bash
claude mcp add google-maps -e GOOGLE_MAPS_API_KEY=TU_CLAVE -- node /ruta/google-maps-plugin/plugins/google-maps/server/index.mjs
```

---

## English

Google Maps plugin for Claude Code. It needs Node.js 18+ and a Google Maps Platform key with Places API (New), Routes API and Geocoding API enabled. Install it with `/plugin marketplace add Pumpidunki/google-maps-plugin`, then `/plugin install google-maps@google-maps-tools`. Claude Code prompts for the key and stores it in secure storage. The tools are the six listed above.

Google bills usage to your own key; check [pricing](https://mapsplatform.google.com/pricing/).
