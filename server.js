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
// ===========================================================================
// GEMINI API CONFIGURATION (server-side only — never exposed to browser)
// ===========================================================================
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_PRIMARY_MODEL = 'gemini-3.6-flash';
const GEMINI_FALLBACK_MODELS = ['gemini-3.8-flash', 'gemini-1.5-flash'];

// Strict System Prompt (Enforces 2-3 short sentences, bite-sized, no long paragraphs)
const GEMINI_SYSTEM_INSTRUCTION =
  'You are MediBuddy Rx, a medical assistant. You must answer questions in a maximum of 2 to 3 short sentences. Keep it extremely concise, bite-sized, and easy to read in a small chat widget. Never write long paragraphs or essays.\n\n' +
  'Clinical Guidelines:\n' +
  '1. Bioequivalence: Explain that certified Indian generic formulations match the Reference Listed Drug (RLD) within CDSCO 80%–125% 90% confidence interval for Cmax and AUC with identical clinical efficacy.\n' +
  '2. Cost Savings: Highlight that generics offer 60%–85% savings in Indian Rupees (₹) due to expired patents.\n' +
  '3. Safety: Always advise consulting a qualified physician or pharmacist before modifying prescriptions. Never prescribe or diagnose.';

// Rate limiter: max 30 requests per IP per minute
const rateLimitMap = new Map();
function chatRateLimit(req, res, next) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + 60_000 });
    return next();
  }
  if (entry.count >= 30) {
    return res.status(429).json({ error: 'Too many requests. Please wait a minute and try again.' });
  }
  entry.count++;
  next();
}


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

/**
 * GET /api/chat-status
 * Returns whether the Gemini API key is configured server-side.
 * The key value is NEVER exposed in the response.
 */
app.get('/api/chat-status', (req, res) => {
  res.json({ configured: Boolean(GEMINI_API_KEY) });
});

/**
 * POST /api/chat
 * Secure server-side proxy to Google Gemini API.
 * Injects strict system instruction and generationConfig (maxOutputTokens: 250, temperature: 0.3)
 */
app.post('/api/chat', chatRateLimit, async (req, res) => {
  const { history, message } = req.body || {};

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ error: 'Missing or invalid message field.' });
  }
  if (message.length > 4000) {
    return res.status(400).json({ error: 'Message too long (max 4000 characters).' });
  }

  // Sanitise and cap conversation history to last 16 turns
  let safeHistory = [];
  if (Array.isArray(history)) {
    safeHistory = history
      .filter(t => t && (t.role === 'user' || t.role === 'model') && Array.isArray(t.parts))
      .slice(-16)
      .map(t => ({ role: t.role, parts: t.parts.map(p => ({ text: String(p.text || '').slice(0, 4000) })) }));
  }

  // Ensure contents has at least the latest user query so Gemini API never receives empty contents
  if (safeHistory.length === 0 && message) {
    safeHistory = [{ role: 'user', parts: [{ text: message }] }];
  }

  // Strict Payload with generationConfig: maxOutputTokens: 250, temperature: 0.3
  const payload = {
    system_instruction: { parts: [{ text: GEMINI_SYSTEM_INSTRUCTION }] },
    contents: safeHistory,
    generationConfig: {
      temperature: 0.3,
      topK: 40,
      topP: 0.95,
      maxOutputTokens: 250,
      thinkingConfig: {
        thinkingBudget: 0
      }
    }
  };

  const modelsToTry = [GEMINI_PRIMARY_MODEL, ...GEMINI_FALLBACK_MODELS];
  let lastError = null;

  for (const model of modelsToTry) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent` +
                  `?key=${encodeURIComponent(GEMINI_API_KEY)}`;

      let responseText;
      if (typeof fetch === 'function') {
        const geminiRes = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        responseText = await geminiRes.text();
        if (!geminiRes.ok) {
          let errMsg = `HTTP ${geminiRes.status}`;
          try {
            const parsed = JSON.parse(responseText);
            errMsg = parsed?.error?.message || errMsg;
          } catch (e) {}
          if (geminiRes.status === 404 || geminiRes.status === 503) {
            lastError = new Error(errMsg);
            continue;
          }
          return res.status(geminiRes.status).json({ error: errMsg });
        }
      } else {
        responseText = await new Promise((resolve, reject) => {
          const https = require('https');
          const urlObj = new URL(url);
          const postData = JSON.stringify(payload);
          const options = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(postData)
            }
          };
          const req2 = https.request(options, (r) => {
            let data = '';
            r.on('data', chunk => data += chunk);
            r.on('end', () => resolve({ status: r.statusCode, body: data }));
          });
          req2.on('error', reject);
          req2.write(postData);
          req2.end();
        });
        if (typeof responseText === 'object') {
          const { status, body } = responseText;
          responseText = body;
          if (status === 404 || status === 503) {
            lastError = new Error(`HTTP ${status}`);
            continue;
          }
          if (status >= 400) {
            let errMsg = `HTTP ${status}`;
            try {
              const parsed = JSON.parse(body);
              errMsg = parsed?.error?.message || errMsg;
            } catch (e) {}
            return res.status(status).json({ error: errMsg });
          }
        }
      }

      const data = JSON.parse(responseText);
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        return res.status(502).json({ error: 'Empty response from Gemini API.' });
      }

      return res.json({ text });
    } catch (err) {
      lastError = err;
      console.warn(`[MediBuddy] Gemini model ${model} failed:`, err.message);
    }
  }

  const msg = lastError?.message || 'Unable to reach Gemini API.';
  console.error('[MediBuddy] All Gemini models exhausted:', msg);
  return res.status(502).json({ error: msg });
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
