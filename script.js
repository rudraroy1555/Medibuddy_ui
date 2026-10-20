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
const sortFilterSelect = document.getElementById('sortFilterSelect');

// Discussion Cart DOM References
const navCartBtn = document.getElementById('navCartBtn');
const navCartBadge = document.getElementById('navCartBadge');
const drawerCartBadge = document.getElementById('drawerCartBadge');
const cartDrawerModal = document.getElementById('cartDrawerModal');
const cartDrawerBackdrop = document.getElementById('cartDrawerBackdrop');
const cartDrawerPanel = document.getElementById('cartDrawerPanel');
const closeCartDrawerBtn = document.getElementById('closeCartDrawerBtn');
const cartItemsList = document.getElementById('cartItemsList');
const cartBenchmarkTotal = document.getElementById('cartBenchmarkTotal');
const cartAlternativeTotal = document.getElementById('cartAlternativeTotal');
const cartSavingsTotal = document.getElementById('cartSavingsTotal');
const clearCartBtn = document.getElementById('clearCartBtn');
const cartGeneratePdfBtn = document.getElementById('cartGeneratePdfBtn');

// In-Memory Database Storage & Filter State
let cdscoData = [];
let pricingData = [];
let localDrugDatabase = []; // Kept for backwards compatibility
let isLocalDbReady = false;
let debounceTimer = null;
let lastQuery = '';
let currentSortMode = 'relevance';
let currentSearchResults = null;
let discussionCart = [];
let currentAlternativesList = [];

/**
 * PapaParse Dependency Check & Navbar Badge Status Updater
 */
function updateBadgeStatus() {
    if (!serverStatusBadge) return;

    if (typeof Papa !== 'undefined') {
        serverStatusBadge.style.cssText = "border: 1px solid #86efac; color: #15803d; background-color: #f0fdf4;";
        serverStatusBadge.innerHTML = `<span>🟢 System Online (Dual-Dataset Search)</span>`;
    } else {
        serverStatusBadge.style.cssText = "border: 1px solid #fca5a5; color: #b91c1c; background-color: #fef2f2;";
        serverStatusBadge.innerHTML = `<span>🔴 PapaParse Library Missing</span>`;
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
            serverStatusBadge.innerHTML = `<span>⚠️ Dataset Fetch Failed</span>`;
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
    currentSearchResults = searchResults;
    renderResults(query, searchResults);
}

// ==============================================================================
// PRESCRIPTION DISCUSSION CART STATE & HELPERS
// ==============================================================================

function getCartItemKey(item) {
    if (!item) return '';
    const b = (item.brand_name || '').trim().toLowerCase();
    const c = (item.cheaper_brand || '').trim().toLowerCase();
    const g = (item.generic_name || '').trim().toLowerCase();
    return `${b}__${c}__${g}`;
}

function isItemInCart(item) {
    if (!item) return false;
    const key = getCartItemKey(item);
    return discussionCart.some(cartItem => getCartItemKey(cartItem) === key);
}

function saveCartToStorage() {
    try {
        localStorage.setItem('medibuddy_discussion_cart', JSON.stringify(discussionCart));
    } catch (e) {
        console.warn('Unable to persist discussion cart to localStorage:', e);
    }
}

function loadCartFromStorage() {
    try {
        const stored = localStorage.getItem('medibuddy_discussion_cart');
        if (stored) {
            const parsed = JSON.parse(stored);
            if (Array.isArray(parsed)) {
                discussionCart = parsed;
            }
        }
    } catch (e) {
        console.warn('Unable to load discussion cart from localStorage:', e);
        discussionCart = [];
    }
}

function addToCart(item) {
    if (!item) return;
    const key = getCartItemKey(item);
    if (!discussionCart.some(it => getCartItemKey(it) === key)) {
        discussionCart.push({
            brand_name: item.brand_name || 'Prescribed Benchmark',
            cheaper_brand: item.cheaper_brand || 'Generic Equivalent',
            generic_name: item.generic_name || 'CDSCO Active API',
            standard_price: Number(item.standard_price) || 0,
            cheaper_price: Number(item.cheaper_price) || 0,
            health_condition: item.health_condition || 'Therapeutic Use',
            s_no: item.s_no || ''
        });
        saveCartToStorage();
        updateCartUI();
    }
}

function removeFromCart(key) {
    discussionCart = discussionCart.filter(it => getCartItemKey(it) !== key);
    saveCartToStorage();
    updateCartUI();
}

function clearCart() {
    discussionCart = [];
    saveCartToStorage();
    updateCartUI();
}

function toggleCartItem(index) {
    if (!currentAlternativesList || !currentAlternativesList[index]) return;
    const item = currentAlternativesList[index];
    const key = getCartItemKey(item);
    if (isItemInCart(item)) {
        removeFromCart(key);
    } else {
        addToCart(item);
    }
}

// Backward compatibility alias for selectAlternative
const selectAlternative = toggleCartItem;
window.selectAlternative = selectAlternative;
window.toggleCartItem = toggleCartItem;
window.removeFromCart = removeFromCart;
window.clearCart = clearCart;

// Drawer Controls
function openCartDrawer(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (!cartDrawerModal || !cartDrawerPanel) return;
    cartDrawerModal.classList.remove('opacity-0', 'pointer-events-none', 'invisible');
    cartDrawerModal.classList.add('opacity-100', 'pointer-events-auto', 'visible');
    cartDrawerPanel.classList.remove('translate-x-full');
    cartDrawerPanel.classList.add('translate-x-0');
    document.body.style.overflow = 'hidden';
}

function closeCartDrawer(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (!cartDrawerModal || !cartDrawerPanel) return;
    cartDrawerModal.classList.remove('opacity-100', 'pointer-events-auto', 'visible');
    cartDrawerModal.classList.add('opacity-0', 'pointer-events-none', 'invisible');
    cartDrawerPanel.classList.remove('translate-x-0');
    cartDrawerPanel.classList.add('translate-x-full');
    document.body.style.overflow = '';
}

window.openCartDrawer = openCartDrawer;
window.closeCartDrawer = closeCartDrawer;

/**
 * Updates cart badges, floating sticky bar, drawer contents, and rendered card states
 */
function updateCartUI() {
    const count = discussionCart.length;

    // 1. Badges
    if (navCartBadge) navCartBadge.textContent = count;
    if (drawerCartBadge) drawerCartBadge.textContent = count;

    // 2. Financial Totals
    let totalStd = 0;
    let totalAlt = 0;
    discussionCart.forEach(it => {
        totalStd += (Number(it.standard_price) || 0);
        totalAlt += (Number(it.cheaper_price) || 0);
    });
    const totalSavings = Math.max(0, totalStd - totalAlt);
    const totalSavingsPct = totalStd > 0 ? Math.round((totalSavings / totalStd) * 100) : 0;

    if (cartBenchmarkTotal) cartBenchmarkTotal.textContent = `₹${totalStd.toFixed(2)}`;
    if (cartAlternativeTotal) cartAlternativeTotal.textContent = `₹${totalAlt.toFixed(2)}`;
    if (cartSavingsTotal) cartSavingsTotal.textContent = `Save ₹${totalSavings.toFixed(2)} (${totalSavingsPct}%)`;

    // 4. Drawer Item List Rendering
    if (cartItemsList) {
        if (count === 0) {
            cartItemsList.innerHTML = `
                <div class="text-center py-12 px-4 text-slate-500">
                    <div class="w-14 h-14 mx-auto rounded-full bg-slate-100 flex items-center justify-center text-slate-400 mb-3 text-2xl">
                        <i class="fa-solid fa-clipboard-check"></i>
                    </div>
                    <h4 class="font-bold text-slateBlue text-base mb-1">Your Discussion Cart is empty</h4>
                    <p class="text-xs text-slate-500 max-w-xs mx-auto leading-relaxed mb-4">
                        Search medications and click <strong class="text-slate-700 font-semibold">'Add to Discussion Cart'</strong> on cheaper generic alternatives to prepare a consultation note for your doctor.
                    </p>
                </div>
            `;
        } else {
            let itemsHtml = '';
            discussionCart.forEach(it => {
                const itemKey = getCartItemKey(it);
                const itemSavings = Math.max(0, it.standard_price - it.cheaper_price);
                const itemSavingsPct = it.standard_price > 0 ? Math.round((itemSavings / it.standard_price) * 100) : 0;

                itemsHtml += `
                    <div class="bg-white rounded-xl p-3.5 border border-slate-200 shadow-xs relative overflow-hidden group">
                        <div class="flex justify-between items-start gap-2">
                            <div class="flex-grow min-w-0">
                                <div class="flex items-center gap-1.5 flex-wrap">
                                    <h4 class="font-bold text-slateBlue text-sm tracking-tight">${escapeHtml(it.cheaper_brand)}</h4>
                                    <span class="bg-emerald-50 text-accentGreen text-[9px] font-bold px-2 py-0.5 rounded-full border border-emerald-200 uppercase">
                                        Alternative
                                    </span>
                                </div>
                                <p class="text-xs text-slate-600 mt-0.5 truncate">
                                    Active API: <span class="text-accentGreen font-semibold">${escapeHtml(it.generic_name)}</span>
                                </p>
                                <p class="text-[11px] text-slate-400 mt-0.5">
                                    Benchmark: <strong class="text-slate-600">${escapeHtml(it.brand_name)}</strong> (₹${it.standard_price.toFixed(2)})
                                </p>
                            </div>
                            <button type="button" onclick="removeFromCart('${itemKey}')" title="Remove from discussion cart"
                                class="text-slate-400 hover:text-red-500 p-1.5 rounded-lg hover:bg-red-50 transition-colors cursor-pointer">
                                <i class="fa-regular fa-trash-can text-sm"></i>
                            </button>
                        </div>
                        <div class="mt-2.5 pt-2 border-t border-slate-100 flex justify-between items-center text-xs">
                            <span class="text-accentGreen font-bold">Save ₹${itemSavings.toFixed(2)} (${itemSavingsPct}%)</span>
                            <div class="flex items-baseline gap-1.5">
                                <span class="text-slate-400 line-through text-[11px]">₹${it.standard_price.toFixed(2)}</span>
                                <span class="font-bold text-slateBlue text-sm">₹${it.cheaper_price.toFixed(2)}</span>
                            </div>
                        </div>
                    </div>
                `;
            });
            cartItemsList.innerHTML = itemsHtml;
        }
    }


    // 6. Update Active Rendered Cards state in DOM
    const cards = document.querySelectorAll('.alternative-drug-card');
    cards.forEach((card, idx) => {
        if (!currentAlternativesList || !currentAlternativesList[idx]) return;
        const item = currentAlternativesList[idx];
        const inCart = isItemInCart(item);
        const actionContainer = card.querySelector('.selection-action-container');
        const borderIndicator = card.querySelector('.left-indicator-bar');

        if (inCart) {
            card.className = 'alternative-drug-card rounded-2xl p-5 md:p-6 transition-all duration-200 relative overflow-hidden mb-4 cursor-pointer border-2 border-accentGreen bg-gradient-to-r from-emerald-50/70 via-white to-white shadow-sm ring-2 ring-accentGreen/20';
            if (borderIndicator) borderIndicator.className = 'left-indicator-bar absolute top-0 left-0 w-1.5 h-full bg-accentGreen transition-colors';
            if (actionContainer) {
                actionContainer.innerHTML = `
                    <button type="button" onclick="event.stopPropagation(); toggleCartItem(${idx})" 
                        class="select-alt-btn inline-flex items-center gap-1.5 bg-accentGreen text-white text-xs font-semibold px-4 py-2 rounded-xl shadow-xs hover:bg-emerald-700 transition-all cursor-pointer">
                        <i class="fa-solid fa-check text-sm"></i>
                        <span>In Discussion Cart</span>
                    </button>
                `;
            }
        } else {
            card.className = 'alternative-drug-card rounded-2xl p-5 md:p-6 transition-all duration-200 relative overflow-hidden mb-4 cursor-pointer border border-slate-200 bg-white hover:border-slate-300 hover:shadow-xs';
            if (borderIndicator) borderIndicator.className = 'left-indicator-bar absolute top-0 left-0 w-1.5 h-full bg-slate-200 group-hover:bg-slate-400 transition-colors';
            if (actionContainer) {
                actionContainer.innerHTML = `
                    <button type="button" onclick="event.stopPropagation(); toggleCartItem(${idx})" 
                        class="select-alt-btn inline-flex items-center gap-1.5 bg-white text-slate-700 hover:text-accentGreen hover:bg-emerald-50 text-xs font-semibold px-4 py-2 rounded-xl border border-slate-200 hover:border-accentGreen/50 shadow-xs transition-all cursor-pointer">
                        <i class="fa-solid fa-cart-plus text-slate-400"></i>
                        <span>Add to Discussion Cart</span>
                    </button>
                `;
            }
        }
    });
}

/**
 * Dynamically render comparison cards with sorting filters and cart actions
 */
function renderResults(query, searchResults) {
    if (!cardsList || !resultsCountBadge || !activeSaltDisplay) return;

    currentSearchResults = searchResults;
    const rawPriceAlternatives = (searchResults && searchResults.priceAlternatives) || [];
    const officialAPIs = (searchResults && searchResults.officialAPIs) || [];
    const totalCount = rawPriceAlternatives.length + officialAPIs.length;

    // Apply sorting filters to priceAlternatives
    let priceAlternatives = [...rawPriceAlternatives];
    if (currentSortMode === 'price-asc') {
        priceAlternatives.sort((a, b) => (Number(a.cheaper_price) || 0) - (Number(b.cheaper_price) || 0));
    } else if (currentSortMode === 'savings-desc') {
        priceAlternatives.sort((a, b) => {
            const savA = Math.max(0, (Number(a.standard_price) || 0) - (Number(a.cheaper_price) || 0));
            const savB = Math.max(0, (Number(b.standard_price) || 0) - (Number(b.cheaper_price) || 0));
            return savB - savA;
        });
    }

    currentAlternativesList = priceAlternatives;

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
        updateCartUI();
        return;
    }

    // Determine primary active salt for header display
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
        priceAlternatives.slice(0, 10).forEach((item, index) => {
            const brand = item.brand_name;
            const cheaperBrand = item.cheaper_brand;
            const generic = item.generic_name;
            const condition = item.health_condition || 'Therapeutic Use';
            const stdPrice = Number(item.standard_price) || 0;
            const altPrice = Number(item.cheaper_price) || 0;
            const savings = Math.max(0, stdPrice - altPrice);
            const savingsPercent = stdPrice > 0 ? Math.round((savings / stdPrice) * 100) : 0;
            const inCart = isItemInCart(item);

            cardsHtml += `
                <div class="alternative-drug-card rounded-2xl p-5 md:p-6 transition-all duration-200 relative overflow-hidden mb-4 cursor-pointer ${
                    inCart
                        ? 'border-2 border-accentGreen bg-gradient-to-r from-emerald-50/70 via-white to-white shadow-sm ring-2 ring-accentGreen/20'
                        : 'border border-slate-200 bg-white hover:border-slate-300 hover:shadow-xs'
                }" data-index="${index}" onclick="toggleCartItem(${index})">
                    <div class="left-indicator-bar absolute top-0 left-0 w-1.5 h-full ${inCart ? 'bg-accentGreen' : 'bg-slate-200 group-hover:bg-slate-400'} transition-colors"></div>

                    <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                        <div class="flex-grow space-y-1.5">
                            <!-- Clean Header: Cheaper Brand Name and Status Badges -->
                            <div class="flex items-center gap-2.5 flex-wrap">
                                <h3 class="text-xl font-bold text-slateBlue tracking-tight">${escapeHtml(cheaperBrand)}</h3>
                                <span class="bg-accentGreen text-white text-[10px] font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider flex items-center gap-1 shadow-xs">
                                    <i class="fa-solid fa-check"></i> Cheaper Alternative
                                </span>
                                <span class="text-xs bg-slate-100 text-slate-700 font-medium px-2.5 py-0.5 rounded-full border border-slate-200">
                                    ${escapeHtml(condition)}
                                </span>
                            </div>

                            <p class="text-sm text-slate-700 font-medium">
                                Active Generic API: <span class="font-semibold text-accentGreen">${escapeHtml(generic)}</span>
                            </p>
                            <p class="text-xs text-slate-500">
                                Prescribed Brand Benchmark: <strong class="text-slate-700 font-semibold">${escapeHtml(brand)}</strong> (Standard: ₹${stdPrice.toFixed(2)})
                            </p>
                            <p class="text-[11px] text-slate-400">
                                Bioequivalent Generic Substitute &bull; Verified Indian Prescribed Dataset
                            </p>
                        </div>

                        <!-- Single Clean Action Column -->
                        <div class="flex flex-row md:flex-col items-center md:items-end justify-between w-full md:w-auto gap-3 pt-3 md:pt-0 border-t md:border-t-0 border-slate-100">
                            <div class="text-left md:text-right">
                                <span class="text-[10px] font-bold uppercase text-slate-400 tracking-wider block">Estimated Savings</span>
                                <span class="font-bold text-accentGreen text-lg md:text-xl">Save ₹${savings.toFixed(2)}</span>
                                <span class="text-[11px] text-emerald-700 font-semibold block">(${savingsPercent}% lower cost)</span>
                            </div>

                            <!-- Cart Add/Remove Toggle Button -->
                            <div class="selection-action-container">
                                ${inCart ? `
                                    <button type="button" onclick="event.stopPropagation(); toggleCartItem(${index})" 
                                        class="select-alt-btn inline-flex items-center gap-1.5 bg-accentGreen text-white text-xs font-semibold px-4 py-2 rounded-xl shadow-xs hover:bg-emerald-700 transition-all cursor-pointer">
                                        <i class="fa-solid fa-check text-sm"></i>
                                        <span>In Discussion Cart</span>
                                    </button>
                                ` : `
                                    <button type="button" onclick="event.stopPropagation(); toggleCartItem(${index})" 
                                        class="select-alt-btn inline-flex items-center gap-1.5 bg-white text-slate-700 hover:text-accentGreen hover:bg-emerald-50 text-xs font-semibold px-4 py-2 rounded-xl border border-slate-200 hover:border-accentGreen/50 shadow-xs transition-all cursor-pointer">
                                        <i class="fa-solid fa-cart-plus text-slate-400"></i>
                                        <span>Add to Discussion Cart</span>
                                    </button>
                                `}
                            </div>
                        </div>
                    </div>

                    <!-- Clean Price Comparison Bar -->
                    <div class="mt-4 pt-3 border-t border-slate-100 flex justify-between items-center text-xs">
                        <div class="text-slate-500">
                            Estimated retail price per pack
                        </div>
                        <div class="flex items-baseline gap-2">
                            <span class="text-slate-400 line-through text-xs">₹${stdPrice.toFixed(2)}</span>
                            <span class="font-bold text-slateBlue text-xl">₹${altPrice.toFixed(2)}</span>
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
                <div class="bg-white border border-slate-200 rounded-2xl p-5 md:p-6 shadow-xs hover:border-slate-300 hover:shadow-sm transition-all relative overflow-hidden group mb-4">
                    <div class="absolute top-0 left-0 w-1.5 h-full bg-slate-200 group-hover:bg-slate-300 transition-colors"></div>

                    <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                        <div class="flex-grow min-w-0 space-y-1.5">
                            <div class="flex items-center gap-2.5 flex-wrap">
                                <h3 class="text-xl font-bold text-slateBlue tracking-tight">${escapeHtml(drugName)}</h3>
                                <span class="bg-slate-100 text-slate-700 text-[10px] font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider border border-slate-200 flex items-center gap-1 shadow-xs">
                                    <i class="fa-solid fa-shield-halved text-slate-500"></i> CDSCO Registry
                                </span>
                            </div>

                            <p class="text-sm text-slate-700 font-medium">
                                Active Regulatory API: <span class="font-semibold text-slate-900">${escapeHtml(genericApi)}</span>
                            </p>
                            <p class="text-xs text-slate-500">
                                <strong class="text-slate-600 font-medium">Approved Indication:</strong> ${escapeHtml(indication)}
                            </p>
                            <p class="text-[11px] text-slate-400">
                                Regulatory Approval: ${escapeHtml(approvalDate)} &bull; S.No: ${escapeHtml(item.s_no)}
                            </p>
                        </div>

                        <!-- Fixed right-side badge column: non-shrinking, strictly aligned -->
                        <div class="flex flex-row md:flex-col items-center md:items-end justify-between md:justify-center w-full md:w-auto md:min-w-[190px] flex-shrink-0 pt-3 md:pt-0 border-t md:border-t-0 border-slate-100 gap-1.5">
                            <span class="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Regulatory Standard</span>
                            <span class="inline-flex items-center gap-1.5 text-slate-700 font-semibold text-xs bg-slate-50 hover:bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200 shadow-xs whitespace-nowrap">
                                <i class="fa-solid fa-certificate text-emerald-600 text-xs"></i>
                                <span>Reference Listed Drug</span>
                            </span>
                        </div>
                    </div>
                </div>
            `;
        });
    }

    cardsList.innerHTML = cardsHtml;
    updateCartUI();
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
function generateDoctorRequestNotePDF() {
    const { jsPDF } = window.jspdf || {};
    if (!jsPDF) {
        alert("The PDF generator library is still loading. Please check your internet connection and try again.");
        return;
    }

    // Determine items to include in note
    let itemsToPrint = [...discussionCart];

    // If cart is empty, fallback gracefully: auto-add top searched alternative if available
    if (itemsToPrint.length === 0) {
        if (currentAlternativesList && currentAlternativesList.length > 0) {
            addToCart(currentAlternativesList[0]);
            itemsToPrint = [...discussionCart];
        } else {
            alert("Your Discussion Cart is empty. Please search and add at least one generic alternative to your cart before generating a note.");
            openCartDrawer();
            return;
        }
    }

    // Note Generator button state feedback inside drawer
    const defaultDrawerBtnHtml = `
        <i class="fa-regular fa-file-lines text-base"></i>
        <span>Note Generator</span>
        <i class="fa-solid fa-arrow-right text-xs"></i>
    `;
    const originalDrawerBtnHtml = cartGeneratePdfBtn ? (cartGeneratePdfBtn.innerHTML || defaultDrawerBtnHtml) : defaultDrawerBtnHtml;

    const setButtonsLoading = () => {
        if (cartGeneratePdfBtn) {
            cartGeneratePdfBtn.innerHTML = `
                <i class="fa-solid fa-circle-notch fa-spin text-sm"></i>
                <span>Generating Note (${itemsToPrint.length} item${itemsToPrint.length > 1 ? 's' : ''})...</span>
            `;
            cartGeneratePdfBtn.disabled = true;
        }
    };

    const resetButtonsSuccess = () => {
        if (cartGeneratePdfBtn) {
            cartGeneratePdfBtn.innerHTML = `
                <i class="fa-solid fa-circle-check text-emerald-400 text-sm"></i>
                <span>Note Downloaded!</span>
            `;
        }
        setTimeout(() => {
            if (cartGeneratePdfBtn) {
                cartGeneratePdfBtn.innerHTML = defaultDrawerBtnHtml;
                cartGeneratePdfBtn.disabled = false;
            }
        }, 2500);
    };

    setButtonsLoading();

    try {
        const doc = new jsPDF({
            orientation: 'portrait',
            unit: 'mm',
            format: 'a4'
        });

        const pageWidth = doc.internal.pageSize.getWidth();
        const margin = 15;
        const contentWidth = pageWidth - (margin * 2);

        // Header Banner
        doc.setFillColor(35, 57, 77); // slateBlue
        doc.rect(0, 0, pageWidth, 26, 'F');

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(14);
        doc.setTextColor(255, 255, 255);
        doc.text('MEDIBUDDY | CLINICAL DISCUSSION AID', margin, 12);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.5);
        doc.setTextColor(203, 213, 225);
        doc.text('Patient Consultation Aid for Therapeutic Generic Bioequivalent Evaluation', margin, 19);

        let currentY = 35;
        const currentDate = new Date().toLocaleDateString('en-IN', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.5);
        doc.setTextColor(100, 116, 139);
        doc.text(`Date: ${currentDate}`, margin, currentY);
        doc.text(`Regulatory Reference: CDSCO (India) Bioequivalence Norms`, pageWidth - margin, currentY, { align: 'right' });

        currentY += 8;

        // Subject Line
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.setTextColor(15, 23, 42);
        const subjectText = itemsToPrint.length === 1
            ? `Subject: Clinical Evaluation Request for Generic Substitute (${itemsToPrint[0].cheaper_brand})`
            : `Subject: Clinical Evaluation Request for ${itemsToPrint.length} Prescribed Generic Substitutes`;
        doc.text(subjectText, margin, currentY);

        currentY += 4;
        doc.setDrawColor(226, 232, 240);
        doc.setLineWidth(0.5);
        doc.line(margin, currentY, margin + contentWidth, currentY);

        currentY += 7;

        // Letter Salutation & Context
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9.5);
        doc.setTextColor(30, 41, 59);
        doc.text('Dear Doctor,', margin, currentY);
        currentY += 5;

        const introText = 'I am actively reviewing my ongoing prescription expenses. In consultation with CDSCO-registered database standards, I have shortlisted the following certified generic equivalent(s) currently available in the Indian pharmaceutical market for your clinical evaluation:';
        const splitIntro = doc.splitTextToSize(introText, contentWidth);
        doc.text(splitIntro, margin, currentY);
        currentY += (splitIntro.length * 4.5) + 4;

        // TABLE HEADER
        const colW = {
            num: 8,
            brand: 44,
            alt: 66,
            price: 26,
            savings: 36
        };

        const tableX = margin;
        doc.setFillColor(241, 245, 249);
        doc.setDrawColor(203, 213, 225);
        doc.rect(tableX, currentY, contentWidth, 7, 'FD');

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(51, 65, 85);
        doc.text('#', tableX + 2, currentY + 4.8);
        doc.text('PRESCRIBED BENCHMARK', tableX + colW.num + 2, currentY + 4.8);
        doc.text('PROPOSED GENERIC & SALT', tableX + colW.num + colW.brand + 2, currentY + 4.8);
        doc.text('ALT PRICE', tableX + colW.num + colW.brand + colW.alt + 2, currentY + 4.8);
        doc.text('EST. SAVINGS', tableX + colW.num + colW.brand + colW.alt + colW.price + 2, currentY + 4.8);

        currentY += 7;

        let totalBenchmarkCost = 0;
        let totalAlternativeCost = 0;

        // TABLE ROWS
        itemsToPrint.forEach((item, idx) => {
            const std = Number(item.standard_price) || 0;
            const alt = Number(item.cheaper_price) || 0;
            const sav = Math.max(0, std - alt);
            const savPct = std > 0 ? Math.round((sav / std) * 100) : 0;

            totalBenchmarkCost += std;
            totalAlternativeCost += alt;

            const rowHeight = 11;
            // Alternating fill
            if (idx % 2 === 1) {
                doc.setFillColor(248, 250, 252);
                doc.rect(tableX, currentY, contentWidth, rowHeight, 'F');
            }
            doc.setDrawColor(226, 232, 240);
            doc.line(tableX, currentY + rowHeight, tableX + contentWidth, currentY + rowHeight);

            // Item number
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(8);
            doc.setTextColor(100, 116, 139);
            doc.text(`${idx + 1}.`, tableX + 2, currentY + 4.5);

            // Prescribed Benchmark
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(30, 41, 59);
            doc.text(doc.splitTextToSize(item.brand_name || 'Prescribed Drug', colW.brand - 4)[0], tableX + colW.num + 2, currentY + 4.5);
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(7.5);
            doc.setTextColor(100, 116, 139);
            doc.text(`Std: ₹${std.toFixed(2)}`, tableX + colW.num + 2, currentY + 8.5);

            // Generic Alternative & Salt
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(8);
            doc.setTextColor(22, 101, 52); // green
            doc.text(doc.splitTextToSize(item.cheaper_brand || 'Generic Alternative', colW.alt - 4)[0], tableX + colW.num + colW.brand + 2, currentY + 4.5);
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(7.5);
            doc.setTextColor(71, 85, 105);
            const saltLine = `Salt: ${item.generic_name || 'CDSCO API'}`;
            doc.text(doc.splitTextToSize(saltLine, colW.alt - 4)[0], tableX + colW.num + colW.brand + 2, currentY + 8.5);

            // Alt Price
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(8);
            doc.setTextColor(35, 57, 77);
            doc.text(`₹${alt.toFixed(2)}`, tableX + colW.num + colW.brand + colW.alt + 2, currentY + 6.5);

            // Savings
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(22, 101, 52);
            doc.text(`Save ₹${sav.toFixed(2)}`, tableX + colW.num + colW.brand + colW.alt + colW.price + 2, currentY + 4.5);
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(7);
            doc.text(`(${savPct}% lower)`, tableX + colW.num + colW.brand + colW.alt + colW.price + 2, currentY + 8.5);

            currentY += rowHeight;
        });

        // TOTAL SUMMARY BOX
        const totalSavings = Math.max(0, totalBenchmarkCost - totalAlternativeCost);
        const totalSavingsPct = totalBenchmarkCost > 0 ? Math.round((totalSavings / totalBenchmarkCost) * 100) : 0;

        currentY += 4;
        doc.setFillColor(240, 253, 244); // emerald-50
        doc.setDrawColor(134, 239, 172); // emerald-300
        doc.roundedRect(tableX, currentY, contentWidth, 14, 1.5, 1.5, 'FD');

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(22, 101, 52);
        doc.text(`Total Benchmark Cost: ₹${totalBenchmarkCost.toFixed(2)}   |   Total Generic Alternative Cost: ₹${totalAlternativeCost.toFixed(2)}`, tableX + 5, currentY + 5.5);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.text(`CONSOLIDATED ESTIMATED SAVINGS: Save ₹${totalSavings.toFixed(2)} (${totalSavingsPct}% Lower Overall Cost)`, tableX + 5, currentY + 10.5);

        currentY += 20;

        // CLINICAL QUESTIONS FOR PHYSICIAN
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9.5);
        doc.setTextColor(35, 57, 77);
        doc.text('Key Clinical Questions for Physician Guidance:', margin, currentY);
        currentY += 5;

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.5);
        doc.setTextColor(51, 65, 85);
        doc.text('1. Therapeutic Bioequivalence: Are the proposed generic formulations chemically and clinically equivalent for my ongoing treatment plan?', margin + 2, currentY);
        currentY += 4.5;
        doc.text('2. Excipients & Tolerability: Are there specific inactive ingredients, release mechanisms, or manufacturer standards I should evaluate?', margin + 2, currentY);
        currentY += 4.5;
        doc.text('3. Prescription Endorsement: If clinically cleared, could you please update my prescription with the approved active chemical salts?', margin + 2, currentY);
        currentY += 9;

        // SIGNATURE BLOCK
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(15, 23, 42);
        doc.text('Thank you for your clinical time, advice, and continued care.', margin, currentY);
        currentY += 10;

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(71, 85, 105);
        doc.text('Patient Signature: _________________________________________', margin, currentY);
        doc.text('Date: ________________________', pageWidth - margin - 50, currentY);
        currentY += 6.5;
        doc.text('Printed Patient Name: _____________________________________', margin, currentY);
        doc.text('Phone: _______________________', pageWidth - margin - 50, currentY);

        // FOOTER DISCLAIMER
        const footerY = 276;
        doc.setDrawColor(226, 232, 240);
        doc.line(margin, footerY - 4, margin + contentWidth, footerY - 4);

        doc.setFont('helvetica', 'italic');
        doc.setFontSize(7.5);
        doc.setTextColor(148, 163, 184);
        const disclaimer = 'Notice: This document is an educational patient discussion aid prepared via MediBuddy. It does NOT constitute a valid medical prescription. All substitution decisions remain solely under the clinical discretion of your licensed treating physician.';
        const disclaimerLines = doc.splitTextToSize(disclaimer, contentWidth);
        doc.text(disclaimerLines, margin, footerY);

        const sanitizedFilename = `Doctor_Request_Note_${itemsToPrint.length}_Medications.pdf`;
        doc.save(sanitizedFilename);

        resetButtonsSuccess();
    } catch (err) {
        console.error('Error generating multi-item PDF:', err);
        alert('An error occurred while generating the PDF. Please try again.');
        if (cartGeneratePdfBtn) {
            cartGeneratePdfBtn.innerHTML = defaultDrawerBtnHtml;
            cartGeneratePdfBtn.disabled = false;
        }
    }
}

if (cartGeneratePdfBtn) {
    cartGeneratePdfBtn.addEventListener('click', generateDoctorRequestNotePDF);
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
// DISCUSSION CART & SORTING FILTER EVENT LISTENERS
// ==============================================================================
if (sortFilterSelect) {
    sortFilterSelect.addEventListener('change', function (e) {
        currentSortMode = e.target.value;
        if (currentSearchResults && lastQuery) {
            renderResults(lastQuery, currentSearchResults);
        }
    });
}

if (navCartBtn) navCartBtn.addEventListener('click', openCartDrawer);
if (closeCartDrawerBtn) closeCartDrawerBtn.addEventListener('click', closeCartDrawer);
if (cartDrawerBackdrop) cartDrawerBackdrop.addEventListener('click', closeCartDrawer);
if (clearCartBtn) clearCartBtn.addEventListener('click', clearCart);

window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
        if (cartDrawerModal && !cartDrawerModal.classList.contains('invisible')) {
            closeCartDrawer();
        }
    }
});

// ==============================================================================
// APP INITIALIZATION
// ==============================================================================
window.addEventListener('DOMContentLoaded', () => {
    updateBadgeStatus();
    loadCartFromStorage();
    updateCartUI();
    initializeLocalDatabase();
});
