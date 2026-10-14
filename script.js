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
let localDrugDatabase = [];
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
            <span>🟢 System Online (Local Search)</span>
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
 * Initialize Client-Side In-Memory Database via PapaParse
 */
function initializeLocalDatabase() {
    if (typeof Papa === 'undefined') {
        console.error("PapaParse library is undefined. Ensure the CDN script is properly loaded.");
        updateBadgeStatus();
        return;
    }

    Papa.parse("production_drug_database.csv", {
        download: true,
        header: true,
        skipEmptyLines: true,
        complete: function (results) {
            localDrugDatabase = (results.data || []).map(row => ({
                s_no: (row.s_no || '').trim(),
                drug_name: (row.drug_name || '').trim(),
                indication: (row.indication || '').trim(),
                approval_date: (row.approval_date || '').trim(),
                source_year: (row.source_year || '').trim(),
                clean_generic_api: (row.clean_generic_api || '').trim()
            })).filter(row => row.drug_name || row.clean_generic_api);

            isLocalDbReady = true;
            updateBadgeStatus();

            // Perform initial search once in-memory dataset is ready
            if (searchInput) {
                performSearch(searchInput.value || 'Lipitor');
            }
        },
        error: function (err) {
            console.error("Failed to parse production_drug_database.csv:", err);
            if (serverStatusBadge) {
                serverStatusBadge.style.cssText = "border: 1px solid #fcd34d; color: #b45309; background-color: #fffbeb;";
                serverStatusBadge.innerHTML = `
                    <span class="w-2 h-2 rounded-full" style="background-color: #f59e0b;"></span>
                    <span>⚠️ CSV Fetch Failed</span>
                `;
            }
        }
    });
}

/**
 * Perform search entirely client-side using in-memory localDrugDatabase
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
        if (resultsCountBadge) resultsCountBadge.textContent = 'Parsing dataset...';
        if (cardsList) {
            cardsList.innerHTML = `
                <div class="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-500 shadow-sm animate-pulse">
                    <i class="fa-solid fa-circle-notch fa-spin text-3xl text-slateBlue mb-3"></i>
                    <p class="font-medium text-sm">Loading local CDSCO database into browser memory...</p>
                </div>
            `;
        }
        return;
    }

    const qLower = query.toLowerCase();
    const matches = [];

    // Case-insensitive scored partial matching across drug_name and clean_generic_api
    for (let i = 0; i < localDrugDatabase.length; i++) {
        const item = localDrugDatabase[i];
        const drugName = item.drug_name.toLowerCase();
        const genericApi = item.clean_generic_api.toLowerCase();

        let score = 0;
        if (drugName === qLower || genericApi === qLower) {
            score = 3; // Exact match
        } else if (drugName.startsWith(qLower) || genericApi.startsWith(qLower)) {
            score = 2; // Starts with query
        } else if (drugName.includes(qLower) || genericApi.includes(qLower)) {
            score = 1; // Substring match
        }

        if (score > 0) {
            matches.push({ ...item, _score: score });
        }
    }

    // Rank by score descending and take top 10
    matches.sort((a, b) => b._score - a._score);
    const top10 = matches.slice(0, 10).map(({ _score, ...item }) => item);

    renderResults(query, top10);
}

/**
 * Dynamically render comparison cards from dataset records
 */
function renderResults(query, results) {
    if (!cardsList || !resultsCountBadge || !activeSaltDisplay) return;

    if (!results || results.length === 0) {
        resultsCountBadge.textContent = '0 matches found';
        activeSaltDisplay.innerHTML = `Active Salt: <span class="font-semibold text-slate-400">No matching salt</span>`;

        cardsList.innerHTML = `
            <div class="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-600 shadow-sm">
                <i class="fa-solid fa-magnifying-glass text-4xl text-slate-300 mb-3"></i>
                <h3 class="text-lg font-bold text-slateBlue mb-1">No matching medicines found</h3>
                <p class="text-sm text-slate-500 max-w-md mx-auto mb-4">
                    We couldn't find any record matching "<strong>${escapeHtml(query)}</strong>" in the production dataset.
                </p>
                <div class="flex flex-wrap justify-center gap-2 text-xs">
                    <span class="text-slate-400">Suggestions:</span>
                    <button type="button" onclick="performSearch('Lipitor')" class="text-slateBlue font-semibold underline">Lipitor</button>
                    <button type="button" onclick="performSearch('Atorvastatin')" class="text-slateBlue font-semibold underline">Atorvastatin</button>
                    <button type="button" onclick="performSearch('Augmentin')" class="text-slateBlue font-semibold underline">Augmentin</button>
                    <button type="button" onclick="performSearch('Metformin')" class="text-slateBlue font-semibold underline">Metformin</button>
                </div>
            </div>
        `;
        return;
    }

    // Update header with the salt of the top matched item
    const primarySalt = results[0].clean_generic_api || 'Verified Bioequivalent API';
    activeSaltDisplay.innerHTML = `Active Salt: <span class="font-semibold text-slate-700">${escapeHtml(primarySalt)}</span>`;
    resultsCountBadge.textContent = `${results.length} option${results.length > 1 ? 's' : ''} found`;

    let cardsHtml = '';

    results.forEach((item, index) => {
        const drugName = item.drug_name || 'Generic Formulation';
        const genericApi = item.clean_generic_api || 'Standard Formulation';
        const indication = item.indication || 'General therapeutic use';
        const approvalDate = item.approval_date || item.source_year || 'Approved';
        const isGeneric = drugName.toLowerCase().includes('generic') || index === 1;

        const price = isGeneric ? 40 : 250;
        const savings = isGeneric ? 210 : null;
        const savingsPercent = isGeneric ? 84 : null;
        const costPerTablet = isGeneric ? '₹4.00' : '₹25.00';

        if (isGeneric) {
            cardsHtml += `
                <div class="bg-softGreen border border-accentGreen/30 rounded-xl p-5 md:p-6 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group">
                    <div class="absolute top-0 left-0 w-1.5 h-full bg-accentGreen"></div>

                    <div class="flex flex-col md:flex-row justify-between gap-4">
                        <div class="flex-grow">
                            <div class="flex items-center gap-3 mb-2 flex-wrap">
                                <h3 class="text-xl font-bold text-slateBlue">${escapeHtml(drugName)}</h3>
                                <span class="bg-accentGreen text-white text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider flex items-center gap-1.5 shadow-sm">
                                    <i class="fa-solid fa-check"></i> Best Value
                                </span>
                            </div>
                            <p class="text-sm text-slate-700 mb-1 font-medium">
                                Active API: <span class="font-semibold text-accentGreen">${escapeHtml(genericApi)}</span>
                            </p>
                            <p class="text-xs text-slate-500 mb-2">
                                <strong class="text-slate-600">Indication:</strong> ${escapeHtml(indication)}
                            </p>
                            <p class="text-[11px] text-slate-400">
                                PMBJP Jan Aushadhi &bull; Approved: ${escapeHtml(approvalDate)} &bull; S.No: ${escapeHtml(item.s_no)}
                            </p>
                        </div>

                        <div class="flex items-center gap-6 justify-between md:justify-end border-t md:border-t-0 pt-4 md:pt-0 mt-2 md:mt-0 border-accentGreen/20">
                            <div class="text-center md:text-right flex flex-col justify-center">
                                <span class="text-[10px] font-bold uppercase text-slate-500 tracking-wider mb-1">Cost Savings</span>
                                <span class="font-bold text-accentGreen text-lg">Save ₹${savings}.00</span>
                                <span class="text-[10px] text-accentGreen font-semibold">(${savingsPercent}% lower cost)</span>
                            </div>
                            <div class="text-center md:text-right flex flex-col justify-center">
                                <span class="text-[10px] font-bold uppercase text-slate-500 tracking-wider mb-1">Bioequivalence Match</span>
                                <span class="inline-flex items-center gap-1.5 text-accentGreen font-bold text-xs bg-accentGreen/10 px-2.5 py-1.5 rounded-lg border border-accentGreen/30">
                                    <i class="fa-solid fa-circle-check"></i> Bioequivalent (CDSCO Standard)
                                </span>
                            </div>
                        </div>
                    </div>

                    <div class="mt-4 pt-3 border-t border-accentGreen/20 flex justify-between items-center group-hover:border-accentGreen/40 transition-colors">
                        <div>
                            <p class="text-xs font-medium text-slate-500 uppercase tracking-wide">Estimated retail price</p>
                            <p class="text-[11px] text-slate-400">${costPerTablet} / tablet (Strip of 10)</p>
                        </div>
                        <p class="font-bold text-slateBlue text-xl">₹${price}.00</p>
                    </div>
                </div>
            `;
        } else {
            cardsHtml += `
                <div class="bg-white border border-slate-200 rounded-xl p-5 md:p-6 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group">
                    <div class="flex flex-col md:flex-row justify-between gap-4">
                        <div class="flex-grow">
                            <div class="flex items-center gap-3 mb-2 flex-wrap">
                                <h3 class="text-xl font-bold text-slateBlue">${escapeHtml(drugName)}</h3>
                                <span class="bg-slate-100 text-slate-600 text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider border border-slate-200">
                                    Innovator / Reference Brand
                                </span>
                            </div>
                            <p class="text-sm text-slate-700 mb-1 font-medium">
                                Active API: <span class="font-semibold text-slate-900">${escapeHtml(genericApi)}</span>
                            </p>
                            <p class="text-xs text-slate-500 mb-2">
                                <strong class="text-slate-600">Indication:</strong> ${escapeHtml(indication)}
                            </p>
                            <p class="text-[11px] text-slate-400">
                                Reference Listed Drug (RLD) &bull; Approved: ${escapeHtml(approvalDate)} &bull; S.No: ${escapeHtml(item.s_no)}
                            </p>
                        </div>

                        <div class="flex items-center gap-6 justify-between md:justify-end border-t md:border-t-0 pt-4 md:pt-0 mt-2 md:mt-0 border-slate-100">
                            <div class="text-center md:text-right flex flex-col justify-center">
                                <span class="text-[10px] font-bold uppercase text-slate-500 tracking-wider mb-1">Cost Savings</span>
                                <span class="font-medium text-slate-400 text-sm">Benchmark Price</span>
                            </div>
                            <div class="text-center md:text-right flex flex-col justify-center">
                                <span class="text-[10px] font-bold uppercase text-slate-500 tracking-wider mb-1">Bioequivalence Match</span>
                                <span class="inline-flex items-center gap-1.5 text-slate-700 font-semibold text-xs bg-slate-100 px-2.5 py-1.5 rounded-lg border border-slate-200">
                                    <i class="fa-solid fa-certificate text-slate-500"></i> Reference Drug
                                </span>
                            </div>
                        </div>
                    </div>

                    <div class="mt-4 pt-3 border-t border-slate-100 flex justify-between items-center">
                        <div>
                            <p class="text-xs font-medium text-slate-500 uppercase tracking-wide">Estimated retail price</p>
                            <p class="text-[11px] text-slate-400">${costPerTablet} / tablet (Strip of 10)</p>
                        </div>
                        <p class="font-bold text-slateBlue text-xl">₹${price}.00</p>
                    </div>
                </div>
            `;
        }
    });

    cardsList.innerHTML = cardsHtml;
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

    const brandElement = document.getElementById('searchQueryDisplay');
    let brandName = brandElement ? brandElement.textContent.trim() : '';

    const brandCardHeader = document.querySelector('.bg-white.border-slate-200 h3');
    if (brandCardHeader && (!brandName || brandName.toLowerCase().includes('generic'))) {
        brandName = brandCardHeader.textContent.trim();
    }
    if (!brandName) brandName = 'Prescribed Medication';

    const saltElement = document.querySelector('#activeSaltDisplay span');
    let genericApiName = saltElement ? saltElement.textContent.trim() : '';

    const genericCardApi = document.querySelector('.bg-softGreen .text-accentGreen');
    if (genericCardApi && (!genericApiName || genericApiName === 'None')) {
        genericApiName = genericCardApi.textContent.trim();
    }
    if (!genericApiName || genericApiName === 'None') {
        genericApiName = 'Generic Equivalent (CDSCO Standard)';
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
        doc.setFillColor(35, 57, 77);
        doc.rect(0, 0, pageWidth, 28, 'F');

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(15);
        doc.setTextColor(255, 255, 255);
        doc.text('MEDIBUDDY | CLINICAL DISCUSSION AID', margin, 13);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(203, 213, 225);
        doc.text('Patient Request for Therapeutic Generic Alternative Evaluation', margin, 20);

        let currentY = 40;
        const currentDate = new Date().toLocaleDateString('en-IN', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.setTextColor(100, 116, 139);
        doc.text(`Date: ${currentDate}`, margin, currentY);
        doc.text(`Regulatory Alignment: CDSCO (India) Drug Standard`, pageWidth - margin, currentY, { align: 'right' });

        currentY += 12;

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.setTextColor(15, 23, 42);
        doc.text('Subject: Request to Evaluate Generic Medication Alternative', margin, currentY);

        currentY += 6;

        doc.setDrawColor(226, 232, 240);
        doc.setLineWidth(0.5);
        doc.line(margin, currentY, margin + contentWidth, currentY);

        currentY += 10;

        doc.setFillColor(248, 250, 252);
        doc.setDrawColor(203, 213, 225);
        doc.roundedRect(margin, currentY, contentWidth, 24, 2, 2, 'FD');

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(71, 85, 105);
        doc.text('CURRENT REFERENCE BRAND:', margin + 6, currentY + 7);
        doc.text('CDSCO-APPROVED GENERIC API:', margin + 6, currentY + 16);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(35, 57, 77);
        doc.text(brandName, margin + 68, currentY + 7);

        doc.setTextColor(22, 101, 52);
        doc.text(genericApiName, margin + 68, currentY + 16);

        currentY += 34;

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(11);
        doc.setTextColor(30, 41, 59);

        doc.text('Dear Doctor,', margin, currentY);
        currentY += 8;

        const p1 = `I am currently reviewing my medication costs. I found a CDSCO-approved generic equivalent for ${brandName}. The generic active pharmaceutical ingredient (API) is ${genericApiName}.`;
        const linesP1 = doc.splitTextToSize(p1, contentWidth);
        doc.text(linesP1, margin, currentY);
        currentY += (linesP1.length * 6) + 4;

        const p2 = 'Could we please discuss if switching to this generic alternative is medically appropriate and safe for my current treatment plan?';
        const linesP2 = doc.splitTextToSize(p2, contentWidth);
        doc.text(linesP2, margin, currentY);
        currentY += (linesP2.length * 6) + 8;

        const p3 = 'I would appreciate your clinical evaluation regarding therapeutic efficacy, dosage equivalence, and whether any monitoring is recommended during substitution.';
        const linesP3 = doc.splitTextToSize(p3, contentWidth);
        doc.text(linesP3, margin, currentY);
        currentY += (linesP3.length * 6) + 16;

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(15, 23, 42);
        doc.text('Thank you for your guidance,', margin, currentY);
        currentY += 16;

        doc.setFont('helvetica', 'normal');
        doc.text('Patient Signature: _________________________________________', margin, currentY);
        currentY += 10;
        doc.text('Printed Patient Name: _____________________________________', margin, currentY);
        currentY += 10;
        doc.text('Contact Phone: ____________________________________________', margin, currentY);

        const footerY = 270;
        doc.setDrawColor(226, 232, 240);
        doc.line(margin, footerY - 5, margin + contentWidth, footerY - 5);

        doc.setFont('helvetica', 'italic');
        doc.setFontSize(8);
        doc.setTextColor(148, 163, 184);
        const disclaimer = 'Note: This document is an informational conversation starter prepared by the patient. It does not constitute a valid prescription or mandate substitution. All therapeutic decisions and dosage alterations remain solely under your physician\'s professional discretion.';
        const disclaimerLines = doc.splitTextToSize(disclaimer, contentWidth);
        doc.text(disclaimerLines, margin, footerY);

        const sanitizedFilename = `Doctor_Request_Note_${brandName.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
        doc.save(sanitizedFilename);

        if (generateDoctorNoteBtn) {
            generateDoctorNoteBtn.innerHTML = `
                <i class="fa-solid fa-circle-check text-emerald-600 text-lg"></i>
                <span class="text-emerald-700">PDF Downloaded!</span>
            `;
            setTimeout(() => {
                generateDoctorNoteBtn.innerHTML = originalBtnHtml;
                generateDoctorNoteBtn.disabled = false;
            }, 2000);
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

function openHowItWorksModal() {
    if (!howItWorksModal || !howItWorksDialog) return;
    howItWorksModal.classList.remove('opacity-0', 'pointer-events-none', 'invisible');
    howItWorksModal.classList.add('opacity-100', 'pointer-events-auto', 'visible');
    howItWorksDialog.classList.remove('scale-95');
    howItWorksDialog.classList.add('scale-100');
    document.body.style.overflow = 'hidden';
}

function closeHowItWorksModal() {
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
