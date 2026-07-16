export let librarySortMode = localStorage.getItem('songsterr_library_sort') || 'recent';
let libraryFilterQuery = '';

export function getLibrary() {
    try {
        const data = localStorage.getItem('songsterr_library');
        return data ? JSON.parse(data) : [];
    } catch (e) {
        return [];
    }
}

export function saveToLibrary(artist, title, url, customMapping = null) {
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
    
    // activeTab is in app.js, so we trigger a custom event or check globally
    if (window.activeTab === 'library') renderLibrary();
}

export function removeFromLibrary(url) {
    let lib = getLibrary();
    lib = lib.filter(item => item.url !== url);
    localStorage.setItem('songsterr_library', JSON.stringify(lib));
    renderLibrary();
}

export function clearLibrary() {
    if (confirm("Are you sure you want to clear your download history?")) {
        localStorage.removeItem('songsterr_library');
        renderLibrary();
    }
}

export function setLibrarySort(mode) {
    librarySortMode = mode;
    localStorage.setItem('songsterr_library_sort', mode);

    // Update pill active states
    document.querySelectorAll('.library-sort-pill').forEach(pill => {
        if (pill.dataset.sort === mode) {
            pill.classList.add('active');
        } else {
            pill.classList.remove('active');
        }
    });

    renderLibrary();
}

export function onLibraryFilterInput() {
    const input = document.getElementById('library-filter-input');
    const clearBtn = document.getElementById('library-filter-clear');
    libraryFilterQuery = input.value.trim().toLowerCase();

    if (libraryFilterQuery.length > 0) {
        clearBtn.classList.remove('hidden');
    } else {
        clearBtn.classList.add('hidden');
    }

    renderLibrary();
}

export function clearLibraryFilter() {
    const input = document.getElementById('library-filter-input');
    const clearBtn = document.getElementById('library-filter-clear');
    input.value = '';
    libraryFilterQuery = '';
    clearBtn.classList.add('hidden');
    renderLibrary();
}

export function renderLibraryItem(item) {
    // If ensureAlbumCover is available from app.js it will be on window
    if (!item.coverUrl && !item.coverFetchAttempted && window.ensureAlbumCover) {
        item.coverFetchAttempted = true; // temporary session flag
        window.ensureAlbumCover(item.url, item.artist, item.title);
    }

    const d = new Date(item.date);
    const dateStr = `${d.getDate().toString().padStart(2, '0')}.${(d.getMonth() + 1).toString().padStart(2, '0')}.${d.getFullYear()}`;
    let badgeHtml = '';
    if (item.customMapping) {
        const count = Object.keys(item.customMapping).length;
        if (count > 0) {
            badgeHtml = `<span class="ml-2 p-1 rounded bg-accent-glow text-accent border border-accent-subtle flex items-center shrink-0 cursor-help" data-tooltip="${count} Custom Drum Mapping${count !== 1 ? 's' : ''} Saved"><i data-feather="map" class="w-3.5 h-3.5"></i></span>`;
        }
    }

    const coverHtml = item.coverUrl
        ? `<img src="${item.coverUrl}" alt="Cover" class="w-16 h-16 rounded-md object-cover mr-3 sm:mr-4 border border-base shadow-sm shrink-0">`
        : `<div class="w-16 h-16 rounded-md bg-surface border border-base mr-3 sm:mr-4 flex items-center justify-center shrink-0 shadow-inner"><i data-feather="music" class="w-6 h-6 text-muted"></i></div>`;

    return `
        <div class="flex items-center justify-between p-3 sm:p-4 bg-input border border-subtle rounded-xl hover:bg-surface transition-colors group">
            ${coverHtml}
            <div class="flex-1 min-w-0 mr-3">
                <h3 class="text-primary font-medium text-base truncate">${item.title}</h3>
                <p class="text-secondary text-sm truncate">${item.artist}</p>
                <div class="flex items-center mt-1">
                    <p class="text-muted text-xs">Downloaded: ${dateStr}</p>
                    ${badgeHtml}
                </div>
            </div>
            <div class="flex flex-col items-center justify-center space-y-1.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity shrink-0">
                <button onclick="window.removeFromLibrary('${item.url}')" class="p-1.5 text-red-400 hover:text-red-300 hover:bg-white/5 rounded-md transition-colors" data-tooltip="Delete">
                    <i data-feather="trash-2" class="w-3.5 h-3.5 sm:w-4 sm:h-4"></i>
                </button>
                <button onclick="window.startDownload({url: '${item.url}'})" class="p-1.5 text-accent hover:text-primary hover:bg-white/5 rounded-md transition-colors" data-tooltip="Re-open">
                    <i data-feather="external-link" class="w-3.5 h-3.5 sm:w-4 sm:h-4"></i>
                </button>
            </div>
        </div>
    `;
}

export function renderLibrary() {
    let lib = getLibrary();
    const container = document.getElementById('library-list');
    const controls = document.getElementById('library-controls');

    if (!container) return;

    if (controls) {
        controls.style.display = lib.length === 0 ? 'none' : '';
    }

    if (lib.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon flex items-center justify-center">
                    <i data-feather="music" class="w-5 h-5"></i>
                </div>
                <p class="empty-state-text">No songs in your library yet.<br>Download a tab to save it here!</p>
            </div>
        `;
        if (window.feather) window.feather.replace();
        return;
    }

    if (libraryFilterQuery) {
        lib = lib.filter(item =>
            item.artist.toLowerCase().includes(libraryFilterQuery) ||
            item.title.toLowerCase().includes(libraryFilterQuery)
        );
    }

    if (lib.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon flex items-center justify-center">
                    <i data-feather="search" class="w-5 h-5"></i>
                </div>
                <p class="empty-state-text">No matches found.</p>
            </div>
        `;
        if (window.feather) window.feather.replace();
        return;
    }

    if (librarySortMode === 'artist') {
        lib.sort((a, b) => a.artist.localeCompare(b.artist, undefined, { sensitivity: 'base' }));
    } else if (librarySortMode === 'title') {
        lib.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
    }

    if (librarySortMode === 'artist') {
        const groups = {};
        lib.forEach(item => {
            const key = item.artist || 'Unknown Artist';
            if (!groups[key]) groups[key] = [];
            groups[key].push(item);
        });

        let html = '';
        Object.keys(groups).forEach(artistName => {
            const items = groups[artistName];
            html += `
                <div class="library-group-header">
                    <span class="library-group-header-name">${artistName}</span>
                    <span class="library-group-header-count">${items.length} ${items.length === 1 ? 'song' : 'songs'}</span>
                </div>
            `;
            items.forEach(item => {
                html += renderLibraryItem(item);
            });
        });
        container.innerHTML = html;
    } else {
        container.innerHTML = lib.map(item => renderLibraryItem(item)).join('');
    }

    if (window.feather) window.feather.replace();
}

// Expose to window for inline handlers
window.removeFromLibrary = removeFromLibrary;
window.clearLibrary = clearLibrary;
window.setLibrarySort = setLibrarySort;
window.onLibraryFilterInput = onLibraryFilterInput;
window.clearLibraryFilter = clearLibraryFilter;
