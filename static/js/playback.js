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
        this.drumKitVarName = '_drum_35_0_JCLive_sf2_file';
        this.volume = 0.8;
    }

    async init(osmdInstance, currentBpm, playbackMap = null) {
        this.osmd = osmdInstance;
        this.bpm = currentBpm || 120;
        this.playbackMap = playbackMap || [];
        this.mapIndex = 0;
        
        if (!this.isReady) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.audioContext = new AudioContext();
            
            if (typeof WebAudioFontPlayer !== 'undefined') {
                this.player = new WebAudioFontPlayer();
                
                if (window[this.drumKitVarName]) {
                    this.drumZone = window[this.drumKitVarName];
                    this.player.loader.decodeAfterLoading(this.audioContext, this.drumKitVarName);
                    this.isReady = true;
                } else {
                    console.error("WebAudioFont drum kit not loaded.");
                }
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
        if (!note || !note.Pitch) return null;
        
        let step = note.Pitch.step !== undefined ? note.Pitch.step : note.Pitch.FundamentalNote;
        let octave = note.Pitch.octave !== undefined ? note.Pitch.octave : note.Pitch.Octave;
        
        if (typeof step === 'number' && step >= 0 && step <= 6) {
            return `${OSMD_STEP_NAMES[step]}-${octave}`;
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
                    this.measureStartTimes[currentM] = this.osmd.cursor.iterator.currentTimeStamp.RealValue;
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
            if (this.linearStartTimes && this.measureStartTimes && this.mapIndex < this.linearStartTimes.length) {
                const noteLocalTime = this.osmd.cursor.iterator.currentTimeStamp.RealValue - this.measureStartTimes[currentMeasureIndex];
                linearWholeNotes = this.linearStartTimes[this.mapIndex] + noteLocalTime;
            } else {
                linearWholeNotes = this.osmd.cursor.iterator.currentTimeStamp.RealValue;
            }

            const deltaWholeNotes = linearWholeNotes - this.playbackStartWholeNotes;
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
                    height: this.osmd.cursor.cursorElement.style.height || (this.osmd.cursor.cursorElement.clientHeight + "px")
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
                        
                        if (note.ParentVoiceItem && note.ParentVoiceItem.isCue) {
                            if (drumType === 'Snare') drumType = 'Snare Ghost';
                        }
                        // Generic length/size checks for ghost notes
                        if (note.Length && note.Length.RealValue < 0) {
                            if (drumType === 'Snare') drumType = 'Snare Ghost';
                        }
                        
                        if (GM_DRUM_NOTES[drumType]) {
                            midiPitch = GM_DRUM_NOTES[drumType];
                        }
                        if (drumType === 'Snare Ghost') {
                            noteVol = this.volume * 0.4;
                        }
                    } else if (note.halfTone) {
                        // Fallback
                        midiPitch = note.halfTone;
                    }

                    this.player.queueWaveTable(this.audioContext, this.audioContext.destination, this.drumZone, absoluteEventTime, midiPitch, 0.5, noteVol);
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
                    if (targetMeasure !== newMeasureIndex || this.osmd.cursor.iterator.EndReached) {
                        // We must enforce the jump to targetMeasure!
                        // OSMD native repeats might have failed or jumped to the wrong pass.
                        // Force OSMD to the correct measure
                        let savedStamp = this.osmd.cursor.iterator.currentTimeStamp ? this.osmd.cursor.iterator.currentTimeStamp.RealValue : 0;
                        this.osmd.cursor.reset();
                        let safety = 0;
                        while (this.osmd.cursor.iterator.CurrentMeasureIndex !== targetMeasure && !this.osmd.cursor.iterator.EndReached) {
                            this.osmd.cursor.next();
                            safety++;
                            if(safety > 5000) break; // prevent infinite loops if measure doesn't exist
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
