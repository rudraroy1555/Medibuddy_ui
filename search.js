/**
 * ==============================================================================
 * MEDIBUDDY SEARCH MODULE (search.js)
 * High-performance in-memory search engine with bounded memoization and sorting.
 * ==============================================================================
 */

import { cdscoData, pricingData, isLocalDbReady } from './data.js';

// Search Cache (Memoization) with Bounded FIFO Eviction
export const searchCache = Object.create(null);
export const MAX_SEARCH_CACHE_ENTRIES = 300;
const searchCacheKeys = [];

/**
 * Searches across both in-memory datasets simultaneously.
 * File 1 (cdscoData): searches clean_generic_api and drug_name
 * File 2 (pricingData): searches Brand Name, Generic Name, and Cheaper Alternative Brand
 *
 * @param {string} query - Raw search query
 * @returns {{ officialAPIs: Array<object>, priceAlternatives: Array<object> }}
 */
export function searchMaster(query) {
    const cleanQuery = (typeof query === 'string' ? query : String(query || '')).trim().toLowerCase();

    if (!cleanQuery) {
        return { officialAPIs: [], priceAlternatives: [] };
    }

    // 1. Memoization (Cache Hit): Instantly return cached result without scanning datasets
    if (searchCache[cleanQuery]) {
        return searchCache[cleanQuery];
    }

    // 2. Search File 1: CDSCO official drug database using pre-computed searchIndex
    const officialAPIs = cdscoData.filter(item => item._searchIndex.includes(cleanQuery));

    // 3. Search File 2: 150 Prescribed Drugs Alternatives using pre-computed searchIndex
    const priceAlternatives = pricingData.filter(item => item._searchIndex.includes(cleanQuery));

    const results = {
        officialAPIs,
        priceAlternatives
    };

    // 4. Memoize: save computed result array to searchCache with bounded FIFO eviction
    if (searchCacheKeys.length >= MAX_SEARCH_CACHE_ENTRIES) {
        const oldestKey = searchCacheKeys.shift();
        delete searchCache[oldestKey];
    }
    searchCache[cleanQuery] = results;
    searchCacheKeys.push(cleanQuery);

    return results;
}

/**
 * Sorts price alternatives by relevance, price-asc, or savings-desc
 * @param {Array<object>} items
 * @param {string} sortMode
 * @returns {Array<object>}
 */
export function sortResults(items, sortMode = 'relevance') {
    const sorted = [...items];

    if (sortMode === 'price-asc') {
        sorted.sort((a, b) => {
            const priceA = Math.max(0, Number(a.cheaper_price) || 0);
            const priceB = Math.max(0, Number(b.cheaper_price) || 0);
            if (priceA !== priceB) return priceA - priceB;
            const savA = Math.max(0, (Number(a.standard_price) || 0) - priceA);
            const savB = Math.max(0, (Number(b.standard_price) || 0) - priceB);
            return savB - savA;
        });
    } else if (sortMode === 'savings-desc') {
        sorted.sort((a, b) => {
            const priceA = Math.max(0, Number(a.cheaper_price) || 0);
            const priceB = Math.max(0, Number(b.cheaper_price) || 0);
            const stdA = Math.max(0, Number(a.standard_price) || 0);
            const stdB = Math.max(0, Number(b.standard_price) || 0);
            const savA = Math.max(0, stdA - priceA);
            const savB = Math.max(0, stdB - priceB);
            if (savB !== savA) return savB - savA;
            return priceA - priceB;
        });
    }

    return sorted;
}

/**
 * Performance QA Benchmark Utility
 * Measures raw dataset filtering time, DOM injection time, and paint latency.
 *
 * @param {string} query
 * @param {object} [options={}]
 * @param {Function} [renderCallback=null]
 * @returns {Promise<object>}
 */
export async function benchmarkSearch(query = 'Paracetamol', options = {}, renderCallback = null) {
    const { bypassCache = false, logTable = true } = options;
    const cleanQuery = (typeof query === 'string' ? query : String(query || '')).trim();

    if (!cleanQuery) {
        console.warn('[Benchmark] Please provide a valid non-empty search query.');
        return null;
    }

    if (!isLocalDbReady) {
        console.warn('[Benchmark] Datasets are still loading. Please wait for initialization.');
        return null;
    }

    const cacheKey = cleanQuery.toLowerCase();
    let cachedBackup = null;
    if (bypassCache && searchCache[cacheKey]) {
        cachedBackup = searchCache[cacheKey];
        delete searchCache[cacheKey];
    }

    console.group(`🔬 [MediBuddy Perf Benchmark] Query: "${cleanQuery}" (bypassCache: ${bypassCache})`);

    // --- Phase 1: Dataset Filtering ---
    console.time('⏱️ Phase 1: Dataset Filtering');
    const t0 = performance.now();
    const isCacheHit = !bypassCache && !!searchCache[cacheKey];
    const searchResults = searchMaster(cleanQuery);
    const t1 = performance.now();
    console.timeEnd('⏱️ Phase 1: Dataset Filtering');
    const filterTimeMs = Number((t1 - t0).toFixed(3));

    if (cachedBackup) {
        searchCache[cacheKey] = cachedBackup;
    }

    // --- Phase 2: DOM Mutation (if callback provided) ---
    let domMutationTimeMs = 0;
    const t2 = performance.now();
    if (typeof renderCallback === 'function') {
        console.time('⏱️ Phase 2: DOM Injection');
        renderCallback(cleanQuery, searchResults);
        console.timeEnd('⏱️ Phase 2: DOM Injection');
    }
    const t3 = performance.now();
    domMutationTimeMs = Number((t3 - t2).toFixed(3));

    // --- Phase 3: Browser Paint / Composite ---
    const { paintTimeMs, totalTimeMs } = await new Promise((resolve) => {
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    const t4 = performance.now();
                    const total = Number((t4 - t0).toFixed(3));
                    const paint = Number((t4 - t3).toFixed(3));
                    resolve({ paintTimeMs: paint, totalTimeMs: total });
                });
            });
        } else {
            const t4 = performance.now();
            resolve({
                paintTimeMs: 0,
                totalTimeMs: Number((t4 - t0).toFixed(3))
            });
        }
    });

    const totalMatches = (searchResults.priceAlternatives?.length || 0) + (searchResults.officialAPIs?.length || 0);

    const report = {
        'Query': cleanQuery,
        'Cache State': isCacheHit ? '🟢 HIT (Memory)' : '🟡 COLD SCAN (20k+ rows)',
        'Filter Time (ms)': `${filterTimeMs} ms`,
        'DOM Injection (ms)': `${domMutationTimeMs} ms`,
        'Paint & Composite (ms)': `${paintTimeMs} ms`,
        'Total Round-Trip (ms)': `${totalTimeMs} ms`,
        'Total Matches Found': totalMatches
    };

    if (logTable) {
        console.table(report);
    }
    console.groupEnd();

    return report;
}
