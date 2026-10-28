/**
 * ==============================================================================
 * MEDIBUDDY DATA MODULE (data.js)
 * Responsible for asynchronous CSV fetching, PapaParse streaming, and in-memory indexing.
 * ==============================================================================
 */

// In-Memory Database Storage
export let cdscoData = [];
export let pricingData = [];
export let isLocalDbReady = false;

/**
 * Escape HTML characters to prevent XSS vulnerabilities
 * @param {string} str
 * @returns {string}
 */
export function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Promisified PapaParse wrapper to load a CSV file asynchronously.
 * Handles network streaming, header whitespace trimming, and BOM sanitization.
 *
 * @param {string} url - Relative URL path to the CSV file
 * @param {object} [customConfig={}] - Optional PapaParse configurations
 * @returns {Promise<Array<object>>}
 */
export function loadCsv(url, customConfig = {}) {
    return new Promise((resolve, reject) => {
        if (typeof window === 'undefined' || typeof window.Papa === 'undefined') {
            return reject(new Error('PapaParse library is missing. Ensure papaparse.min.js is included in your HTML.'));
        }

        window.Papa.parse(url, {
            download: true,
            header: true,
            skipEmptyLines: 'greedy',
            transformHeader: (header) => header.trim().replace(/^\uFEFF/, ''),
            complete: (results) => {
                if (results.errors && results.errors.length > 0 && (!results.data || results.data.length === 0)) {
                    return reject(new Error(`Failed to parse CSV from "${url}": ${results.errors[0]?.message || 'Invalid format'}`));
                }
                resolve(results.data || []);
            },
            error: (error) => {
                reject(new Error(`Failed to load CSV from "${url}": ${error.message || error}`));
            },
            ...customConfig
        });
    });
}

/**
 * Initializes and loads both datasets concurrently using Promise.all so the UI thread does not block.
 * File 1: production_drug_database.csv (CDSCO Regulatory standards)
 * File 2: indian_prescribed_drugs_150.csv (Market brand alternatives & pricing)
 *
 * Pre-computes normalized lowercase search indexes on every row to eliminate runtime string allocation.
 * @returns {Promise<{ cdscoData: Array<object>, pricingData: Array<object> }>}
 */
export async function initializeDatasets() {
    const file1Url = 'production_drug_database.csv';
    const file2Url = 'indian_prescribed_drugs_150.csv';

    try {
        const [rawCdsco, rawPricing] = await Promise.all([
            loadCsv(file1Url),
            loadCsv(file2Url)
        ]);

        if (!rawCdsco || rawCdsco.length === 0) {
            throw new Error('CDSCO regulatory database could not be loaded or returned 0 records.');
        }

        if (!rawPricing || rawPricing.length === 0) {
            throw new Error('Prescription drug pricing database could not be loaded or returned 0 records.');
        }

        // File 1: Clean and pre-index CDSCO regulatory records
        cdscoData = rawCdsco.map((row, index) => {
            const cleanGenericApi = (row.clean_generic_api || '').trim();
            const drugName = (row.drug_name || '').trim();
            const lowerGenericApi = cleanGenericApi.toLowerCase();
            const lowerDrugName = drugName.toLowerCase();

            return {
                s_no: (row.s_no || String(index + 1)).trim(),
                drug_name: drugName,
                indication: (row.indication || '').trim(),
                approval_date: (row.approval_date || '').trim(),
                source_year: (row.source_year || '').trim(),
                clean_generic_api: cleanGenericApi,
                raw: row,
                _lowerGenericApi: lowerGenericApi,
                _lowerDrugName: lowerDrugName,
                _searchIndex: `${lowerGenericApi} ${lowerDrugName}`
            };
        }).filter(row => row.clean_generic_api || row.drug_name);

        // File 2: Clean and pre-index Market Pricing & Alternative Medicine records
        pricingData = rawPricing.map((row, index) => {
            const brandName = (row['Brand Name'] || row.brand_name || '').trim();
            const genericName = (row['Generic Name'] || row.generic_name || '').trim();
            const cheaperBrand = (row['Cheaper Alternative Brand'] || row.cheaper_brand || '').trim();
            const condition = (row['Health Condition'] || row.health_condition || 'Therapeutic Use').trim();
            const id = (row['ID'] || row['Id'] || row['S.No'] || row.id || String(index + 1)).trim();

            const parseCleanPrice = (val) => {
                if (val === null || val === undefined || val === '') return 0;
                if (typeof val === 'number') return isFinite(val) && !isNaN(val) ? val : 0;
                // Strip currency symbols (₹, $, Rs., etc.), commas, spaces, letters
                const cleaned = String(val).replace(/[^0-9.]/g, '').trim();
                if (!cleaned) return 0;
                const num = parseFloat(cleaned);
                return isFinite(num) && !isNaN(num) ? num : 0;
            };

            const stdPrice = parseCleanPrice(
                row['Standard Brand Price (INR)'] ??
                row['Standard Price (INR)'] ??
                row.standard_price ??
                row.standard_brand_price ??
                row['Standard Price']
            );

            const cheaperPrice = parseCleanPrice(
                row['Cheaper Alternative Price (INR)'] ??
                row['Cheaper Price (INR)'] ??
                row.cheaper_price ??
                row.cheaper_alternative_price ??
                row['Cheaper Price']
            );

            const lowerBrandName = brandName.toLowerCase();
            const lowerGenericName = genericName.toLowerCase();
            const lowerCheaperBrand = cheaperBrand.toLowerCase();

            return {
                id: id,
                health_condition: condition,
                brand_name: brandName,
                generic_name: genericName,
                standard_price: stdPrice,
                cheaper_brand: cheaperBrand,
                cheaper_price: cheaperPrice,
                raw: row,
                _lowerBrandName: lowerBrandName,
                _lowerGenericName: lowerGenericName,
                _lowerCheaperBrand: lowerCheaperBrand,
                _searchIndex: `${lowerBrandName} ${lowerGenericName} ${lowerCheaperBrand}`
            };
        }).filter(row => row.brand_name || row.generic_name);

        isLocalDbReady = true;

        return { cdscoData, pricingData };
    } catch (err) {
        isLocalDbReady = false;
        throw err;
    }
}
