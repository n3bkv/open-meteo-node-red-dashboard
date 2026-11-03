# Open-Meteo Weather Command Center for Node-RED

A configurable, **location-independent weather dashboard for Node-RED Dashboard 1.0**, using public Open-Meteo weather, air-quality and historical-weather APIs. No personal weather station or station API token is required.

> **Important:** This dashboard shows **modeled and reanalysis estimates**, not actual observations collected by a physical weather station. Do not use the data as a substitute for official warnings or emergency information.

## Screens and features

The **WX · Overview** tab is a compact, responsive weather command center. The other tabs expose detailed time-series plots and manual controls.

| Tab | Contents |
| --- | --- |
| **Overview** | Current modeled conditions, temperature, wind, solar/UV, AQI, 12 atmospheric tiles, threshold-based insights, seven-day outlook, detailed hourly forecast, air pollutants, 30/60-day climate summary, API diagnostics |
| **Trends** | Temperature/feels-like/dew point, humidity, pressure, wind/gusts, hourly precipitation, probability of precipitation, UV, solar radiation, vapor-pressure deficit, soil temperature |
| **Forecast** | Daily modeled highs/lows and precipitation charts |
| **Air Quality** | U.S. AQI and particulate matter (PM2.5/PM10) charts |
| **Climate** | Archived temperature, rainfall, and wind-gust trends |
| **Diagnostics** | Manual refresh buttons for weather, air quality, and historical archive |

The flow includes **17 detailed charts**, heating and cooling degree-day estimates (65°F base), rule-based weather indicators, a 36-hour hourly table, sunrise/sunset times, and last-successful-response fallback if an API request fails.

## Requirements

- [Node-RED](https://nodered.org/) with network access to Open-Meteo HTTPS endpoints.
- **`node-red-dashboard` 3.6.6** (the original, Angular-based **Dashboard 1.0** package).
- Modern Node.js supported by the installed Node-RED version.
- No API key needed for ordinary non-commercial public API usage, subject to [Open-Meteo terms](https://open-meteo.com/en/terms). Commercial/production use may require an appropriate plan or API arrangement.

**Not compatible as-is with FlowFuse Dashboard 2.0 (`@flowfuse/node-red-dashboard`).** The UI uses classic `ui_tab`, `ui_group`, `ui_chart`, and Angular `ui_template` nodes.

**Maintenance note:** Dashboard 1.0 has been deprecated upstream since June 2024. This project intentionally targets Dashboard 1.0 for existing installations; a Dashboard 2.0 port would require UI changes.

## Quick start

1. Install Dashboard 1.0 if needed, from the Node-RED user directory:

   ```bash
   cd ~/.node-red
   npm install node-red-dashboard@3.6.6
   ```

   Restart Node-RED after installing a new node package.

2. In the Node-RED editor, choose **Menu → Import → select `flows.json` → Import**. Select a new flow/tab or a suitable workspace and verify the imported nodes.
3. Double-click **`CONFIG | location & Open-Meteo APIs`**, change its sample `DEFAULTS` to your desired location, and click **Done**. Alternatively, supply environment variables as shown below.
4. Click **Deploy**. The three inject nodes fetch data on startup (staggered) and then periodically.
5. Open your Dashboard 1.0 URL, usually **`http://YOUR-NODE-RED-HOST:1880/ui`** (the path is configurable in Node-RED settings).

> The exported example initially displays **New York City**, not the author's home coordinates. **Configure your own location before relying on the dashboard.**

## Location configuration

The **single source of configuration** is the `CONFIG | location & Open-Meteo APIs` function. It includes editable defaults:

```javascript
const DEFAULTS = {
    latitude: 40.7128,
    longitude: -74.0060,
    timezone: 'America/New_York',
    label: 'Example: New York City (configure your location)'
};
```


**Units:** This version uses **°F, mph, inches, inHg, and U.S. AQI** throughout the queries, calculations, and UI. Do not change API units independently without updating those UI labels and formulas. The timezone controls displayed timestamps in the command center; classic `ui_chart` may render its X-axis in the **viewer's browser timezone** rather than the configured weather timezone.

When the coordinates or timezone change, the configuration function clears previously cached weather/air/archive responses to avoid mixing data from two locations. Redeploy or trigger each refresh source after editing the location. Changing only `WX_LABEL` changes the heading.

## Refresh intervals

| Feed | API | Default refresh | History / forecast |
| --- | --- | --- | --- |
| Weather | `api.open-meteo.com` | Every **10 minutes** | Last 7 days plus next 7 days of modeled conditions |
| Air quality | `air-quality-api.open-meteo.com` | Every **30 minutes** | 2 previous days and 3 forecast days |
| Historical reanalysis | `archive-api.open-meteo.com` | Every **6 hours** | 60 archived days, intentionally ending 8 days before today |

The flows make three outgoing HTTPS GET requests; API data is saved to **Node-RED flow context** as `wx_forecast`, `wx_air`, and `wx_archive`, with request diagnostics in `wx_diag` and location metadata in `wx_config`. The default Node-RED memory context does not survive a process restart. If persistent context storage is enabled globally, these values may be persisted according to your Node-RED settings.

The archive is **not** joined seamlessly with recent model data, because historical reanalysis and forecast-model estimates are not the same dataset. A missing archive is shown as unavailable until fetched.

## Flow architecture

```text
Refresh forecast (10m) ──┐
Refresh AQI (30m) ───────┼─> CONFIG (location / URL builder)
Refresh archive (6h) ────┘         │
                                   ├─> HTTP forecast ─┐
                                   ├─> HTTP AQI ──────┼─> Store + diagnostics
                                   └─> HTTP archive ──┘           │
                           Catch HTTP errors ────────────────────┤
                                                                ▼
                                                    Compute weather analytics
                                                        │               │
                                                 Overview UI       Chart router
                                                                        │
                                                            17 separate ui_chart nodes
```

**Chart router ordering matters.** Each of its 17 outputs is now wired **1:1** to the matching chart. The original source flow had an empty first output, shifting chart assignments and disconnecting the final graph.

The HTTP catch handler maps the **actual imported HTTP node IDs**, fixing an older, stale-ID mapping. A failed request retains the last successfully fetched data for that feed, displays an error in diagnostics, and does not overwrite cached data with malformed responses.

## Data definitions and caveats

- **Current weather / 'rain today':** derived from Open-Meteo model data. This is **not** a measured rain-gauge total; it can disagree with nearby weather stations, especially during localized showers.
- **UV, soil moisture, wind, AQI, and pollution:** model-derived variables; they may not reflect microclimates or a particular street or garden.
- **Heating/cooling degree days:** daily mean relative to a **65°F** base, not household energy consumption. Historical metrics use available archived days; the seven-day indicator uses the prior seven modeled days.
- **Wet-bulb:** an approximation derived from temperature and relative humidity, not a sensor observation.
- **Alerts:** the dashboard's heat, rain, wind, UV and AQI notices are simple numeric rules **and are not National Weather Service alerts or warnings**.
- **Time:** daily Unix timestamps are interpreted using the timezone offset returned by Open-Meteo for daily boundaries; runtime hour/date formatting uses the configured IANA timezone. Daylight-saving transitions can require particular care in comparisons.
- **Source/data availability:** variable coverage, historical lag and API availability depend on Open-Meteo's models and policies; data may be null for some locations or times.

See the official [Weather API](https://open-meteo.com/en/docs), [Air Quality API](https://open-meteo.com/en/docs/air-quality-api), and [Historical Weather API](https://open-meteo.com/en/docs/historical-weather-api) documentation.

## Troubleshooting

**No widgets / missing node types:** Confirm you have installed **`node-red-dashboard`**, not only Dashboard 2.0. Restart Node-RED and redeploy.

**Blank screen after first deploy:** The Overview requires a valid forecast response before rendering. Verify that `api.open-meteo.com` is reachable and use the Debug sidebar and **WX · Diagnostics**; the forecast inject fires on startup.

**API errors / 400:** Confirm decimal latitude/longitude and an IANA timezone in the `CONFIG` function or environment. Open-Meteo sometimes adjusts supported variable combinations; inspect the error reason in diagnostics.

**Weather differs from your station:** This is expected: Open-Meteo estimates conditions over model grid cells, not from physical weather sensor.

**Charts blank or mislabeled:** Verify you imported the provided `flows.json` without manually shifting the router outputs. The check script below validates all 17 wires.

**Data seems stale:** Check `WX · Overview` → **Diagnostics & data attribution**, manual refresh buttons on **WX · Diagnostics**, and network/DNS connectivity. Error handling intentionally keeps the last good response.

**Charts show another timezone:** Dashboard 1.0 charts commonly use the **browser's timezone** for axis labels; use a browser configured to the desired timezone or customize chart presentation.

## Validate the exported flow

With Node.js installed, run the included structural and functional checks **without requiring a running Node-RED server**:

```bash
node tests/validate-flow.js
```

This checks node references, config URLs, timezone/location overrides, error mapping and one-to-one chart routing. It cannot verify live API responses or Dashboard rendering; test those after import.

## Repository layout

```text
.
├── flows.json               # Import into Node-RED
├── README.md                # This guide
├── LICENSE                  # MIT License
├── .gitignore               # Local files to exclude from Git
└── tests/
    └── validate-flow.js     # Local, no-dependency checks
```

## License and attribution


This project is open-source software licensed under the [MIT License](LICENSE).

Copyright (c) 2026 David Ginsberg. See [LICENSE](LICENSE) for the complete license terms.

The software is provided "AS IS", without warranty of any kind, express or implied.


Open-Meteo provides the weather, air-quality and historical model data. Follow its [terms of service](https://open-meteo.com/en/terms), usage restrictions, and attribution requirements, including any requirements applying to commercial access.

## Support This Project
If you find this useful, star ⭐ the repo! It helps others discover it.

## More Info
Blog: https://hamradiohacks.blogspot.com

GitHub: https://github.com/n3bkv