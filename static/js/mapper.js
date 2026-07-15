// mapper.js - Visual Drum Mapping Engine

const STAFF_Y_MAP = [
    { step: 'C', octave: 6, y: 0 },
    { step: 'B', octave: 5, y: 5 },
    { step: 'A', octave: 5, y: 10 },
    { step: 'G', octave: 5, y: 15 },
    { step: 'F', octave: 5, y: 20 },
    { step: 'E', octave: 5, y: 25 },
    { step: 'D', octave: 5, y: 30 },
    { step: 'C', octave: 5, y: 35 },
    { step: 'B', octave: 4, y: 40 },
    { step: 'A', octave: 4, y: 45 },
    { step: 'G', octave: 4, y: 50 },
    { step: 'F', octave: 4, y: 55 },
    { step: 'E', octave: 4, y: 60 },
    { step: 'D', octave: 4, y: 65 },
    { step: 'C', octave: 4, y: 70 },
    { step: 'B', octave: 3, y: 75 },
];

function getYForNote(step, octave) {
    const found = STAFF_Y_MAP.find(m => m.step === step && m.octave === octave);
    return found ? found.y : 35; // Default C5
}

function getNoteForY(y) {
    const snapped = Math.round(y / 5) * 5;
    const clamped = Math.max(0, Math.min(75, snapped));
    const found = STAFF_Y_MAP.find(m => m.y === clamped);
    return found || STAFF_Y_MAP[7]; // Default C5
}

function getNoteheadSVG(type) {
    switch(type) {
        case 'x':
            return `<path d="M-4,-4 L4,4 M-4,4 L4,-4" stroke="currentColor" stroke-width="1.5" fill="none"/>`;
        case 'circle-x':
            return `<circle cx="0" cy="0" r="4.5" stroke="currentColor" stroke-width="1" fill="none"/><path d="M-3,-3 L3,3 M-3,3 L3,-3" stroke="currentColor" stroke-width="1" fill="none"/>`;
        case 'diamond':
            return `<polygon points="0,-4.5 4,0 0,4.5 -4,0" fill="currentColor"/>`;
        case 'triangle':
            return `<polygon points="0,-4.5 4,3 -4,3" fill="currentColor"/>`;
        default: // normal
            return `<ellipse cx="0" cy="0" rx="5" ry="3.5" transform="rotate(-20)" fill="currentColor"/>`;
    }
}

function getStemYOffset(type, direction) {
    if (type === 'x') {
        return direction === 'down' ? 4 : -4;
    }
    if (type === 'triangle') {
        return direction === 'down' ? 3 : -4.5;
    }
    return 0; // normal, circle-x, diamond
}

// -----------------------------------------------------------------------------------------
// Single Fret Editor (Used for Unknown Drums intercept modal)
// -----------------------------------------------------------------------------------------

class VisualMapper {
    constructor(containerElement, initialMapping, isGlobal = false, songUrl = null) {
        this.container = containerElement;
        this.mapping = initialMapping; 
        this.isGlobal = isGlobal;
        this.songUrl = songUrl;
        this.osmdInstances = [];
        this.render();
    }

    render() {
        this.container.innerHTML = '';
        this.osmdInstances = [];
        Object.keys(this.mapping).forEach(fret => {
            const data = this.mapping[fret];
            const y = getYForNote(data.step, data.octave);
            
            const wrapper = document.createElement('div');
            wrapper.className = 'bg-input p-4 rounded-xl border border-subtle space-y-3 mapper-item';
            wrapper.dataset.fret = fret;

            const nameInput = `<input type="text" class="map-name block w-full bg-surface border border-base rounded px-3 py-2 text-sm text-primary" placeholder="Instrument Name" value="${data.name || 'Drum ' + fret}">`;

            const heads = ['normal', 'x', 'circle-x', 'diamond', 'triangle'];
            let toolbarHtml = `<div class="flex space-x-2">`;
            heads.forEach(h => {
                const active = (data.notehead || 'normal') === h ? 'bg-accent border-accent' : 'bg-surface border-base';
                toolbarHtml += `<button type="button" class="btn-notehead w-8 h-8 rounded border flex items-center justify-center text-primary ${active}" data-head="${h}">
                    <svg viewBox="-8 -8 16 16" class="w-4 h-4">${getNoteheadSVG(h)}</svg>
                </button>`;
            });
            toolbarHtml += `</div>`;

            const svgHtml = `
                <div class="relative h-40 w-full bg-surface/50 rounded-lg overflow-hidden border border-subtle cursor-ns-resize select-none staff-container">
                    <svg width="100%" height="100%" viewBox="0 -10 100 100" preserveAspectRatio="xMidYMid meet">
                        <!-- Staff Lines (E4 to F5) -->
                        <line x1="10" y1="20" x2="90" y2="20" stroke="var(--text-muted)" opacity="0.5" stroke-width="1"/>
                        <line x1="10" y1="30" x2="90" y2="30" stroke="var(--text-muted)" opacity="0.5" stroke-width="1"/>
                        <line x1="10" y1="40" x2="90" y2="40" stroke="var(--text-muted)" opacity="0.5" stroke-width="1"/>
                        <line x1="10" y1="50" x2="90" y2="50" stroke="var(--text-muted)" opacity="0.5" stroke-width="1"/>
                        <line x1="10" y1="60" x2="90" y2="60" stroke="var(--text-muted)" opacity="0.5" stroke-width="1"/>
                        
                        <g class="ledger-lines" stroke="var(--text-muted)" opacity="0.8" stroke-width="1.5"></g>

                        <g class="draggable-note text-accent" transform="translate(50, ${y})">
                            <line x1="4.5" y1="0" x2="4.5" y2="-25" stroke="currentColor" stroke-width="1.2" class="note-stem" />
                            <g class="note-head">${getNoteheadSVG(data.notehead || 'normal')}</g>
                        </g>
                    </svg>
                    <div class="absolute bottom-2 right-2 text-xs text-accent font-mono note-label">${data.step}${data.octave}</div>
                </div>
            `;

            let infoHtml = `
                <div class="flex items-center justify-between mb-2">
                    <div class="flex items-center text-secondary font-medium text-sm">
                        Drum ID: ${fret}
                    </div>`;
                    
            if (data.display_measure !== undefined && data.display_measure !== null) {
                const measureNum = data.display_measure;
                infoHtml += `
                    <div class="flex items-center space-x-2">
                        <span class="text-xs text-secondary">First appears in Measure ${measureNum}</span>`;
                infoHtml += `</div>`;
            }
            infoHtml += `</div>`;

            let previewHtml = '';
            if (data.preview_xml) {
                const measureNum = (data.display_measure !== undefined && data.display_measure !== null) ? data.display_measure : '?';
                previewHtml = `
                    <div class="mt-4 border-t border-subtle pt-4">
                        <div class="text-xs text-secondary mb-2 font-medium">Context Preview (Measure ${measureNum}):</div>
                        <div class="rounded-md overflow-hidden border border-slate-700 bg-transparent" id="preview-osmd-${fret}"></div>
                    </div>
                `;
            }

            wrapper.innerHTML = `
                ${infoHtml}
                ${nameInput}
                ${toolbarHtml}
                ${svgHtml}
                ${previewHtml}
            `;
            
            this.container.appendChild(wrapper);
            this.attachEvents(wrapper, fret);
            this.updateLedgerLines(wrapper, y);

            if (data.preview_xml) {
                const previewContainer = wrapper.querySelector(`#preview-osmd-${fret}`);
                if (previewContainer && window.opensheetmusicdisplay) {
                    const osmd = new opensheetmusicdisplay.OpenSheetMusicDisplay(previewContainer, {
                        backend: "svg",
                        drawTitle: false,
                        drawSubtitle: false,
                        drawComposer: false,
                        drawPartNames: false,
                        drawMeasureNumbers: false,
                        autoResize: true,
                        darkMode: window.osmdDarkModeGlobal || false,
                        pageBackgroundColor: window.osmdDarkModeGlobal ? window.osmdDarkBg : "#FFFFFF"
                    });
                    osmd.EngravingRules.RenderMeasureNumbers = false;
                    osmd.EngravingRules.PageTopMargin = 2.0;
                    osmd.EngravingRules.PageBottomMargin = 2.0;
                    osmd.EngravingRules.PageLeftMargin = 0.0;
                    osmd.EngravingRules.PageRightMargin = 0.0;
                    osmd.EngravingRules.PercussionOneLineCutoff = 0;

                    if (window.osmdDarkModeGlobal && window.applyDarkThemeEngravingRules) {
                        window.applyDarkThemeEngravingRules(osmd);
                    }
                    osmd.load(data.preview_xml).then(() => {
                        osmd.zoom = 1.0; 
                        osmd.render();
                    }).catch(err => console.error("OSMD Preview Error:", err));
                    this.osmdInstances.push(osmd);
                }
            }
        });
    }

    updateDarkMode(isDark) {
        this.osmdInstances.forEach(osmd => {
            osmd.setOptions({
                darkMode: isDark,
                pageBackgroundColor: isDark ? window.osmdDarkBg : "#FFFFFF"
            });
            if (isDark && window.applyDarkThemeEngravingRules) {
                window.applyDarkThemeEngravingRules(osmd);
            } else if (!isDark && window.applyDefaultLightEngravingRules) {
                window.applyDefaultLightEngravingRules(osmd);
            }
            osmd.render();
        });
    }

    attachEvents(wrapper, fret) {
        const buttons = wrapper.querySelectorAll('.btn-notehead');
        buttons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                buttons.forEach(b => {
                    b.classList.remove('bg-accent', 'border-accent');
                    b.classList.add('bg-surface', 'border-base');
                });
                btn.classList.remove('bg-surface', 'border-base');
                btn.classList.add('bg-accent', 'border-accent');
                
                const head = btn.dataset.head;
                this.mapping[fret].notehead = head === 'normal' ? null : head;
                wrapper.querySelector('.note-head').innerHTML = getNoteheadSVG(head);
                
                // Update stem offset
                const stem = wrapper.querySelector('.note-stem');
                const isDown = stem.getAttribute('y2') === '25';
                stem.setAttribute('y1', getStemYOffset(head, isDown ? 'down' : 'up'));
            });
        });

        const nameInput = wrapper.querySelector('.map-name');
        nameInput.addEventListener('change', (e) => {
            this.mapping[fret].name = e.target.value;
        });

        const staffContainer = wrapper.querySelector('.staff-container');
        const svg = staffContainer.querySelector('svg');
        const draggableNote = svg.querySelector('.draggable-note');
        const noteLabel = staffContainer.querySelector('.note-label');
        const stem = draggableNote.querySelector('.note-stem');

        let isDragging = false;

        const updatePosition = (clientY) => {
            const rect = svg.getBoundingClientRect();
            const ratio = 100 / rect.height;
            const yOffset = (clientY - rect.top) * ratio - 10;
            
            const noteDef = getNoteForY(yOffset);
            draggableNote.setAttribute('transform', `translate(50, ${noteDef.y})`);
            noteLabel.innerText = `${noteDef.step}${noteDef.octave}`;
            
            if (noteDef.y <= 40) {
                stem.setAttribute('y2', '25');
                stem.setAttribute('x1', '-4.5');
                stem.setAttribute('x2', '-4.5');
                stem.setAttribute('y1', getStemYOffset(this.mapping[fret].notehead, 'down'));
            } else {
                stem.setAttribute('y2', '-25');
                stem.setAttribute('x1', '4.5');
                stem.setAttribute('x2', '4.5');
                stem.setAttribute('y1', getStemYOffset(this.mapping[fret].notehead, 'up'));
            }

            this.updateLedgerLines(wrapper, noteDef.y);
            this.mapping[fret].step = noteDef.step;
            this.mapping[fret].octave = noteDef.octave;
        };

        staffContainer.addEventListener('mousedown', (e) => {
            isDragging = true;
            updatePosition(e.clientY);
        });
        document.addEventListener('mousemove', (e) => {
            if (isDragging) updatePosition(e.clientY);
        });
        document.addEventListener('mouseup', () => {
            if (isDragging && this.isGlobal) this.saveGlobal();
            isDragging = false;
        });
        
        const initialY = getYForNote(this.mapping[fret].step, this.mapping[fret].octave);
        if (initialY <= 40) {
            stem.setAttribute('y2', '25');
            stem.setAttribute('x1', '-4.5');
            stem.setAttribute('x2', '-4.5');
            stem.setAttribute('y1', getStemYOffset(this.mapping[fret].notehead, 'down'));
        } else {
            stem.setAttribute('y1', getStemYOffset(this.mapping[fret].notehead, 'up'));
        }
    }
    
    updateLedgerLines(wrapper, y) {
        const group = wrapper.querySelector('.ledger-lines');
        group.innerHTML = '';
        if (y <= 10) group.innerHTML += `<line x1="42" y1="10" x2="58" y2="10"/>`;
        if (y <= 0) group.innerHTML += `<line x1="42" y1="0" x2="58" y2="0"/>`;
        if (y >= 70) group.innerHTML += `<line x1="42" y1="70" x2="58" y2="70"/>`;
    }

    getMapping() { return this.mapping; }
    saveGlobal() { localStorage.setItem('songsterr_global_mapping', JSON.stringify(this.mapping)); }
}

// -----------------------------------------------------------------------------------------
// Compact Multi-Note Editor (Used for Global Settings)
// -----------------------------------------------------------------------------------------

const DRUM_GROUPS = [
    { id: 'kick', name: "Bass Drums", frets: ["36", "35"] },
    { id: 'snare', name: "Snares", frets: ["38", "40", "37"] },
    { id: 'tom', name: "Toms", frets: ["48", "50", "47", "45", "43", "41"] },
    { id: 'hihat', name: "Hi-Hats", frets: ["42", "46", "44"] },
    { id: 'cymbal', name: "Cymbals", frets: ["51", "59", "53", "49", "57", "55", "52"] },
    { id: 'perc', name: "Percussion", frets: ["56", "31"] }
];

class VisualMapperCompact {
    constructor(containerElement, initialMapping) {
        this.container = containerElement;
        this.mapping = initialMapping; 
        this.groups = DRUM_GROUPS.map(g => ({
            ...g,
            frets: g.frets.filter(f => this.mapping[f]) // only include mapped ones
        })).filter(g => g.frets.length > 0);
        
        this.render();
    }

    render() {
        this.container.innerHTML = '';
        
        this.groups.forEach((group, index) => {
            const wrapper = document.createElement('div');
            wrapper.className = 'bg-input p-4 rounded-xl border border-subtle space-y-3';
            wrapper.dataset.groupId = group.id;
            
            // Set first fret as selected by default
            const initialFret = group.frets[0];
            const initialData = this.mapping[initialFret];

            // Shared Toolbar
            const heads = ['normal', 'x', 'circle-x', 'diamond', 'triangle'];
            let toolbarHtml = `<div class="flex justify-between items-center bg-surface p-2 rounded-lg border border-base group-toolbar">
                <input type="text" class="map-name bg-transparent border-none text-sm text-primary font-medium focus:ring-0 outline-none w-1/2" value="${initialData.name || 'Drum ' + initialFret}">
                <div class="flex space-x-1">`;
            
            heads.forEach(h => {
                const active = (initialData.notehead || 'normal') === h ? 'bg-accent border-accent' : 'border-transparent';
                toolbarHtml += `<button type="button" class="btn-notehead w-6 h-6 rounded border flex items-center justify-center text-primary ${active} hover:bg-surface-hover" data-head="${h}" data-tooltip="${h}">
                    <svg viewBox="-8 -8 16 16" class="w-3 h-3">${getNoteheadSVG(h)}</svg>
                </button>`;
            });
            toolbarHtml += `</div></div>`;

            // SVG Staff
            let notesHtml = '';
            let ledgersHtml = '';
            
            // Distribute notes along X axis
            const width = 300;
            const spacing = width / (group.frets.length + 1);

            group.frets.forEach((fret, i) => {
                const data = this.mapping[fret];
                const y = getYForNote(data.step, data.octave);
                const x = spacing * (i + 1);
                const isSelected = fret === initialFret;
                const opacity = isSelected ? '1' : '0.4';
                const colorClass = isSelected ? 'text-accent' : 'text-secondary';
                
                // Add ledger lines if needed
                if (y <= 10) ledgersHtml += `<line x1="${x-8}" y1="10" x2="${x+8}" y2="10" data-fret="${fret}" opacity="${opacity}" class="ledger-line"/>`;
                if (y <= 0) ledgersHtml += `<line x1="${x-8}" y1="0" x2="${x+8}" y2="0" data-fret="${fret}" opacity="${opacity}" class="ledger-line"/>`;
                if (y >= 70) ledgersHtml += `<line x1="${x-8}" y1="70" x2="${x+8}" y2="70" data-fret="${fret}" opacity="${opacity}" class="ledger-line"/>`;

                // Stem direction
                let stemHtml = '';
                if (y <= 40) {
                    stemHtml = `<line x1="-4.5" y1="${getStemYOffset(data.notehead, 'down')}" x2="-4.5" y2="25" stroke="currentColor" stroke-width="1.2" class="note-stem" />`;
                } else {
                    stemHtml = `<line x1="4.5" y1="${getStemYOffset(data.notehead, 'up')}" x2="4.5" y2="-25" stroke="currentColor" stroke-width="1.2" class="note-stem" />`;
                }

                notesHtml += `
                    <g class="draggable-note ${colorClass} cursor-pointer transition-all duration-200 hover:opacity-100" 
                       transform="translate(${x}, ${y})" 
                       data-fret="${fret}" 
                       data-x="${x}"
                       style="opacity: ${opacity};">
                        <!-- Hitbox for easier dragging/clicking -->
                        <rect x="-10" y="-15" width="20" height="30" fill="transparent"/>
                        ${stemHtml}
                        <g class="note-head">${getNoteheadSVG(data.notehead || 'normal')}</g>
                    </g>
                `;
            });

            const svgHtml = `
                <div class="relative h-40 w-full bg-surface/50 rounded-lg overflow-hidden border border-subtle select-none staff-container" data-selected="${initialFret}">
                    <svg width="100%" height="100%" viewBox="0 -10 300 100" preserveAspectRatio="xMidYMid meet">
                        <!-- Staff Lines -->
                        <line x1="5" y1="20" x2="295" y2="20" stroke="var(--text-muted)" opacity="0.5" stroke-width="1"/>
                        <line x1="5" y1="30" x2="295" y2="30" stroke="var(--text-muted)" opacity="0.5" stroke-width="1"/>
                        <line x1="5" y1="40" x2="295" y2="40" stroke="var(--text-muted)" opacity="0.5" stroke-width="1"/>
                        <line x1="5" y1="50" x2="295" y2="50" stroke="var(--text-muted)" opacity="0.5" stroke-width="1"/>
                        <line x1="5" y1="60" x2="295" y2="60" stroke="var(--text-muted)" opacity="0.5" stroke-width="1"/>
                        
                        <g class="ledger-lines" stroke="var(--text-muted)" opacity="0.8" stroke-width="1.5">
                            ${ledgersHtml}
                        </g>

                        ${notesHtml}
                    </svg>
                    <div class="absolute bottom-2 right-2 text-xs text-accent font-mono note-label">${initialData.step}${initialData.octave}</div>
                </div>
            `;

            wrapper.innerHTML = `
                <div class="flex items-center text-secondary font-bold text-xs uppercase tracking-wider mb-2">
                    ${group.name}
                </div>
                ${toolbarHtml}
                ${svgHtml}
            `;
            
            this.container.appendChild(wrapper);
            this.attachEvents(wrapper, group);
        });
    }

    attachEvents(wrapper, group) {
        const staffContainer = wrapper.querySelector('.staff-container');
        const svg = staffContainer.querySelector('svg');
        const nameInput = wrapper.querySelector('.map-name');
        const noteButtons = wrapper.querySelectorAll('.btn-notehead');
        const noteLabel = staffContainer.querySelector('.note-label');
        
        // Selection Logic
        const selectNote = (fret) => {
            staffContainer.dataset.selected = fret;
            const data = this.mapping[fret];
            
            // Update Toolbar
            nameInput.value = data.name || `Drum ${fret}`;
            if (noteLabel) noteLabel.textContent = `${data.step}${data.octave}`;
            noteButtons.forEach(btn => {
                const head = btn.dataset.head;
                if ((data.notehead || 'normal') === head) {
                    btn.classList.add('bg-accent', 'border-accent');
                    btn.classList.remove('border-transparent', 'bg-surface-hover');
                } else {
                    btn.classList.remove('bg-accent', 'border-accent');
                    btn.classList.add('border-transparent');
                }
            });
            
            // Update SVG Visuals
            svg.querySelectorAll('.draggable-note').forEach(n => {
                if (n.dataset.fret === fret) {
                    n.style.opacity = '1';
                    n.classList.remove('text-secondary');
                    n.classList.add('text-accent');
                } else {
                    n.style.opacity = '0.4';
                    n.classList.remove('text-accent');
                    n.classList.add('text-secondary');
                }
            });
            svg.querySelectorAll('.ledger-line').forEach(l => {
                l.setAttribute('opacity', l.dataset.fret === fret ? '1' : '0.4');
            });
        };

        // Toolbar Events
        nameInput.addEventListener('change', (e) => {
            const fret = staffContainer.dataset.selected;
            this.mapping[fret].name = e.target.value;
            // Update label under note
            svg.querySelector(`.draggable-note[data-fret="${fret}"] text:last-child`).textContent = e.target.value;
            this.saveGlobal();
        });

        noteButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const fret = staffContainer.dataset.selected;
                const head = btn.dataset.head;
                this.mapping[fret].notehead = head === 'normal' ? null : head;
                
                // Visual update
                svg.querySelector(`.draggable-note[data-fret="${fret}"] .note-head`).innerHTML = getNoteheadSVG(head);
                
                // Update stem offset
                const stem = svg.querySelector(`.draggable-note[data-fret="${fret}"] .note-stem`);
                const isDown = stem.getAttribute('y2') === '25';
                stem.setAttribute('y1', getStemYOffset(head, isDown ? 'down' : 'up'));
                
                selectNote(fret); // Refresh toolbar colors
                this.saveGlobal();
            });
        });

        // Drag and Drop Logic
        let draggingFret = null;
        let draggingNode = null;

        const updatePosition = (clientY) => {
            if (!draggingFret || !draggingNode) return;
            
            const rect = svg.getBoundingClientRect();
            const ratio = 100 / rect.height;
            const yOffset = (clientY - rect.top) * ratio - 10;
            
            const noteDef = getNoteForY(yOffset);
            const x = draggingNode.dataset.x;
            
            draggingNode.setAttribute('transform', `translate(${x}, ${noteDef.y})`);
            if (noteLabel) noteLabel.textContent = `${noteDef.step}${noteDef.octave}`;
            
            const stem = draggingNode.querySelector('.note-stem');
            if (noteDef.y <= 40) {
                stem.setAttribute('y2', '25');
                stem.setAttribute('x1', '-4.5');
                stem.setAttribute('x2', '-4.5');
                stem.setAttribute('y1', getStemYOffset(this.mapping[draggingFret].notehead, 'down'));
            } else {
                stem.setAttribute('y2', '-25');
                stem.setAttribute('x1', '4.5');
                stem.setAttribute('x2', '4.5');
                stem.setAttribute('y1', getStemYOffset(this.mapping[draggingFret].notehead, 'up'));
            }

            this.mapping[draggingFret].step = noteDef.step;
            this.mapping[draggingFret].octave = noteDef.octave;
            
            // Re-render all ledger lines for this group to keep it clean
            this.updateGroupLedgers(svg, group.frets);
        };

        svg.querySelectorAll('.draggable-note').forEach(node => {
            node.addEventListener('mousedown', (e) => {
                const fret = node.dataset.fret;
                selectNote(fret);
                draggingFret = fret;
                draggingNode = node;
                updatePosition(e.clientY);
            });
        });

        document.addEventListener('mousemove', (e) => {
            if (draggingFret) updatePosition(e.clientY);
        });

        document.addEventListener('mouseup', () => {
            if (draggingFret) {
                this.saveGlobal();
                draggingFret = null;
                draggingNode = null;
            }
        });
    }

    updateGroupLedgers(svg, frets) {
        const group = svg.querySelector('.ledger-lines');
        group.innerHTML = '';
        const selectedFret = svg.parentElement.dataset.selected;
        
        frets.forEach(fret => {
            const data = this.mapping[fret];
            const y = getYForNote(data.step, data.octave);
            const node = svg.querySelector(`.draggable-note[data-fret="${fret}"]`);
            if(!node) return;
            
            const x = parseFloat(node.dataset.x);
            const opacity = fret === selectedFret ? '1' : '0.4';
            
            if (y <= 10) group.innerHTML += `<line x1="${x-8}" y1="10" x2="${x+8}" y2="10" data-fret="${fret}" opacity="${opacity}" class="ledger-line"/>`;
            if (y <= 0) group.innerHTML += `<line x1="${x-8}" y1="0" x2="${x+8}" y2="0" data-fret="${fret}" opacity="${opacity}" class="ledger-line"/>`;
            if (y >= 70) group.innerHTML += `<line x1="${x-8}" y1="70" x2="${x+8}" y2="70" data-fret="${fret}" opacity="${opacity}" class="ledger-line"/>`;
        });
    }

    saveGlobal() { localStorage.setItem('songsterr_global_mapping', JSON.stringify(this.mapping)); }
}

// -----------------------------------------------------------------------------------------
// Global State & Reset
// -----------------------------------------------------------------------------------------

let globalDrumMapping = {};

async function fetchDefaultsAndMerge() {
    try {
        const res = await fetch('/api/mapping');
        const data = await res.json();
        const backendMapping = data.mapping;
        
        // Merge backend defaults with local modifications
        Object.keys(backendMapping).forEach(fret => {
            if (!globalDrumMapping[fret]) {
                globalDrumMapping[fret] = backendMapping[fret];
            }
        });
    } catch (e) {
        console.error("Failed to fetch mapping", e);
    }
}

// Initialize on load
(async () => {
    try {
        const stored = localStorage.getItem('songsterr_global_mapping');
        if (stored) globalDrumMapping = JSON.parse(stored);
    } catch(e){}
    await fetchDefaultsAndMerge();
})();

async function resetGlobalMapping() {
    localStorage.removeItem('songsterr_global_mapping');
    globalDrumMapping = {};
    await fetchDefaultsAndMerge();
    
    // Reset PDF & Styling UI manually
    const pageFormatSelect = document.getElementById('style-page-format');
    if (pageFormatSelect) pageFormatSelect.value = "A4_P";
    
    const zoomInput = document.getElementById('style-zoom');
    if (zoomInput) {
        zoomInput.value = "0.6";
        const zoomValDisp = document.getElementById('style-zoom-val');
        if (zoomValDisp) zoomValDisp.innerText = "0.6";
    }
    
    const drawTitleCheck = document.getElementById('style-draw-title');
    if (drawTitleCheck) drawTitleCheck.checked = true;
    
    const drawMeasuresCheck = document.getElementById('style-draw-measures');
    if (drawMeasuresCheck) drawMeasuresCheck.checked = true;

    // Re-render Settings UI
    const container = document.getElementById('global-mapping-container');
    if (container && container.children.length > 0) {
        new VisualMapperCompact(container, globalDrumMapping);
    }
}
