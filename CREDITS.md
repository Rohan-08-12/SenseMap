# Credits & Attributions

SenseMap is built on the shoulders of many excellent open-source projects, data providers, and services. This file documents all third-party resources used and their applicable licenses.

---

## Data Sources

### OpenStreetMap
**License:** [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/)  
**Attribution required:** © OpenStreetMap contributors  
Location data for Toronto is seeded from OpenStreetMap via the Overpass API. Under the ODbL, any public use of this data must credit OpenStreetMap contributors. SenseMap displays this attribution in the map footer via Mapbox's built-in attribution control.

### Open-Meteo
**License:** [Creative Commons Attribution 4.0 (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/)  
**URL:** https://open-meteo.com  
Real-time weather data (temperature, weather code) shown in location detail panels is sourced from the Open-Meteo API — a free, open-source weather API with no API key required.

### Ontario 511 API
**Provider:** Ontario Ministry of Transportation (Government of Ontario)  
**URL:** https://511on.ca  
Construction project data used for the nearby construction chip is sourced from the Ontario 511 open data API. Government of Ontario open data is available under the [Open Government Licence – Ontario](https://www.ontario.ca/page/open-government-licence-ontario).

---

## Frontend Libraries

| Library | License | Author / Organization |
|---|---|---|
| [React](https://react.dev) | MIT | Meta Platforms |
| [React DOM](https://react.dev) | MIT | Meta Platforms |
| [React Router](https://reactrouter.com) | MIT | Remix Software |
| [Vite](https://vitejs.dev) | MIT | Evan You & contributors |
| [Mapbox GL JS](https://docs.mapbox.com/mapbox-gl-js/) | [Mapbox ToS](https://www.mapbox.com/legal/tos) | Mapbox |
| [react-map-gl](https://visgl.github.io/react-map-gl/) | MIT | Vis.gl / Urban Computing Foundation |
| [deck.gl](https://deck.gl) | MIT | Vis.gl / Urban Computing Foundation |
| [Framer Motion](https://www.framer.com/motion/) | MIT | Framer |
| [Recharts](https://recharts.org) | MIT | Recharts Group |
| [Axios](https://axios-http.com) | MIT | Matt Zabriskie & contributors |
| [@auth0/auth0-react](https://github.com/auth0/auth0-react) | MIT | Auth0 |

---

## Backend Libraries

| Library | License | Author / Organization |
|---|---|---|
| [Express](https://expressjs.com) | MIT | TJ Holowaychuk & OpenJS Foundation |
| [Prisma](https://www.prisma.io) | Apache 2.0 | Prisma Data |
| [pg (node-postgres)](https://node-postgres.com) | MIT | Brian Carlson |
| [Helmet](https://helmetjs.github.io) | MIT | Adam Baldwin & contributors |
| [cors](https://github.com/expressjs/cors) | MIT | Troy Goode |
| [express-rate-limit](https://github.com/express-rate-limit/express-rate-limit) | MIT | Nathan Friedly & contributors |
| [express-oauth2-jwt-bearer](https://github.com/auth0/node-oauth2-jwt-bearer) | MIT | Auth0 |
| [Multer](https://github.com/expressjs/multer) | MIT | Hage Yaapa & contributors |
| [dotenv](https://github.com/motdotla/dotenv) | BSD-2-Clause | Scott Motte & contributors |
| [file-type](https://github.com/sindresorhus/file-type) | MIT | Sindre Sorhus |
| [nodemon](https://nodemon.io) | MIT | Remy Sharp |
| [@google/generative-ai](https://github.com/google-gemini/generative-ai-js) | Apache 2.0 | Google LLC |

---

## Services & APIs

| Service | Role | Terms |
|---|---|---|
| [Mapbox](https://www.mapbox.com) | Base map tiles, traffic layer, geocoding | [Mapbox ToS](https://www.mapbox.com/legal/tos) |
| [Google Gemini](https://deepmind.google/technologies/gemini/) | AI-generated sensory insights from reviews | [Google AI ToS](https://ai.google.dev/terms) |
| [Google Places API](https://developers.google.com/maps/documentation/places/web-service) | Location enrichment, photos, hours | [Google Maps Platform ToS](https://cloud.google.com/maps-platform/terms) |
| [Auth0](https://auth0.com) | User authentication & JWT management | [Auth0 ToS](https://auth0.com/legal/terms-of-service) |
| [Cloudinary](https://cloudinary.com) | Location image hosting & optimization | [Cloudinary ToS](https://cloudinary.com/tos) |
| [Supabase](https://supabase.com) | Managed PostgreSQL database | [Supabase ToS](https://supabase.com/terms) |

---

## Map Attribution

Mapbox GL JS and OpenStreetMap attribution are displayed directly within the map UI as required by their respective terms of service. The Mapbox logo and "© Mapbox © OpenStreetMap contributors" text must remain visible and must not be hidden or obscured.

---

## License

SenseMap's own source code is proprietary. All third-party code, data, and assets remain under their respective licenses as listed above.
