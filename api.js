/**
 * ==============================================================================
 * MEDIBUDDY API & LOCAL STORAGE MODULE (api.js)
 * Secure proxy calls to Google Gemini AI and persistent local storage key management.
 * Strict XSS sanitization and production error handling.
 * ==============================================================================
 */

import { escapeHtml } from './data.js';

// ==============================================================================
// LOCAL STORAGE KEY MANAGEMENT (PRODUCTION-READY)
// ==============================================================================

/**
 * Retrieves and deserializes a key from localStorage safely
 * @param {string} key
 * @param {*} defaultValue
 * @returns {*}
 */
export function getStorageItem(key, defaultValue = null) {
    try {
        if (typeof localStorage === 'undefined') return defaultValue;
        const item = localStorage.getItem(key);
        if (item === null) return defaultValue;
        try {
            return JSON.parse(item);
        } catch {
            return item;
        }
    } catch {
        return defaultValue;
    }
}

/**
 * Serializes and stores a value to localStorage safely
 * @param {string} key
 * @param {*} value
 * @returns {boolean}
 */
export function setStorageItem(key, value) {
    try {
        if (typeof localStorage === 'undefined') return false;
        const serialized = typeof value === 'string' ? value : JSON.stringify(value);
        localStorage.setItem(key, serialized);
        return true;
    } catch {
        return false;
    }
}

/**
 * Removes a key from localStorage safely
 * @param {string} key
 */
export function removeStorageItem(key) {
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.removeItem(key);
        }
    } catch {
        // Suppress storage mutation errors in private browsing modes
    }
}

// ==============================================================================
// CHATBOT DOM ELEMENTS ($ PREFIX NOTATION)
// ==============================================================================
const getEl = (id) => (typeof document !== 'undefined' ? document.getElementById(id) : null);

export const $chatbotFab = getEl('chatbotFab');
export const $chatbotWindow = getEl('chatbotWindow');
export const $chatCloseBtn = getEl('chatCloseBtn');
export const $fabChatIcon = getEl('fabChatIcon');
export const $fabCloseIcon = getEl('fabCloseIcon');
export const $chatInput = getEl('chatInput');
export const $chatSendBtn = getEl('chatSendBtn');
export const $chatForm = getEl('chatForm');
export const $chatMessages = getEl('chatMessages');
export const $chatChips = getEl('chatChips');
export const $chatClearBtn = getEl('chatClearBtn');

// Chat Conversation State & Multi-Turn History
export let chatConversationHistory = [];
export let isAiGenerating = false;

/**
 * Global toast dispatcher hook (injected from ui.js)
 */
let toastDispatcher = null;
export function registerToastDispatcher(fn) {
    toastDispatcher = fn;
}

/**
 * System instruction enforcing the MediBuddy Rx persona.
 * Keeps AI responses to 2-3 short sentences max.
 */
const GEMINI_SYSTEM_INSTRUCTION =
    'You are MediBuddy Rx, a medical assistant. You must answer questions in a maximum of 2 to 3 short sentences. Keep it extremely concise, bite-sized, and easy to read in a small chat widget. Never write long paragraphs or essays.\n\n' +
    'Clinical Guidelines:\n' +
    '1. Bioequivalence: Explain that certified Indian generic formulations match the Reference Listed Drug (RLD) within CDSCO 80%–125% 90% confidence interval for Cmax and AUC with identical clinical efficacy.\n' +
    '2. Cost Savings: Highlight that generics offer 60%–85% savings in Indian Rupees (₹) due to expired patents.\n' +
    '3. Safety: Always advise consulting a qualified physician or pharmacist before modifying prescriptions. Never prescribe or diagnose.';

/**
 * Ordered model fallback chain for client-side Gemini API calls.
 */
const GEMINI_MODELS = ['gemini-2.0-flash', 'gemini-1.5-flash'];

/**
 * Direct client-side fetch to the Google Generative Language REST API.
 * API key is retrieved from localStorage('medibuddy_gemini_key').
 *
 * @param {string} message - The user's latest message
 * @param {Array<object>} history - Multi-turn conversation history
 * @returns {Promise<string>} - The AI response text
 */
export async function callGeminiApi(message, history = []) {
    const apiKey = getStorageItem('medibuddy_gemini_key', '');
    if (!apiKey) {
        throw new Error(
            'Gemini API key not configured. Open browser console and run: ' +
            'localStorage.setItem("medibuddy_gemini_key", "YOUR_KEY")'
        );
    }

    // Sanitise and cap conversation history to last 16 turns
    let safeHistory = [];
    if (Array.isArray(history)) {
        safeHistory = history
            .filter(t => t && (t.role === 'user' || t.role === 'model') && Array.isArray(t.parts))
            .slice(-16)
            .map(t => ({
                role: t.role,
                parts: t.parts.map(p => ({ text: String(p.text || '').slice(0, 4000) }))
            }));
    }

    // Ensure contents array has at least the latest user query
    if (safeHistory.length === 0) {
        safeHistory = [{ role: 'user', parts: [{ text: message }] }];
    }

    const payload = {
        system_instruction: { parts: [{ text: GEMINI_SYSTEM_INSTRUCTION }] },
        contents: safeHistory,
        generationConfig: {
            temperature: 0.3,
            topK: 40,
            topP: 0.95,
            maxOutputTokens: 250
        }
    };

    let lastError = null;

    for (const model of GEMINI_MODELS) {
        try {
            const url =
                `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const responseText = await response.text();

            if (!response.ok) {
                let errMsg = `HTTP ${response.status}`;
                try {
                    const parsed = JSON.parse(responseText);
                    errMsg = parsed?.error?.message || errMsg;
                } catch (_) { /* ignore parse failure */ }

                // Retry next model on 404 (model not found) or 503 (overloaded)
                if (response.status === 404 || response.status === 503) {
                    lastError = new Error(errMsg);
                    continue;
                }
                throw new Error(errMsg);
            }

            const data = JSON.parse(responseText);
            const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!text || typeof text !== 'string' || text.trim().length === 0) {
                throw new Error('AI service returned an empty response. Please retry.');
            }

            return text.trim();
        } catch (err) {
            lastError = err;
            // Only continue to next model on retriable errors; otherwise rethrow
            if (err.message && !err.message.startsWith('HTTP 404') && !err.message.startsWith('HTTP 503')) {
                throw err;
            }
        }
    }

    throw new Error(lastError?.message || 'Unable to connect to the medical assistant service.');
}

/**
 * Toggle Chat Window open / closed state
 */
export function toggleChat() {
    if (!$chatbotWindow || !$chatbotFab) return;
    const isOpen = $chatbotWindow.classList.toggle('is-open');
    $chatbotFab.setAttribute('aria-expanded', String(isOpen));
    if (isOpen) {
        if ($fabChatIcon) $fabChatIcon.classList.add('hidden');
        if ($fabCloseIcon) $fabCloseIcon.classList.remove('hidden');
        if ($chatInput) $chatInput.focus();
    } else {
        if ($fabChatIcon) $fabChatIcon.classList.remove('hidden');
        if ($fabCloseIcon) $fabCloseIcon.classList.add('hidden');
    }
}

/**
 * Sanitize text and format basic Markdown into safe, structured HTML.
 * MANDATORY: XSS sanitization (escapeHtml) runs BEFORE any Markdown substitutions.
 *
 * @param {string} text
 * @returns {string}
 */
export function formatMarkdown(text) {
    if (!text) return '';
    // 1. Mandatory XSS sanitization of all raw input
    let html = escapeHtml(text);

    // 2. Safe markdown conversions onto escaped text
    html = html.replace(/^### (.*$)/gim, '<h4 class="font-bold text-sm text-slate-900 dark:text-white mt-2.5 mb-1">$1</h4>');
    html = html.replace(/^## (.*$)/gim, '<h3 class="font-bold text-base text-slate-900 dark:text-white mt-2.5 mb-1">$1</h3>');
    html = html.replace(/^---$/gim, '<hr class="my-2 border-slate-200 dark:border-slate-700"/>');
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong class="font-semibold text-slate-900 dark:text-white">$1</strong>');
    html = html.replace(/__(.*?)__/g, '<strong class="font-semibold text-slate-900 dark:text-white">$1</strong>');
    html = html.replace(/\*(.*?)\*/g, '<em class="italic">$1</em>');
    html = html.replace(/_([^_]+)_/g, '<em class="italic">$1</em>');
    html = html.replace(/`([^`]+)`/g, '<code class="bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded text-xs font-mono text-emerald-600 dark:text-emerald-400">$1</code>');

    // Bullet & numbered lists
    html = html.replace(/(?:^|\n)[*-] (.*?)(?=(?:\n[*-] |\n\n|$))/g, (match, content) =>
        `<li class="ml-4 list-disc text-slate-700 dark:text-[#F8FAFC] my-0.5">${content}</li>`
    );
    html = html.replace(/(?:^|\n)\d+\. (.*?)(?=(?:\n\d+\. |\n\n|$))/g, (match, content) =>
        `<li class="ml-4 list-decimal text-slate-700 dark:text-[#F8FAFC] my-0.5">${content}</li>`
    );

    // Disclaimer alert banner
    html = html.replace(/(⚠️.*?)(?:\n|$)/g, '<div class="mt-2 pt-2 border-t border-slate-200 dark:border-slate-700 text-[11px] text-amber-700 dark:text-amber-400 font-medium leading-relaxed">$1</div>');

    // Paragraph breaks
    html = html.replace(/\n\n/g, '<div class="h-2"></div>');
    html = html.replace(/\n/g, '<br/>');

    return html;
}

/**
 * Append message bubble to chat window with strict textContent safety for user inputs
 * @param {'user'|'bot'} sender
 * @param {string} content
 * @param {boolean} [isHtml=false]
 * @returns {HTMLElement|null}
 */
export function appendMessage(sender, content, isHtml = false) {
    if (!$chatMessages) return null;
    const bubble = document.createElement('div');

    if (sender === 'user') {
        bubble.className = 'chat-user-bubble bg-slateBlue dark:bg-emerald-600 text-white rounded-xl rounded-tr-sm p-3 shadow-sm max-w-[85%] self-end text-sm leading-relaxed';
        // textContent guarantees zero HTML parsing for raw user input (100% XSS immune)
        bubble.textContent = content;
    } else {
        bubble.className = 'chat-bot-bubble bg-white dark:bg-[#1E293B] border border-slate-200 dark:border-[#334155] rounded-xl rounded-tl-sm p-3.5 shadow-sm max-w-[88%] text-slate-700 dark:text-[#F8FAFC] text-sm leading-relaxed';
        if (isHtml) {
            bubble.innerHTML = content;
        } else {
            bubble.innerHTML = formatMarkdown(content);
        }
    }

    $chatMessages.appendChild(bubble);
    $chatMessages.scrollTop = $chatMessages.scrollHeight;
    return bubble;
}

/**
 * Display animated typing indicator
 * @returns {HTMLElement|null}
 */
export function showChatTypingIndicator() {
    if (!$chatMessages) return null;
    const indicator = document.createElement('div');
    indicator.id = 'chatTypingIndicator';
    indicator.className = 'chat-bot-bubble bg-white dark:bg-[#1E293B] border border-slate-200 dark:border-[#334155] rounded-xl rounded-tl-sm px-3.5 py-3 shadow-sm max-w-[70px] flex items-center justify-center gap-1.5';
    indicator.innerHTML = `
        <span class="typing-dot"></span>
        <span class="typing-dot"></span>
        <span class="typing-dot"></span>
    `;
    $chatMessages.appendChild(indicator);
    $chatMessages.scrollTop = $chatMessages.scrollHeight;
    return indicator;
}

/**
 * Remove animated typing indicator
 */
export function removeChatTypingIndicator() {
    const indicator = document.getElementById('chatTypingIndicator');
    if (indicator) indicator.remove();
}

/**
 * Send user message and coordinate AI response flow with visual fallback card
 * @param {string} [explicitQuery]
 */
export async function sendChatMessage(explicitQuery) {
    if (isAiGenerating) return;

    let query = explicitQuery;
    if (!query && $chatInput) {
        query = $chatInput.value.trim();
    }

    if (!query) return;

    if ($chatInput) {
        $chatInput.value = '';
    }

    appendMessage('user', query);

    chatConversationHistory.push({
        role: 'user',
        parts: [{ text: query }]
    });

    if (chatConversationHistory.length > 16) {
        chatConversationHistory = chatConversationHistory.slice(-16);
    }

    isAiGenerating = true;
    if ($chatSendBtn) $chatSendBtn.disabled = true;
    if ($chatInput) $chatInput.disabled = true;
    showChatTypingIndicator();

    try {
        const aiResponseText = await callGeminiApi(query, chatConversationHistory);
        removeChatTypingIndicator();

        appendMessage('bot', aiResponseText);

        chatConversationHistory.push({
            role: 'model',
            parts: [{ text: aiResponseText }]
        });
    } catch (err) {
        removeChatTypingIndicator();

        // Clean visual error fallback card inside chat flow
        const fallbackCardHtml = `
            <div class="p-3 bg-red-50/80 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 rounded-xl space-y-1.5">
                <div class="flex items-center gap-1.5 text-red-700 dark:text-red-400 font-bold text-xs">
                    <i class="fa-solid fa-triangle-exclamation"></i>
                    <span>AI Service Unavailable</span>
                </div>
                <p class="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                    ${escapeHtml(err.message || 'Unable to connect to the medical assistant service.')}
                </p>
                <div class="text-[11px] text-slate-400 dark:text-slate-500 pt-1 border-t border-red-100 dark:border-red-900/30">
                    Please check your internet connection or try again shortly.
                </div>
            </div>
        `;
        appendMessage('bot', fallbackCardHtml, true);

        if (typeof toastDispatcher === 'function') {
            toastDispatcher('AI assistant unavailable. Please try again shortly.', 'warning');
        }
    } finally {
        isAiGenerating = false;
        if ($chatSendBtn) $chatSendBtn.disabled = false;
        if ($chatInput) {
            $chatInput.disabled = false;
            $chatInput.focus();
        }
    }
}

/**
 * Reset conversation history and clear chat UI
 */
export function clearChatConversation() {
    chatConversationHistory = [];
    if (!$chatMessages) return;

    $chatMessages.innerHTML = `
        <div class="chat-bot-bubble bg-white dark:bg-[#1E293B] border border-slate-200 dark:border-[#334155] rounded-xl rounded-tl-sm p-3.5 shadow-sm max-w-[88%] text-slate-700 dark:text-[#F8FAFC]">
            <p>Hello! I am your <strong>MediBuddy Rx Assistant</strong>. I can help verify Indian generic medicine equivalents, explain CDSCO bioequivalence standards, and estimate ₹ savings.</p>
            <div class="mt-2 pt-2 border-t border-slate-100 dark:border-slate-700 text-[11px] text-amber-700 dark:text-amber-400 font-medium leading-relaxed">
                ⚠️ Educational only &mdash; always consult a registered medical practitioner before switching or modifying medications.
            </div>
        </div>
        <div class="flex flex-col gap-1.5 my-1" id="chatChips">
            <button type="button"
                class="text-left text-xs bg-white dark:bg-[#1E293B] hover:bg-emerald-50 dark:hover:bg-slate-700 text-slateBlue dark:text-[#F8FAFC] hover:text-accentGreen dark:hover:text-emerald-300 border border-slate-200 dark:border-[#334155] hover:border-accentGreen/30 px-3 py-2 rounded-lg transition-colors font-medium cursor-pointer"
                data-query="Is generic Atorvastatin as effective as Lipitor?">
                💬 Is generic Atorvastatin as effective as Lipitor?
            </button>
            <button type="button"
                class="text-left text-xs bg-white dark:bg-[#1E293B] hover:bg-emerald-50 dark:hover:bg-slate-700 text-slateBlue dark:text-[#F8FAFC] hover:text-accentGreen dark:hover:text-emerald-300 border border-slate-200 dark:border-[#334155] hover:border-accentGreen/30 px-3 py-2 rounded-lg transition-colors font-medium cursor-pointer"
                data-query="Why is generic Atorvastatin ₹40 vs Lipitor ₹250?">
                💬 Why is generic Atorvastatin ₹40 vs Lipitor ₹250?
            </button>
            <button type="button"
                class="text-left text-xs bg-white dark:bg-[#1E293B] hover:bg-emerald-50 dark:hover:bg-slate-700 text-slateBlue dark:text-[#F8FAFC] hover:text-accentGreen dark:hover:text-emerald-300 border border-slate-200 dark:border-[#334155] hover:border-accentGreen/30 px-3 py-2 rounded-lg transition-colors font-medium cursor-pointer"
                data-query="What does CDSCO Standard mean for generic bioequivalence?">
                💬 What does CDSCO Standard mean for generic bioequivalence?
            </button>
        </div>
    `;
}

/**
 * Initializes chat event listeners
 */
export function initChatListeners() {
    if ($chatbotFab) $chatbotFab.addEventListener('click', toggleChat);
    if ($chatCloseBtn) $chatCloseBtn.addEventListener('click', toggleChat);
    if ($chatClearBtn) $chatClearBtn.addEventListener('click', clearChatConversation);

    if ($chatForm) {
        $chatForm.addEventListener('submit', (e) => {
            e.preventDefault();
            sendChatMessage();
        });
    }

    if ($chatMessages) {
        $chatMessages.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-query]');
            if (btn) {
                const query = btn.getAttribute('data-query');
                if (query) sendChatMessage(query);
            }
        });
    }

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && $chatbotWindow && $chatbotWindow.classList.contains('is-open')) {
            toggleChat();
        }
    });
}
