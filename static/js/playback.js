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

    async init(osmdInstance, currentBpm) {
        this.osmd = osmdInstance;
        this.bpm = currentBpm || 120;
        
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
                this.playbackStartWholeNotes = this.osmd.cursor.iterator.currentTimeStamp.RealValue;
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
        }
        this.osmd.cursor.show();
        
        // Setup Decoupled Visual Cursor
        if (!this.customCursor) {
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
        }
        
        // Hide the native OSMD cursor so it doesn't jump ahead visually
        if (this.osmd.cursor.cursorElement) {
            this.osmd.cursor.cursorElement.style.opacity = "0";
            // Ensure native cursor matches dimensions roughly to calculate correct boundaries if OSMD needs it
            this.osmd.cursor.cursorElement.style.width = "28px"; 
            this.osmd.cursor.cursorElement.style.transform = "translateX(0px)";
        }
        
        this.cursorQueue = [];
        
        this.playbackStartWholeNotes = this.osmd.cursor.iterator.currentTimeStamp.RealValue;
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
            if (this.osmd.cursor.iterator.EndReached) {
                this.stop();
                break;
            }

            const currentWholeNotes = this.osmd.cursor.iterator.currentTimeStamp.RealValue;
            const deltaWholeNotes = currentWholeNotes - this.playbackStartWholeNotes;
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
                    if (key && mapping[key]) {
                        const drumType = mapping[key];
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
