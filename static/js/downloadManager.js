import { getLibrary } from './storageManager.js';

export class DownloadManager extends EventTarget {
    constructor() {
        super();
        this.batchQueue = [];
        this.batchQueueTotal = 0;
        this.batchQueueCompleted = 0;
        this.isBatchProcessing = false;
        this.currentEventSource = null;
        this.currentTaskId = null;
        this.currentDownloadUrl = null;
    }

    startDownloadFromSearch(songId, artist, title, config) {
        this.isBatchProcessing = false;
        this.startDownload({ songId, artist, title }, config);
    }

    startDownloadFromUrls(urlsArray, config) {
        if (!urlsArray || urlsArray.length === 0) return;

        if (urlsArray.length > 1) {
            this.batchQueue = urlsArray;
            this.batchQueueTotal = urlsArray.length;
            this.batchQueueCompleted = 0;
            this.isBatchProcessing = true;

            this.dispatchEvent(new CustomEvent('batch-start', { detail: { total: this.batchQueueTotal } }));
            this.processNextBatchItem(config);
        } else {
            this.isBatchProcessing = false;
            this.startDownload({ url: urlsArray[0] }, config);
        }
    }

    processNextBatchItem(config) {
        if (this.batchQueue.length === 0) {
            this.isBatchProcessing = false;
            this.dispatchEvent(new CustomEvent('batch-complete'));
            return;
        }

        const nextUrl = this.batchQueue.shift();
        this.dispatchEvent(new CustomEvent('batch-progress', {
            detail: {
                completed: this.batchQueueCompleted,
                total: this.batchQueueTotal,
                currentUrl: nextUrl
            }
        }));

        this.startDownload({ url: nextUrl }, config, true);
    }

    async startDownload(payload, config, isBatchContinuation = false) {
        payload.format = config.format || 'musicxml';
        payload.global_mapping = config.globalMapping || {};
        payload.stem_direction = config.stemDirection || 'up';
        if (config.bpm) payload.bpm = config.bpm;

        if (payload.url) {
            this.currentDownloadUrl = payload.url;
        } else if (payload.songId) {
            if (payload.artist && payload.title) {
                const safeArtist = payload.artist.toLowerCase().replace(/[^a-z0-9]+/g, '-');
                const safeTitle = payload.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
                this.currentDownloadUrl = `https://www.songsterr.com/a/wsa/${safeArtist}-${safeTitle}-drum-tab-s${payload.songId}`;
            } else {
                this.currentDownloadUrl = `https://www.songsterr.com/a/wsa/song-s${payload.songId}`;
            }
        }

        // Apply custom mapping from library if exists
        const lib = getLibrary();
        const existingItem = lib.find(i => i.url === this.currentDownloadUrl);
        if (existingItem && existingItem.customMapping) {
            Object.assign(payload.global_mapping, existingItem.customMapping);
        }

        this.dispatchEvent(new CustomEvent('download-start', { detail: { payload, url: this.currentDownloadUrl } }));

        try {
            const res = await fetch('/api/download', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to start download');

            this.currentTaskId = data.taskId;
            this.listenToProgress(this.currentTaskId, config);
        } catch (err) {
            this.dispatchEvent(new CustomEvent('download-error', { detail: { error: err.message } }));
        }
    }

    listenToProgress(taskId, config) {
        if (this.currentEventSource) {
            this.currentEventSource.close();
        }

        this.currentEventSource = new EventSource(`/api/status/${taskId}`);

        this.currentEventSource.onmessage = (event) => {
            const data = JSON.parse(event.data);

            if (data.error) {
                this.currentEventSource.close();
                this.dispatchEvent(new CustomEvent('download-error', { detail: { error: data.error } }));
                if (this.isBatchProcessing) {
                    setTimeout(() => this.processNextBatchItem(config), 2500);
                }
                return;
            }

            this.dispatchEvent(new CustomEvent('download-progress', { detail: { progress: data.progress, step: data.step } }));

            if (data.status === 'done') {
                this.currentEventSource.close();
                if (this.isBatchProcessing) {
                    this.batchQueueCompleted++;
                    this.dispatchEvent(new CustomEvent('batch-item-done', { detail: { result: data.result } }));
                    this.processNextBatchItem(config);
                } else {
                    this.dispatchEvent(new CustomEvent('download-complete', { detail: { result: data.result, url: this.currentDownloadUrl } }));
                }
            } else if (data.status === 'requires_mapping') {
                this.currentEventSource.close();
                this.dispatchEvent(new CustomEvent('requires-mapping', { detail: { unmapped_frets: data.unmapped_frets, song_url: data.song_url || this.currentDownloadUrl } }));
            } else if (data.status === 'requires_track_selection') {
                this.currentEventSource.close();
                this.dispatchEvent(new CustomEvent('requires-track-selection', { detail: { tracks: data.tracks } }));
            } else if (data.status === 'error') {
                this.currentEventSource.close();
                this.dispatchEvent(new CustomEvent('download-error', { detail: { error: data.error || 'Download failed' } }));
            }
        };

        this.currentEventSource.onerror = () => {
            this.currentEventSource.close();
            this.dispatchEvent(new CustomEvent('download-error', { detail: { error: 'Lost connection to server' } }));
        };
    }

    async submitTrackSelection(partId, config) {
        this.dispatchEvent(new CustomEvent('download-resume', { detail: { step: 'Resuming download...' } }));

        try {
            const res = await fetch('/api/download/resume_track', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ taskId: this.currentTaskId, partId: partId })
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to resume download');

            this.listenToProgress(this.currentTaskId, config);
        } catch (err) {
            this.dispatchEvent(new CustomEvent('download-error', { detail: { error: err.message } }));
        }
    }

    async submitMapping(customMapping, config) {
        this.dispatchEvent(new CustomEvent('download-resume', { detail: { step: 'Applying custom mapping...' } }));

        try {
            const res = await fetch('/api/download/resume', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ taskId: this.currentTaskId, custom_mapping: customMapping })
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to resume download');

            this.listenToProgress(this.currentTaskId, config);
        } catch (err) {
            this.dispatchEvent(new CustomEvent('download-error', { detail: { error: err.message } }));
        }
    }
}
