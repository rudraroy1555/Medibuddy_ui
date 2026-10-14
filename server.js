/**
 * ==============================================================================
 * MEDIBUDDY MEDICINE SEARCH ENGINE - BACKEND API SERVER
 * Built with Node.js & Express.
 * Loads production_drug_database.csv into in-memory array and provides /search.
 * ==============================================================================
 */

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

const app = express();
const PORT = process.env.PORT || 3000;
const CSV_FILE_PATH = path.join(__dirname, 'production_drug_database.csv');

// In-memory cache for all drug records from the CSV
let drugDatabase = [];
let isDatabaseLoaded = false;

// Middleware
app.use(cors()); // Allow cross-origin requests from frontend (Live Server, GitHub Pages, etc.)
app.use(express.json());
app.use(express.static(__dirname)); // Serve frontend static files (index.html, styles.css)

/**
 * Loads and parses production_drug_database.csv into memory using csv-parser.
 * Resolves once stream completes, rejects if file reading fails.
 */
function loadDatabaseFromCSV() {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(CSV_FILE_PATH)) {
      const errorMsg = `Error: Dataset file not found at ${CSV_FILE_PATH}`;
      console.error(errorMsg);
      return reject(new Error(errorMsg));
    }

    const records = [];
    console.log(`Loading dataset from ${CSV_FILE_PATH}...`);

    fs.createReadStream(CSV_FILE_PATH)
      .pipe(csv({
        // Strip BOM and trim keys to prevent column naming mismatches
        mapHeaders: ({ header }) => header.trim().replace(/^\uFEFF/, '')
      }))
      .on('data', (row) => {
        // Normalize record properties according to required schema:
        // s_no, drug_name, indication, approval_date, source_year, clean_generic_api
        const cleanRow = {
          s_no: (row.s_no || '').trim(),
          drug_name: (row.drug_name || '').trim(),
          indication: (row.indication || '').trim(),
          approval_date: (row.approval_date || '').trim(),
          source_year: (row.source_year || '').trim(),
          clean_generic_api: (row.clean_generic_api || '').trim()
        };

        // Only store if at least drug_name or clean_generic_api is non-empty
        if (cleanRow.drug_name || cleanRow.clean_generic_api) {
          records.push(cleanRow);
        }
      })
      .on('end', () => {
        drugDatabase = records;
        isDatabaseLoaded = true;
        console.log(`Successfully loaded ${drugDatabase.length} records into memory.`);
        resolve(drugDatabase);
      })
      .on('error', (err) => {
        console.error('Error parsing CSV file:', err.message);
        isDatabaseLoaded = false;
        reject(err);
      });
  });
}

/**
 * GET /search
 * Query parameter: ?q=... or ?query=...
 * Performs case-insensitive partial match on 'clean_generic_api' and 'drug_name'.
 * Returns up to 10 ranked matching records.
 */
app.get('/search', (req, res) => {
  if (!isDatabaseLoaded) {
    return res.status(503).json({
      error: 'Database is still initializing or unavailable. Please try again shortly.',
      total_results: 0,
      results: []
    });
  }

  // Support both ?q= and ?query= parameters
  const rawQuery = (req.query.q || req.query.query || '').trim();

  if (!rawQuery) {
    return res.status(400).json({
      error: 'Missing search query parameter. Usage: /search?q=lipitor',
      total_results: 0,
      results: []
    });
  }

  const query = rawQuery.toLowerCase();

  // Search and score matches for relevance ranking:
  // 3 points: Exact match on drug_name or generic_api
  // 2 points: Starts with query
  // 1 point: Substring match
  const matches = [];

  for (let i = 0; i < drugDatabase.length; i++) {
    const item = drugDatabase[i];
    const drugName = item.drug_name.toLowerCase();
    const genericApi = item.clean_generic_api.toLowerCase();

    let score = 0;

    if (drugName === query || genericApi === query) {
      score = 3;
    } else if (drugName.startsWith(query) || genericApi.startsWith(query)) {
      score = 2;
    } else if (drugName.includes(query) || genericApi.includes(query)) {
      score = 1;
    }

    if (score > 0) {
      matches.push({
        ...item,
        _score: score
      });
    }
  }

  // Sort by score descending (most relevant first), then limit to 10
  matches.sort((a, b) => b._score - a._score);
  const top10 = matches.slice(0, 10).map(({ _score, ...item }) => item);

  return res.json({
    query: rawQuery,
    total_results: top10.length,
    results: top10
  });
});

/**
 * Health check & status endpoint
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    database_loaded: isDatabaseLoaded,
    records_count: drugDatabase.length,
    timestamp: new Date().toISOString()
  });
});

/**
 * Admin reload endpoint to refresh memory cache when CSV updates
 */
app.post('/reload', async (req, res) => {
  try {
    await loadDatabaseFromCSV();
    res.json({
      message: 'Dataset reloaded successfully into memory.',
      records_count: drugDatabase.length
    });
  } catch (err) {
    res.status(500).json({
      error: 'Failed to reload dataset',
      details: err.message
    });
  }
});

// Boot the server
async function startServer() {
  try {
    await loadDatabaseFromCSV();
  } catch (err) {
    console.warn('Initial CSV load failed. Server will start, but /search will report 503 until dataset is provided.');
  }

  app.listen(PORT, () => {
    console.log(`\n======================================================`);
    console.log(` MediBuddy API Server running at http://localhost:${PORT}`);
    console.log(` Search endpoint: http://localhost:${PORT}/search?q=lipitor`);
    console.log(` Health check:     http://localhost:${PORT}/health`);
    console.log(`======================================================\n`);
  });
}

startServer();
