/**
 * ==============================================================================
 * MEDIBUDDY APPLICATION ENTRY POINT (script.js - ES6 Module)
 * Orchestrates modular architecture: data.js, search.js, api.js, and ui.js.
 * ==============================================================================
 */

import { initializeDatasets, isLocalDbReady, escapeHtml } from './data.js';
import { searchMaster, searchCache, benchmarkSearch } from './search.js';
import {
    callGeminiApi,
    sendChatMessage,
    clearChatConversation,
    toggleChat,
    initChatListeners,
    getStorageItem,
    setStorageItem,
    removeStorageItem
} from './api.js';
import {
    $searchInput,
    performSearch,
    toggleCartItem,
    openCartDrawer,
    closeCartDrawer,
    clearCart,
    openHowItWorksModal,
    closeHowItWorksModal,
    updateBadgeStatus,
    loadCartFromStorage,
    updateCartUI,
    initSortDropdown,
    initThemeToggle,
    initScrollControllers,
    initUiEventListeners,
    renderResults,
    renderDatasetErrorState
} from './ui.js';

// ==============================================================================
// GLOBAL BRIDGE FOR INLINE HTML ATTRIBUTES & DEVTOOLS BENCHMARKING
// Ensures full backwards compatibility with any inline events (onclick, onsubmit)
// ==============================================================================
if (typeof window !== 'undefined') {
    window.performSearch = performSearch;
    window.toggleCartItem = toggleCartItem;
    window.openCartDrawer = openCartDrawer;
    window.closeCartDrawer = closeCartDrawer;
    window.clearCart = clearCart;
    window.openHowItWorksModal = openHowItWorksModal;
    window.closeHowItWorksModal = closeHowItWorksModal;
    window.sendMessage = sendChatMessage;
    window.sendChatMessage = sendChatMessage;
    window.toggleChat = toggleChat;
    window.clearChatConversation = clearChatConversation;
    window.searchCache = searchCache;
    window.benchmarkSearch = (query, options) => benchmarkSearch(query, options, renderResults);
    window.isLocalDbReady = isLocalDbReady;
    window.retryInitializeDatasets = bootstrapDatasets;
}

// ==============================================================================
// APPLICATION BOOTSTRAPPER
// ==============================================================================
export function bootstrapDatasets() {
    return initializeDatasets()
        .then(() => {
            updateBadgeStatus();
            const initialQuery = ($searchInput && $searchInput.value.trim()) || 'Calpol';
            performSearch(initialQuery);
        })
        .catch(err => {
            renderDatasetErrorState(err.message || 'Failed to load medicine datasets.');
        });
}

function initApp() {
    initThemeToggle();
    initScrollControllers();
    updateBadgeStatus();
    loadCartFromStorage();
    updateCartUI();
    initSortDropdown();
    initUiEventListeners();
    initChatListeners();

    bootstrapDatasets();
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', initApp);
    } else {
        initApp();
    }
}

export {
    initializeDatasets,
    searchMaster,
    performSearch,
    sendChatMessage,
    benchmarkSearch
};
