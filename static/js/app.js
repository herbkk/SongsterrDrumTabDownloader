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

import { initTheme, renderThemePicker, renderBaseThemePicker, setBaseTheme, setTheme } from './themeManager.js';
import { DownloadManager } from './downloadManager.js';
import { saveToLibrary, getLibrary, renderLibrary, librarySortMode } from './storageManager.js';
import { DrumPlaybackEngine } from './playback.js';

window.playbackEngine = new DrumPlaybackEngine();

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

let searchTimeout = null;
let currentFormat = 'musicxml';
let activeTab = 'search';
window.activeTab = activeTab;

// Batch Processing State
let isBatchModeUI = false;

// Resize Observer for consistent OSMD rendering
let osmdResizeObserver = null;

function setupOSMDResizeObserver() {
    const wrapper = document.querySelector('.print-wrapper');
    const container = document.getElementById('osmd-container');

    if (!wrapper || !container) return;
    if (osmdResizeObserver) osmdResizeObserver.disconnect();

    osmdResizeObserver = new ResizeObserver(entries => {
        for (let entry of entries) {
            const wrapperWidth = entry.contentRect.width;
            if (wrapperWidth === 0) continue;

            if (wrapperWidth < 1024) {
                // Force container layout to 1024px
                container.style.width = '1024px';
                container.style.minWidth = '1024px';
                // Visually zoom down to fit wrapper width
                container.style.zoom = wrapperWidth / 1024;
            } else {
                // Normal responsive layout above 1024px
                container.style.width = '100%';
                container.style.minWidth = '1024px';
                container.style.zoom = 1;
            }
        }
    });

    osmdResizeObserver.observe(wrapper);
}

// Initialize Observer
document.addEventListener('DOMContentLoaded', setupOSMDResizeObserver);

// Format handling
function updateFormatSelection(radio) {
    currentFormat = radio.value;

    // Update styling for selected
    document.querySelectorAll('.format-option').forEach(el => {
        el.classList.remove('selected', 'border-base');
        el.classList.add('border-base');
        el.querySelector('.check-icon').classList.remove('text-accent');
        el.querySelector('.check-icon').classList.add('text-transparent');
    });

    const parent = radio.closest('.format-option');
    parent.classList.remove('border-base');
    parent.classList.add('selected');
    parent.querySelector('.check-icon').classList.replace('text-transparent', 'text-accent');

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
            helper.innerHTML = `<p>All downloaded <code class="text-secondary font-mono">.musicxml</code> files are automatically saved to your server's local <code class="text-secondary font-mono">downloads/</code> folder.</p>
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
    window.activeTab = tabName;
    // Update tab styling
    Object.keys(tabs).forEach(key => {
        if (key === tabName) {
            tabs[key].classList.add('active');
            tabs[key].classList.remove('text-secondary');
        } else {
            tabs[key].classList.remove('active');
            tabs[key].classList.add('text-secondary');
        }
    });

    // Clean up score preview if navigating away via tabs
    if (!panels.result.classList.contains('hidden')) {
        if (window.playbackEngine && window.playbackEngine.isPlaying) {
            stopPlayback();
        }
        const mainCard = document.querySelector('main');
        if (mainCard) {
            mainCard.classList.add('max-w-3xl');
            mainCard.classList.remove('max-w-6xl');
        }
        panels.result.classList.add('hidden');
        panels.result.classList.remove('flex');
    }

    // Show active panel
    Object.keys(panels).forEach(key => {
        if (key === tabName) {
            panels[key].classList.remove('hidden');
            if (key === 'library') {
                panels[key].classList.add('flex');
                panels[key].classList.remove('block');
            } else {
                panels[key].classList.add('block');
                panels[key].classList.remove('flex');
            }
        } else if (['search', 'url', 'settings', 'library'].includes(key)) {
            panels[key].classList.remove('block', 'flex');
            panels[key].classList.add('hidden');
        }
    });

    if (window.innerWidth >= 640) {
        if (tabName === 'search') searchInput.focus();
        if (tabName === 'url') urlInput.focus();
    }
    if (tabName === 'library') {
        // Sync sort pill active state to persisted preference
        document.querySelectorAll('.library-sort-pill').forEach(pill => {
            pill.classList.toggle('active', pill.dataset.sort === librarySortMode);
        });
        renderLibrary();
    }

    if (tabName === 'settings') {
        const container = document.getElementById('global-mapping-container');
        if (container.children.length === 0) {
            new VisualMapperCompact(container, window.globalDrumMapping);
        }
        renderThemePicker();
    }
}

async function resetGlobalMapping() {
    if (confirm("Reset all drum mappings to defaults? This will delete all custom overrides including the app theme.")) {
        localStorage.removeItem('songsterr_mapping');
        localStorage.removeItem('songsterr_global_mapping');
        localStorage.removeItem('songsterr_theme');
        localStorage.removeItem('songsterr_base_theme');
        localStorage.removeItem('style_page_format');
        localStorage.removeItem('style_draw_title');
        localStorage.removeItem('style_draw_measures');
        localStorage.removeItem('style_zoom');
        localStorage.removeItem('style_force_stems_up');
        localStorage.removeItem('osmd_dist_systems');
        localStorage.removeItem('osmd_dist_staves');
        localStorage.removeItem('osmd_margin_top');
        localStorage.removeItem('osmd_margin_bottom');
        localStorage.removeItem('osmd_margin_left');
        localStorage.removeItem('osmd_margin_right');

        window.globalDrumMapping = {};
        if (window.fetchDefaultsAndMerge) {
            await window.fetchDefaultsAndMerge();
        }

        const container = document.getElementById('global-mapping-container');
        container.innerHTML = '';
        new VisualMapperCompact(container, window.globalDrumMapping);
        setTheme('turquoise-glow');
        setBaseTheme('clean-light');

        // Reset DOM elements for PDF Settings
        document.getElementById('style-page-format').value = 'A4_P';
        document.getElementById('style-draw-title').checked = true;
        document.getElementById('style-draw-measures').checked = true;
        document.getElementById('style-stem-direction').value = 'up';
        document.getElementById('style-zoom').value = '0.6';
        document.getElementById('style-zoom-val').innerText = '0.6';

        // Reset Advanced Layout DOM elements
        const advDefaults = {
            'dist-systems': 10, 'dist-staves': 5,
            'margin-top': 20, 'margin-bottom': 20,
            'margin-left': 10, 'margin-right': 10
        };
        Object.entries(advDefaults).forEach(([k, v]) => {
            const el = document.getElementById(`osmd-${k}`);
            const valDisplay = document.getElementById(`val-${k}`);
            if (el) el.value = v;
            if (valDisplay) valDisplay.innerText = v;
        });

        renderThemePicker();
        renderBaseThemePicker();
        showSuccessToast("Global mapping and theme reset");
    }
}

// --- Search Logic ---

searchInput.addEventListener('input', (e) => {
    const query = e.target.value.trim();

    clearTimeout(searchTimeout);

    if (query.length < 2) {
        searchResults.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon flex items-center justify-center">
                    <i data-feather="search" class="w-5 h-5"></i>
                </div>
                <p class="empty-state-text">Type at least 2 characters to search</p>
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
            <div class="empty-state">
                <div class="empty-state-icon flex items-center justify-center">
                    <i data-feather="music" class="w-5 h-5"></i>
                </div>
                <p class="empty-state-text">No tracks found for this query.</p>
            </div>
        `;
        feather.replace();
        return;
    }

    let html = '';
    results.forEach(song => {
        // Difficulty rendering (1-3 stars)
        const diff = song.trackDifficulty ?? song.drumDifficulty ?? 1;
        let diffHtml = '';
        for (let i = 0; i < 3; i++) {
            if (i < diff) diffHtml += `<i data-feather="star" class="w-3 h-3 star-filled inline"></i>`;
            else diffHtml += `<i data-feather="star" class="w-3 h-3 text-muted inline"></i>`;
        }

        html += `
            <div class="search-result-item bg-surface border border-subtle rounded-xl p-4 cursor-pointer flex justify-between items-center group w-full min-w-0" 
                 onclick="startDownloadFromSearch(${song.songId}, '${song.artist.replace(/'/g, "\\'")}', '${song.title.replace(/'/g, "\\'")}')">
                <div class="flex-1 min-w-0 pr-4">
                    <h4 class="text-primary font-medium truncate group-hover:text-accent transition-colors">${song.title}</h4>
                    <p class="text-secondary text-sm truncate">${song.artist}</p>
                </div>
                <div class="flex flex-col items-end flex-shrink-0">
                    <div class="bg-surface px-2 py-1 rounded text-xs text-secondary font-medium mb-1 border border-subtle">
                        <i data-feather="box" class="w-3 h-3 inline mr-1 text-accent"></i>${song.instrument === 'drums' ? 'Drums' : 'Guitar'}
                    </div>
                    <div class="text-xs" data-tooltip="Difficulty">
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

// --- Download Manager Integration ---
const downloadManager = new DownloadManager();

downloadManager.addEventListener('batch-start', (e) => {
    document.getElementById('batch-progress-container').classList.remove('hidden');
    updateBatchProgressUI(0, e.detail.total);
});

downloadManager.addEventListener('batch-progress', (e) => {
    updateBatchProgressUI(e.detail.completed, e.detail.total);
    progressTitle.innerText = `Downloading item ${e.detail.completed + 1} of ${e.detail.total}`;
});

downloadManager.addEventListener('batch-item-done', async (e) => {
    const result = e.detail.result;
    if (currentFormat === 'pdf') {
        progressStep.innerText = 'Ghost rendering PDF...';
        try {
            await generateGhostPDF(result.xml_string, result.artist, result.title);
        } catch (err) {
            console.error("Ghost PDF Error", err);
            showError("Failed to render PDF for " + result.title);
        }
    }
});

downloadManager.addEventListener('batch-complete', () => {
    updateBatchProgressUI(downloadManager.batchQueueTotal, downloadManager.batchQueueTotal); // Hits 100%
    setTimeout(() => {
        resetUI();
        switchTab('library');
        showSuccessToast("Batch download completed!");
    }, 1000);
});

downloadManager.addEventListener('download-start', (e) => {
    if (window.playbackEngine && window.playbackEngine.isPlaying) {
        stopPlayback();
    }

    panels.search.classList.add('hidden');
    panels.url.classList.add('hidden');

    if (window.innerWidth >= 640) {
        tabs.search.parentElement.classList.add('hidden');
    } else {
        Object.values(tabs).forEach(tab => tab.classList.add('pointer-events-none', 'opacity-50'));
    }

    panels.result.classList.add('hidden');
    panels.result.classList.remove('flex');

    panels.progress.classList.remove('hidden');
    panels.progress.classList.add('flex');
    panels.progress.parentElement.classList.add('progress-pulse');

    progressBar.style.width = '0%';
    progressStep.innerText = 'Connecting to server...';
});

downloadManager.addEventListener('download-progress', (e) => {
    progressBar.style.width = `${e.detail.progress * 100}%`;
    progressStep.innerText = e.detail.step;
});

downloadManager.addEventListener('download-resume', (e) => {
    const panelTrackSelection = document.getElementById('panel-track-selection');
    if (panelTrackSelection) {
        panelTrackSelection.classList.add('hidden');
        panelTrackSelection.classList.remove('flex');
    }

    panels.mapping.classList.add('hidden');
    panels.mapping.classList.remove('flex');

    panels.progress.classList.remove('hidden');
    panels.progress.classList.add('flex');
    panels.progress.parentElement.classList.add('progress-pulse');
    progressStep.innerText = e.detail.step;
});

downloadManager.addEventListener('download-complete', (e) => {
    showSuccess(e.detail.result, e.detail.url);
});

function showMappingUI(unmappedFrets, songUrl) {
    panels.search.classList.add('hidden');
    panels.url.classList.add('hidden');
    panels.result.classList.add('hidden');
    panels.result.classList.remove('flex');
    panels.progress.classList.add('hidden');
    panels.progress.classList.remove('flex');
    
    // Hide nav bar cleanly
    if (window.innerWidth >= 640) {
        tabs.search.parentElement.classList.add('hidden');
    } else {
        Object.values(tabs).forEach(tab => tab.classList.add('pointer-events-none', 'opacity-50'));
    }

    panels.mapping.classList.remove('hidden');
    panels.mapping.classList.add('flex');

    const urlContainer = document.getElementById('mapping-song-url-container');
    if (urlContainer && songUrl) {
        urlContainer.innerHTML = `<a href="${songUrl}" target="_blank" class="hover:underline flex items-center justify-center"><i data-feather="external-link" class="w-3 h-3 mr-1"></i>View Score on Songsterr</a>`;
        if (window.feather) window.feather.replace();
    } else if (urlContainer) {
        urlContainer.innerHTML = '';
    }

    const mappingDict = {};
    if (Array.isArray(unmappedFrets)) {
        unmappedFrets.forEach(item => {
            mappingDict[item.fret] = {
                step: 'C',
                octave: 5,
                notehead: 'x',
                name: 'Drum ' + item.fret,
                first_measure: item.first_measure,
                display_measure: item.display_measure,
                preview_xml: item.preview_xml
            };
        });
    } else {
        Object.assign(mappingDict, unmappedFrets);
    }

    const container = document.getElementById('mapping-container');
    container.innerHTML = '';
    window.currentInterceptMapper = new VisualMapper(container, mappingDict, false, songUrl);
}

downloadManager.addEventListener('requires-mapping', (e) => {
    showMappingUI(e.detail.unmapped_frets, e.detail.song_url);
});

downloadManager.addEventListener('requires-track-selection', (e) => {
    showTrackSelectionUI(e.detail.tracks);
});

function showTrackSelectionUI(tracks) {
    panels.search.classList.add('hidden');
    panels.url.classList.add('hidden');
    panels.result.classList.add('hidden');
    panels.result.classList.remove('flex');
    panels.progress.classList.add('hidden');
    panels.progress.classList.remove('flex');
    
    // Hide nav bar cleanly
    if (window.innerWidth >= 640) {
        tabs.search.parentElement.classList.add('hidden');
    } else {
        Object.values(tabs).forEach(tab => tab.classList.add('pointer-events-none', 'opacity-50'));
    }

    const panelTrackSelection = document.getElementById('panel-track-selection');
    if (panelTrackSelection) {
        panelTrackSelection.classList.remove('hidden');
        panelTrackSelection.classList.add('flex');
    }

    const trackList = document.getElementById('track-selection-list');
    if (trackList) {
        trackList.innerHTML = '';
        tracks.forEach(track => {
            const div = document.createElement('div');
            div.className = 'p-4 border-b border-base hover:bg-surface-hover cursor-pointer transition-colors flex items-center justify-between group last:border-b-0';
            div.onclick = () => submitTrackSelection(track.partId);
            
            let iconHtml = '<i data-feather="box" class="w-5 h-5 text-secondary group-hover:text-accent transition-colors mr-3"></i>';
            
            div.innerHTML = `
                <div class="flex items-center min-w-0">
                    ${iconHtml}
                    <div class="min-w-0">
                        <div class="text-sm font-medium text-primary group-hover:text-accent transition-colors truncate">${track.title || track.name || 'Unnamed Track'}</div>
                        <div class="text-xs text-secondary truncate">${track.instrument || 'Percussion'} (ID: ${track.partId})</div>
                    </div>
                </div>
                <div class="shrink-0 ml-3">
                    <div class="w-8 h-8 rounded-full bg-surface-hover group-hover:bg-accent/10 flex items-center justify-center transition-colors border border-base group-hover:border-accent/30">
                        <i data-feather="chevron-right" class="w-4 h-4 text-secondary group-hover:text-accent"></i>
                    </div>
                </div>
            `;
            trackList.appendChild(div);
        });
    }
    
    if (window.feather) window.feather.replace();
    
    const cancelBtn = document.getElementById('cancel-track-btn');
    if (cancelBtn) {
        cancelBtn.onclick = () => {
            resetUI();
            downloadManager.dispatchEvent(new CustomEvent('download-error', { detail: { error: 'Track selection cancelled' } }));
        };
    }
}

downloadManager.addEventListener('download-error', (e) => {
    showError(e.detail.error);
    resetUI();
});

function getDownloadConfig() {
    return {
        format: currentFormat,
        globalMapping: window.globalDrumMapping,
        stemDirection: document.getElementById('style-stem-direction')?.value || 'up',
        bpm: document.getElementById('bpm-input')?.value ? parseInt(document.getElementById('bpm-input').value, 10) : undefined
    };
}

function startDownloadFromSearch(songId, artist, title) {
    downloadManager.startDownloadFromSearch(songId, artist, title, getDownloadConfig());
}

function startDownloadFromUrl() {
    const inputEl = isBatchModeUI ? document.getElementById('batch-input') : urlInput;
    const text = inputEl.value.trim();
    if (!text) return;

    const urls = text.split('\n').map(u => u.trim()).filter(u => u.includes('songsterr.com/') && (u.includes('-s') || u.includes('songid=')));
    if (urls.length === 0) return;

    downloadManager.startDownloadFromUrls(urls, getDownloadConfig());
}

function updateBatchProgressUI(completed, total) {
    const pct = total > 0 ? (completed / total) * 100 : 0;
    document.getElementById('batch-progress-text').innerText = `Batch Progress (${completed}/${total})`;
    document.getElementById('batch-progress-pct').innerText = `${Math.round(pct)}%`;
    document.getElementById('batch-progress-bar').style.width = `${pct}%`;
}

async function startDownload(payload) {
    downloadManager.startDownload(payload, getDownloadConfig());
}

function submitTrackSelection(partId) {
    downloadManager.submitTrackSelection(partId, getDownloadConfig());
}

async function submitMapping() {
    if (!window.currentInterceptMapper) return;
    const customMapping = window.currentInterceptMapper.getMapping();
    window.lastSubmittedCustomMapping = customMapping;
    downloadManager.submitMapping(customMapping, getDownloadConfig());
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
        darkMode: window.osmdDarkModeGlobal,
        engravingRules: {
            percussionUseXMLDisplayStep: true
        }
    });

    osmd.EngravingRules.FlatBeams = true; // Hardcoded best for drums
    osmd.EngravingRules.RenderMeasureNumbers = drawMeasures;
    osmd.EngravingRules.PercussionOneLineCutoff = 0;

    // Apply Advanced PDF Layout
    osmd.EngravingRules.DistanceBetweenSystems = parseInt(document.getElementById('osmd-dist-systems')?.value || 10);
    osmd.EngravingRules.DistanceBetweenStaves = parseInt(document.getElementById('osmd-dist-staves')?.value || 5);
    osmd.EngravingRules.PageTopMargin = parseInt(document.getElementById('osmd-margin-top')?.value || 20);
    osmd.EngravingRules.PageBottomMargin = parseInt(document.getElementById('osmd-margin-bottom')?.value || 20);
    osmd.EngravingRules.PageLeftMargin = parseInt(document.getElementById('osmd-margin-left')?.value || 10);
    osmd.EngravingRules.PageRightMargin = parseInt(document.getElementById('osmd-margin-right')?.value || 10);

    osmd.zoom = zoomVal;

    if (window.osmdDarkModeGlobal) {
        window.applyDarkThemeEngravingRules(osmd);
    }

    osmd.setOptions({ percussionUseXMLDisplayStep: true });

    return osmd;
}

function saveOSMDLayoutSettings() {
    localStorage.setItem('osmd_dist_systems', document.getElementById('osmd-dist-systems').value);
    localStorage.setItem('osmd_dist_staves', document.getElementById('osmd-dist-staves').value);
    localStorage.setItem('osmd_margin_top', document.getElementById('osmd-margin-top').value);
    localStorage.setItem('osmd_margin_bottom', document.getElementById('osmd-margin-bottom').value);
    localStorage.setItem('osmd_margin_left', document.getElementById('osmd-margin-left').value);
    localStorage.setItem('osmd_margin_right', document.getElementById('osmd-margin-right').value);
}

function loadOSMDLayoutSettings() {
    const keys = ['dist-systems', 'dist-staves', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right'];
    keys.forEach(k => {
        const val = localStorage.getItem(`osmd_${k.replace('-', '_')}`);
        if (val) {
            const el = document.getElementById(`osmd-${k}`);
            if (el) {
                el.value = val;
                const valDisplay = document.getElementById(`val-${k}`);
                if (valDisplay) valDisplay.innerText = val;
            }
        }
    });
}


// --- Success & Reset ---

async function showSuccess(result, downloadUrl) {
    // Save to library history
    if (downloadUrl) {
        saveToLibrary(result.artist, result.title, downloadUrl, window.lastSubmittedCustomMapping);
        window.lastSubmittedCustomMapping = null;
    }

    panels.progress.classList.add('hidden');
    panels.progress.classList.remove('flex');
    panels.progress.parentElement.classList.remove('progress-pulse');
    tabs.search.parentElement.classList.remove('hidden', 'pointer-events-none', 'opacity-50');
    Object.values(tabs).forEach(tab => tab.classList.remove('pointer-events-none', 'opacity-50'));

    // Widen the main container for the score
    const mainCard = document.querySelector('main');
    if (mainCard) {
        mainCard.classList.remove('max-w-3xl');
        mainCard.classList.add('max-w-6xl');
    }

    panels.result.classList.remove('hidden');
    panels.result.classList.add('flex');

    const titleEl = document.getElementById('result-song-name');
    titleEl.innerText = `${result.artist} - ${result.title}`;
    titleEl.dataset.artist = result.artist;
    titleEl.dataset.title = result.title;
    document.getElementById('result-download-link').href = result.downloadUrl;

    const songsterrLink = document.getElementById('result-songsterr-link');
    if (songsterrLink && downloadUrl) {
        songsterrLink.href = downloadUrl;
        songsterrLink.classList.remove('hidden');
        songsterrLink.classList.add('flex');
    } else if (songsterrLink) {
        songsterrLink.classList.add('hidden');
        songsterrLink.classList.remove('flex');
    }

    updateStemButtonIcon();

    // Save string and map for stem toggling
    window.currentXmlString = result.xml_string;
    window.currentPlaybackMap = result.playback_map;
    window.currentSwingMap = result.swing_map;
    window.currentBaseTempo = result.base_tempo || 120;

    // Render OSMD
    const osmdContainer = document.getElementById('osmd-container');
    if (osmdContainer) {
        osmdContainer.innerHTML = ''; // Clear previous

        // Re-instantiate OSMD to avoid memory leaks or rendering state bugs between songs
        osmdInstance = createConfiguredOSMD(osmdContainer, false);

        runWithOSMDLoader(null, () => {
            return osmdInstance.load(result.xml_string).then(() => {
                osmdInstance.render();
                postProcessOSMDRender();
            });
        }, () => {
            // Success Callback

            // Initialize Audio Playback
            if (window.playbackEngine) {
                let bpmInput = document.getElementById('bpm-input').value;
                let currentBpm = bpmInput ? parseFloat(bpmInput) : window.currentBaseTempo; // fallback
                window.playbackEngine.init(osmdInstance, currentBpm, result.playback_map, result.swing_map);
            }

            // Show audio buttons
            document.getElementById('btn-audio-play').classList.remove('hidden');
            document.getElementById('btn-audio-play').classList.add('flex');
            document.getElementById('btn-audio-stop').classList.remove('hidden');
            document.getElementById('btn-audio-stop').classList.add('flex');
            const volumeBtn = document.getElementById('btn-volume-drag');
            if (volumeBtn) {
                volumeBtn.classList.remove('hidden');
                volumeBtn.classList.add('flex');
            }

            // Auto-scroll to bottom on mobile so controls are visible
            if (window.innerWidth < 640 && mainCard) {
                const scrollContainer = mainCard.querySelector('.max-sm\\:overflow-y-auto');
                if (scrollContainer) {
                    scrollContainer.scrollTop = scrollContainer.scrollHeight;
                }
            }
        }, (err) => {
            console.error("OSMD Load Error:", err);
            showError("Failed to render sheet music preview.");
        });
    }
}

// --- Audio Playback Controls ---

function togglePlayback() {
    if (!window.playbackEngine) return;

    if (window.playbackEngine.isPlaying) {
        window.playbackEngine.pause();
    } else {
        window.playbackEngine.play();
    }

    updateAudioPlaybackUI();
}

function stopPlayback() {
    if (!window.playbackEngine) return;

    window.playbackEngine.stop();
    updateAudioPlaybackUI();
}

function updateAudioPlaybackUI() {
    const playBtn = document.getElementById('btn-audio-play');
    const playIcon = document.getElementById('icon-audio-play');
    const pauseIcon = document.getElementById('icon-audio-pause');

    if (window.playbackEngine && window.playbackEngine.isPlaying) {
        playIcon.classList.add('hidden');
        pauseIcon.classList.remove('hidden');
        if (playBtn) playBtn.setAttribute('data-tooltip', 'Pause Audio');
    } else {
        playIcon.classList.remove('hidden');
        pauseIcon.classList.add('hidden');
        if (playBtn) playBtn.setAttribute('data-tooltip', 'Play Audio');
    }

    // Refresh tooltip if visible
    if (window.tooltipManager && window.tooltipManager.currentTarget === playBtn) {
        window.tooltipManager.showTooltip(playBtn);
    }
}

let appCustomCursor = null;

// Ensure audio stops if user navigates away or stems are toggled
window.playbackEngine.addEventListener('playback-stopped', () => {
    updateAudioPlaybackUI();
});

window.playbackEngine.addEventListener('cursor-update', (e) => {
    const ev = e.detail;
    if (!appCustomCursor) {
        appCustomCursor = document.createElement('div');
        appCustomCursor.style.position = 'absolute';
        appCustomCursor.style.zIndex = '999';
        appCustomCursor.style.backgroundColor = "var(--accent-1)";
        appCustomCursor.style.opacity = "0.45";
        appCustomCursor.style.borderRadius = "6px";
        appCustomCursor.style.pointerEvents = "none";
        appCustomCursor.style.display = "none";
    }

    if (ev.parent && appCustomCursor.parentElement !== ev.parent) {
        ev.parent.appendChild(appCustomCursor);
    }

    appCustomCursor.style.left = ev.left;
    appCustomCursor.style.top = ev.top;
    appCustomCursor.style.width = ev.width;
    appCustomCursor.style.height = ev.height;
    appCustomCursor.style.display = "block";
});

window.playbackEngine.addEventListener('cursor-hide', () => {
    if (appCustomCursor) {
        appCustomCursor.style.display = "none";
    }
});

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
    btn.innerHTML = `<i data-feather="loader" class="w-5 h-5 mr-2 animate-spin"></i><span class="whitespace-nowrap">Generating...</span>`;
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

        const titleEl = document.getElementById('result-song-name');
        const artist = titleEl.dataset.artist || 'Unknown Artist';
        const title = titleEl.dataset.title || 'Chord Chart';

        pdf.setProperties({
            title: title,
            author: artist,
            subject: 'Chord Chart',
            keywords: 'Chords, Guitar, Songsterr',
            creator: 'SongsterrGuitarChordDownloader'
        });

        pdf.save(`${artist} - ${title}.pdf`);
    } catch (err) {
        console.error("PDF Export Error:", err);
        showError("Failed to generate PDF. Check console for details.");
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
        feather.replace();
    }
}

async function generateGhostPDF(xmlString, artist, title) {
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

        pdf.setProperties({
            title: title || 'Chord Chart',
            author: artist || 'Unknown Artist',
            subject: 'Chord Chart',
            keywords: 'Chords, Guitar, Songsterr',
            creator: 'SongsterrGuitarChordDownloader'
        });

        pdf.save(`${artist} - ${title}.pdf`);
    } finally {
        document.body.removeChild(ghostContainer);
    }
}

function resetUI() {
    // Stop audio playback if active
    if (window.playbackEngine && window.playbackEngine.isPlaying) {
        stopPlayback();
    }

    // Restore main container width
    const mainCard = document.querySelector('main');
    if (mainCard) {
        mainCard.classList.add('max-w-3xl');
        mainCard.classList.remove('max-w-6xl');
    }

    panels.result.classList.add('hidden');
    panels.result.classList.remove('flex');

    panels.mapping.classList.add('hidden');
    panels.mapping.classList.remove('flex');

    const panelTrackSelection = document.getElementById('panel-track-selection');
    if (panelTrackSelection) {
        panelTrackSelection.classList.add('hidden');
        panelTrackSelection.classList.remove('flex');
    }

    panels.progress.classList.add('hidden');
    panels.progress.classList.remove('flex');
    panels.progress.parentElement.classList.remove('progress-pulse');

    tabs.search.parentElement.classList.remove('hidden', 'pointer-events-none', 'opacity-50');

    // Default to active tab
    switchTab(activeTab);
}

// --- Settings & UI Global Actions ---

function updateDarkModeIcon() {
    const moons = document.querySelectorAll('.icon-moon');
    const suns = document.querySelectorAll('.icon-sun');

    if (moons.length > 0 && suns.length > 0) {
        if (window.osmdDarkModeGlobal) {
            moons.forEach(m => m.classList.remove('hidden'));
            suns.forEach(s => s.classList.add('hidden'));
        } else {
            moons.forEach(m => m.classList.add('hidden'));
            suns.forEach(s => s.classList.remove('hidden'));
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
            postProcessOSMDRender();
        }
        if (window.currentInterceptMapper && !panels.mapping.classList.contains('hidden')) {
            window.currentInterceptMapper.updateDarkMode(true);
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
    // Determine which button was likely clicked based on screen size (or we can just pass the first visible one)
    const btn = window.innerWidth >= 640 ? document.querySelector('.fixed.top-4 .osmd-toggle') : document.querySelector('#main-navigation .osmd-toggle');

    runWithOSMDLoader(btn, () => {
        window.osmdDarkModeGlobal = !window.osmdDarkModeGlobal;
        localStorage.setItem('osmd_dark_mode', window.osmdDarkModeGlobal);

        if (osmdInstance && !panels.result.classList.contains('hidden')) {
            osmdInstance.setOptions({
                darkMode: window.osmdDarkModeGlobal,
                pageBackgroundColor: window.osmdDarkModeGlobal ? window.osmdDarkBg : "#FFFFFF"
            });

            if (window.osmdDarkModeGlobal) {
                window.applyDarkThemeEngravingRules(osmdInstance);
            } else {
                window.applyDefaultLightEngravingRules(osmdInstance);
            }

            osmdInstance.render();
            postProcessOSMDRender();
        }

        if (window.currentInterceptMapper && !panels.mapping.classList.contains('hidden')) {
            window.currentInterceptMapper.updateDarkMode(window.osmdDarkModeGlobal);
        }
    }, () => {
        updateDarkModeIcon();
    });
}

function updateStemButtonIcon() {
    const dir = document.getElementById('style-stem-direction')?.value || 'up';
    const btn = document.getElementById('btn-toggle-stem');
    const iconUp = document.getElementById('icon-stem-up');
    const iconDown = document.getElementById('icon-stem-down');
    const iconAuto = document.getElementById('icon-stem-auto');
    if (iconUp && iconDown && iconAuto) {
        iconUp.classList.add('hidden');
        iconDown.classList.add('hidden');
        iconAuto.classList.add('hidden');

        if (dir === 'up') {
            iconUp.classList.remove('hidden');
            if (btn) btn.title = "Stems Up";
        } else if (dir === 'down') {
            iconDown.classList.remove('hidden');
            if (btn) btn.title = "Stems Down";
        } else {
            iconAuto.classList.remove('hidden');
            if (btn) btn.title = "Stems Auto";
        }
    }
}

/**
 * Generic utility to show a loading state before a heavy OSMD render task.
 * @param {HTMLElement} btnElement - Optional button to show a spinner in.
 * @param {Function} renderCallback - The heavy render function to execute.
 * @param {Function} onComplete - Optional callback when done.
 */
function runWithOSMDLoader(btnElement, renderCallback, onComplete) {
    const osmdContainer = document.getElementById('osmd-container');

    // Capture scroll positions to prevent jump during re-renders
    const mainScroll = document.querySelector('main .max-sm\\:overflow-y-auto');
    const sheetScroll = document.querySelector('.print-wrapper');
    const mainScrollTop = mainScroll ? mainScroll.scrollTop : 0;
    const sheetScrollTop = sheetScroll ? sheetScroll.scrollTop : 0;

    if (osmdContainer) {
        osmdContainer.style.opacity = '0.5';
        osmdContainer.style.pointerEvents = 'none';
        osmdContainer.style.transition = 'opacity 0.2s ease-in-out';
    }

    let hiddenElements = [];
    let spinnerContainer = null;

    if (btnElement) {
        // Hide all SVG and I tags inside the button to preserve text
        Array.from(btnElement.children).forEach(child => {
            if (child.tagName.toLowerCase() === 'svg' || child.tagName.toLowerCase() === 'i') {
                if (!child.classList.contains('hidden')) {
                    child.classList.add('hidden');
                    hiddenElements.push(child);
                }
            }
        });

        spinnerContainer = document.createElement('span');
        spinnerContainer.className = 'flex items-center justify-center';

        const isSmallBtn = btnElement.classList.contains('w-11');
        const isOsmdToggle = btnElement.classList.contains('osmd-toggle');
        const spinnerSize = isOsmdToggle ? 'w-5 h-5 sm:w-4 sm:h-4 mb-1 sm:mb-0 sm:mr-1.5' : (isSmallBtn ? 'w-5 h-5' : 'w-5 h-5 mx-auto');

        spinnerContainer.innerHTML = `<i data-feather="loader" class="${spinnerSize} animate-spin"></i>`;

        btnElement.insertBefore(spinnerContainer, btnElement.firstChild);
        feather.replace();
        btnElement.disabled = true;
    }

    const finishLoading = () => {
        if (osmdContainer) {
            osmdContainer.style.opacity = '1';
            osmdContainer.style.pointerEvents = 'auto';
        }
        if (btnElement) {
            if (spinnerContainer) spinnerContainer.remove();
            hiddenElements.forEach(child => child.classList.remove('hidden'));
            btnElement.disabled = false;
        }

        // Restore scroll positions strictly for toggles (btnElement exists) on mobile
        if (btnElement && window.innerWidth < 640) {
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    if (mainScroll) mainScroll.scrollTop = mainScrollTop;
                    if (sheetScroll) sheetScroll.scrollTop = sheetScrollTop;
                });
            });
        }

        if (onComplete) onComplete();
    };

    setTimeout(async () => {
        try {
            const result = renderCallback();
            if (result && typeof result.then === 'function') {
                await result;
            }
        } catch (err) {
            console.error("OSMD Loader Error:", err);
            showError("An error occurred during rendering.");
        } finally {
            finishLoading();
        }
    }, 50);
}

function toggleStemDirection() {
    const select = document.getElementById('style-stem-direction');
    const btn = document.getElementById('btn-toggle-stem');
    if (!select) return;

    if (select.value === 'up') select.value = 'down';
    else if (select.value === 'down') select.value = 'auto';
    else select.value = 'up';

    localStorage.setItem('style_stem_direction', select.value);

    if (window.currentXmlString && osmdInstance) {
        runWithOSMDLoader(btn, () => {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(window.currentXmlString, "text/xml");
            const notes = xmlDoc.getElementsByTagName("note");

            for (let i = 0; i < notes.length; i++) {
                const note = notes[i];
                if (note.getElementsByTagName("rest").length > 0) continue;

                let stem = note.getElementsByTagName("stem")[0];
                if (select.value === 'auto') {
                    if (stem) note.removeChild(stem);
                } else {
                    if (!stem) {
                        stem = xmlDoc.createElement("stem");
                        note.appendChild(stem);
                    }
                    stem.textContent = select.value;
                }
            }

            const serializer = new XMLSerializer();
            const newXmlString = serializer.serializeToString(xmlDoc);

            const osmdContainer = document.getElementById('osmd-container');
            if (osmdContainer) osmdContainer.innerHTML = '';
            osmdInstance = createConfiguredOSMD(osmdContainer, false);

            return osmdInstance.load(newXmlString).then(() => {
                osmdInstance.render();
                postProcessOSMDRender();

                // Re-initialize Audio Playback with the new OSMD instance
                if (window.playbackEngine) {
                    let bpmInput = document.getElementById('bpm-input').value;
                    let currentBpm = bpmInput ? parseFloat(bpmInput) : 120;
                    window.playbackEngine.init(osmdInstance, currentBpm, window.currentPlaybackMap, window.currentSwingMap);
                }
            });
        }, () => {
            updateStemButtonIcon();
        });
    } else {
        updateStemButtonIcon();
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

// Post-process SVG immediately after OSMD render to fine-tune visual layout 
// (e.g., forcing repeat counts to align over the repeat barline, bypassing OSMD collision avoidance)
window.postProcessOSMDRender = function () {
    const svgs = document.querySelectorAll('#osmd-container svg');
    svgs.forEach(svg => {
        const texts = Array.from(svg.querySelectorAll('text'));
        const repeatTexts = texts.filter(t => t.textContent.match(/^\d+x$/));

        repeatTexts.forEach(rt => {
            const rtX = parseFloat(rt.getAttribute('x') || 0);
            // Shift left by 35 units to clear the first note and align precisely over the repeat barline
            rt.setAttribute('x', (rtX - 35).toString());
        });
    });
};

// Initialization
(async () => {
    try {
        const storedDark = localStorage.getItem('osmd_dark_mode');
        window.osmdDarkModeGlobal = storedDark === 'true';

        // Apply Theme
        initTheme();

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

        // Restore PDF Settings
        const savedFormat = localStorage.getItem('style_page_format');
        if (savedFormat) document.getElementById('style-page-format').value = savedFormat;

        const savedTitle = localStorage.getItem('style_draw_title');
        if (savedTitle !== null) document.getElementById('style-draw-title').checked = savedTitle === 'true';

        const savedMeasures = localStorage.getItem('style_draw_measures');
        if (savedMeasures !== null) document.getElementById('style-draw-measures').checked = savedMeasures === 'true';

        const savedZoom = localStorage.getItem('style_zoom');
        if (savedZoom !== null) {
            document.getElementById('style-zoom').value = savedZoom;
            document.getElementById('style-zoom-val').innerText = savedZoom;
        }

        const savedStemsDir = localStorage.getItem('style_stem_direction');
        if (savedStemsDir !== null) {
            document.getElementById('style-stem-direction').value = savedStemsDir;
            // Also clean up old boolean if present
            localStorage.removeItem('style_force_stems_up');
        }

        // Attach event listeners for PDF settings to persist them
        document.getElementById('style-page-format')?.addEventListener('change', (e) => localStorage.setItem('style_page_format', e.target.value));
        document.getElementById('style-draw-title')?.addEventListener('change', (e) => localStorage.setItem('style_draw_title', e.target.checked));
        document.getElementById('style-draw-measures')?.addEventListener('change', (e) => localStorage.setItem('style_draw_measures', e.target.checked));
        document.getElementById('style-zoom')?.addEventListener('change', (e) => localStorage.setItem('style_zoom', e.target.value));
        document.getElementById('style-stem-direction')?.addEventListener('change', (e) => {
            localStorage.setItem('style_stem_direction', e.target.value);
            updateStemButtonIcon();
        });

    } catch (e) { console.error('Error loading settings', e); }
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
        const query = new URLSearchParams({ artist, title }).toString();
        const url = `/api/cover-art?${query}`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.url) {
            return data.url;
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

// (Library & Theme logic extracted to ES6 modules)

// --- Tooltip Manager ---

class TooltipManager {
    constructor() {
        this.tooltipEl = document.createElement('div');
        this.tooltipEl.id = 'global-tooltip';
        document.body.appendChild(this.tooltipEl);

        this.hoveredElement = null;
        this.currentTarget = null;
        this.showTimeout = null;
        this.init();
    }

    init() {
        document.addEventListener('mouseover', (e) => {
            const target = e.target.closest('[data-tooltip]');
            if (target) {
                if (this.currentTarget === target) return;
                this.currentTarget = target;
                this.scheduleShow(target);
            }
        });

        document.addEventListener('mouseout', (e) => {
            const target = e.target.closest('[data-tooltip]');
            if (target) {
                if (e.relatedTarget && target.contains(e.relatedTarget)) return;
                if (this.currentTarget === target) {
                    this.currentTarget = null;
                    this.hideTooltip();
                }
            }
        });

        // Hide tooltip on click to prevent ghost tooltips
        document.addEventListener('click', (e) => {
            if (e.target.closest('[data-tooltip]')) {
                this.currentTarget = null;
                this.hideTooltip();
            }
        });
    }

    scheduleShow(element) {
        clearTimeout(this.showTimeout);
        this.showTimeout = setTimeout(() => {
            this.showTooltip(element);
        }, 500);
    }

    showTooltip(element) {
        this.hoveredElement = element;
        const text = element.getAttribute('data-tooltip');
        if (!text) return;

        this.tooltipEl.innerText = text;

        // Ensure tooltip has content to calculate height
        this.tooltipEl.classList.remove('visible');

        const rect = element.getBoundingClientRect();
        const tooltipRect = this.tooltipEl.getBoundingClientRect();

        // Default position: above the element
        let top = rect.top - tooltipRect.height - 8;
        let left = rect.left + (rect.width / 2);

        // Check if there's enough space above, if not put it below
        if (top < 10) {
            top = rect.bottom + 8;
            this.tooltipEl.style.transform = 'translate(-50%, -4px) scale(0.95)'; // start slightly above for bottom placement
        } else {
            this.tooltipEl.style.transform = 'translate(-50%, 4px) scale(0.95)'; // start slightly below for top placement
        }

        this.tooltipEl.style.top = `${top}px`;
        this.tooltipEl.style.left = `${left}px`;

        // Add visible class to trigger CSS transition
        requestAnimationFrame(() => {
            if (this.hoveredElement === element) {
                this.tooltipEl.classList.add('visible');

                // Adjust if bleeding off screen horizontally
                const updatedRect = this.tooltipEl.getBoundingClientRect();
                if (updatedRect.left < 10) {
                    this.tooltipEl.style.left = `${updatedRect.width / 2 + 10}px`;
                } else if (updatedRect.right > window.innerWidth - 10) {
                    this.tooltipEl.style.left = `${window.innerWidth - (updatedRect.width / 2) - 10}px`;
                }
            }
        });
    }

    hideTooltip() {
        clearTimeout(this.showTimeout);
        this.hoveredElement = null;
        this.tooltipEl.classList.remove('visible');
    }
}

// --- Volume Control ---
let globalVolume = 1.0;

function setGlobalVolume(val) {
    globalVolume = parseFloat(val);
    globalVolume = Math.max(0, Math.min(1, globalVolume));

    // Update Slider
    const slider = document.getElementById('setting-volume');
    if (slider && slider.value !== String(globalVolume)) slider.value = globalVolume;

    const sliderVal = document.getElementById('setting-volume-val');
    if (sliderVal) sliderVal.innerText = Math.round(globalVolume * 100) + '%';

    // Update Button Fills
    const fill = document.getElementById('volume-fill');
    if (fill) fill.style.height = (globalVolume * 100) + '%';

    // Update Icon opacity based on volume
    const iconVol = document.getElementById('icon-volume');
    const iconMuted = document.getElementById('icon-volume-muted');

    if (iconVol && iconMuted) {
        if (globalVolume === 0) {
            iconVol.classList.add('hidden');
            iconMuted.classList.remove('hidden');
        } else {
            iconVol.classList.remove('hidden');
            iconMuted.classList.add('hidden');
        }
    }

    // Update Audio Engine
    if (window.playbackEngine) {
        window.playbackEngine.volume = globalVolume;
    }

    localStorage.setItem('master_volume', globalVolume);
}

function initVolumeControl() {
    const savedVol = localStorage.getItem('master_volume');
    if (savedVol !== null) {
        setGlobalVolume(savedVol);
    } else {
        setGlobalVolume(1.0);
    }

    const dragBtn = document.getElementById('btn-volume-drag');
    if (!dragBtn) return;

    let isDragging = false;
    let startY = 0;
    let startVol = 0;

    function startDrag(e) {
        isDragging = true;
        startY = e.clientY || (e.touches && e.touches[0].clientY);
        startVol = globalVolume;
        document.body.style.userSelect = 'none';
    }

    function onDrag(e) {
        if (!isDragging) return;
        const y = e.clientY || (e.touches && e.touches[0].clientY);
        const deltaY = startY - y; // positive if moving up

        // 100px drag = 100% volume change
        const deltaVol = deltaY / 100.0;
        setGlobalVolume(startVol + deltaVol);
    }

    function stopDrag() {
        if (isDragging) {
            isDragging = false;
            document.body.style.userSelect = '';
        }
    }

    dragBtn.addEventListener('mousedown', startDrag);
    dragBtn.addEventListener('touchstart', startDrag, { passive: true });

    document.addEventListener('mousemove', onDrag);
    document.addEventListener('touchmove', onDrag, { passive: true });

    document.addEventListener('mouseup', stopDrag);
    document.addEventListener('touchend', stopDrag);
}

// Initialize tooltips and load settings
document.addEventListener('DOMContentLoaded', () => {
    window.tooltipManager = new TooltipManager();
    loadOSMDLayoutSettings();
    initVolumeControl();
});

// Expose functions to window for inline HTML handlers
window.switchTab = switchTab;
window.toggleBatchMode = toggleBatchMode;
window.updateFormatSelection = updateFormatSelection;
window.startDownloadFromUrl = startDownloadFromUrl;
window.resetGlobalMapping = resetGlobalMapping;
window.setGlobalVolume = setGlobalVolume;
window.hideToast = hideToast;
window.exportOSMDPDF = exportOSMDPDF;
window.toggleStemDirection = toggleStemDirection;
window.toggleOSMDDarkMode = toggleOSMDDarkMode;
window.togglePlayback = togglePlayback;
window.stopPlayback = stopPlayback;
window.startDownload = startDownload;
window.startDownloadFromSearch = startDownloadFromSearch;
window.resetUI = resetUI;
window.submitMapping = submitMapping;
window.ensureAlbumCover = ensureAlbumCover;
window.saveOSMDLayoutSettings = saveOSMDLayoutSettings;
