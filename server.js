// server.js — lightweight Node backend
const express    = require('express');
const bodyParser = require('body-parser');
const cors       = require('cors');
const path       = require('path');
const fetch      = require('node-fetch');

const app  = express();
const PORT = 3000;

// Your TomTom API key — keep it server-side only, never expose to the browser
const TOMTOM_KEY = "3K9kSnXBJGDJ0VzpJr82wjoZR5oLKNpW";

app.use(cors());
app.use(bodyParser.json());

// Serve your index.html and static assets from the same folder
app.use(express.static(path.join(__dirname)));


// ---------------------
// POST /optimize
// Body: { traffic, waste, water }
// Returns city improvement suggestions based on current slider values.
// Called by simulateEvent() in the frontend.
// ---------------------
app.post('/optimize', (req, res) => {
  const { traffic, waste, water } = req.body;

  if (traffic === undefined || waste === undefined || water === undefined) {
    return res.status(400).json({ error: "Missing required fields: traffic, waste, water" });
  }

  const suggestions = [];

  if (traffic > 70)  suggestions.push("🚗 Very high traffic — optimise signal timings or introduce a congestion charge.");
  else if (traffic > 50) suggestions.push("🚦 Moderate traffic — consider dedicated bus lanes.");

  if (waste > 70)    suggestions.push("🗑️ High waste levels — dispatch extra collection trucks.");
  else if (waste > 50) suggestions.push("♻️ Waste rising — review collection schedules.");

  if (water > 70)    suggestions.push("💧 Severe water shortage risk — restrict non-essential usage immediately.");
  else if (water > 50) suggestions.push("🌊 Water usage elevated — encourage conservation.");

  if (suggestions.length === 0) {
    suggestions.push("✅ City is stable. No immediate action needed.");
  }

  res.json({ suggestions });
});


// ---------------------
// POST /reportIssue
// Body: { type, desc, lat, lng }
// Persists a citizen report in memory and returns it with an ID.
// Called by submitReport() in the frontend.
// ---------------------
const issues = [];

app.post('/reportIssue', (req, res) => {
  const { type, desc, lat, lng } = req.body;

  if (!type || !desc) {
    return res.status(400).json({ error: "Missing required fields: type, desc" });
  }

  const issue = {
    id:   issues.length + 1,
    type,
    desc,
    lat:  lat  ?? null,
    lng:  lng  ?? null,
    time: new Date().toISOString()
  };

  issues.push(issue);
  res.json(issue);
});

// Optional: GET /issues — retrieve all reports (useful for debugging or a future admin view)
app.get('/issues', (req, res) => {
  res.json(issues);
});


// ---------------------
// GET /getTraffic
// FIXED: now calls TomTom directly instead of a placeholder URL.
// Query params: lat, lon
// Called by fetchLiveTraffic() — NOTE: the frontend now calls backend.py /tomtom-traffic
// instead, so this route is kept for completeness but is no longer the primary path.
// ---------------------
app.get('/getTraffic', async (req, res) => {
  const { lat, lon } = req.query;

  if (!lat || !lon) {
    return res.status(400).json({ error: "lat and lon query params required" });
  }

  try {
    const url = `https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json?point=${lat},${lon}&key=${TOMTOM_KEY}`;
    const response = await fetch(url);

    if (!response.ok) {
      return res.status(502).json({ error: `TomTom returned ${response.status}` });
    }

    const data = await response.json();
    res.json(data);

  } catch (err) {
    console.error('Traffic fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch traffic data' });
  }
});


// ---------------------
// GET /getTrafficHeatmap
// Builds a 3×3 grid of TomTom traffic intensity points around a lat/lon.
// Query params: lat, lon
// Called by updateHeatmap() in the frontend.
// ---------------------
app.get('/getTrafficHeatmap', async (req, res) => {
  const { lat, lon } = req.query;

  if (!lat || !lon) {
    return res.status(400).json({ error: "lat and lon required" });
  }

  try {
    const centerLat = parseFloat(lat);
    const centerLon = parseFloat(lon);
    const delta     = 0.0015; // ~150 m grid spacing
    const steps     = [-delta, 0, delta];
    const points    = [];

    for (const dlat of steps) {
      for (const dlon of steps) {
        const pLat = centerLat + dlat;
        const pLon = centerLon + dlon;
        const url  = `https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json?point=${pLat},${pLon}&key=${TOMTOM_KEY}`;

        try {
          const response = await fetch(url);
          const data     = await response.json();

          let intensity = 0.5; // default: free-flowing
          if (data.flowSegmentData) {
            const free    = data.flowSegmentData.freeFlowSpeed || 50;
            const current = data.flowSegmentData.currentSpeed  || free;
            intensity = Math.min(Math.max(free / current, 0.5), 3.0);
          }

          points.push({ lat: pLat, lon: pLon, intensity });

        } catch (pointErr) {
          console.error(`Failed point (${pLat}, ${pLon}):`, pointErr.message);
          // Push a neutral point so the grid stays complete
          points.push({ lat: pLat, lon: pLon, intensity: 0.5 });
        }
      }
    }

    res.json({ points });

  } catch (err) {
    console.error('Heatmap error:', err);
    res.status(500).json({ error: 'Failed to fetch heatmap points' });
  }
});


// ---------------------
// Start server
// ---------------------
app.listen(PORT, () => {
  console.log(`✅ server.js running at http://localhost:${PORT}`);
});
