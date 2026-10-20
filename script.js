/**
 * ==============================================================================
 * MEDIBUDDY CLIENT-SIDE LOGIC & IN-MEMORY SEARCH ENGINE
 * ==============================================================================
 */

// DOM Element References
const serverStatusBadge = document.getElementById('serverStatusBadge');
const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const searchIcon = document.getElementById('searchIcon');
const resultsContainer = document.getElementById('resultsContainer');
const heroSection = document.getElementById('hero-section');
const searchQueryDisplay = document.getElementById('searchQueryDisplay');
const activeSaltDisplay = document.getElementById('activeSaltDisplay');
const resultsCountBadge = document.getElementById('resultsCountBadge');
const cardsList = document.getElementById('cardsList');
const popularChips = document.getElementById('popularChips');

// In-Memory Database Storage
let cdscoData = [];
let pricingData = [];
let localDrugDatabase = []; // Kept for backwards compatibility
let isLocalDbReady = false;
let debounceTimer = null;
let lastQuery = '';

/**
 * PapaParse Dependency Check & Navbar Badge Status Updater
 */
function updateBadgeStatus() {
    if (!serverStatusBadge) return;

    if (typeof Papa !== 'undefined') {
        serverStatusBadge.style.cssText = "border: 1px solid #86efac; color: #15803d; background-color: #f0fdf4;";
        serverStatusBadge.innerHTML = `
            <span class="w-2 h-2 rounded-full animate-pulse" style="background-color: #22c55e;"></span>
            <span>🟢 System Online (Dual-Dataset Search)</span>
        `;
    } else {
        serverStatusBadge.style.cssText = "border: 1px solid #fca5a5; color: #b91c1c; background-color: #fef2f2;";
        serverStatusBadge.innerHTML = `
            <span class="w-2 h-2 rounded-full" style="background-color: #ef4444;"></span>
            <span>🔴 PapaParse Library Missing</span>
        `;
    }
}

// Immediate status verification on script evaluation
updateBadgeStatus();

/**
 * Escape HTML characters to prevent XSS vulnerabilities
 */
function escapeHtml(str) {
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
function loadCsv(url, customConfig = {}) {
    return new Promise((resolve, reject) => {
        if (typeof Papa === 'undefined') {
            return reject(new Error('PapaParse library is missing. Ensure papaparse.min.js is included in your HTML.'));
        }

        Papa.parse(url, {
            download: true,
            header: true,
            skipEmptyLines: 'greedy',
            transformHeader: (header) => header.trim().replace(/^\uFEFF/, ''),
            complete: (results) => {
                if (results.errors && results.errors.length > 0) {
                    console.warn(`[PapaParse Warning] File: "${url}":`, results.errors);
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
 * Initializes and loads both datasets concurrently using Promise.all so UI does not block.
 * File 1: production_drug_database.csv
 * File 2: indian_prescribed_drugs_150.csv
 */
async function initializeDatasets() {
    const file1Url = 'production_drug_database.csv';
    const file2Url = 'indian_prescribed_drugs_150.csv';

    try {
        console.time('[MediBuddy] Datasets Loaded In');

        const [rawCdsco, rawPricing] = await Promise.all([
            loadCsv(file1Url),
            loadCsv(file2Url)
        ]);

        // Normalize and store in-memory
        cdscoData = (rawCdsco || []).map(row => ({
            s_no: (row.s_no || '').trim(),
            drug_name: (row.drug_name || '').trim(),
            indication: (row.indication || '').trim(),
            approval_date: (row.approval_date || '').trim(),
            source_year: (row.source_year || '').trim(),
            clean_generic_api: (row.clean_generic_api || '').trim()
        })).filter(row => row.drug_name || row.clean_generic_api);

        pricingData = (rawPricing || []).map(row => ({
            id: (row.ID || row.id || '').trim(),
            health_condition: (row['Health Condition'] || '').trim(),
            brand_name: (row['Brand Name'] || '').trim(),
            generic_name: (row['Generic Name'] || '').trim(),
            standard_price: parseFloat(row['Standard Brand Price (INR)']) || 0,
            cheaper_brand: (row['Cheaper Alternative Brand'] || '').trim(),
            cheaper_price: parseFloat(row['Cheaper Alternative Price (INR)']) || 0,
            raw: row
        })).filter(row => row.brand_name || row.generic_name);

        localDrugDatabase = cdscoData; // backwards compatibility
        isLocalDbReady = true;

        console.timeEnd('[MediBuddy] Datasets Loaded In');
        console.log(`[MediBuddy Ready] CDSCO: ${cdscoData.length} entries | Pricing Alternatives: ${pricingData.length} entries.`);
        updateBadgeStatus();

        // Perform initial search once in-memory datasets are ready
        if (searchInput) {
            performSearch(searchInput.value || 'Calpol');
        }

        return { cdscoData, pricingData };
    } catch (err) {
        console.error("Failed to load datasets via Promise.all:", err);
        if (serverStatusBadge) {
            serverStatusBadge.style.cssText = "border: 1px solid #fcd34d; color: #b45309; background-color: #fffbeb;";
            serverStatusBadge.innerHTML = `
                <span class="w-2 h-2 rounded-full" style="background-color: #f59e0b;"></span>
                <span>⚠️ Dataset Fetch Failed</span>
            `;
        }
        throw err;
    }
}

// Alias for backwards compatibility
const initializeLocalDatabase = initializeDatasets;

/**
 * Searches across both in-memory datasets simultaneously.
 * File 1 (cdscoData): searches `clean_generic_api` and `drug_name`
 * File 2 (pricingData): searches `Brand Name` and `Generic Name`
 *
 * @param {string} query - Raw search query
 * @returns {{ officialAPIs: Array<object>, priceAlternatives: Array<object> }}
 */
function searchMaster(query) {
    const cleanQuery = (typeof query === 'string' ? query : String(query || '')).trim().toLowerCase();

    if (!cleanQuery) {
        const emptyResult = { officialAPIs: [], priceAlternatives: [] };
        console.log('[searchMaster] Empty query provided:', emptyResult);
        return emptyResult;
    }

    // 1. Search File 1: CDSCO official drug database
    const officialAPIs = cdscoData.filter(item => {
        const drugName = item.drug_name.toLowerCase();
        const genericApi = item.clean_generic_api.toLowerCase();
        return drugName.includes(cleanQuery) || genericApi.includes(cleanQuery);
    });

    // 2. Search File 2: 150 Prescribed Drugs Alternatives
    const priceAlternatives = pricingData.filter(item => {
        const brandName = item.brand_name.toLowerCase();
        const genericName = item.generic_name.toLowerCase();
        return brandName.includes(cleanQuery) || genericName.includes(cleanQuery);
    });

    const results = {
        officialAPIs,
        priceAlternatives
    };

    console.log(`[searchMaster] Query: "${query}" | Results:`, results);
    return results;
}

/**
 * Perform search entirely client-side using searchMaster across both datasets
 */
function performSearch(customQuery = null) {
    if (!searchInput) return;
    const query = (customQuery !== null ? customQuery : searchInput.value).trim();
    if (!query) return;

    lastQuery = query;
    searchInput.value = query;
    if (searchQueryDisplay) {
        searchQueryDisplay.textContent = query.charAt(0).toUpperCase() + query.slice(1);
    }

    // Animate hero and reveal results container
    if (heroSection) {
        heroSection.classList.add('md:pt-0', 'mb-6', 'scale-[0.98]');
        heroSection.classList.remove('mb-8');
    }
    if (resultsContainer) {
        resultsContainer.classList.remove('hidden');
        resultsContainer.classList.add('flex');
    }

    if (!isLocalDbReady) {
        if (resultsCountBadge) resultsCountBadge.textContent = 'Parsing datasets...';
        if (cardsList) {
            cardsList.innerHTML = `
                <div class="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-500 shadow-sm animate-pulse">
                    <i class="fa-solid fa-circle-notch fa-spin text-3xl text-slateBlue mb-3"></i>
                    <p class="font-medium text-sm">Loading CDSCO and Pricing databases into browser memory...</p>
                </div>
            `;
        }
        return;
    }

    const searchResults = searchMaster(query);
    renderResults(query, searchResults);
}

// Active Alternative Drug Selection State
let selectedAlternativeIndex = 0;
let currentAlternativesList = [];

/**
 * Updates the summary caption below the Generate Doctor Note button
 */
function updateDoctorNoteSummary() {
    const summaryEl = document.getElementById('selectedNoteSummary');
    if (!summaryEl) return;

    if (currentAlternativesList && currentAlternativesList.length > 0 && selectedAlternativeIndex >= 0 && currentAlternativesList[selectedAlternativeIndex]) {
        const item = currentAlternativesList[selectedAlternativeIndex];
        const savings = Math.max(0, item.standard_price - item.cheaper_price);
        summaryEl.innerHTML = `Selected for doctor note: <strong class="text-accentGreen font-bold">${escapeHtml(item.cheaper_brand)}</strong> (₹${item.cheaper_price.toFixed(2)}) &bull; Saves ₹${savings.toFixed(2)} vs ${escapeHtml(item.brand_name)}.`;
    } else {
        summaryEl.innerHTML = `Create a personalized conversation starter &mdash; never a prescription.`;
    }
}

/**
 * Interactively select an alternative drug card and update visual highlighting
 * @param {number} index - Index of selected item in currentAlternativesList
 */
function selectAlternative(index) {
    if (!currentAlternativesList || !currentAlternativesList[index]) return;
    selectedAlternativeIndex = index;

    const cards = document.querySelectorAll('.alternative-drug-card');
    cards.forEach((card, idx) => {
        const isSelected = (idx === selectedAlternativeIndex);
        const radio = card.querySelector('input[type="radio"]');
        const pillContainer = card.querySelector('.selection-pill-container');
        const borderIndicator = card.querySelector('.left-indicator-bar');

        if (radio) radio.checked = isSelected;

        if (isSelected) {
            card.className = 'alternative-drug-card rounded-xl p-5 md:p-6 transition-all duration-200 relative overflow-hidden group mb-4 cursor-pointer border-2 border-accentGreen bg-emerald-50/70 shadow-md ring-2 ring-accentGreen/20';
            if (borderIndicator) borderIndicator.className = 'left-indicator-bar absolute top-0 left-0 w-1.5 h-full bg-accentGreen transition-colors';
            if (pillContainer) {
                pillContainer.innerHTML = `
                    <span class="inline-flex items-center gap-1.5 bg-accentGreen text-white text-xs font-bold px-3 py-1.5 rounded-lg shadow-sm">
                        <i class="fa-solid fa-circle-check"></i> Selected for Discussion
                    </span>
                `;
            }
        } else {
            card.className = 'alternative-drug-card rounded-xl p-5 md:p-6 transition-all duration-200 relative overflow-hidden group mb-4 cursor-pointer border border-slate-200 bg-white hover:border-emerald-300 hover:bg-slate-50/50 shadow-sm';
            if (borderIndicator) borderIndicator.className = 'left-indicator-bar absolute top-0 left-0 w-1.5 h-full bg-slate-300 group-hover:bg-accentGreen transition-colors';
            if (pillContainer) {
                pillContainer.innerHTML = `
                    <button type="button" onclick="selectAlternative(${idx})" 
                        class="select-alt-btn inline-flex items-center gap-1.5 bg-white text-slate-700 hover:text-accentGreen text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-300 hover:border-accentGreen hover:bg-emerald-50 transition-all cursor-pointer">
                        <i class="fa-regular fa-circle text-slate-400"></i> Select Alternative
                    </button>
                `;
            }
        }
    });

    updateDoctorNoteSummary();
}

// Expose globally so inline onclick handlers have access
window.selectAlternative = selectAlternative;

/**
 * Dynamically render comparison cards from both pricing alternatives and CDSCO official records
 */
function renderResults(query, searchResults) {
    if (!cardsList || !resultsCountBadge || !activeSaltDisplay) return;

    const priceAlternatives = (searchResults && searchResults.priceAlternatives) || [];
    const officialAPIs = (searchResults && searchResults.officialAPIs) || [];
    const totalCount = priceAlternatives.length + officialAPIs.length;

    // Cache current list for dynamic selection and note generation
    currentAlternativesList = priceAlternatives;
    selectedAlternativeIndex = priceAlternatives.length > 0 ? 0 : -1;

    if (totalCount === 0) {
        resultsCountBadge.textContent = '0 matches found';
        activeSaltDisplay.innerHTML = `Active Salt: <span class="font-semibold text-slate-400">No matching salt</span>`;

        cardsList.innerHTML = `
            <div class="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-600 shadow-sm">
                <i class="fa-solid fa-magnifying-glass text-4xl text-slate-300 mb-3"></i>
                <h3 class="text-lg font-bold text-slateBlue mb-1">No matching medicines found</h3>
                <p class="text-sm text-slate-500 max-w-md mx-auto mb-4">
                    We couldn't find any record matching "<strong>${escapeHtml(query)}</strong>" across either dataset.
                </p>
                <div class="flex flex-wrap justify-center gap-2 text-xs">
                    <span class="text-slate-400">Try searching:</span>
                    <button type="button" onclick="performSearch('Calpol')" class="text-slateBlue font-semibold underline">Calpol</button>
                    <button type="button" onclick="performSearch('Paracetamol')" class="text-slateBlue font-semibold underline">Paracetamol</button>
                    <button type="button" onclick="performSearch('Combiflam')" class="text-slateBlue font-semibold underline">Combiflam</button>
                    <button type="button" onclick="performSearch('Augmentin')" class="text-slateBlue font-semibold underline">Augmentin</button>
                    <button type="button" onclick="performSearch('Metformin')" class="text-slateBlue font-semibold underline">Metformin</button>
                    <button type="button" onclick="performSearch('Montair LC')" class="text-slateBlue font-semibold underline">Montair LC</button>
                </div>
            </div>
        `;
        updateDoctorNoteSummary();
        return;
    }

    // Determine the primary active salt for header display
    let primarySalt = 'Generic Bioequivalent API';
    if (priceAlternatives.length > 0) {
        primarySalt = priceAlternatives[0].generic_name;
    } else if (officialAPIs.length > 0) {
        primarySalt = officialAPIs[0].clean_generic_api;
    }

    activeSaltDisplay.innerHTML = `Active Salt: <span class="font-semibold text-slate-700">${escapeHtml(primarySalt)}</span>`;
    resultsCountBadge.textContent = `${totalCount} option${totalCount > 1 ? 's' : ''} found (${priceAlternatives.length} market, ${officialAPIs.length} CDSCO)`;

    let cardsHtml = '';

    // =========================================================================
    // SECTION 1: REAL-WORLD MARKET PRICING & CHEAPER ALTERNATIVES
    // =========================================================================
    if (priceAlternatives.length > 0) {
        priceAlternatives.slice(0, 8).forEach((item, index) => {
            const brand = item.brand_name;
            const cheaperBrand = item.cheaper_brand;
            const generic = item.generic_name;
            const condition = item.health_condition || 'Therapeutic Use';
            const stdPrice = item.standard_price;
            const altPrice = item.cheaper_price;
            const savings = Math.max(0, stdPrice - altPrice);
            const savingsPercent = stdPrice > 0 ? Math.round((savings / stdPrice) * 100) : 0;
            const isSelected = (index === selectedAlternativeIndex);

            cardsHtml += `
                <div class="alternative-drug-card rounded-xl p-5 md:p-6 transition-all duration-200 relative overflow-hidden group mb-4 cursor-pointer ${
                    isSelected
                        ? 'border-2 border-accentGreen bg-emerald-50/70 shadow-md ring-2 ring-accentGreen/20'
                        : 'border border-slate-200 bg-white hover:border-emerald-300 hover:bg-slate-50/50 shadow-sm'
                }" data-index="${index}" onclick="selectAlternative(${index})">
                    <div class="left-indicator-bar absolute top-0 left-0 w-1.5 h-full ${isSelected ? 'bg-accentGreen' : 'bg-slate-300 group-hover:bg-accentGreen'} transition-colors"></div>

                    <div class="flex flex-col md:flex-row justify-between gap-4">
                        <div class="flex-grow">
                            <!-- Header with Brand Name, Badges, and Radio Toggle -->
                            <div class="flex items-center gap-3 mb-2 flex-wrap">
                                <label class="inline-flex items-center gap-2.5 cursor-pointer" onclick="event.stopPropagation();">
                                    <input type="radio" name="selectedAlternativeRadio" value="${index}" ${isSelected ? 'checked' : ''} 
                                        onchange="selectAlternative(${index})" 
                                        class="w-4 h-4 text-accentGreen focus:ring-accentGreen cursor-pointer accent-accentGreen">
                                    <h3 class="text-xl font-bold text-slateBlue">${escapeHtml(cheaperBrand)}</h3>
                                </label>
                                <span class="bg-accentGreen text-white text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider flex items-center gap-1.5 shadow-sm">
                                    <i class="fa-solid fa-check"></i> Cheaper Alternative
                                </span>
                                <span class="text-xs bg-emerald-100 text-emerald-800 font-semibold px-2.5 py-0.5 rounded-full">
                                    ${escapeHtml(condition)}
                                </span>
                            </div>

                            <p class="text-sm text-slate-700 mb-1 font-medium">
                                Active Salt / Generic: <span class="font-semibold text-accentGreen">${escapeHtml(generic)}</span>
                            </p>
                            <p class="text-xs text-slate-500 mb-2">
                                Prescribed Brand Benchmark: <strong class="text-slate-700">${escapeHtml(brand)}</strong> (Standard: ₹${stdPrice.toFixed(2)})
                            </p>
                            <p class="text-[11px] text-slate-400">
                                Bioequivalent Generic Substitute &bull; Verified Indian Prescribed Dataset
                            </p>
                        </div>

                        <!-- Price Savings & Selection Action -->
                        <div class="flex items-center gap-4 md:gap-6 justify-between md:justify-end border-t md:border-t-0 pt-4 md:pt-0 mt-2 md:mt-0 border-accentGreen/20">
                            <div class="text-center md:text-right flex flex-col justify-center">
                                <span class="text-[10px] font-bold uppercase text-slate-500 tracking-wider mb-1">Direct Savings</span>
                                <span class="font-bold text-accentGreen text-xl">Save ₹${savings.toFixed(2)}</span>
                                <span class="text-[10px] text-accentGreen font-semibold">(${savingsPercent}% cheaper)</span>
                            </div>

                            <!-- Interactive Button / Pill -->
                            <div class="selection-pill-container flex items-center justify-end" onclick="event.stopPropagation();">
                                ${isSelected ? `
                                    <span class="inline-flex items-center gap-1.5 bg-accentGreen text-white text-xs font-bold px-3 py-1.5 rounded-lg shadow-sm">
                                        <i class="fa-solid fa-circle-check"></i> Selected for Discussion
                                    </span>
                                ` : `
                                    <button type="button" onclick="selectAlternative(${index})" 
                                        class="select-alt-btn inline-flex items-center gap-1.5 bg-white text-slate-700 hover:text-accentGreen text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-300 hover:border-accentGreen hover:bg-emerald-50 transition-all cursor-pointer">
                                        <i class="fa-regular fa-circle text-slate-400"></i> Select Alternative
                                    </button>
                                `}
                            </div>
                        </div>
                    </div>

                    <div class="mt-4 pt-3 border-t ${isSelected ? 'border-accentGreen/30' : 'border-slate-100'} flex justify-between items-center group-hover:border-accentGreen/40 transition-colors">
                        <div>
                            <p class="text-xs font-medium text-slate-500 uppercase tracking-wide">Alternative Retail Price</p>
                            <p class="text-[11px] text-slate-400">Standard pack retail estimation</p>
                        </div>
                        <div class="text-right">
                            <span class="text-xs text-slate-400 line-through mr-2">₹${stdPrice.toFixed(2)}</span>
                            <span class="font-bold text-slateBlue text-2xl">₹${altPrice.toFixed(2)}</span>
                        </div>
                    </div>
                </div>
            `;
        });
    }

    // =========================================================================
    // SECTION 2: CDSCO OFFICIAL REGULATORY APPROVAL RECORDS
    // =========================================================================
    if (officialAPIs.length > 0) {
        officialAPIs.slice(0, 5).forEach(item => {
            const drugName = item.drug_name || 'Standard Regulatory Formulation';
            const genericApi = item.clean_generic_api || 'Approved Chemical Entity';
            const indication = item.indication || 'General therapeutic use';
            const approvalDate = item.approval_date || item.source_year || 'Approved';

            cardsHtml += `
                <div class="bg-white border border-slate-200 rounded-xl p-5 md:p-6 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group mb-4">
                    <div class="flex flex-col md:flex-row justify-between gap-4">
                        <div class="flex-grow">
                            <div class="flex items-center gap-3 mb-2 flex-wrap">
                                <h3 class="text-xl font-bold text-slateBlue">${escapeHtml(drugName)}</h3>
                                <span class="bg-slate-100 text-slate-700 text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider border border-slate-200 flex items-center gap-1">
                                    <i class="fa-solid fa-shield-halved text-slate-500"></i> CDSCO Official Registry
                                </span>
                            </div>
                            <p class="text-sm text-slate-700 mb-1 font-medium">
                                Active Regulatory API: <span class="font-semibold text-slate-900">${escapeHtml(genericApi)}</span>
                            </p>
                            <p class="text-xs text-slate-500 mb-2">
                                <strong class="text-slate-600">Approved Indication:</strong> ${escapeHtml(indication)}
                            </p>
                            <p class="text-[11px] text-slate-400">
                                Regulatory Approval: ${escapeHtml(approvalDate)} &bull; S.No: ${escapeHtml(item.s_no)}
                            </p>
                        </div>

                        <div class="flex items-center gap-6 justify-between md:justify-end border-t md:border-t-0 pt-4 md:pt-0 mt-2 md:mt-0 border-slate-100">
                            <div class="text-center md:text-right flex flex-col justify-center">
                                <span class="text-[10px] font-bold uppercase text-slate-500 tracking-wider mb-1">Standard Status</span>
                                <span class="inline-flex items-center gap-1.5 text-slate-700 font-semibold text-xs bg-slate-100 px-2.5 py-1.5 rounded-lg border border-slate-200">
                                    <i class="fa-solid fa-certificate text-slate-500"></i> Reference Listed Drug
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        });
    }

    cardsList.innerHTML = cardsHtml;
    updateDoctorNoteSummary();
}

/**
 * Render graceful error state when local search fails
 */
function renderErrorState(query, errorDetails) {
    if (!resultsCountBadge || !cardsList) return;
    resultsCountBadge.textContent = 'Search Error';
    cardsList.innerHTML = `
        <div class="bg-amber-50 border border-warningAmber/30 rounded-xl p-6 text-amber-900 shadow-sm">
            <div class="flex items-start gap-3">
                <i class="fa-solid fa-triangle-exclamation text-warningAmber text-xl mt-0.5"></i>
                <div>
                    <h3 class="font-bold text-base mb-1">Local Search Issue</h3>
                    <p class="text-xs md:text-sm text-amber-800 mb-2">
                        An error occurred while searching for "<strong>${escapeHtml(query)}</strong>".
                    </p>
                    <p class="text-xs text-amber-700">
                        Details: ${escapeHtml(errorDetails)}
                    </p>
                </div>
            </div>
        </div>
    `;
}

// --- Event Listeners for Search ---
if (searchInput) {
    searchInput.addEventListener('input', function (e) {
        clearTimeout(debounceTimer);
        const query = e.target.value.trim();
        if (query.length >= 2) {
            debounceTimer = setTimeout(() => {
                performSearch(query);
            }, 350);
        }
    });

    searchInput.addEventListener('keypress', function (e) {
        if (e.key === 'Enter') {
            clearTimeout(debounceTimer);
            performSearch();
        }
    });
}

if (searchBtn) {
    searchBtn.addEventListener('click', () => performSearch());
}

if (popularChips) {
    popularChips.addEventListener('click', function (e) {
        const btn = e.target.closest('.chip-btn');
        if (btn) {
            const term = btn.getAttribute('data-term');
            if (term) {
                performSearch(term);
            }
        }
    });
}

// ==============================================================================
// GENERATE DOCTOR REQUEST NOTE PDF (VIA JSPDF)
// ==============================================================================
const generateDoctorNoteBtn = document.getElementById('generateDoctorNoteBtn');

function generateDoctorRequestNotePDF() {
    const { jsPDF } = window.jspdf || {};
    if (!jsPDF) {
        alert("The PDF generator library is still loading. Please check your internet connection and try again.");
        return;
    }

    // Read details from the currently selected alternative card
    const selectedItem = (currentAlternativesList && selectedAlternativeIndex >= 0 && currentAlternativesList[selectedAlternativeIndex])
        ? currentAlternativesList[selectedAlternativeIndex]
        : (currentAlternativesList && currentAlternativesList.length > 0 ? currentAlternativesList[0] : null);

    let brandName = '';
    let cheaperBrand = '';
    let genericApiName = '';
    let cheaperPriceStr = '';
    let stdPriceStr = '';
    let savingsStr = '';
    let condition = '';

    if (selectedItem) {
        brandName = selectedItem.brand_name || 'Prescribed Medication';
        cheaperBrand = selectedItem.cheaper_brand || 'Generic Equivalent Alternative';
        genericApiName = selectedItem.generic_name || 'CDSCO Standard API';
        const std = selectedItem.standard_price || 0;
        const alt = selectedItem.cheaper_price || 0;
        const sav = Math.max(0, std - alt);
        const savPct = std > 0 ? Math.round((sav / std) * 100) : 0;

        stdPriceStr = `₹${std.toFixed(2)}`;
        cheaperPriceStr = `₹${alt.toFixed(2)}`;
        savingsStr = `₹${sav.toFixed(2)} (${savPct}% savings)`;
        condition = selectedItem.health_condition || 'Therapeutic Indication';
    } else {
        // Fallback to active query display and CDSCO salt if no pricing item is loaded
        const brandElement = document.getElementById('searchQueryDisplay');
        brandName = brandElement ? brandElement.textContent.trim() : (lastQuery || 'Prescribed Medication');
        cheaperBrand = `${brandName} (Generic Bioequivalent)`;
        const saltElement = document.querySelector('#activeSaltDisplay span');
        genericApiName = saltElement ? saltElement.textContent.trim() : 'CDSCO Bioequivalent API';
        stdPriceStr = 'Market Benchmark';
        cheaperPriceStr = 'Jan Aushadhi / Certified Generic Rate';
        savingsStr = 'Substantial Generic Savings';
        condition = 'Prescribed Medical Condition';
    }

    const originalBtnHtml = generateDoctorNoteBtn ? generateDoctorNoteBtn.innerHTML : '';
    if (generateDoctorNoteBtn) {
        generateDoctorNoteBtn.innerHTML = `
            <i class="fa-solid fa-circle-notch fa-spin text-lg"></i>
            <span>Generating PDF...</span>
        `;
        generateDoctorNoteBtn.disabled = true;
    }

    try {
        const doc = new jsPDF({
            orientation: 'portrait',
            unit: 'mm',
            format: 'a4'
        });

        const pageWidth = doc.internal.pageSize.getWidth();
        const margin = 20;
        const contentWidth = pageWidth - (margin * 2);

        // Top Header Banner
        doc.setFillColor(35, 57, 77); // slateBlue #23394d
        doc.rect(0, 0, pageWidth, 28, 'F');

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(15);
        doc.setTextColor(255, 255, 255);
        doc.text('MEDIBUDDY | CLINICAL DISCUSSION AID', margin, 13);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(203, 213, 225);
        doc.text('Patient Request for Therapeutic Generic Alternative Evaluation', margin, 20);

        let currentY = 38;
        const currentDate = new Date().toLocaleDateString('en-IN', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(100, 116, 139);
        doc.text(`Date: ${currentDate}`, margin, currentY);
        doc.text(`Regulatory Standard: CDSCO (India) Bioequivalence Norms`, pageWidth - margin, currentY, { align: 'right' });

        currentY += 10;

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.setTextColor(15, 23, 42);
        doc.text(`Subject: Request to Evaluate Generic Alternative (${cheaperBrand})`, margin, currentY);

        currentY += 5;
        doc.setDrawColor(226, 232, 240);
        doc.setLineWidth(0.5);
        doc.line(margin, currentY, margin + contentWidth, currentY);

        currentY += 8;

        // Structured Medical Comparison Box
        doc.setFillColor(248, 250, 252);
        doc.setDrawColor(203, 213, 225);
        doc.roundedRect(margin, currentY, contentWidth, 42, 2, 2, 'FD');

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(71, 85, 105);
        doc.text('CURRENT REFERENCE BRAND:', margin + 6, currentY + 8);
        doc.text('CHOSEN CHEAPER ALTERNATIVE:', margin + 6, currentY + 16);
        doc.text('ACTIVE PHARMACEUTICAL INGREDIENT:', margin + 6, currentY + 24);
        doc.text('HEALTH CONDITION / THERAPY:', margin + 6, currentY + 32);
        doc.text('ESTIMATED PRICE & SAVINGS:', margin + 6, currentY + 39);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(35, 57, 77);
        doc.text(`${brandName} (${stdPriceStr})`, margin + 74, currentY + 8);

        doc.setTextColor(22, 101, 52); // accentGreen
        doc.text(`${cheaperBrand} (${cheaperPriceStr})`, margin + 74, currentY + 16);
        doc.text(genericApiName, margin + 74, currentY + 24);

        doc.setTextColor(51, 65, 85);
        doc.text(condition, margin + 74, currentY + 32);

        doc.setTextColor(22, 101, 52);
        doc.text(savingsStr, margin + 74, currentY + 39);

        currentY += 50;

        // Structured Clinical Letter to Physician
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10.5);
        doc.setTextColor(30, 41, 59);

        doc.text('Dear Doctor,', margin, currentY);
        currentY += 7;

        const p1 = `I am currently reviewing my ongoing healthcare expenses. I noticed that a CDSCO-cleared bioequivalent alternative exists for my medication ${brandName}:`;
        const linesP1 = doc.splitTextToSize(p1, contentWidth);
        doc.text(linesP1, margin, currentY);
        currentY += (linesP1.length * 5.5) + 3;

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9.5);
        doc.setTextColor(35, 57, 77);
        doc.text(`* Alternative Brand: ${cheaperBrand}`, margin + 6, currentY);
        currentY += 5;
        doc.text(`* Active Pharmaceutical Ingredient: ${genericApiName}`, margin + 6, currentY);
        currentY += 5;
        doc.text(`* Cost Comparison: ${stdPriceStr} vs ${cheaperPriceStr} (Estimated Savings: ${savingsStr})`, margin + 6, currentY);
        currentY += 7;

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10.5);
        doc.setTextColor(30, 41, 59);

        const p2 = `Could you please advise if substituting ${brandName} with ${cheaperBrand} is clinically safe and therapeutic for my condition?`;
        const linesP2 = doc.splitTextToSize(p2, contentWidth);
        doc.text(linesP2, margin, currentY);
        currentY += (linesP2.length * 5.5) + 3;

        const p3 = 'I would appreciate your clinical evaluation regarding therapeutic efficacy, dosage equivalence, and whether any monitoring is recommended during substitution.';
        const linesP3 = doc.splitTextToSize(p3, contentWidth);
        doc.text(linesP3, margin, currentY);
        currentY += (linesP3.length * 5.5) + 12;

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(15, 23, 42);
        doc.text('Thank you for your guidance and clinical time,', margin, currentY);
        currentY += 14;

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9.5);
        doc.text('Patient Signature: _________________________________________', margin, currentY);
        currentY += 8;
        doc.text('Printed Patient Name: _____________________________________', margin, currentY);
        currentY += 8;
        doc.text('Contact Phone: ____________________________________________', margin, currentY);

        // Disclaimer Footer
        const footerY = 270;
        doc.setDrawColor(226, 232, 240);
        doc.line(margin, footerY - 5, margin + contentWidth, footerY - 5);

        doc.setFont('helvetica', 'italic');
        doc.setFontSize(8);
        doc.setTextColor(148, 163, 184);
        const disclaimer = 'Note: This document is an informational conversation starter prepared by the patient. It does not constitute a valid prescription or medical advice. All therapeutic substitution decisions remain solely under your treating physician\'s professional judgment.';
        const disclaimerLines = doc.splitTextToSize(disclaimer, contentWidth);
        doc.text(disclaimerLines, margin, footerY);

        const sanitizedFilename = `Doctor_Request_Note_${cheaperBrand.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
        doc.save(sanitizedFilename);

        if (generateDoctorNoteBtn) {
            generateDoctorNoteBtn.innerHTML = `
                <i class="fa-solid fa-circle-check text-emerald-600 text-lg"></i>
                <span class="text-emerald-700">PDF Downloaded!</span>
            `;
            setTimeout(() => {
                generateDoctorNoteBtn.innerHTML = originalBtnHtml;
                generateDoctorNoteBtn.disabled = false;
            }, 2500);
        }
    } catch (err) {
        console.error('Error generating PDF:', err);
        alert('An error occurred while generating the PDF. Please try again.');
        if (generateDoctorNoteBtn) {
            generateDoctorNoteBtn.innerHTML = originalBtnHtml;
            generateDoctorNoteBtn.disabled = false;
        }
    }
}

if (generateDoctorNoteBtn) {
    generateDoctorNoteBtn.addEventListener('click', generateDoctorRequestNotePDF);
}

// ==============================================================================
// CHATBOT WIDGET LOGIC
// ==============================================================================
const chatbotFab = document.getElementById('chatbotFab');
const chatbotWindow = document.getElementById('chatbotWindow');
const chatCloseBtn = document.getElementById('chatCloseBtn');
const fabChatIcon = document.getElementById('fabChatIcon');
const fabCloseIcon = document.getElementById('fabCloseIcon');
const chatInput = document.getElementById('chatInput');
const chatMessages = document.getElementById('chatMessages');
const chatChips = document.getElementById('chatChips');

function toggleChat() {
    if (!chatbotWindow || !chatbotFab) return;
    const isOpen = chatbotWindow.classList.toggle('is-open');
    chatbotFab.setAttribute('aria-expanded', isOpen);
    if (isOpen) {
        if (fabChatIcon) fabChatIcon.classList.add('hidden');
        if (fabCloseIcon) fabCloseIcon.classList.remove('hidden');
        if (chatInput) chatInput.focus();
    } else {
        if (fabChatIcon) fabChatIcon.classList.remove('hidden');
        if (fabCloseIcon) fabCloseIcon.classList.add('hidden');
    }
}

if (chatbotFab) chatbotFab.addEventListener('click', toggleChat);
if (chatCloseBtn) chatCloseBtn.addEventListener('click', toggleChat);

function appendMessage(sender, text) {
    if (!chatMessages) return;
    const bubble = document.createElement('div');
    if (sender === 'user') {
        bubble.className = 'bg-slateBlue text-white rounded-xl rounded-tr-sm p-3 shadow-sm max-w-[85%] self-end text-sm';
    } else {
        bubble.className = 'bg-white border border-slate-200 rounded-xl rounded-tl-sm p-3.5 shadow-sm max-w-[88%] text-slate-700 text-sm';
    }
    bubble.textContent = text;
    chatMessages.appendChild(bubble);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

const clinicalResponses = {
    effective: "Yes. Generic Atorvastatin contains the identical active pharmaceutical ingredient (Atorvastatin Calcium) in equivalent dosage and strength as brand Lipitor, providing identical therapeutic cholesterol reduction.",
    price: "Brand Lipitor includes originator R&D patent premiums and global branding costs (₹250/strip). Generics by PMBJP Jan Aushadhi or Indian pharma manufacturers compete on efficient domestic volume production (₹40/strip), yielding direct 84% savings.",
    cdsco: "In India, CDSCO requires generic formulations to prove bioequivalence within an 80%–125% 90% confidence interval for Cmax and AUC. Claiming '100%' is pharmacologically misleading, but regulatory bioequivalence proves identical clinical outcomes.",
    default: "Certified generic Atorvastatin is a CDSCO-cleared therapeutic substitute for Lipitor. Always review with your doctor before switching cardiac maintenance medications."
};

function handleChatResponse(query) {
    appendMessage('user', query);
    setTimeout(() => {
        const q = query.toLowerCase();
        if (q.includes('effective') || q.includes('safe') || q.includes('lipitor')) {
            appendMessage('bot', clinicalResponses.effective);
        } else if (q.includes('40') || q.includes('250') || q.includes('price') || q.includes('why')) {
            appendMessage('bot', clinicalResponses.price);
        } else if (q.includes('cdsco') || q.includes('standard') || q.includes('bioequivalen')) {
            appendMessage('bot', clinicalResponses.cdsco);
        } else {
            appendMessage('bot', clinicalResponses.default);
        }
    }, 350);
}

function sendChatMessage() {
    if (!chatInput) return;
    const query = chatInput.value.trim();
    if (query) {
        handleChatResponse(query);
        chatInput.value = '';
    }
}

if (chatChips) {
    chatChips.addEventListener('click', function (e) {
        const btn = e.target.closest('button');
        if (btn) {
            const query = btn.getAttribute('data-query');
            if (query) handleChatResponse(query);
        }
    });
}

window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && chatbotWindow && chatbotWindow.classList.contains('is-open')) {
        toggleChat();
    }
});

// ==============================================================================
// HOW IT WORKS MODAL LOGIC
// ==============================================================================
const howItWorksBtn = document.getElementById('howItWorksBtn');
const howItWorksModal = document.getElementById('howItWorksModal');
const howItWorksDialog = document.getElementById('howItWorksDialog');
const closeHowItWorksBtn = document.getElementById('closeHowItWorksBtn');
const dismissHowItWorksBtn = document.getElementById('dismissHowItWorksBtn');

function openHowItWorksModal(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (!howItWorksModal || !howItWorksDialog) return;
    howItWorksModal.classList.remove('opacity-0', 'pointer-events-none', 'invisible');
    howItWorksModal.classList.add('opacity-100', 'pointer-events-auto', 'visible');
    howItWorksDialog.classList.remove('scale-95');
    howItWorksDialog.classList.add('scale-100');
    document.body.style.overflow = 'hidden';
}

function closeHowItWorksModal(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (!howItWorksModal || !howItWorksDialog) return;
    howItWorksModal.classList.remove('opacity-100', 'pointer-events-auto', 'visible');
    howItWorksModal.classList.add('opacity-0', 'pointer-events-none', 'invisible');
    howItWorksDialog.classList.remove('scale-100');
    howItWorksDialog.classList.add('scale-95');
    document.body.style.overflow = '';
}

if (howItWorksBtn) howItWorksBtn.addEventListener('click', openHowItWorksModal);
if (closeHowItWorksBtn) closeHowItWorksBtn.addEventListener('click', closeHowItWorksModal);
if (dismissHowItWorksBtn) dismissHowItWorksBtn.addEventListener('click', closeHowItWorksModal);

if (howItWorksDialog) {
    howItWorksDialog.addEventListener('click', function (e) {
        e.stopPropagation();
    });
}

if (howItWorksModal) {
    howItWorksModal.addEventListener('click', function (e) {
        if (e.target === howItWorksModal) {
            closeHowItWorksModal();
        }
    });
}

window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && howItWorksModal && !howItWorksModal.classList.contains('invisible')) {
        closeHowItWorksModal();
    }
});

// ==============================================================================
// APP INITIALIZATION
// ==============================================================================
window.addEventListener('DOMContentLoaded', () => {
    updateBadgeStatus();
    initializeLocalDatabase();
});
