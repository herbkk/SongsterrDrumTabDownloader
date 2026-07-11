// DOM Elements
const tabs = {
    search: document.getElementById('tab-search'),
    url: document.getElementById('tab-url'),
    library: document.getElementById('tab-library'),
    settings: document.getElementById('tab-settings')
};
const panels = {
    search: document.getElementById('panel-search'),
    url: document.getElementById('panel-url'),
    library: document.getElementById('panel-library'),
    progress: document.getElementById('panel-progress'),
    result: document.getElementById('panel-result'),
    mapping: document.getElementById('panel-mapping'),
    settings: document.getElementById('panel-settings')
};

// Global OSMD instance
let osmdInstance = null;
let currentDownloadUrl = null;
window.osmdDarkModeGlobal = false;
window.osmdDarkBg = "#1c1d1f";
window.osmdDarkStaff = "#6d6d6d";
window.osmdDarkNote = "#cacaca";

// Search Elements
const searchInput = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');
const searchSpinner = document.getElementById('search-spinner');

// URL Elements
const urlInput = document.getElementById('url-input');
const btnDownloadUrl = document.getElementById('btn-download-url');

// Progress Elements
const progressTitle = document.getElementById('progress-title');
const progressStep = document.getElementById('progress-step');
const progressBar = document.getElementById('progress-bar');

// Toast Elements
const toast = document.getElementById('toast');
const toastMessage = document.getElementById('toast-message');

let currentEventSource = null;
let currentTaskId = null;
let searchTimeout = null;
let currentFormat = 'musicxml';
let activeTab = 'search';

// Batch Processing State
let batchQueue = [];
let batchQueueTotal = 0;
let batchQueueCompleted = 0;
let isBatchProcessing = false;
let isBatchModeUI = false;

// Format handling
function updateFormatSelection(radio) {
    currentFormat = radio.value;

    // Update styling for selected
    document.querySelectorAll('.format-option').forEach(el => {
        el.classList.remove('border-brand-500', 'ring-1', 'ring-brand-500');
        el.classList.add('border-white/10');
        el.querySelector('.check-icon').classList.replace('text-brand-500', 'text-transparent');
    });

    const parent = radio.closest('.format-option');
    parent.classList.remove('border-white/10');
    parent.classList.add('border-brand-500', 'ring-1', 'ring-brand-500');
    parent.querySelector('.check-icon').classList.replace('text-transparent', 'text-brand-500');

    updateBatchHelperText();
}

function toggleBatchMode() {
    isBatchModeUI = document.getElementById('batch-toggle').checked;

    const urlContainer = document.getElementById('url-input-container');
    const batchContainer = document.getElementById('batch-input-container');

    if (isBatchModeUI) {
        urlContainer.classList.add('hidden');
        batchContainer.classList.remove('hidden');
        document.getElementById('format-selection-container').classList.remove('hidden');
    } else {
        urlContainer.classList.remove('hidden');
        batchContainer.classList.add('hidden');
        document.getElementById('format-selection-container').classList.add('hidden');
        // Default back to musicxml for single URLs
        document.querySelector('input[name="format-select"][value="musicxml"]').click();
    }

    updateBatchHelperText();
    validateUrlInput();
}

function updateBatchHelperText() {
    const helper = document.getElementById('url-helper-text');
    if (!isBatchModeUI) {
        helper.innerHTML = '<p>Must be a valid Songsterr song URL.</p>';
    } else {
        if (currentFormat === 'musicxml') {
            helper.innerHTML = `<p>All downloaded <code class="text-slate-400 font-mono">.musicxml</code> files are automatically saved to your server's local <code class="text-slate-400 font-mono">downloads/</code> folder.</p>
                                <p>Batch downloads will process sequentially and appear in your Library when finished.</p>`;
        } else {
            helper.innerHTML = `<p>The browser will sequentially generate and save PDF files.</p>
                                <p class="text-amber-500"><i data-feather="alert-triangle" class="w-3 h-3 inline"></i> You may need to "Allow multiple downloads" when prompted by your browser.</p>`;
            feather.replace();
        }
    }
}

// --- Format Management Removed ---

// --- Tab Management ---

function switchTab(tabName) {
    activeTab = tabName;
    // Update tab styling
    Object.keys(tabs).forEach(key => {
        if (key === tabName) {
            tabs[key].classList.add('border-brand-500', 'text-brand-400', 'bg-white/5');
            tabs[key].classList.remove('border-transparent', 'text-slate-400');
        } else {
            tabs[key].classList.remove('border-brand-500', 'text-brand-400', 'bg-white/5');
            tabs[key].classList.add('border-transparent', 'text-slate-400');
        }
    });

    // Show active panel
    Object.keys(panels).forEach(key => {
        if (key === tabName) {
            panels[key].classList.remove('hidden');
            panels[key].classList.add('block');
        } else if (['search', 'url', 'settings', 'library'].includes(key)) {
            panels[key].classList.remove('block');
            panels[key].classList.add('hidden');
        }
    });

    if (tabName === 'search') searchInput.focus();
    if (tabName === 'url') urlInput.focus();
    if (tabName === 'library') renderLibrary();

    if (tabName === 'settings') {
        const container = document.getElementById('global-mapping-container');
        if (container.children.length === 0) {
            new VisualMapperCompact(container, globalDrumMapping);
        }
    }
}

// --- Search Logic ---

searchInput.addEventListener('input', (e) => {
    const query = e.target.value.trim();

    clearTimeout(searchTimeout);

    if (query.length < 2) {
        searchResults.innerHTML = `
            <div class="text-center py-8 text-slate-500 flex flex-col items-center">
                <i data-feather="search" class="w-8 h-8 mb-3 opacity-50"></i>
                <p>Type at least 2 characters to search</p>
            </div>
        `;
        feather.replace();
        return;
    }

    searchSpinner.classList.remove('hidden');

    // Debounce search
    searchTimeout = setTimeout(() => {
        performSearch(query);
    }, 500);
});

async function performSearch(query) {
    try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        const data = await res.json();

        searchSpinner.classList.add('hidden');

        if (!res.ok) throw new Error(data.error || 'Search failed');

        renderSearchResults(data.results);
    } catch (err) {
        searchSpinner.classList.add('hidden');
        showError(err.message);
    }
}

function renderSearchResults(results) {
    if (!results || results.length === 0) {
        searchResults.innerHTML = `
            <div class="text-center py-8 text-slate-500 flex flex-col items-center">
                <i data-feather="music" class="w-8 h-8 mb-3 opacity-50"></i>
                <p>No drum tracks found for this query.</p>
            </div>
        `;
        feather.replace();
        return;
    }

    let html = '';
    results.forEach(song => {
        // Difficulty rendering (1-3 stars)
        const diff = song.drumDifficulty || 1;
        let diffHtml = '';
        for (let i = 0; i < 3; i++) {
            if (i < diff) diffHtml += `<i data-feather="star" class="w-3 h-3 text-amber-400 fill-amber-400 inline"></i>`;
            else diffHtml += `<i data-feather="star" class="w-3 h-3 text-slate-600 inline"></i>`;
        }

        html += `
            <div class="search-result-item bg-slate-800/60 border border-white/5 rounded-xl p-4 cursor-pointer flex justify-between items-center group" 
                 onclick="startDownloadFromSearch(${song.songId}, '${song.artist.replace(/'/g, "\\'")}', '${song.title.replace(/'/g, "\\'")}')">
                <div class="overflow-hidden pr-4">
                    <h4 class="text-white font-medium truncate group-hover:text-brand-400 transition-colors">${song.title}</h4>
                    <p class="text-slate-400 text-sm truncate">${song.artist}</p>
                </div>
                <div class="flex flex-col items-end flex-shrink-0">
                    <div class="bg-slate-900/80 px-2 py-1 rounded text-xs text-slate-300 font-medium mb-1 border border-white/5">
                        <i data-feather="box" class="w-3 h-3 inline mr-1 text-brand-500"></i>Drums
                    </div>
                    <div class="text-xs" title="Difficulty">
                        ${diffHtml}
                    </div>
                </div>
            </div>
        `;
    });

    searchResults.innerHTML = html;
    feather.replace();
}

// --- URL Logic ---

function validateUrlInput() {
    const inputEl = isBatchModeUI ? document.getElementById('batch-input') : urlInput;
    const val = inputEl.value.trim();
    const urls = val.split('\n').map(u => u.trim());
    const hasValid = urls.some(u => u.includes('songsterr.com/') && (u.includes('-s') || u.includes('songid=')));

    if (hasValid) {
        inputEl.classList.add('border-green-500/50', 'focus:ring-green-500/50', 'focus:border-green-500');
        inputEl.classList.remove('border-brand-500', 'border-red-500/50');
        btnDownloadUrl.disabled = false;
    } else {
        inputEl.classList.remove('border-green-500/50', 'focus:ring-green-500/50', 'focus:border-green-500');
        if (val.length > 0) {
            inputEl.classList.add('border-red-500/50');
        } else {
            inputEl.classList.remove('border-red-500/50');
        }
        btnDownloadUrl.disabled = true;
    }
}

urlInput.addEventListener('input', validateUrlInput);
document.getElementById('batch-input').addEventListener('input', validateUrlInput);

// --- Download Logic ---

function startDownloadFromSearch(songId, artist, title) {
    isBatchProcessing = false;
    startDownload({ songId, artist, title });
}

function startDownloadFromUrl() {
    const inputEl = isBatchModeUI ? document.getElementById('batch-input') : urlInput;
    const text = inputEl.value.trim();
    if (!text) return;

    const urls = text.split('\n').map(u => u.trim()).filter(u => u.includes('songsterr.com/') && (u.includes('-s') || u.includes('songid=')));
    if (urls.length === 0) return;

    if (urls.length > 1) {
        batchQueue = urls;
        batchQueueTotal = urls.length;
        batchQueueCompleted = 0;
        isBatchProcessing = true;

        // Show batch progress UI
        document.getElementById('batch-progress-container').classList.remove('hidden');
        updateBatchProgressUI();

        processNextBatchItem();
    } else {
        isBatchProcessing = false;
        startDownload({ url: urls[0] });
    }
}

function updateBatchProgressUI() {
    const completed = batchQueueCompleted;
    const pct = batchQueueTotal > 0 ? (completed / batchQueueTotal) * 100 : 0;

    document.getElementById('batch-progress-text').innerText = `Batch Progress (${completed}/${batchQueueTotal})`;
    document.getElementById('batch-progress-pct').innerText = `${Math.round(pct)}%`;
    document.getElementById('batch-progress-bar').style.width = `${pct}%`;
}

function processNextBatchItem() {
    if (batchQueue.length === 0) {
        isBatchProcessing = false;
        updateBatchProgressUI(); // Hits 100%
        setTimeout(() => {
            resetUI();
            switchTab('library');
            showSuccessToast("Batch download completed!");
        }, 1000);
        return;
    }

    const nextUrl = batchQueue.shift();
    progressTitle.innerText = `Downloading item ${batchQueueCompleted + 1} of ${batchQueueTotal}`;
    startDownload({ url: nextUrl }, true);
}

async function startDownload(payload, isBatchContinuation = false) {
    payload.format = currentFormat;
    payload.global_mapping = globalDrumMapping;

    const bpmVal = document.getElementById('bpm-input')?.value;
    if (bpmVal) payload.bpm = parseInt(bpmVal, 10);

    if (payload.url) {
        currentDownloadUrl = payload.url;
    } else if (payload.songId) {
        if (payload.artist && payload.title) {
            const safeArtist = payload.artist.toLowerCase().replace(/[^a-z0-9]+/g, '-');
            const safeTitle = payload.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
            currentDownloadUrl = `https://www.songsterr.com/a/wsa/${safeArtist}-${safeTitle}-drum-tab-s${payload.songId}`;
        } else {
            currentDownloadUrl = `https://www.songsterr.com/a/wsa/song-s${payload.songId}`;
        }
    }

    const lib = getLibrary();
    const existingItem = lib.find(i => i.url === currentDownloadUrl);
    if (existingItem && existingItem.customMapping) {
        Object.assign(payload.global_mapping, existingItem.customMapping);
    }

    // Hide inputs, show progress
    panels.search.classList.add('hidden');
    panels.url.classList.add('hidden');
    tabs.search.parentElement.classList.add('hidden'); // Hide tabs wrapper

    panels.progress.classList.remove('hidden');
    panels.progress.classList.add('flex');
    panels.progress.parentElement.classList.add('progress-pulse');

    progressBar.style.width = '0%';
    progressStep.innerText = 'Connecting to server...';

    try {
        const res = await fetch('/api/download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to start download');

        currentTaskId = data.taskId;
        listenToProgress(data.taskId);
    } catch (err) {
        showError(err.message);
        resetUI();
    }
}

function listenToProgress(taskId) {
    if (currentEventSource) {
        currentEventSource.close();
    }

    currentEventSource = new EventSource(`/api/status/${taskId}`);

    currentEventSource.onmessage = function (event) {
        const data = JSON.parse(event.data);

        if (data.error) {
            currentEventSource.close();
            showError(data.error);
            if (isBatchProcessing) {
                setTimeout(processNextBatchItem, 2500);
            } else {
                resetUI();
            }
            return;
        }

        // Update UI
        progressBar.style.width = `${data.progress * 100}%`;
        progressStep.innerText = data.step;

        if (data.status === 'done') {
            currentEventSource.close();
            showSuccess(data.result);
        } else if (data.status === 'requires_mapping') {
            currentEventSource.close();
            showMappingUI(data.unmapped_frets, data.song_url || currentDownloadUrl);
        } else if (data.status === 'error') {
            currentEventSource.close();
            showError(data.error || 'Download failed');
            resetUI();
        }
    };

    currentEventSource.onerror = function () {
        currentEventSource.close();
        showError('Lost connection to server');
        resetUI();
    };
}

// --- Mapping UI ---

let currentInterceptMapper = null;

function showMappingUI(frets, songUrl) {
    // Widen the main container to give the OSMD previews more room
    const mainCard = document.querySelector('main.glass-card');
    mainCard.classList.remove('max-w-3xl');
    mainCard.classList.add('max-w-6xl');

    panels.progress.classList.add('hidden');
    panels.progress.classList.remove('flex');
    panels.progress.parentElement.classList.remove('progress-pulse');

    panels.mapping.classList.remove('hidden');
    panels.mapping.classList.add('flex');

    const urlContainer = document.getElementById('mapping-song-url-container');
    if (urlContainer) {
        if (songUrl) {
            urlContainer.innerHTML = `Source: <a href="${songUrl}" target="_blank" class="hover:underline hover:text-brand-300 font-medium">View Original Score on Songsterr</a>`;
        } else {
            urlContainer.innerHTML = '';
        }
    }

    const container = document.getElementById('mapping-container');

    // Build initial mapping object for these unknown frets
    const initialMap = {};
    frets.forEach(f_obj => {
        initialMap[f_obj.fret] = {
            name: `Drum ${f_obj.fret}`,
            step: 'C',
            octave: 5,
            notehead: 'normal',
            first_measure: f_obj.first_measure,
            preview_xml: f_obj.preview_xml
        };
    });

    currentInterceptMapper = new VisualMapper(container, initialMap, false, songUrl);
}

async function submitMapping() {
    if (!currentInterceptMapper) return;

    const customMapping = currentInterceptMapper.getMapping();
    window.lastSubmittedCustomMapping = customMapping;

    panels.mapping.classList.add('hidden');
    panels.mapping.classList.remove('flex');

    panels.progress.classList.remove('hidden');
    panels.progress.classList.add('flex');
    panels.progress.parentElement.classList.add('progress-pulse');
    progressStep.innerText = 'Applying custom mapping...';

    try {
        const res = await fetch('/api/download/resume', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ taskId: currentTaskId, custom_mapping: customMapping })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to resume download');

        listenToProgress(currentTaskId);
    } catch (err) {
        showError(err.message);
        resetUI();
    }
}

// --- PDF & OSMD Engine ---

function createConfiguredOSMD(containerElement, isGhost = false) {
    const pageFormat = document.getElementById('style-page-format')?.value || "A4_P";
    const drawTitle = document.getElementById('style-draw-title')?.checked ?? true;
    const drawMeasures = document.getElementById('style-draw-measures')?.checked ?? true;
    const zoomVal = parseFloat(document.getElementById('style-zoom')?.value || "0.6");

    const osmd = new opensheetmusicdisplay.OpenSheetMusicDisplay(containerElement, {
        autoResize: !isGhost, // Ghost doesn't resize, UI does
        backend: "svg",
        drawTitle: drawTitle,
        drawSubtitle: drawTitle,
        drawComposer: drawTitle,
        pageFormat: pageFormat,
        pageBackgroundColor: window.osmdDarkModeGlobal ? window.osmdDarkBg : "#FFFFFF",
        darkMode: window.osmdDarkModeGlobal
    });

    osmd.EngravingRules.FlatBeams = true; // Hardcoded best for drums
    osmd.EngravingRules.RenderMeasureNumbers = drawMeasures;
    osmd.EngravingRules.PercussionOneLineCutoff = 0;
    osmd.zoom = zoomVal;

    if (window.osmdDarkModeGlobal) {
        window.applyDarkThemeEngravingRules(osmd);
    }

    return osmd;
}

// --- Success & Reset ---

async function showSuccess(result) {
    // Save to library history
    if (currentDownloadUrl) {
        saveToLibrary(result.artist, result.title, currentDownloadUrl, window.lastSubmittedCustomMapping);
        window.lastSubmittedCustomMapping = null;
    }

    if (isBatchProcessing) {
        if (currentFormat === 'pdf') {
            progressStep.innerText = 'Ghost rendering PDF...';
            try {
                await generateGhostPDF(result.xml_string, `${result.artist} - ${result.title}`);
            } catch (err) {
                console.error("Ghost PDF Error", err);
                showError("Failed to render PDF for " + result.title);
            }
        }

        batchQueueCompleted++;
        updateBatchProgressUI();

        progressStep.innerText = 'Waiting before next request...';
        setTimeout(processNextBatchItem, 2500);
        return;
    }

    panels.progress.classList.add('hidden');
    panels.progress.classList.remove('flex');
    panels.progress.parentElement.classList.remove('progress-pulse');

    // Widen the main container for the score
    const mainCard = document.querySelector('main.glass-card');
    mainCard.classList.remove('max-w-3xl');
    mainCard.classList.add('max-w-6xl');

    panels.result.classList.remove('hidden');
    panels.result.classList.add('flex');

    document.getElementById('result-song-name').innerText = `${result.artist} - ${result.title}`;
    document.getElementById('result-download-link').href = result.downloadUrl;

    // Render OSMD
    const osmdContainer = document.getElementById('osmd-container');
    osmdContainer.innerHTML = ''; // Clear previous

    osmdInstance = createConfiguredOSMD(osmdContainer, false);

    osmdInstance.load(result.xml_string).then(() => {
        osmdInstance.render();
    }).catch(err => {
        console.error("OSMD Load Error:", err);
        showError("Failed to render sheet music preview.");
    });
}

function svgToJpegDataUrl(svgElement) {
    return new Promise((resolve, reject) => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        const data = new XMLSerializer().serializeToString(svgElement);
        const DOMURL = window.URL || window.webkitURL || window;
        const img = new Image();
        const svgBlob = new Blob([data], { type: "image/svg+xml;charset=utf-8" });
        const url = DOMURL.createObjectURL(svgBlob);

        img.onload = function () {
            // scale up for high-resolution PDF
            const scale = 3;
            canvas.width = svgElement.clientWidth * scale;
            canvas.height = svgElement.clientHeight * scale;
            ctx.fillStyle = "#FFFFFF";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            DOMURL.revokeObjectURL(url);
            resolve(canvas.toDataURL("image/jpeg", 0.95));
        };
        img.onerror = reject;
        img.src = url;
    });
}

async function exportOSMDPDF() {
    if (!osmdInstance) return;

    const btn = document.getElementById('btn-save-pdf');
    const originalText = btn.innerHTML;
    btn.innerHTML = `<i data-feather="loader" class="w-4 h-4 mr-2 animate-spin"></i> Generating...`;
    btn.disabled = true;
    feather.replace();

    try {
        const { jsPDF } = window.jspdf;
        const pageFormat = document.getElementById('style-page-format')?.value || "A4_P";
        const orientation = pageFormat.endsWith("_L") ? "l" : "p";
        const formatSize = pageFormat.startsWith("Letter") ? "letter" : "a4";
        const pdf = new jsPDF(orientation, "pt", formatSize);
        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();

        const backends = osmdInstance.drawer.Backends;

        for (let i = 0; i < backends.length; i++) {
            if (i > 0) pdf.addPage();

            const svgElement = backends[i].getSvgElement();
            const imageDataUrl = await svgToJpegDataUrl(svgElement);

            // Calculate scale to fit width
            const ratio = svgElement.clientHeight / svgElement.clientWidth;
            const drawWidth = pageWidth;
            const drawHeight = pageWidth * ratio;

            pdf.addImage(imageDataUrl, 'JPEG', 0, 0, drawWidth, drawHeight);
        }

        const songName = document.getElementById('result-song-name').innerText || 'Drum Tab';
        pdf.save(`${songName}.pdf`);
    } catch (err) {
        console.error("PDF Export Error:", err);
        showError("Failed to generate PDF. Check console for details.");
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
        feather.replace();
    }
}

async function generateGhostPDF(xmlString, songName) {
    const ghostContainer = document.createElement('div');
    ghostContainer.style.position = 'absolute';
    ghostContainer.style.left = '-9999px';
    ghostContainer.style.top = '-9999px';
    ghostContainer.style.width = '1152px';
    document.body.appendChild(ghostContainer);

    try {
        const ghostOsmd = createConfiguredOSMD(ghostContainer, true);

        await ghostOsmd.load(xmlString);
        ghostOsmd.render();

        const { jsPDF } = window.jspdf;
        const pageFormat = document.getElementById('style-page-format')?.value || "A4_P";
        const orientation = pageFormat.endsWith("_L") ? "l" : "p";
        const formatSize = pageFormat.startsWith("Letter") ? "letter" : "a4";
        const pdf = new jsPDF(orientation, "pt", formatSize);
        const pageWidth = pdf.internal.pageSize.getWidth();

        const backends = ghostOsmd.drawer.Backends;
        for (let i = 0; i < backends.length; i++) {
            if (i > 0) pdf.addPage();
            const svgElement = backends[i].getSvgElement();
            const imageDataUrl = await svgToJpegDataUrl(svgElement);
            const ratio = svgElement.clientHeight / svgElement.clientWidth;
            const drawHeight = pageWidth * ratio;
            pdf.addImage(imageDataUrl, 'JPEG', 0, 0, pageWidth, drawHeight);
        }
        pdf.save(`${songName}.pdf`);
    } finally {
        document.body.removeChild(ghostContainer);
    }
}

function resetUI() {
    // Restore main container width
    const mainCard = document.querySelector('main.glass-card');
    mainCard.classList.add('max-w-3xl');
    mainCard.classList.remove('max-w-6xl');

    panels.result.classList.add('hidden');
    panels.result.classList.remove('flex');

    panels.mapping.classList.add('hidden');
    panels.mapping.classList.remove('flex');

    panels.progress.classList.add('hidden');
    panels.progress.classList.remove('flex');
    panels.progress.parentElement.classList.remove('progress-pulse');

    tabs.search.parentElement.classList.remove('hidden');

    // Default to active tab
    switchTab(activeTab);
}

// --- Settings & UI Global Actions ---

function updateDarkModeIcon() {
    const moon = document.getElementById('icon-moon');
    const sun = document.getElementById('icon-sun');

    if (moon && sun) {
        if (window.osmdDarkModeGlobal) {
            moon.classList.remove('hidden');
            sun.classList.add('hidden');
        } else {
            moon.classList.add('hidden');
            sun.classList.remove('hidden');
        }
    }
}

function updateDarkThemeColors() {
    window.osmdDarkBg = document.getElementById('color-dark-bg').value;
    window.osmdDarkStaff = document.getElementById('color-dark-staff').value;
    window.osmdDarkNote = document.getElementById('color-dark-note').value;

    document.getElementById('label-color-dark-bg').innerText = window.osmdDarkBg;
    document.getElementById('label-color-dark-staff').innerText = window.osmdDarkStaff;
    document.getElementById('label-color-dark-note').innerText = window.osmdDarkNote;

    localStorage.setItem('osmd_dark_bg', window.osmdDarkBg);
    localStorage.setItem('osmd_dark_staff', window.osmdDarkStaff);
    localStorage.setItem('osmd_dark_note', window.osmdDarkNote);

    if (window.osmdDarkModeGlobal) {
        if (osmdInstance && !panels.result.classList.contains('hidden')) {
            osmdInstance.setOptions({ pageBackgroundColor: window.osmdDarkBg });
            window.applyDarkThemeEngravingRules(osmdInstance);
            osmdInstance.render();
        }
        if (currentInterceptMapper && !panels.mapping.classList.contains('hidden')) {
            currentInterceptMapper.updateDarkMode(true);
        }
    }
}

window.applyDarkThemeEngravingRules = function (osmd) {
    osmd.EngravingRules.DefaultColorMusic = window.osmdDarkNote;
    osmd.EngravingRules.DefaultColorRest = window.osmdDarkNote;
    osmd.EngravingRules.StaffLineColor = window.osmdDarkStaff;
    osmd.EngravingRules.ClefColor = window.osmdDarkStaff;
    osmd.EngravingRules.TimeSignatureColor = window.osmdDarkStaff;
    osmd.EngravingRules.KeySignatureColor = window.osmdDarkStaff;
    osmd.EngravingRules.StemColor = window.osmdDarkNote;
    osmd.EngravingRules.LedgerLineColor = window.osmdDarkStaff;
    osmd.EngravingRules.TempoColor = window.osmdDarkStaff;
    osmd.EngravingRules.MeasureNumberColor = window.osmdDarkStaff;
    osmd.EngravingRules.RepeatBarlineColor = window.osmdDarkStaff;
}

function toggleOSMDDarkMode() {
    window.osmdDarkModeGlobal = !window.osmdDarkModeGlobal;
    localStorage.setItem('osmd_dark_mode', window.osmdDarkModeGlobal);

    updateDarkModeIcon();

    if (osmdInstance && !panels.result.classList.contains('hidden')) {
        osmdInstance.setOptions({
            darkMode: window.osmdDarkModeGlobal,
            pageBackgroundColor: window.osmdDarkModeGlobal ? window.osmdDarkBg : "#FFFFFF"
        });

        if (window.osmdDarkModeGlobal) {
            window.applyDarkThemeEngravingRules(osmdInstance);
        } else {
            // Unset or rely on OSMD's darkMode to reset colors? OSMD handles false partially, but we must clear our overrides
            window.applyDefaultLightEngravingRules(osmdInstance);
        }

        osmdInstance.render();
    }

    if (currentInterceptMapper && !panels.mapping.classList.contains('hidden')) {
        currentInterceptMapper.updateDarkMode(window.osmdDarkModeGlobal);
    }
}

window.applyDefaultLightEngravingRules = function (osmd) {
    osmd.EngravingRules.DefaultColorMusic = "#000000";
    osmd.EngravingRules.DefaultColorRest = "#000000";
    osmd.EngravingRules.StaffLineColor = "#000000";
    osmd.EngravingRules.ClefColor = "#000000";
    osmd.EngravingRules.TimeSignatureColor = "#000000";
    osmd.EngravingRules.KeySignatureColor = "#000000";
    osmd.EngravingRules.StemColor = "#000000";
    osmd.EngravingRules.LedgerLineColor = "#000000";
    osmd.EngravingRules.TempoColor = "#000000";
    osmd.EngravingRules.MeasureNumberColor = "#000000";
    osmd.EngravingRules.RepeatBarlineColor = "#000000";
};

    // Initialization
    (async () => {
        try {
            const storedDark = localStorage.getItem('osmd_dark_mode');
            window.osmdDarkModeGlobal = storedDark === 'true';

            // Sync icon state immediately
            updateDarkModeIcon();

            window.osmdDarkBg = localStorage.getItem('osmd_dark_bg') || "#1e2022";
            window.osmdDarkStaff = localStorage.getItem('osmd_dark_staff') || "#6b7280";
            window.osmdDarkNote = localStorage.getItem('osmd_dark_note') || "#d4d4d8";

            const bgInput = document.getElementById('color-dark-bg');
            if (bgInput) {
                if (/^#[0-9A-Fa-f]{6}$/.test(window.osmdDarkBg)) bgInput.value = window.osmdDarkBg;
                document.getElementById('label-color-dark-bg').innerText = window.osmdDarkBg;
            }
            const staffInput = document.getElementById('color-dark-staff');
            if (staffInput) {
                if (/^#[0-9A-Fa-f]{6}$/.test(window.osmdDarkStaff)) staffInput.value = window.osmdDarkStaff;
                document.getElementById('label-color-dark-staff').innerText = window.osmdDarkStaff;
            }
            const noteInput = document.getElementById('color-dark-note');
            if (noteInput) {
                if (/^#[0-9A-Fa-f]{6}$/.test(window.osmdDarkNote)) noteInput.value = window.osmdDarkNote;
                document.getElementById('label-color-dark-note').innerText = window.osmdDarkNote;
            }

        } catch (e) { }
    })();

// --- Toast Notifications ---

let toastTimeout;
function showError(message) {
    const toast = document.getElementById('toast');
    document.getElementById('toast-message').innerText = message;
    toast.classList.remove('translate-y-full', 'opacity-0');

    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
        hideToast('toast');
    }, 5000);
}

function showSuccessToast(message) {
    const toast = document.getElementById('toast-success');
    document.getElementById('toast-success-message').innerText = message;
    toast.classList.remove('translate-y-full', 'opacity-0');

    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
        hideToast('toast-success');
    }, 5000);
}

function hideToast(toastId = 'toast') {
    document.getElementById(toastId).classList.add('translate-y-full', 'opacity-0');
}

// --- Album Art ---

async function fetchAlbumCover(artist, title) {
    try {
        const query = encodeURIComponent(`${artist} ${title}`);
        const url = `https://itunes.apple.com/search?term=${query}&entity=song&limit=1`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.results && data.results.length > 0) {
            let artwork = data.results[0].artworkUrl100;
            return artwork.replace('100x100bb', '400x400bb');
        }
    } catch (err) {
        console.error("Cover fetch error:", err);
    }
    return null;
}

async function ensureAlbumCover(url, artist, title) {
    let lib = getLibrary();
    let itemIndex = lib.findIndex(i => i.url === url);
    if (itemIndex > -1 && !lib[itemIndex].coverUrl) {
        const cover = await fetchAlbumCover(artist, title);
        if (cover) {
            let freshLib = getLibrary();
            let freshIndex = freshLib.findIndex(i => i.url === url);
            if (freshIndex > -1) {
                freshLib[freshIndex].coverUrl = cover;
                localStorage.setItem('songsterr_library', JSON.stringify(freshLib));
                if (activeTab === 'library') renderLibrary();
            }
        }
    }
}

// --- Library / History Management ---

function getLibrary() {
    try {
        const data = localStorage.getItem('songsterr_library');
        return data ? JSON.parse(data) : [];
    } catch (e) {
        return [];
    }
}

function saveToLibrary(artist, title, url, customMapping = null) {
    let lib = getLibrary();
    let existingItem = lib.find(item => item.url === url);
    let mappingToSave = customMapping;

    if (!mappingToSave && existingItem && existingItem.customMapping) {
        mappingToSave = existingItem.customMapping;
    }

    // Remove if exists to prepend it at the top
    lib = lib.filter(item => item.url !== url);

    let newItem = {
        artist: artist || 'Unknown Artist',
        title: title || 'Unknown Title',
        url: url,
        date: new Date().toISOString()
    };

    if (mappingToSave && Object.keys(mappingToSave).length > 0) {
        newItem.customMapping = mappingToSave;
    }

    lib.unshift(newItem);

    // Keep max 50 items
    if (lib.length > 50) lib.pop();

    localStorage.setItem('songsterr_library', JSON.stringify(lib));
    if (activeTab === 'library') renderLibrary();
}

function removeFromLibrary(url) {
    let lib = getLibrary();
    lib = lib.filter(item => item.url !== url);
    localStorage.setItem('songsterr_library', JSON.stringify(lib));
    renderLibrary();
}

function clearLibrary() {
    if (confirm("Are you sure you want to clear your download history?")) {
        localStorage.removeItem('songsterr_library');
        renderLibrary();
    }
}

function renderLibrary() {
    const lib = getLibrary();
    const container = document.getElementById('library-list');

    if (lib.length === 0) {
        container.innerHTML = `
            <div class="text-center py-8 text-slate-500 text-sm">
                No songs in your library yet. Download a tab to save it here!
            </div>
        `;
        return;
    }

    container.innerHTML = lib.map(item => {
        if (!item.coverUrl && !item.coverFetchAttempted) {
            item.coverFetchAttempted = true; // temporary session flag
            ensureAlbumCover(item.url, item.artist, item.title);
        }

        const dateStr = new Date(item.date).toLocaleDateString();
        let badgeHtml = '';
        if (item.customMapping) {
            const count = Object.keys(item.customMapping).length;
            if (count > 0) {
                badgeHtml = `<span class="ml-2 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center" title="${count} Custom Drum Mappings Saved"><i data-feather="settings" class="w-3 h-3 mr-1"></i>${count} Mappings</span>`;
            }
        }

        const coverHtml = item.coverUrl 
            ? `<img src="${item.coverUrl}" alt="Cover" class="w-16 h-16 rounded-md object-cover mr-4 border border-white/10 shadow-lg shrink-0">`
            : `<div class="w-16 h-16 rounded-md bg-slate-800 border border-white/10 mr-4 flex items-center justify-center shrink-0 shadow-inner"><i data-feather="music" class="w-6 h-6 text-slate-500"></i></div>`;

        return `
            <div class="flex items-center justify-between p-4 bg-slate-900/50 border border-white/5 rounded-xl hover:bg-slate-800 transition-colors group">
                ${coverHtml}
                <div class="flex-1 min-w-0 mr-4">
                    <h3 class="text-white font-medium truncate">${item.title}</h3>
                    <p class="text-slate-400 text-sm truncate">${item.artist}</p>
                    <div class="flex items-center mt-1">
                        <p class="text-slate-600 text-xs">Downloaded: ${dateStr}</p>
                        ${badgeHtml}
                    </div>
                </div>
                <div class="flex items-center space-x-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                    <button onclick="startDownload({url: '${item.url}'})" class="p-2 text-brand-400 hover:text-brand-300 hover:bg-white/5 rounded-lg transition-colors" title="Re-open">
                        <i data-feather="external-link" class="w-4 h-4"></i>
                    </button>
                    <button onclick="removeFromLibrary('${item.url}')" class="p-2 text-red-400 hover:text-red-300 hover:bg-white/5 rounded-lg transition-colors" title="Delete">
                        <i data-feather="trash-2" class="w-4 h-4"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');

    feather.replace();
}
