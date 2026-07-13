const GM_DRUM_NOTES = {
    'Snare': 38,
    'Snare Ghost': 38, 
    'Snare Rim': 37,
    'Bass Drum': 36,
    'Hi-Hat Closed': 42,
    'Hi-Hat Open': 46,
    'Hi-Hat Pedal': 44,
    'Tom 1': 48,
    'Tom 2': 45,
    'Tom 3': 43,
    'Tom 4': 41,
    'Ride': 51,
    'Ride Bell': 53,
    'Crash 1': 49,
    'Crash 2': 57,
    'Splash': 55,
    'China': 52,
    'Cowbell': 56,
    'Tambourine': 54
};

const VISUAL_DRUM_MAP = {
    'F-4': 'Bass Drum',
    'C-5': 'Snare',
    'E-5': 'Tom 1',
    'D-5': 'Tom 2',
    'A-4': 'Tom 3',
    'G-4': 'Tom 4',
    'G-5': 'Hi-Hat Closed', // Open/closed differentiated by notehead in logic
    'D-4': 'Hi-Hat Pedal',
    'F-5': 'Ride',
    'A-5': 'Crash 1',
    'B-5': 'Crash 2',
    // Fallbacks or specific notation:
    // Some cymbals share pitches but use different noteheads.
    // The parser ensures that these pitches are used.
};

const OSMD_STEP_NAMES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

class DrumPlaybackEngine {
    constructor() {
        this.audioContext = null;
        this.player = null;
        this.drumZone = null;
        this.osmd = null;
        this.bpm = 120;
        
        this.isPlaying = false;
        this.playbackStartTime = 0;
        this.playbackStartWholeNotes = 0;
        
        this.schedulerTimer = null;
        this.scheduleAheadTime = 0.2; // 200ms buffer for robust, jitter-free WebAudio scheduling
        this.lookahead = 25.0; // Polling interval
        
        this.cursorQueue = [];
        this.visualCursorTimer = null;
        this.customCursor = null;
        
        this.isReady = false;
        this.drumZones = {}; // Stores multiple zones by pitch
        this.volume = 0.8;
    }

    async init(osmdInstance, currentBpm, playbackMap = null, swingMap = null) {
        this.osmd = osmdInstance;
        this.bpm = currentBpm || 120;
        this.playbackMap = playbackMap || [];
        this.swingMap = swingMap || {};
        this.mapIndex = 0;
        
        if (!this.isReady) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.audioContext = new AudioContext();
            
            if (typeof WebAudioFontPlayer !== 'undefined') {
                this.player = new WebAudioFontPlayer();
                
                // Get all unique MIDI pitches from GM_DRUM_NOTES
                const uniquePitches = [...new Set(Object.values(GM_DRUM_NOTES))];
                
                const loadPitch = (pitch) => {
                    return new Promise((resolve) => {
                        const varName = `_drum_${pitch}_0_JCLive_sf2_file`;
                        if (window[varName]) {
                            resolve({ pitch, varName });
                            return;
                        }
                        const script = document.createElement('script');
                        script.src = `https://surikov.github.io/webaudiofontdata/sound/128${pitch}_0_JCLive_sf2_file.js`;
                        script.onload = () => resolve({ pitch, varName });
                        script.onerror = () => {
                            console.error(`Failed to load drum pitch ${pitch}`);
                            resolve({ pitch, varName: null });
                        };
                        document.head.appendChild(script);
                    });
                };
                
                const results = await Promise.all(uniquePitches.map(p => loadPitch(p)));
                
                for (let res of results) {
                    if (res.varName && window[res.varName]) {
                        this.drumZones[res.pitch] = window[res.varName];
                        this.player.loader.decodeAfterLoading(this.audioContext, res.varName);
                    }
                }
                
                // Wait for all audio decoding to finish
                await new Promise(resolve => {
                    this.player.loader.waitLoad(() => {
                        this.isReady = true;
                        resolve();
                    });
                });
                
            } else {
                console.error("WebAudioFontPlayer not found.");
            }
        }
    }

    updateBpm(newBpm) {
        if (newBpm && newBpm > 0) {
            this.bpm = newBpm;
            // If playing, adjusting BPM on the fly requires resetting the start anchor
            if (this.isPlaying && this.osmd && this.osmd.cursor.iterator) {
                let startLinearWholeNotes = this.osmd.cursor.iterator.currentTimeStamp.RealValue;
                if (this.linearStartTimes && this.measureStartTimes && this.mapIndex < this.linearStartTimes.length) {
                    const currentMeasureIndex = this.osmd.cursor.iterator.CurrentMeasureIndex;
                    const noteLocalTime = this.osmd.cursor.iterator.currentTimeStamp.RealValue - this.measureStartTimes[currentMeasureIndex];
                    startLinearWholeNotes = this.linearStartTimes[this.mapIndex] + noteLocalTime;
                }
                this.playbackStartWholeNotes = startLinearWholeNotes;
                this.playbackStartTime = this.audioContext.currentTime;
            }
        }
    }

    getDrumKey(note) {
        if (!note || note.halfTone === undefined) return null;
        
        // OSMD applies a -1 octave transposition to the entire score, including percussion clefs.
        // We add 12 to reverse this transposition and retrieve the true visual MIDI pitch.
        const adjustedHalfTone = note.halfTone + 12;
        
        const octave = Math.floor(adjustedHalfTone / 12) - 1;
        const pitchClass = adjustedHalfTone % 12;
        
        // Map pitchClass back to visual step (0=C, 2=D, 4=E, 5=F, 7=G, 9=A, 11=B)
        const stepMap = {
            0: 'C', 2: 'D', 4: 'E', 5: 'F', 7: 'G', 9: 'A', 11: 'B'
        };
        
        if (stepMap[pitchClass] !== undefined) {
            return `${stepMap[pitchClass]}-${octave}`;
        }
        
        return null;
    }

    play() {
        if (!this.isReady || !this.osmd) return;
        
        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }
        
        if (this.isPlaying) return;
        this.isPlaying = true;
        
        if (!this.osmd.cursor.iterator || this.osmd.cursor.iterator.EndReached) {
            this.osmd.cursor.reset();
            this.mapIndex = 0;
        }
        
        // --- Pre-calculate Linear Measure Start Times ---
        if (!this.linearStartTimes && this.playbackMap && this.osmd.sheet.SourceMeasures) {
            this.measureStartTimes = []; // Native start times
            this.measureDurations = []; // Native durations
            
            // Scan OSMD for exact native measure start times
            let savedIterator = this.osmd.cursor.iterator.clone();
            this.osmd.cursor.reset();
            let currentM = -1;
            while (!this.osmd.cursor.iterator.EndReached) {
                let mIndex = this.osmd.cursor.iterator.CurrentMeasureIndex;
                if (mIndex !== currentM) {
                    currentM = mIndex;
                    if (this.measureStartTimes[currentM] === undefined) {
                        this.measureStartTimes[currentM] = this.osmd.cursor.iterator.currentTimeStamp.RealValue;
                    }
                }
                this.osmd.cursor.next();
            }
            
            for (let i = 0; i < this.measureStartTimes.length; i++) {
                if (i < this.measureStartTimes.length - 1) {
                    this.measureDurations[i] = this.measureStartTimes[i+1] - this.measureStartTimes[i];
                } else {
                    this.measureDurations[i] = 1.0; // Fallback for last measure
                }
            }
            
            this.linearStartTimes = [];
            let currentLinearTime = 0;
            for (let i = 0; i < this.playbackMap.length; i++) {
                this.linearStartTimes[i] = currentLinearTime;
                let mIndex = this.playbackMap[i];
                currentLinearTime += (this.measureDurations[mIndex] || 1.0);
            }
            
            // Restore iterator
            this.osmd.cursor.iterator = savedIterator;
        }
        
        this.osmd.cursor.show();
        
        // Setup Decoupled Visual Cursor
        if (this.customCursor && this.customCursor.parentElement) {
            this.customCursor.parentElement.removeChild(this.customCursor);
        }
        
        this.customCursor = document.createElement('div');
        this.customCursor.style.position = 'absolute';
        this.customCursor.style.zIndex = '999';
        this.customCursor.style.backgroundColor = "var(--accent-1)";
        this.customCursor.style.opacity = "0.45";
        this.customCursor.style.borderRadius = "6px";
        this.customCursor.style.pointerEvents = "none";
        this.customCursor.style.display = "none";
        
        if (this.osmd.cursor.cursorElement && this.osmd.cursor.cursorElement.parentElement) {
            this.osmd.cursor.cursorElement.parentElement.appendChild(this.customCursor);
        }
        
        // Hide the native OSMD cursor so it doesn't jump ahead visually
        if (this.osmd.cursor.cursorElement) {
            this.osmd.cursor.cursorElement.style.opacity = "0";
            // Ensure native cursor matches dimensions roughly to calculate correct boundaries if OSMD needs it
            this.osmd.cursor.cursorElement.style.width = "28px"; 
            this.osmd.cursor.cursorElement.style.transform = "translateX(0px)";
        }
        
        this.cursorQueue = [];
        
        let startLinearWholeNotes = this.osmd.cursor.iterator.currentTimeStamp.RealValue;
        if (this.linearStartTimes && this.measureStartTimes && this.mapIndex < this.linearStartTimes.length) {
            const currentMeasureIndex = this.osmd.cursor.iterator.CurrentMeasureIndex;
            const noteLocalTime = this.osmd.cursor.iterator.currentTimeStamp.RealValue - this.measureStartTimes[currentMeasureIndex];
            startLinearWholeNotes = this.linearStartTimes[this.mapIndex] + noteLocalTime;
        }
        
        this.playbackStartWholeNotes = startLinearWholeNotes;
        this.playbackStartTime = this.audioContext.currentTime + 0.05;
        this.scheduler();
        this.visualLoop();

        document.dispatchEvent(new CustomEvent('playback-started'));
    }

    pause() {
        if (!this.isPlaying) return;
        this.isPlaying = false;
        
        if (this.schedulerTimer) {
            clearTimeout(this.schedulerTimer);
            this.schedulerTimer = null;
        }
        if (this.visualCursorTimer) {
            cancelAnimationFrame(this.visualCursorTimer);
            this.visualCursorTimer = null;
        }
        if (this.player && this.audioContext) {
            this.player.cancelQueue(this.audioContext);
        }
        document.dispatchEvent(new CustomEvent('playback-paused'));
    }

    stop() {
        this.pause();
        this.mapIndex = 0; // Reset jump sequencer target
        if (this.osmd) {
            this.osmd.cursor.reset();
            if (this.osmd.cursor.cursorElement) {
                this.osmd.cursor.cursorElement.style.opacity = "0.45"; // Restore native cursor visibility
            }
        }
        if (this.customCursor) {
            this.customCursor.style.display = "none";
        }
        document.dispatchEvent(new CustomEvent('playback-stopped'));
    }

    scheduler() {
        if (!this.isPlaying) return;

        while (true) {
            // Wait to check EndReached until AFTER jump logic

            const currentMeasureIndex = this.osmd.cursor.iterator.CurrentMeasureIndex;
            
            let linearWholeNotes = 0;
            let noteLocalTime = 0;
            if (this.linearStartTimes && this.measureStartTimes && this.mapIndex < this.linearStartTimes.length) {
                noteLocalTime = this.osmd.cursor.iterator.currentTimeStamp.RealValue - this.measureStartTimes[currentMeasureIndex];
                linearWholeNotes = this.linearStartTimes[this.mapIndex] + noteLocalTime;
            } else {
                linearWholeNotes = this.osmd.cursor.iterator.currentTimeStamp.RealValue;
                if (this.measureStartTimes && this.measureStartTimes[currentMeasureIndex] !== undefined) {
                    noteLocalTime = linearWholeNotes - this.measureStartTimes[currentMeasureIndex];
                } else {
                    noteLocalTime = linearWholeNotes % 1; // Fallback
                }
            }

            let swingDelayWholeNotes = 0;
            let swingType = this.swingMap ? this.swingMap[currentMeasureIndex] : null;

            if (swingType && swingType !== "None" && swingType !== "Straight") {
                const swingStr = String(swingType).toLowerCase();
                
                if (swingStr.includes("16") || swingStr.includes("sixteenth")) {
                    // 16th note swing
                    const sixteenths = noteLocalTime * 16;
                    const remainder = sixteenths % 2; // Even is on-beat, odd is off-beat
                    if (Math.abs(remainder - 1.0) < 0.05) {
                        // Off-beat 16th note shifted from 1/2 of an 8th to 2/3 of an 8th
                        swingDelayWholeNotes = 1.0 / 48.0;
                    }
                } else {
                    // 8th note swing (default)
                    const eighths = noteLocalTime * 8;
                    const remainder = eighths % 2; // Even is on-beat, odd is off-beat
                    if (Math.abs(remainder - 1.0) < 0.05) {
                        // Off-beat 8th note shifted from 1/2 of a quarter to 2/3 of a quarter
                        swingDelayWholeNotes = 1.0 / 24.0;
                    }
                }
            }

            const deltaWholeNotes = linearWholeNotes - this.playbackStartWholeNotes + swingDelayWholeNotes;
            const beats = deltaWholeNotes * 4;
            const secondsPerBeat = 60.0 / this.bpm;
            const absoluteEventTime = this.playbackStartTime + (beats * secondsPerBeat);

            if (absoluteEventTime > this.audioContext.currentTime + this.scheduleAheadTime) {
                break;
            }

            const notes = this.osmd.cursor.NotesUnderCursor();
            
            // Queue visual cursor update before next() moves the native element
            if (this.osmd.cursor.cursorElement) {
                this.cursorQueue.push({
                    time: absoluteEventTime,
                    left: this.osmd.cursor.cursorElement.style.left,
                    top: this.osmd.cursor.cursorElement.style.top,
                    width: "28px", // Keep it wide for drum visibility
                    height: this.osmd.cursor.cursorElement.style.height || (this.osmd.cursor.cursorElement.clientHeight + "px"),
                    parent: this.osmd.cursor.cursorElement.parentElement
                });
            }

            if (notes && notes.length > 0) {
                const mapping = window.activeCustomMapping || window.globalDrumMapping || {};
                
                for (let note of notes) {
                    if (note.isRest()) continue;

                    let midiPitch = 38; // Default Snare
                    let noteVol = this.volume;
                    
                    const key = this.getDrumKey(note);
                    let drumType = null;
                    if (key) {
                        // Priority 1: User's custom mapping
                        if (mapping && mapping[key]) {
                            drumType = mapping[key];
                        } 
                        // Priority 2: VISUAL_DRUM_MAP fallback
                        else if (VISUAL_DRUM_MAP[key]) {
                            drumType = VISUAL_DRUM_MAP[key];
                        }
                    }
                    
                    if (drumType) {
                        // Handle Ghost Notes, Rimshots & Cymbals
                        if (note.notehead) {
                            if (note.notehead.shape === 3) { // Cross
                                if (drumType === 'Snare') drumType = 'Snare Rim';
                                else if (drumType === 'Hi-Hat Closed') drumType = 'Hi-Hat Closed'; // default
                            } else if (note.notehead.shape === 1) { // Diamond
                                if (drumType === 'Ride') drumType = 'Ride Bell';
                                else if (drumType === 'Crash 2') drumType = 'Tambourine'; // mapped to B-5 diamond
                            } else if (note.notehead.shape === 5) { // Circle-X
                                if (drumType === 'Hi-Hat Closed') drumType = 'Hi-Hat Open';
                            } else if (note.notehead.shape === 2) { // Triangle
                                drumType = 'Cowbell';
                            }
                        }
                        
                        let isGhost = false;
                        if (note.ParentVoiceItem && note.ParentVoiceItem.isCue) isGhost = true;
                        if (note.Length && note.Length.RealValue < 0) isGhost = true;
                        
                        if (isGhost) {
                            noteVol = this.volume * 0.4;
                            if (drumType === 'Snare') drumType = 'Snare Ghost';
                        }
                        
                        if (GM_DRUM_NOTES[drumType]) {
                            midiPitch = GM_DRUM_NOTES[drumType];
                        }
                    } else if (note.halfTone) {
                        // Fallback
                        midiPitch = note.halfTone;
                    }

                    let targetZone = this.drumZones[midiPitch];
                    if (!targetZone) {
                        // Fallback mechanism: If we don't have a specific sample for this note,
                        // we fallback to Bass Drum (36) and WebAudioFont will pitch it up/down to the midiPitch.
                        targetZone = this.drumZones[36] || Object.values(this.drumZones)[0];
                    }
                    
                    if (targetZone && noteVol > 0) {
                        this.player.queueWaveTable(this.audioContext, this.audioContext.destination, targetZone, absoluteEventTime, midiPitch, 0.5, noteVol);
                    }
                }
            }

            this.osmd.cursor.next();
            
            // Custom Jump Sequencer Logic
            if (this.playbackMap && this.playbackMap.length > 0) {
                const newMeasureIndex = this.osmd.cursor.iterator.EndReached ? -1 : this.osmd.cursor.iterator.CurrentMeasureIndex;
                
                // Have we moved to a new measure natively?
                if (newMeasureIndex !== currentMeasureIndex || this.osmd.cursor.iterator.EndReached) {
                    this.mapIndex++;
                    
                    if (this.mapIndex >= this.playbackMap.length) {
                        this.stop();
                        break;
                    }
                    
                    const targetMeasure = this.playbackMap[this.mapIndex];
                    // We must enforce the jump to targetMeasure!
                    // OSMD native repeats might have failed, or jumped natively.
                    // ANY native jump (forward or backward) desyncs the `currentTimeStamp` from our `measureStartTimes`!
                    if (targetMeasure !== newMeasureIndex || this.osmd.cursor.iterator.EndReached || newMeasureIndex !== currentMeasureIndex + 1) {
                        // Force OSMD to the correct measure via a fresh iterator
                        this.osmd.cursor.reset();
                        let safety = 0;
                        while (!this.osmd.cursor.iterator.EndReached && this.osmd.cursor.iterator.CurrentMeasureIndex !== targetMeasure) {
                            this.osmd.cursor.next();
                            safety++;
                            if(safety > 10000) break; // prevent infinite loops if measure doesn't exist
                        }
                    }
                }
            } else if (this.osmd.cursor.iterator.EndReached) {
                this.stop();
                break;
            }
        }
        
        if (this.isPlaying) {
            this.schedulerTimer = setTimeout(() => this.scheduler(), this.lookahead);
        }
    }
    
    visualLoop() {
        if (!this.isPlaying) return;
        
        const currentTime = this.audioContext.currentTime;
        
        // Find all visual events that have passed and apply the most recent one
        let updated = false;
        while (this.cursorQueue.length > 0 && this.cursorQueue[0].time <= currentTime) {
            const ev = this.cursorQueue.shift();
            if (this.customCursor) {
                if (ev.parent && this.customCursor.parentElement !== ev.parent) {
                    ev.parent.appendChild(this.customCursor);
                }
                this.customCursor.style.left = ev.left;
                this.customCursor.style.top = ev.top;
                this.customCursor.style.width = ev.width;
                this.customCursor.style.height = ev.height;
                updated = true;
            }
        }
        
        if (updated && this.customCursor) {
            this.customCursor.style.display = "block";
        }
        
        this.visualCursorTimer = requestAnimationFrame(() => this.visualLoop());
    }
}

// Global instance
window.playbackEngine = new DrumPlaybackEngine();
