/**
 * ==============================================================================
 * MEDIBUDDY UI MODULE (ui.js)
 * DOM manipulation, chunked card rendering, prescription cart, modals & drawers.
 * Strict naming convention: all DOM element references are prefixed with '$'.
 * ==============================================================================
 */

import { escapeHtml, isLocalDbReady } from './data.js';
import { searchMaster, sortResults, searchCache } from './search.js';
import { getStorageItem, setStorageItem, registerToastDispatcher } from './api.js';

// ==============================================================================
// DOM ELEMENT REFERENCES ($ PREFIX NOTATION)
// ==============================================================================
const getEl = (id) => (typeof document !== 'undefined' ? document.getElementById(id) : null);

// Search Bar & Main Results Area
export const $serverStatusBadge = getEl('serverStatusBadge');
export const $searchInput = getEl('searchInput');
export const $searchBtn = getEl('searchBtn');
export const $searchIcon = getEl('searchIcon');
export const $resultsContainer = getEl('resultsContainer');
export const $heroSection = getEl('hero-section');
export const $searchQueryDisplay = getEl('searchQueryDisplay');
export const $activeSaltDisplay = getEl('activeSaltDisplay');
export const $resultsCountBadge = getEl('resultsCountBadge');
export const $cardsList = getEl('cardsList');
export const $popularChips = getEl('popularChips');
export const $sortFilterSelect = getEl('sortFilterSelect');

// Prescription Discussion Cart & Drawer
export const $navCartBtn = getEl('navCartBtn');
export const $navCartBadge = getEl('navCartBadge');
export const $drawerCartBadge = getEl('drawerCartBadge');
export const $cartDrawerModal = getEl('cartDrawerModal');
export const $cartDrawerBackdrop = getEl('cartDrawerBackdrop');
export const $cartDrawerPanel = getEl('cartDrawerPanel');
export const $closeCartDrawerBtn = getEl('closeCartDrawerBtn');
export const $cartItemsList = getEl('cartItemsList');
export const $cartBenchmarkTotal = getEl('cartBenchmarkTotal');
export const $cartAlternativeTotal = getEl('cartAlternativeTotal');
export const $cartSavingsTotal = getEl('cartSavingsTotal');
export const $clearCartBtn = getEl('clearCartBtn');
export const $cartGeneratePdfBtn = getEl('cartGeneratePdfBtn');

// DOM Chunking & Pagination Controls
export const $paginationContainer = getEl('paginationContainer');
export const $paginationStatus = getEl('paginationStatus');
export const $loadMoreBtn = getEl('loadMoreBtn');
export const $loadMoreBtnText = getEl('loadMoreBtnText');
export const $infiniteScrollSentinel = getEl('infiniteScrollSentinel');

// Modals: How It Works
export const $howItWorksBtn = getEl('howItWorksBtn');
export const $howItWorksModal = getEl('howItWorksModal');
export const $howItWorksDialog = getEl('howItWorksDialog');
export const $closeHowItWorksBtn = getEl('closeHowItWorksBtn');
export const $dismissHowItWorksBtn = getEl('dismissHowItWorksBtn');

// Custom Sorting Dropdown
export const $sortDropdownContainer = getEl('sortDropdownContainer');
export const $sortDropdownTrigger = getEl('sortDropdownTrigger');
export const $sortDropdownMenu = getEl('sortDropdownMenu');
export const $sortCaretIcon = getEl('sortCaretIcon');
export const $sortSelectedLabel = getEl('sortSelectedLabel');

// Theme & Global Scrolling
export const $themeToggleBtn = getEl('themeToggleBtn');
export const $themeToggleSun = getEl('themeToggleSun');
export const $themeToggleMoon = getEl('themeToggleMoon');
export const $scrollProgressBar = getEl('scrollProgressBar');
export const $backToTopBtn = getEl('backToTopBtn');

// ==============================================================================
// UI COMPONENT STATE (CAMELCASE)
// ==============================================================================
export const renderChunkSize = 25;
export let currentRenderQueue = [];
export let currentRenderedCount = 0;
export let infiniteScrollObserver = null;
export let isAppendingChunk = false;

export let discussionCart = [];
export let currentAlternativesList = [];
export let currentSearchResults = null;
export let lastQuery = '';
export let currentSortMode = 'relevance';
let debounceTimer = null;

// ==============================================================================
// NAVBAR STATUS BADGE
// ==============================================================================
export function updateBadgeStatus() {
    if (!$serverStatusBadge) return;
    if (typeof window.Papa !== 'undefined') {
        $serverStatusBadge.className = 'status-online hidden lg:inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full font-medium shadow-xs border border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-[rgba(16,185,129,0.3)] dark:bg-[rgba(16,185,129,0.12)] dark:text-[#34D399]';
        $serverStatusBadge.innerHTML = '<span>🟢 System Online (Dual-Dataset Search)</span>';
    } else {
        $serverStatusBadge.className = 'hidden lg:inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full font-medium shadow-xs border border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-950/40 dark:text-red-400';
        $serverStatusBadge.innerHTML = '<span>🔴 PapaParse Library Missing</span>';
    }
}

// ==============================================================================
// TOAST NOTIFICATIONS & GLOBAL ERROR STATES
// ==============================================================================

/**
 * Injects and manages accessible, rich toast notifications
 * @param {string} message
 * @param {'error'|'warning'|'success'|'info'} [type='error']
 * @param {number} [durationMs=4000]
 */
export function showToast(message, type = 'error', durationMs = 4000) {
    if (typeof document === 'undefined') return;

    let $toastContainer = document.getElementById('toastNotificationContainer');
    if (!$toastContainer) {
        $toastContainer = document.createElement('div');
        $toastContainer.id = 'toastNotificationContainer';
        $toastContainer.className = 'fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none px-4 sm:px-0';
        document.body.appendChild($toastContainer);
    }

    const toast = document.createElement('div');
    toast.className = 'pointer-events-auto flex items-start gap-3 p-3.5 rounded-xl border shadow-lg transition-all duration-300 transform -translate-y-2 opacity-0 text-xs font-medium';

    let iconHtml = '';
    if (type === 'error') {
        toast.className += ' bg-[#161F30] border-red-500/40 text-red-100 shadow-red-950/20';
        iconHtml = '<i class="fa-solid fa-circle-exclamation text-red-400 mt-0.5 text-sm flex-shrink-0"></i>';
    } else if (type === 'warning') {
        toast.className += ' bg-[#161F30] border-amber-500/40 text-amber-100 shadow-amber-950/20';
        iconHtml = '<i class="fa-solid fa-triangle-exclamation text-amber-400 mt-0.5 text-sm flex-shrink-0"></i>';
    } else {
        toast.className += ' bg-[#161F30] border-emerald-500/40 text-emerald-100 shadow-emerald-950/20';
        iconHtml = '<i class="fa-solid fa-circle-check text-emerald-400 mt-0.5 text-sm flex-shrink-0"></i>';
    }

    const contentWrapper = document.createElement('div');
    contentWrapper.className = 'flex-grow text-xs leading-relaxed font-medium text-slate-200';
    contentWrapper.textContent = message;

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'text-slate-400 hover:text-white transition-colors cursor-pointer text-xs ml-auto';
    closeBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    closeBtn.setAttribute('aria-label', 'Dismiss notification');

    toast.innerHTML = iconHtml;
    toast.appendChild(contentWrapper);
    toast.appendChild(closeBtn);
    $toastContainer.appendChild(toast);

    requestAnimationFrame(() => {
        toast.classList.remove('-translate-y-2', 'opacity-0');
        toast.classList.add('translate-y-0', 'opacity-100');
    });

    const removeToast = () => {
        toast.classList.remove('translate-y-0', 'opacity-100');
        toast.classList.add('-translate-y-2', 'opacity-0');
        setTimeout(() => toast.remove(), 250);
    };

    closeBtn.addEventListener('click', removeToast);
    if (durationMs > 0) {
        setTimeout(removeToast, durationMs);
    }
}

// Register toast dispatcher with api.js
registerToastDispatcher(showToast);

/**
 * Injects a clean visual error state into the UI when dataset CSV fetching fails
 * @param {string} [errorMessage]
 */
export function renderDatasetErrorState(errorMessage = 'Network connection failed while fetching medicine datasets.') {
    if ($serverStatusBadge) {
        $serverStatusBadge.className = 'hidden lg:inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full font-medium shadow-xs border border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-950/40 dark:text-red-400';
        $serverStatusBadge.innerHTML = '<span>🔴 Dataset Load Failed</span>';
    }

    if ($resultsCountBadge) {
        $resultsCountBadge.textContent = 'System Unavailable';
    }

    if ($cardsList) {
        $cardsList.innerHTML = `
            <div class="dataset-error-card bg-white dark:bg-[#161F30] border-2 border-red-200 dark:border-red-900/50 rounded-2xl p-6 md:p-8 text-center shadow-xs">
                <div class="w-12 h-12 bg-red-50 dark:bg-red-950/50 text-red-600 dark:text-red-400 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-red-200 dark:border-red-900/40">
                    <i class="fa-solid fa-database text-xl"></i>
                </div>
                <h3 class="text-lg font-bold text-slateBlue dark:text-white mb-2">Failed to Load Drug Datasets</h3>
                <p class="text-xs md:text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto mb-5 leading-relaxed">
                    ${escapeHtml(errorMessage)} We were unable to load the regulatory and market pricing data into memory.
                </p>
                <button type="button" onclick="window.retryInitializeDatasets()" 
                    class="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-xs text-white bg-slateBlue hover:bg-deepSlate dark:bg-emerald-600 dark:hover:bg-emerald-700 shadow-sm transition-all cursor-pointer">
                    <i class="fa-solid fa-rotate-right text-xs"></i>
                    <span>Retry Loading Datasets</span>
                </button>
            </div>
        `;
    }

    showToast('Failed to load medicine dataset. Please check your network and retry.', 'error');
}

/**
 * Injects a visual error state when an individual query fails
 * @param {string} query
 * @param {string} [errorDetails='']
 */
export function renderErrorState(query, errorDetails = '') {
    if (!$resultsCountBadge || !$cardsList) return;
    $resultsCountBadge.textContent = 'Search Error';
    $cardsList.innerHTML = `
        <div class="bg-amber-50 dark:bg-amber-950/40 border border-warningAmber/30 dark:border-amber-800/40 rounded-xl p-6 text-amber-900 dark:text-amber-200 shadow-sm">
            <div class="flex items-start gap-3">
                <i class="fa-solid fa-triangle-exclamation text-warningAmber dark:text-amber-400 text-xl mt-0.5"></i>
                <div class="space-y-1">
                    <h3 class="font-bold text-base">Search Issue</h3>
                    <p class="text-xs md:text-sm text-amber-800 dark:text-amber-300">
                        An error occurred while processing "<strong class="font-semibold text-slate-800 dark:text-white">${escapeHtml(query)}</strong>".
                    </p>
                    ${errorDetails ? `<p class="text-xs text-amber-700 dark:text-amber-400 font-mono pt-1">${escapeHtml(errorDetails)}</p>` : ''}
                </div>
            </div>
        </div>
    `;
    showToast(`Error during search for "${query}".`, 'error');
}

// ==============================================================================
// PRESCRIPTION DISCUSSION CART MANAGEMENT
// ==============================================================================
export function getCartItemKey(item) {
    if (!item) return '';
    const b = (item.brand_name || '').trim().toLowerCase();
    const c = (item.cheaper_brand || '').trim().toLowerCase();
    const g = (item.generic_name || '').trim().toLowerCase();
    return `${b}__${c}__${g}`;
}

export function isItemInCart(item) {
    if (!item) return false;
    const key = getCartItemKey(item);
    return discussionCart.some(cartItem => getCartItemKey(cartItem) === key);
}

export function saveCartToStorage() {
    setStorageItem('medibuddy_discussion_cart', discussionCart);
}

export function loadCartFromStorage() {
    discussionCart = getStorageItem('medibuddy_discussion_cart', []) || [];
}

export function addToCart(item) {
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

export function removeFromCart(key) {
    discussionCart = discussionCart.filter(it => getCartItemKey(it) !== key);
    saveCartToStorage();
    updateCartUI();
}

export function toggleCartItem(index) {
    if (!currentAlternativesList || !currentAlternativesList[index]) return;
    const item = currentAlternativesList[index];
    const key = getCartItemKey(item);

    if (isItemInCart(item)) {
        removeFromCart(key);
    } else {
        addToCart(item);
    }
}

export function clearCart() {
    if (discussionCart.length === 0) return;
    discussionCart = [];
    saveCartToStorage();
    updateCartUI();
}

export function openCartDrawer() {
    const modal = document.getElementById('cartDrawerModal');
    const panel = document.getElementById('cartDrawerPanel');
    const backdrop = document.getElementById('cartDrawerBackdrop');
    if (!modal || !panel) return;

    modal.classList.remove('invisible', 'pointer-events-none', 'opacity-0');
    modal.classList.add('visible', 'pointer-events-auto', 'opacity-100');

    if (backdrop) {
        backdrop.classList.remove('opacity-0');
        backdrop.classList.add('opacity-100');
    }

    panel.classList.remove('translate-x-full');
    panel.classList.add('translate-x-0');

    document.body.style.overflow = 'hidden';
}

export function closeCartDrawer() {
    const modal = document.getElementById('cartDrawerModal');
    const panel = document.getElementById('cartDrawerPanel');
    const backdrop = document.getElementById('cartDrawerBackdrop');
    if (!modal || !panel) return;

    panel.classList.remove('translate-x-0');
    panel.classList.add('translate-x-full');

    if (backdrop) {
        backdrop.classList.remove('opacity-100');
        backdrop.classList.add('opacity-0');
    }

    modal.classList.remove('opacity-100', 'pointer-events-auto');
    modal.classList.add('opacity-0', 'pointer-events-none');

    setTimeout(() => {
        modal.classList.remove('visible');
        modal.classList.add('invisible');
        document.body.style.overflow = '';
    }, 300);
}

/**
 * Robust price sanitizer: strips currency symbols (₹, $, Rs.), commas, and whitespace
 * @param {*} val
 * @returns {number}
 */
export function parsePrice(val) {
    if (val === null || val === undefined || val === '') return 0;
    if (typeof val === 'number') return isFinite(val) && !isNaN(val) ? val : 0;
    const cleaned = String(val).replace(/[^0-9.]/g, '').trim();
    if (!cleaned) return 0;
    const num = parseFloat(cleaned);
    return isFinite(num) && !isNaN(num) ? num : 0;
}

export function updateCartUI() {
    const totalItems = discussionCart.length;

    // Badges
    if ($navCartBadge) {
        $navCartBadge.textContent = String(totalItems);
        $navCartBadge.classList.toggle('hidden', totalItems === 0);
    }
    if ($drawerCartBadge) {
        $drawerCartBadge.textContent = `${totalItems} item${totalItems === 1 ? '' : 's'}`;
    }

    // Totals
    let benchmarkTotal = 0;
    let alternativeTotal = 0;
    discussionCart.forEach(item => {
        benchmarkTotal += parsePrice(item.standard_price);
        alternativeTotal += parsePrice(item.cheaper_price);
    });
    const totalSavings = Math.max(0, benchmarkTotal - alternativeTotal);
    const savingsPercent = benchmarkTotal > 0 ? Math.round((totalSavings / benchmarkTotal) * 100) : 0;

    if ($cartBenchmarkTotal) $cartBenchmarkTotal.textContent = `₹${benchmarkTotal.toFixed(2)}`;
    if ($cartAlternativeTotal) $cartAlternativeTotal.textContent = `₹${alternativeTotal.toFixed(2)}`;
    if ($cartSavingsTotal) {
        $cartSavingsTotal.textContent = `Save ₹${totalSavings.toFixed(2)} (${savingsPercent}%)`;
    }

    // Drawer list
    if ($cartItemsList) {
        if (totalItems === 0) {
            $cartItemsList.innerHTML = `
                <div class="p-8 text-center text-slate-400 dark:text-slate-500">
                    <i class="fa-solid fa-clipboard-list text-4xl mb-3 text-slate-300 dark:text-slate-600"></i>
                    <p class="font-semibold text-slate-700 dark:text-slate-200 text-sm mb-1">Your Doctor Checklist is empty</p>
                    <p class="text-xs max-w-xs mx-auto">Click "Save for Doctor Visit" on any generic alternative to review cost differences with your physician.</p>
                </div>
            `;
        } else {
            let html = '';
            discussionCart.forEach(item => {
                const key = getCartItemKey(item);
                const stdP = parsePrice(item.standard_price);
                const altP = parsePrice(item.cheaper_price);
                const diff = Math.max(0, stdP - altP);

                html += `
                    <div class="p-3.5 bg-slate-50 dark:bg-[#1E293B] rounded-xl border border-slate-200 dark:border-[#334155] flex items-start justify-between gap-3">
                        <div class="flex-grow space-y-1">
                            <div class="flex items-center gap-1.5 flex-wrap">
                                <span class="font-bold text-sm text-slateBlue dark:text-white">${escapeHtml(item.cheaper_brand)}</span>
                                <span class="text-[10px] bg-accentGreen/10 text-accentGreen dark:text-emerald-400 font-bold px-1.5 py-0.5 rounded">Alternative</span>
                            </div>
                            <p class="text-xs text-slate-500 dark:text-slate-400">
                                Active Salt: <strong class="text-slate-700 dark:text-slate-200 font-medium">${escapeHtml(item.generic_name)}</strong>
                            </p>
                            <div class="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-2 pt-0.5">
                                <span>MRP: ₹${stdP.toFixed(2)}</span>
                                <span>&rarr;</span>
                                <span class="font-bold text-accentGreen dark:text-emerald-400">Alt: ₹${altP.toFixed(2)}</span>
                                <span class="text-emerald-700 dark:text-emerald-300 font-semibold">(Save ₹${diff.toFixed(2)})</span>
                            </div>
                        </div>
                        <button type="button" class="cart-remove-item-btn text-slate-400 hover:text-red-500 dark:hover:text-red-400 p-1.5 rounded-lg transition-colors cursor-pointer"
                            data-cart-key="${escapeHtml(key)}" aria-label="Remove item">
                            <i class="fa-solid fa-trash-can text-xs"></i>
                        </button>
                    </div>
                `;
            });
            $cartItemsList.innerHTML = html;

            $cartItemsList.querySelectorAll('.cart-remove-item-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const key = btn.getAttribute('data-cart-key');
                    if (key) removeFromCart(key);
                });
            });
        }
    }

    // Synchronize rendered card selection states
    const cards = document.querySelectorAll('.alternative-drug-card');
    cards.forEach((card, idx) => {
        const altIndex = parseInt(card.getAttribute('data-index'), 10);
        const indexToUse = !isNaN(altIndex) ? altIndex : idx;
        if (!currentAlternativesList || !currentAlternativesList[indexToUse]) return;
        const item = currentAlternativesList[indexToUse];
        const inCart = isItemInCart(item);
        const actionContainer = card.querySelector('.selection-action-container');
        const borderIndicator = card.querySelector('.left-indicator-bar');

        if (inCart) {
            card.className = 'alternative-drug-card is-selected rounded-2xl p-5 md:p-6 transition-all duration-200 relative overflow-hidden mb-4 cursor-pointer border-2 border-accentGreen bg-gradient-to-r from-emerald-50/70 via-white to-white dark:from-emerald-950/40 dark:via-[#161F30] dark:to-[#161F30] dark:border-emerald-500 shadow-sm ring-2 ring-accentGreen/20 dark:ring-emerald-500/30';
            if (borderIndicator) borderIndicator.className = 'left-indicator-bar absolute top-0 left-0 w-1.5 h-full bg-accentGreen dark:bg-emerald-500 transition-colors';
            if (actionContainer) {
                actionContainer.innerHTML = `
                    <button type="button" onclick="event.stopPropagation(); window.toggleCartItem(${indexToUse})" 
                        class="select-alt-btn inline-flex items-center gap-1.5 bg-accentGreen dark:bg-emerald-600 text-white text-xs font-semibold px-4 py-2 rounded-xl shadow-xs hover:bg-emerald-700 transition-all cursor-pointer"
                        data-tooltip="Remove from checklist">
                        <i class="fa-solid fa-check text-sm" aria-hidden="true"></i>
                        <span>Saved to Checklist</span>
                    </button>
                `;
            }
        } else {
            card.className = 'alternative-drug-card rounded-2xl p-5 md:p-6 transition-all duration-200 relative overflow-hidden mb-4 cursor-pointer border border-slate-200 dark:border-[#334155] bg-white dark:bg-[#161F30] hover:border-slate-300 dark:hover:border-slate-500 hover:shadow-xs';
            if (borderIndicator) borderIndicator.className = 'left-indicator-bar absolute top-0 left-0 w-1.5 h-full bg-slate-200 dark:bg-slate-700 group-hover:bg-slate-400 dark:group-hover:bg-slate-500 transition-colors';
            if (actionContainer) {
                actionContainer.innerHTML = `
                    <button type="button" onclick="event.stopPropagation(); window.toggleCartItem(${indexToUse})" 
                        class="select-alt-btn inline-flex items-center gap-1.5 bg-white dark:bg-[#1E293B] text-slate-700 dark:text-slate-200 hover:text-accentGreen dark:hover:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-slate-800 text-xs font-semibold px-4 py-2 rounded-xl border border-slate-200 dark:border-[#334155] hover:border-accentGreen/50 shadow-xs transition-all cursor-pointer"
                        data-tooltip="Save for doctor visit">
                        <i class="fa-solid fa-plus text-accentGreen dark:text-emerald-400" aria-hidden="true"></i>
                        <span>Save for Doctor Visit</span>
                    </button>
                `;
            }
        }
    });
}

// ==============================================================================
// CARD HTML TEMPLATE BUILDERS
// ==============================================================================
export function createAlternativeCardHtml(item, index) {
    const brand = item.brand_name || 'Prescribed Benchmark';
    const cheaperBrand = item.cheaper_brand || 'Generic Alternative';
    const generic = item.generic_name || 'Active API';
    const condition = item.health_condition || 'Therapeutic Use';
    const stdPrice = parsePrice(item.standard_price ?? item['Standard Brand Price (INR)'] ?? item['Standard Price (INR)']);
    const altPrice = parsePrice(item.cheaper_price ?? item['Cheaper Alternative Price (INR)'] ?? item['Cheaper Price (INR)']);
    const savings = Math.max(0, stdPrice - altPrice);
    const savingsPercent = stdPrice > 0 ? Math.round((savings / stdPrice) * 100) : 0;
    const inCart = isItemInCart(item);

    return `
        <div class="alternative-drug-card rounded-2xl p-5 md:p-6 transition-all duration-200 relative overflow-hidden mb-4 cursor-pointer ${
            inCart
                ? 'border-2 border-accentGreen bg-gradient-to-r from-emerald-50/70 via-white to-white dark:from-emerald-950/40 dark:via-[#161F30] dark:to-[#161F30] dark:border-emerald-500 shadow-sm ring-2 ring-accentGreen/20 dark:ring-emerald-500/30 is-selected'
                : 'border border-slate-200 dark:border-[#334155] bg-white dark:bg-[#161F30] hover:border-slate-300 dark:hover:border-slate-500 hover:shadow-xs'
        }" data-index="${index}" onclick="window.toggleCartItem(${index})">
            <div class="left-indicator-bar absolute top-0 left-0 w-1.5 h-full ${inCart ? 'bg-accentGreen dark:bg-emerald-500' : 'bg-slate-200 dark:bg-slate-700 group-hover:bg-slate-400 dark:group-hover:bg-slate-500'} transition-colors"></div>

            <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div class="flex-grow space-y-1.5">
                    <div class="flex items-center gap-2.5 flex-wrap">
                        <h3 class="text-xl font-bold text-slateBlue dark:text-[#F8FAFC] tracking-tight">${escapeHtml(cheaperBrand)}</h3>
                        <span class="bg-accentGreen dark:bg-emerald-600 text-white text-[10px] font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider flex items-center gap-1 shadow-xs">
                            <i class="fa-solid fa-check"></i> Cheaper Alternative
                        </span>
                        <span class="text-xs bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium px-2.5 py-0.5 rounded-full border border-slate-200 dark:border-[#334155]">
                            ${escapeHtml(condition)}
                        </span>
                    </div>

                    <p class="text-sm text-slate-600 dark:text-[#94A3B8] font-medium">
                        Active Generic API: <span class="font-semibold text-accentGreen dark:text-emerald-400">${escapeHtml(generic)}</span>
                    </p>
                    <p class="text-xs text-slate-500 dark:text-[#94A3B8]">
                        Prescribed Brand Benchmark: <strong class="text-slate-700 dark:text-slate-200 font-semibold">${escapeHtml(brand)}</strong> (Standard: ₹${stdPrice.toFixed(2)})
                    </p>
                    <p class="text-[11px] text-slate-400 dark:text-slate-500">
                        Bioequivalent Generic Substitute &bull; Verified Indian Prescribed Dataset
                    </p>
                </div>

                <div class="flex flex-row md:flex-col items-center md:items-end justify-between w-full md:w-auto gap-3 pt-3 md:pt-0 border-t md:border-t-0 border-slate-100 dark:border-[#334155]/60">
                    <div class="text-left md:text-right">
                        <span class="text-[10px] font-bold uppercase text-slate-400 dark:text-[#94A3B8] tracking-wider block">Estimated Savings</span>
                        <span class="font-bold text-accentGreen dark:text-emerald-400 text-lg md:text-xl">Save ₹${savings.toFixed(2)}</span>
                        <span class="text-[11px] text-emerald-700 dark:text-emerald-400 font-semibold block">(${savingsPercent}% lower cost)</span>
                    </div>

                    <div class="selection-action-container">
                        ${inCart ? `
                            <button type="button" onclick="event.stopPropagation(); window.toggleCartItem(${index})" 
                                class="select-alt-btn inline-flex items-center gap-1.5 bg-accentGreen dark:bg-emerald-600 text-white text-xs font-semibold px-4 py-2 rounded-xl shadow-xs hover:bg-emerald-700 transition-all cursor-pointer"
                                data-tooltip="Remove from checklist">
                                <i class="fa-solid fa-check text-sm" aria-hidden="true"></i>
                                <span>Saved to Checklist</span>
                            </button>
                        ` : `
                            <button type="button" onclick="event.stopPropagation(); window.toggleCartItem(${index})" 
                                class="select-alt-btn inline-flex items-center gap-1.5 bg-white dark:bg-[#1E293B] text-slate-700 dark:text-slate-200 hover:text-accentGreen dark:hover:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-slate-800 text-xs font-semibold px-4 py-2 rounded-xl border border-slate-200 dark:border-[#334155] hover:border-accentGreen/50 shadow-xs transition-all cursor-pointer"
                                data-tooltip="Save for doctor visit">
                                <i class="fa-solid fa-plus text-accentGreen dark:text-emerald-400" aria-hidden="true"></i>
                                <span>Save for Doctor Visit</span>
                            </button>
                        `}
                    </div>
                </div>
            </div>

            <div class="mt-4 pt-3 border-t border-slate-100 dark:border-[#334155]/60 flex justify-between items-center text-xs">
                <div class="text-slate-500 dark:text-[#94A3B8]">
                    Estimated retail price per pack
                </div>
                <div class="flex items-baseline gap-2">
                    <span class="text-slate-400 dark:text-slate-500 line-through text-xs">₹${stdPrice.toFixed(2)}</span>
                    <span class="font-bold text-slateBlue dark:text-[#F8FAFC] text-xl">₹${altPrice.toFixed(2)}</span>
                </div>
            </div>
        </div>
    `;
}

export function createCdscoCardHtml(item) {
    const drugName = item.drug_name || 'Standard Regulatory Formulation';
    const genericApi = item.clean_generic_api || 'Approved Chemical Entity';
    const indication = item.indication || 'General therapeutic use';
    const approvalDate = item.approval_date || item.source_year || 'Approved';

    return `
        <div class="cdsco-record-card bg-white dark:bg-[#161F30] border border-slate-200 dark:border-[#334155] rounded-2xl p-5 md:p-6 shadow-xs hover:border-slate-300 dark:hover:border-slate-500 hover:shadow-sm transition-all relative overflow-hidden group mb-4">
            <div class="absolute top-0 left-0 w-1.5 h-full bg-slate-200 dark:bg-slate-700 group-hover:bg-slate-300 dark:group-hover:bg-slate-600 transition-colors"></div>

            <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div class="flex-grow min-w-0 space-y-1.5">
                    <div class="flex items-center gap-2.5 flex-wrap">
                        <h3 class="text-xl font-bold text-slateBlue dark:text-[#F8FAFC] tracking-tight">${escapeHtml(drugName)}</h3>
                        <span class="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[10px] font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider border border-slate-200 dark:border-[#334155] flex items-center gap-1 shadow-xs">
                            <i class="fa-solid fa-shield-halved text-slate-500 dark:text-slate-400"></i> CDSCO Registry
                        </span>
                    </div>

                    <p class="text-sm text-slate-600 dark:text-[#94A3B8] font-medium">
                        Active Regulatory API: <span class="font-semibold text-slate-900 dark:text-[#F8FAFC]">${escapeHtml(genericApi)}</span>
                    </p>
                    <p class="text-xs text-slate-500 dark:text-[#94A3B8]">
                        <strong class="text-slate-600 dark:text-slate-300 font-medium">Approved Indication:</strong> ${escapeHtml(indication)}
                    </p>
                    <p class="text-[11px] text-slate-400 dark:text-slate-500">
                        Regulatory Approval: ${escapeHtml(approvalDate)} &bull; S.No: ${escapeHtml(item.s_no || '')}
                    </p>
                </div>

                <div class="flex flex-row md:flex-col items-center md:items-end justify-between md:justify-center w-full md:w-auto md:min-w-[190px] flex-shrink-0 pt-3 md:pt-0 border-t md:border-t-0 border-slate-100 dark:border-[#334155]/60 gap-1.5">
                    <span class="text-[10px] font-bold uppercase text-slate-400 dark:text-[#94A3B8] tracking-wider">Regulatory Standard</span>
                    <span class="inline-flex items-center gap-1.5 text-slate-700 dark:text-slate-200 font-semibold text-xs bg-slate-50 dark:bg-slate-800 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-[#334155] shadow-xs whitespace-nowrap cursor-default select-none">
                        <i class="fa-solid fa-certificate text-emerald-600 dark:text-emerald-400 text-xs"></i>
                        <span>Reference Listed Drug</span>
                    </span>
                </div>
            </div>
        </div>
    `;
}

export function createSectionHeaderHtml(title, count, icon, subtitle) {
    return `
        <div class="mt-4 mb-3 pt-4 border-t border-slate-200/80 dark:border-[#334155] flex items-center justify-between flex-wrap gap-2">
            <div class="flex items-center gap-2">
                <i class="${icon} text-slate-400 dark:text-slate-500 text-sm"></i>
                <h4 class="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">${escapeHtml(title)} (${count})</h4>
            </div>
            ${subtitle ? `<span class="text-[11px] text-slate-400 dark:text-slate-500">${escapeHtml(subtitle)}</span>` : ''}
        </div>
    `;
}

// ==============================================================================
// CHUNKED DOM RENDERING & PAGINATION CONTROLLERS
// ==============================================================================
export function updatePaginationControls() {
    if (!$paginationContainer || !$paginationStatus || !$loadMoreBtn) return;

    const totalItems = currentRenderQueue.filter(i => i.kind !== 'header').length;

    if (totalItems <= renderChunkSize) {
        $paginationContainer.classList.add('hidden');
        $paginationContainer.classList.remove('flex');
        if (infiniteScrollObserver && $infiniteScrollSentinel) {
            infiniteScrollObserver.unobserve($infiniteScrollSentinel);
        }
        return;
    }

    $paginationContainer.classList.remove('hidden');
    $paginationContainer.classList.add('flex');

    const displayedCount = currentRenderQueue.slice(0, currentRenderedCount).filter(i => i.kind !== 'header').length;

    if (currentRenderedCount < currentRenderQueue.length) {
        $loadMoreBtn.classList.remove('hidden');
        const remaining = totalItems - displayedCount;
        if ($loadMoreBtnText) {
            $loadMoreBtnText.textContent = `Show More Results (${remaining} remaining)`;
        }
        $paginationStatus.innerHTML = `Showing <strong class="font-semibold text-slate-800 dark:text-slate-100">${displayedCount}</strong> of <strong class="font-semibold text-slate-800 dark:text-slate-100">${totalItems}</strong> matching medicines`;

        if (infiniteScrollObserver && $infiniteScrollSentinel) {
            infiniteScrollObserver.observe($infiniteScrollSentinel);
        }
    } else {
        $loadMoreBtn.classList.add('hidden');
        if (infiniteScrollObserver && $infiniteScrollSentinel) {
            infiniteScrollObserver.unobserve($infiniteScrollSentinel);
        }
        $paginationStatus.innerHTML = `
            <span class="inline-flex items-center gap-1.5 text-accentGreen dark:text-emerald-400 font-semibold text-xs">
                <i class="fa-solid fa-circle-check"></i> All ${totalItems} matching medicines loaded
            </span>
        `;
    }
}

export function renderNextChunk() {
    if (isAppendingChunk) return;
    if (currentRenderedCount >= currentRenderQueue.length) {
        updatePaginationControls();
        return;
    }

    isAppendingChunk = true;
    const startIndex = currentRenderedCount;
    const endIndex = Math.min(startIndex + renderChunkSize, currentRenderQueue.length);
    const chunk = currentRenderQueue.slice(startIndex, endIndex);

    let chunkHtml = '';
    for (let i = 0; i < chunk.length; i++) {
        const itemObj = chunk[i];
        if (itemObj.kind === 'header') {
            chunkHtml += createSectionHeaderHtml(itemObj.title, itemObj.count, itemObj.icon, itemObj.subtitle);
        } else if (itemObj.kind === 'alternative') {
            chunkHtml += createAlternativeCardHtml(itemObj.data, itemObj.altIndex);
        } else if (itemObj.kind === 'cdsco') {
            chunkHtml += createCdscoCardHtml(itemObj.data);
        }
    }

    $cardsList.insertAdjacentHTML('beforeend', chunkHtml);
    currentRenderedCount = endIndex;

    updateCartUI();
    updatePaginationControls();

    isAppendingChunk = false;
}

export function setupInfiniteScroll() {
    if (!$infiniteScrollSentinel) return;

    if (infiniteScrollObserver) {
        infiniteScrollObserver.disconnect();
    }

    if ('IntersectionObserver' in window) {
        infiniteScrollObserver = new IntersectionObserver((entries) => {
            const entry = entries[0];
            if (entry && entry.isIntersecting) {
                if (!isAppendingChunk && currentRenderedCount < currentRenderQueue.length) {
                    renderNextChunk();
                }
            }
        }, {
            root: null,
            rootMargin: '250px',
            threshold: 0.01
        });

        infiniteScrollObserver.observe($infiniteScrollSentinel);
    }
}

export function renderSkeletonCards(count = 3) {
    if (!$cardsList) return;
    let skeletonHtml = '';
    for (let i = 0; i < count; i++) {
        skeletonHtml += `
            <div class="rounded-2xl p-5 md:p-6 mb-4 border border-slate-200/80 dark:border-[#334155] bg-white dark:bg-[#161F30] shadow-xs relative overflow-hidden animate-pulse">
                <div class="absolute top-0 left-0 w-1.5 h-full bg-slate-200 dark:bg-slate-700"></div>
                <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div class="flex-grow space-y-2.5 w-full md:w-3/5">
                        <div class="flex items-center gap-2.5 flex-wrap">
                            <div class="h-6 w-32 bg-slate-200 dark:bg-slate-700 rounded-md"></div>
                            <div class="h-5 w-28 bg-emerald-100 dark:bg-emerald-950/60 rounded-full"></div>
                            <div class="h-5 w-20 bg-slate-100 dark:bg-slate-800 rounded-full"></div>
                        </div>
                        <div class="h-4 w-48 bg-slate-200/90 dark:bg-slate-700/80 rounded"></div>
                        <div class="h-3 w-56 bg-slate-100 dark:bg-slate-800 rounded"></div>
                        <div class="h-3 w-40 bg-slate-100 dark:bg-slate-800 rounded"></div>
                    </div>
                    <div class="flex flex-row md:flex-col items-center md:items-end justify-between w-full md:w-auto gap-3 pt-3 md:pt-0 border-t md:border-t-0 border-slate-100 dark:border-[#334155]/60">
                        <div class="space-y-1 text-left md:text-right">
                            <div class="h-3 w-20 bg-slate-100 dark:bg-slate-800 rounded md:ml-auto"></div>
                            <div class="h-6 w-28 bg-emerald-100 dark:bg-emerald-950/60 rounded md:ml-auto"></div>
                        </div>
                        <div class="h-9 w-36 bg-slate-200 dark:bg-slate-700 rounded-xl"></div>
                    </div>
                </div>
            </div>
        `;
    }
    $cardsList.innerHTML = skeletonHtml;
}

export function renderResults(query, searchResults) {
    if (!$cardsList || !$resultsCountBadge || !$activeSaltDisplay) return;

    currentSearchResults = searchResults;
    const rawPriceAlternatives = (searchResults && searchResults.priceAlternatives) || [];
    const officialAPIs = (searchResults && searchResults.officialAPIs) || [];
    const totalCount = rawPriceAlternatives.length + officialAPIs.length;

    const priceAlternatives = sortResults(rawPriceAlternatives, currentSortMode);
    currentAlternativesList = priceAlternatives;

    if (totalCount === 0) {
        $resultsCountBadge.textContent = '0 matches found';
        $activeSaltDisplay.innerHTML = 'Active Salt: <span class="font-semibold text-slate-400 dark:text-slate-500">No matching salt</span>';

        $cardsList.innerHTML = `
            <div class="empty-state-card bg-white dark:bg-[#161F30] border border-slate-200 dark:border-[#334155] rounded-xl p-8 text-center text-slate-600 dark:text-[#94A3B8] shadow-sm">
                <i class="fa-solid fa-magnifying-glass text-4xl text-slate-300 dark:text-slate-600 mb-3"></i>
                <h3 class="text-lg font-bold text-slateBlue dark:text-[#F8FAFC] mb-1">No matching medicines found</h3>
                <p class="text-sm text-slate-500 dark:text-[#94A3B8] max-w-md mx-auto mb-4">
                    We couldn't find any record matching "<strong class="text-slate-700 dark:text-[#F8FAFC]">${escapeHtml(query)}</strong>" across either dataset.
                </p>
                <div class="flex flex-wrap justify-center gap-2 text-xs">
                    <span class="text-slate-400 dark:text-slate-500">Try searching:</span>
                    <button type="button" onclick="window.performSearch('Calpol')" class="text-slateBlue dark:text-emerald-400 font-semibold underline hover:text-accentGreen dark:hover:text-emerald-300 transition-colors cursor-pointer">Calpol</button>
                    <button type="button" onclick="window.performSearch('Paracetamol')" class="text-slateBlue dark:text-emerald-400 font-semibold underline hover:text-accentGreen dark:hover:text-emerald-300 transition-colors cursor-pointer">Paracetamol</button>
                    <button type="button" onclick="window.performSearch('Combiflam')" class="text-slateBlue dark:text-emerald-400 font-semibold underline hover:text-accentGreen dark:hover:text-emerald-300 transition-colors cursor-pointer">Combiflam</button>
                    <button type="button" onclick="window.performSearch('Augmentin')" class="text-slateBlue dark:text-emerald-400 font-semibold underline hover:text-accentGreen dark:hover:text-emerald-300 transition-colors cursor-pointer">Augmentin</button>
                    <button type="button" onclick="window.performSearch('Metformin')" class="text-slateBlue dark:text-emerald-400 font-semibold underline hover:text-accentGreen dark:hover:text-emerald-300 transition-colors cursor-pointer">Metformin</button>
                </div>
            </div>
        `;
        if ($paginationContainer) {
            $paginationContainer.classList.add('hidden');
            $paginationContainer.classList.remove('flex');
        }
        if (infiniteScrollObserver && $infiniteScrollSentinel) {
            infiniteScrollObserver.unobserve($infiniteScrollSentinel);
        }
        updateCartUI();
        return;
    }

    let primarySalt = 'Generic Bioequivalent API';
    if (priceAlternatives.length > 0) {
        primarySalt = priceAlternatives[0].generic_name;
    } else if (officialAPIs.length > 0) {
        primarySalt = officialAPIs[0].clean_generic_api;
    }

    $activeSaltDisplay.innerHTML = `Active Salt: <span class="font-semibold text-slate-700 dark:text-slate-200">${escapeHtml(primarySalt)}</span>`;
    $resultsCountBadge.textContent = `${totalCount} option${totalCount > 1 ? 's' : ''} found (${priceAlternatives.length} market, ${officialAPIs.length} CDSCO)`;

    currentRenderQueue = [];
    priceAlternatives.forEach((item, index) => {
        currentRenderQueue.push({
            kind: 'alternative',
            data: item,
            altIndex: index
        });
    });

    if (priceAlternatives.length > 0 && officialAPIs.length > 0) {
        currentRenderQueue.push({
            kind: 'header',
            title: 'CDSCO Regulatory Standard Registry',
            count: officialAPIs.length,
            icon: 'fa-solid fa-shield-halved',
            subtitle: 'Central Drugs Standard Control Organisation approved chemical entities'
        });
    }

    officialAPIs.forEach((item, index) => {
        currentRenderQueue.push({
            kind: 'cdsco',
            data: item,
            cdscoIndex: index
        });
    });

    currentRenderedCount = 0;
    $cardsList.innerHTML = '';

    setupInfiniteScroll();
    renderNextChunk();
}

export function performSearch(customQuery = null) {
    if (!$searchInput) return;
    const query = (customQuery !== null ? customQuery : $searchInput.value).trim();
    if (!query) return;

    lastQuery = query;
    $searchInput.value = query;
    if ($searchQueryDisplay) {
        $searchQueryDisplay.textContent = query.charAt(0).toUpperCase() + query.slice(1);
    }

    if ($heroSection) {
        $heroSection.classList.add('md:pt-0', 'mb-6', 'scale-[0.98]');
        $heroSection.classList.remove('mb-8');
    }
    if ($resultsContainer) {
        $resultsContainer.classList.remove('hidden');
        $resultsContainer.classList.add('flex');
    }

    if (!isLocalDbReady) {
        if ($resultsCountBadge) $resultsCountBadge.textContent = 'Parsing datasets...';
        renderSkeletonCards(3);
        return;
    }

    const cleanQuery = query.toLowerCase();

    // Cache hit: instant render
    if (searchCache[cleanQuery]) {
        try {
            const searchResults = searchMaster(query);
            currentSearchResults = searchResults;
            renderResults(query, searchResults);
        } catch (err) {
            renderErrorState(query, err.message || 'Cache search failed.');
        }
        return;
    }

    if ($resultsCountBadge) $resultsCountBadge.textContent = 'Searching options...';
    renderSkeletonCards(3);

    // Cache miss: execute search
    setTimeout(() => {
        try {
            const searchResults = searchMaster(query);
            currentSearchResults = searchResults;
            renderResults(query, searchResults);
        } catch (err) {
            renderErrorState(query, err.message || 'Dataset search failed.');
        }
    }, 60);
}

// ==============================================================================
// PDF NOTE GENERATOR
// ==============================================================================
export function generateDoctorRequestNotePdf() {
    const { jsPDF } = window.jspdf || {};
    if (!jsPDF) {
        alert('The PDF generator library is still loading. Please check your internet connection and try again.');
        return;
    }

    let itemsToPrint = [...discussionCart];

    if (itemsToPrint.length === 0) {
        if (currentAlternativesList && currentAlternativesList.length > 0) {
            addToCart(currentAlternativesList[0]);
            itemsToPrint = [...discussionCart];
        } else {
            alert('Your Doctor Checklist is empty. Please search and add at least one generic alternative before generating a note.');
            openCartDrawer();
            return;
        }
    }

    const defaultDrawerBtnHtml = `
        <i class="fa-regular fa-file-lines text-base"></i>
        <span>Note Generator</span>
        <i class="fa-solid fa-arrow-right text-xs"></i>
    `;

    const setButtonsLoading = () => {
        if ($cartGeneratePdfBtn) {
            $cartGeneratePdfBtn.innerHTML = `
                <i class="fa-solid fa-circle-notch fa-spin text-sm"></i>
                <span>Generating Note (${itemsToPrint.length} item${itemsToPrint.length > 1 ? 's' : ''})...</span>
            `;
            $cartGeneratePdfBtn.disabled = true;
        }
    };

    const resetButtonsSuccess = () => {
        if ($cartGeneratePdfBtn) {
            $cartGeneratePdfBtn.innerHTML = `
                <i class="fa-solid fa-circle-check text-emerald-400 text-sm"></i>
                <span>Note Downloaded!</span>
            `;
        }
        setTimeout(() => {
            if ($cartGeneratePdfBtn) {
                $cartGeneratePdfBtn.innerHTML = defaultDrawerBtnHtml;
                $cartGeneratePdfBtn.disabled = false;
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
        doc.setFillColor(35, 57, 77);
        doc.roundedRect(margin, 12, contentWidth, 24, 3, 3, 'F');

        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(14);
        doc.text('MEDIBUDDY - CLINICAL DISCUSSION AID', margin + 8, 22);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.5);
        doc.setTextColor(203, 213, 225);
        doc.text('Patient Generic Substitution Request | Bioequivalent Formulations (CDSCO Standards)', margin + 8, 29);

        // Date
        const currentDate = new Date().toLocaleDateString('en-IN', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
        doc.setFontSize(7.5);
        doc.text(`Generated: ${currentDate}`, pageWidth - margin - 45, 22);

        let currentY = 44;

        // Intro
        doc.setTextColor(15, 23, 42);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9.5);
        doc.text('Dear Prescribing Physician / Medical Practitioner,', margin, currentY);
        currentY += 5;

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.5);
        doc.setTextColor(51, 65, 85);
        const introText = 'The patient has identified the following generic bioequivalent medicines to reduce out-of-pocket prescription expenses. Please review the proposed active ingredients and standard therapeutic indications to evaluate if substitution is clinically appropriate for this course of treatment.';
        const splitIntro = doc.splitTextToSize(introText, contentWidth);
        doc.text(splitIntro, margin, currentY);
        currentY += (splitIntro.length * 4.2) + 4;

        // Table Header
        doc.setFillColor(241, 245, 249);
        doc.roundedRect(margin, currentY, contentWidth, 8, 1.5, 1.5, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.setTextColor(30, 41, 59);

        doc.text('PRESCRIBED BENCHMARK', margin + 4, currentY + 5.5);
        doc.text('RECOMMENDED GENERIC', margin + 50, currentY + 5.5);
        doc.text('ACTIVE INGREDIENT (API)', margin + 102, currentY + 5.5);
        doc.text('EST. SAVINGS', margin + 152, currentY + 5.5);
        currentY += 10;

        // Table Rows
        let totalSavingsSum = 0;
        itemsToPrint.forEach((item, idx) => {
            const stdP = Number(item.standard_price) || 0;
            const altP = Number(item.cheaper_price) || 0;
            const sav = Math.max(0, stdP - altP);
            totalSavingsSum += sav;

            if (idx % 2 === 1) {
                doc.setFillColor(248, 250, 252);
                doc.rect(margin, currentY - 2.5, contentWidth, 12, 'F');
            }

            doc.setFont('helvetica', 'bold');
            doc.setFontSize(8);
            doc.setTextColor(30, 41, 59);
            doc.text(doc.splitTextToSize(item.brand_name || 'Standard Prescribed', 44), margin + 4, currentY + 1.5);

            doc.setTextColor(21, 128, 61);
            doc.text(doc.splitTextToSize(item.cheaper_brand || 'Generic Alternative', 48), margin + 50, currentY + 1.5);

            doc.setFont('helvetica', 'normal');
            doc.setTextColor(71, 85, 105);
            doc.text(doc.splitTextToSize(item.generic_name || 'Generic API', 46), margin + 102, currentY + 1.5);

            doc.setFont('helvetica', 'bold');
            doc.setTextColor(21, 128, 61);
            doc.text(`Save Rs. ${sav.toFixed(2)}`, margin + 152, currentY + 1.5);

            currentY += 12;
        });

        // Summary box
        currentY += 4;
        doc.setDrawColor(226, 232, 240);
        doc.setFillColor(248, 250, 252);
        doc.roundedRect(margin, currentY, contentWidth, 16, 2, 2, 'FD');

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(30, 41, 59);
        doc.text(`Total Prescription Candidates: ${itemsToPrint.length} medicine(s)`, margin + 6, currentY + 6.5);

        doc.setTextColor(21, 128, 61);
        doc.text(`Estimated Out-of-Pocket Savings: Rs. ${totalSavingsSum.toFixed(2)} per refill cycle`, margin + 6, currentY + 12);
        currentY += 22;

        // Signatures
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(71, 85, 105);
        doc.text('Patient Signature: _________________________________________', margin, currentY);
        doc.text('Date: ________________________', pageWidth - margin - 50, currentY);
        currentY += 6.5;
        doc.text('Printed Patient Name: _____________________________________', margin, currentY);
        doc.text('Phone: _______________________', pageWidth - margin - 50, currentY);

        // Disclaimer
        const footerY = 276;
        doc.setDrawColor(226, 232, 240);
        doc.line(margin, footerY - 4, margin + contentWidth, footerY - 4);
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(7.5);
        doc.setTextColor(148, 163, 184);
        const disclaimer = 'Notice: This document is an educational patient discussion aid prepared via MediBuddy. It does NOT constitute a valid medical prescription. All substitution decisions remain solely under the clinical discretion of your licensed treating physician.';
        const disclaimerLines = doc.splitTextToSize(disclaimer, contentWidth);
        doc.text(disclaimerLines, margin, footerY);

        doc.save(`Doctor_Request_Note_${itemsToPrint.length}_Medications.pdf`);
        resetButtonsSuccess();
    } catch {
        showToast('Failed to generate PDF note. Please check your selected items and retry.', 'error');
        if ($cartGeneratePdfBtn) {
            $cartGeneratePdfBtn.innerHTML = defaultDrawerBtnHtml;
            $cartGeneratePdfBtn.disabled = false;
        }
    }
}

// ==============================================================================
// MODALS & DRAWERS INITIALIZERS
// ==============================================================================
export function openHowItWorksModal(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (!$howItWorksModal || !$howItWorksDialog) return;
    $howItWorksModal.classList.remove('opacity-0', 'pointer-events-none', 'invisible');
    $howItWorksModal.classList.add('opacity-100', 'pointer-events-auto', 'visible');
    $howItWorksDialog.classList.remove('scale-95');
    $howItWorksDialog.classList.add('scale-100');
    document.body.style.overflow = 'hidden';
}

export function closeHowItWorksModal(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (!$howItWorksModal || !$howItWorksDialog) return;
    $howItWorksModal.classList.remove('opacity-100', 'pointer-events-auto', 'visible');
    $howItWorksModal.classList.add('opacity-0', 'pointer-events-none', 'invisible');
    $howItWorksDialog.classList.remove('scale-100');
    $howItWorksDialog.classList.add('scale-95');
    document.body.style.overflow = '';
}

export function initSortDropdown() {
    if (!$sortDropdownTrigger || !$sortDropdownMenu || !$sortDropdownContainer) return;

    const labels = {
        'relevance': 'Relevance',
        'price-asc': 'Price: Low to High',
        'savings-desc': 'Highest Savings'
    };

    function toggleMenu(show) {
        const willShow = (typeof show === 'boolean') ? show : $sortDropdownMenu.classList.contains('invisible');
        if (willShow) {
            $sortDropdownMenu.classList.remove('opacity-0', 'translate-y-1', 'invisible', 'pointer-events-none');
            $sortDropdownMenu.classList.add('opacity-100', 'translate-y-0', 'visible', 'pointer-events-auto');
            if ($sortCaretIcon) $sortCaretIcon.classList.add('rotate-180');
            $sortDropdownTrigger.setAttribute('aria-expanded', 'true');
        } else {
            $sortDropdownMenu.classList.remove('opacity-100', 'translate-y-0', 'visible', 'pointer-events-auto');
            $sortDropdownMenu.classList.add('opacity-0', 'translate-y-1', 'invisible', 'pointer-events-none');
            if ($sortCaretIcon) $sortCaretIcon.classList.remove('rotate-180');
            $sortDropdownTrigger.setAttribute('aria-expanded', 'false');
        }
    }

    $sortDropdownTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleMenu();
    });

    const optionBtns = $sortDropdownMenu.querySelectorAll('.sort-option-btn');
    optionBtns.forEach(btn => {
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            const val = this.getAttribute('data-value');
            if (!val) return;

            currentSortMode = val;
            if ($sortFilterSelect && $sortFilterSelect.value !== val) {
                $sortFilterSelect.value = val;
            }
            if ($sortSelectedLabel) $sortSelectedLabel.textContent = labels[val] || 'Relevance';

            optionBtns.forEach(b => {
                const isSelected = (b.getAttribute('data-value') === val);
                b.setAttribute('aria-selected', isSelected ? 'true' : 'false');
                const checkIcon = b.querySelector('.sort-check-icon');
                if (isSelected) {
                    b.classList.add('bg-slate-100/90', 'text-slateBlue', 'font-semibold');
                    b.classList.remove('hover:bg-slate-50', 'text-slate-600', 'font-medium');
                    if (checkIcon) checkIcon.classList.remove('hidden');
                } else {
                    b.classList.remove('bg-slate-100/90', 'text-slateBlue', 'font-semibold');
                    b.classList.add('hover:bg-slate-50', 'text-slate-600', 'font-medium');
                    if (checkIcon) checkIcon.classList.add('hidden');
                }
            });

            toggleMenu(false);

            if (currentSearchResults && lastQuery) {
                renderResults(lastQuery, currentSearchResults);
            }
        });
    });

    document.addEventListener('click', (e) => {
        if (!$sortDropdownContainer.contains(e.target)) {
            toggleMenu(false);
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !$sortDropdownMenu.classList.contains('invisible')) {
            toggleMenu(false);
            $sortDropdownTrigger.focus();
        }
    });
}

export function applyTheme(theme) {
    const isDark = (theme === 'dark');
    if (isDark) {
        document.documentElement.classList.add('dark');
        if ($themeToggleSun) $themeToggleSun.classList.remove('hidden');
        if ($themeToggleMoon) $themeToggleMoon.classList.add('hidden');
    } else {
        document.documentElement.classList.remove('dark');
        if ($themeToggleSun) $themeToggleSun.classList.add('hidden');
        if ($themeToggleMoon) $themeToggleMoon.classList.remove('hidden');
    }

    if ($themeToggleBtn) {
        const label = isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode';
        $themeToggleBtn.setAttribute('aria-label', label);
        $themeToggleBtn.setAttribute('data-tooltip', label);
    }
}

export function initThemeToggle() {
    if (!$themeToggleBtn) return;
    let activeTheme = 'light';
    const saved = getStorageItem('medibuddy_theme', null);
    if (saved === 'dark' || saved === 'light') {
        activeTheme = saved;
    } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        activeTheme = 'dark';
    }

    applyTheme(activeTheme);

    $themeToggleBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const currentlyDark = document.documentElement.classList.contains('dark');
        const nextTheme = currentlyDark ? 'light' : 'dark';
        applyTheme(nextTheme);
        setStorageItem('medibuddy_theme', nextTheme);
    });

    if (window.matchMedia) {
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
            if (!getStorageItem('medibuddy_theme', null)) {
                applyTheme(e.matches ? 'dark' : 'light');
            }
        });
    }
}

export function initScrollControllers() {
    function handleScroll() {
        const scrollTop = window.scrollY || document.documentElement.scrollTop;
        const scrollHeight = document.documentElement.scrollHeight - document.documentElement.clientHeight;
        const progress = scrollHeight > 0 ? (scrollTop / scrollHeight) * 100 : 0;

        if ($scrollProgressBar) {
            $scrollProgressBar.style.width = `${Math.min(100, Math.max(0, progress))}%`;
        }

        if ($backToTopBtn) {
            if (scrollTop > 300) {
                $backToTopBtn.classList.remove('opacity-0', 'pointer-events-none', 'translate-y-3');
                $backToTopBtn.classList.add('opacity-100', 'pointer-events-auto', 'translate-y-0');
            } else {
                $backToTopBtn.classList.remove('opacity-100', 'pointer-events-auto', 'translate-y-0');
                $backToTopBtn.classList.add('opacity-0', 'pointer-events-none', 'translate-y-3');
            }
        }
    }

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();

    if ($backToTopBtn) {
        $backToTopBtn.addEventListener('click', (e) => {
            e.preventDefault();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }
}

// ==============================================================================
// ATTACH DOM LISTENERS
// ==============================================================================
export function initUiEventListeners() {
    // Search input debounce and enter key
    if ($searchInput) {
        $searchInput.addEventListener('input', (e) => {
            clearTimeout(debounceTimer);
            const query = e.target.value.trim();
            if (query.length >= 2) {
                debounceTimer = setTimeout(() => {
                    performSearch(query);
                }, 350);
            }
        });

        $searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                clearTimeout(debounceTimer);
                performSearch();
            }
        });
    }

    if ($searchBtn) {
        $searchBtn.addEventListener('click', () => performSearch());
    }

    if ($popularChips) {
        $popularChips.addEventListener('click', (e) => {
            const btn = e.target.closest('.chip-btn');
            if (btn) {
                const term = btn.getAttribute('data-term');
                if (term) performSearch(term);
            }
        });
    }

    // Pagination Load More
    if ($loadMoreBtn) {
        $loadMoreBtn.addEventListener('click', () => {
            if (!isAppendingChunk && currentRenderedCount < currentRenderQueue.length) {
                renderNextChunk();
            }
        });
    }

    // Drawer triggers - bound explicitly via document.getElementById
    const navCartBtn = document.getElementById('navCartBtn');
    if (navCartBtn) {
        navCartBtn.addEventListener('click', (e) => {
            e.preventDefault();
            openCartDrawer();
        });
    }

    const closeCartDrawerBtn = document.getElementById('closeCartDrawerBtn');
    if (closeCartDrawerBtn) {
        closeCartDrawerBtn.addEventListener('click', (e) => {
            e.preventDefault();
            closeCartDrawer();
        });
    }

    const cartDrawerBackdrop = document.getElementById('cartDrawerBackdrop');
    if (cartDrawerBackdrop) {
        cartDrawerBackdrop.addEventListener('click', (e) => {
            e.preventDefault();
            closeCartDrawer();
        });
    }

    const clearCartBtn = document.getElementById('clearCartBtn');
    if (clearCartBtn) {
        clearCartBtn.addEventListener('click', (e) => {
            e.preventDefault();
            clearCart();
        });
    }

    const cartGeneratePdfBtn = document.getElementById('cartGeneratePdfBtn');
    if (cartGeneratePdfBtn) {
        cartGeneratePdfBtn.addEventListener('click', (e) => {
            e.preventDefault();
            generateDoctorRequestNotePdf();
        });
    }

    // How It Works Modal
    if ($howItWorksBtn) $howItWorksBtn.addEventListener('click', openHowItWorksModal);
    if ($closeHowItWorksBtn) $closeHowItWorksBtn.addEventListener('click', closeHowItWorksModal);
    if ($dismissHowItWorksBtn) $dismissHowItWorksBtn.addEventListener('click', closeHowItWorksModal);
    if ($howItWorksDialog) {
        $howItWorksDialog.addEventListener('click', (e) => e.stopPropagation());
    }
    if ($howItWorksModal) {
        $howItWorksModal.addEventListener('click', (e) => {
            if (e.target === $howItWorksModal) closeHowItWorksModal();
        });
    }

    // Escape Key Handler for Modals
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if ($cartDrawerModal && !$cartDrawerModal.classList.contains('invisible')) {
                closeCartDrawer();
            }
            if ($howItWorksModal && !$howItWorksModal.classList.contains('invisible')) {
                closeHowItWorksModal();
            }
        }
    });
}
