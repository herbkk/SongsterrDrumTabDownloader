"""
Songsterr Drum Tab Downloader — Flask Web Server

Provides a web UI for searching Songsterr songs, downloading drum tracks,
and rendering them as traditional notation PDFs.
"""

import os
import uuid
import json
import time
import logging
import threading
from flask import Flask, render_template, request, jsonify, send_from_directory, Response

from downloader.api import search_songs
from downloader.scraper import download_drum_track
from downloader.xml_generator import generate_musicxml, get_unmapped_frets, DRUM_MAPPING, generate_measure_preview_xml, calculate_playback_map, calculate_swing_map

# ─── Configuration ──────────────────────────────────────────────────────────────

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DOWNLOADS_DIR = os.path.join(BASE_DIR, "downloads")
os.makedirs(DOWNLOADS_DIR, exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

# ─── Flask App ──────────────────────────────────────────────────────────────────

app = Flask(__name__)

def get_build_info():
    """Retrieve build date from Docker build_info.txt, or local Git hash if available."""
    info_path = os.path.join(BASE_DIR, "build_info.txt")
    if os.path.exists(info_path):
        try:
            with open(info_path, "r", encoding="utf-8") as f:
                return f.read().strip()
        except Exception:
            pass
            
    # Fallback for local development
    try:
        git_dir = os.path.join(BASE_DIR, ".git")
        if os.path.exists(git_dir):
            head_path = os.path.join(git_dir, "HEAD")
            with open(head_path, "r", encoding="utf-8") as f:
                head_content = f.read().strip()
            if head_content.startswith("ref: "):
                ref_path = os.path.join(git_dir, head_content.split(" ")[1])
                with open(ref_path, "r", encoding="utf-8") as f:
                    commit_hash = f.read().strip()[:7]
                    return f"Local Dev ({commit_hash})"
    except Exception:
        pass
        
    return "Local Dev Mode"

BUILD_INFO = get_build_info()

# In-memory task status store (keyed by task_id)
tasks = {}


# ─── Routes ─────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    """Serve the main UI."""
    return render_template("index.html", build_info=BUILD_INFO)


@app.route("/sw.js")
def serve_sw():
    """Serve the ServiceWorker at the root scope."""
    return send_from_directory(os.path.join(BASE_DIR, "static"), "sw.js")


@app.route("/api/search")
def api_search():
    """
    Search Songsterr for songs.
    Query params:
        q: search query string
        drums_only: if 'true', filter to songs with drum tracks (default: true)
    """
    query = request.args.get("q", "").strip()
    if not query:
        return jsonify({"error": "Search query is required", "results": []}), 400

    drums_only = request.args.get("drums_only", "true").lower() == "true"

    try:
        results = search_songs(query, size=20, drums_only=drums_only)
        return jsonify({"results": results})
    except Exception as e:
        logger.error(f"Search failed: {e}")
        return jsonify({"error": str(e), "results": []}), 500


@app.route("/api/mapping")
def api_mapping():
    """Return the default backend drum mapping."""
    return jsonify({"mapping": DRUM_MAPPING})


@app.route("/api/cover-art")
def api_cover_art():
    """
    Proxy request to iTunes Search API to avoid CORS issues on the frontend.
    Query params:
        artist: string
        title: string
    """
    artist = request.args.get("artist", "")
    title = request.args.get("title", "")
    
    if not artist and not title:
        return jsonify({"error": "Missing artist or title"}), 400
        
    import requests
    from urllib.parse import quote_plus
    
    query = quote_plus(f"{artist} {title}")
    url = f"https://itunes.apple.com/search?term={query}&entity=song&limit=1"
    
    try:
        headers = {"User-Agent": "SongsterrDrumTabDownloader/1.0"}
        res = requests.get(url, headers=headers, timeout=10)
        res.raise_for_status()
        data = res.json()
        
        if data.get("results") and len(data["results"]) > 0:
            artwork = data["results"][0].get("artworkUrl100", "")
            if artwork:
                return jsonify({"url": artwork.replace("100x100bb", "400x400bb")})
    except Exception as e:
        logger.error(f"Failed to fetch cover art from iTunes: {e}")
        
    return jsonify({"url": None})


@app.route("/api/download", methods=["POST"])
def api_download():
    """
    Start a drum tab download + PDF render task.
    JSON body:
        url: Songsterr song URL (optional if songId provided)
        songId: Songsterr song ID (optional if url provided)
    """
    data = request.get_json(force=True, silent=True) or {}
    song_url = data.get("url", "").strip()
    song_id = data.get("songId")
    output_format = data.get("format", "musicxml")
    global_mapping = data.get("global_mapping", {})
    bpm = data.get("bpm", None)
    stem_direction = data.get("stem_direction", "up")

    if not song_url and not song_id:
        return jsonify({"error": "Either 'url' or 'songId' is required"}), 400

    # Create a task
    task_id = str(uuid.uuid4())[:8]
    tasks[task_id] = {
        "status": "queued",
        "progress": 0,
        "step": "Queued...",
        "result": None,
        "error": None,
        "song_url": song_url, # store for later
    }

    # Run download in background thread
    thread = threading.Thread(
        target=_run_download_task,
        args=(task_id, song_url, song_id, output_format, global_mapping, bpm, stem_direction),
        daemon=True
    )
    thread.start()

    return jsonify({"taskId": task_id})


@app.route("/api/download/resume", methods=["POST"])
def api_download_resume():
    """
    Resume a download task after providing custom mapping.
    JSON body:
        taskId: str
        custom_mapping: dict
    """
    data = request.get_json(force=True, silent=True) or {}
    task_id = data.get("taskId")
    custom_mapping = data.get("custom_mapping", {})

    if not task_id or task_id not in tasks:
        return jsonify({"error": "Invalid or missing taskId"}), 400
        
    task = tasks[task_id]
    if task["status"] != "requires_mapping":
        return jsonify({"error": "Task is not in requires_mapping state"}), 400
        
    task["custom_mapping"] = custom_mapping
    
    # Resume background task
    thread = threading.Thread(
        target=_run_download_task_resume,
        args=(task_id,),
        daemon=True
    )
    thread.start()
    
    return jsonify({"success": True})

@app.route("/api/download/resume_track", methods=["POST"])
def api_download_resume_track():
    """
    Resume a download task after providing the selected track ID.
    JSON body:
        taskId: str
        partId: int
    """
    data = request.get_json(force=True, silent=True) or {}
    task_id = data.get("taskId")
    part_id = data.get("partId")

    if not task_id or task_id not in tasks:
        return jsonify({"error": "Invalid or missing taskId"}), 400
        
    if part_id is None:
        return jsonify({"error": "Missing partId"}), 400
        
    task = tasks[task_id]
    if task["status"] != "requires_track_selection":
        return jsonify({"error": "Task is not in requires_track_selection state"}), 400
        
    task["selected_part_id"] = int(part_id)
    
    # Resume background task
    thread = threading.Thread(
        target=_run_download_task_resume_track,
        args=(task_id,),
        daemon=True
    )
    thread.start()
    
    return jsonify({"success": True})

@app.route("/api/status/<task_id>")
def api_status(task_id):
    """
    Server-Sent Events endpoint for real-time progress updates.
    """
    def generate():
        while True:
            task = tasks.get(task_id)
            if not task:
                yield f"data: {json.dumps({'error': 'Task not found'})}\n\n"
                break

            event = {
                "status": task["status"],
                "progress": task["progress"],
                "step": task["step"],
            }

            if task["status"] == "done":
                event["result"] = task["result"]
                yield f"data: {json.dumps(event)}\n\n"
                break
            elif task["status"] == "error":
                event["error"] = task["error"]
                yield f"data: {json.dumps(event)}\n\n"
                break
            elif task["status"] == "requires_mapping":
                event["unmapped_frets"] = task["unmapped_frets"]
                event["song_url"] = task.get("song_url")
                yield f"data: {json.dumps(event)}\n\n"
                break
            elif task["status"] == "requires_track_selection":
                event["tracks"] = task["tracks"]
                yield f"data: {json.dumps(event)}\n\n"
                break
            else:
                yield f"data: {json.dumps(event)}\n\n"

            time.sleep(0.5)

    return Response(
        generate(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.route("/downloads/<filename>")
def serve_download(filename):
    """Serve a generated PDF file."""
    return send_from_directory(DOWNLOADS_DIR, filename, as_attachment=True)


# ─── Background Task ───────────────────────────────────────────────────────────

def _run_download_task(task_id: str, song_url: str, song_id: int, output_format: str, global_mapping: dict = None, bpm: int = None, stem_direction: str = "up"):
    """
    Background task: download drum track + generate MusicXML (+ convert to PDF).
    """
    task = tasks[task_id]
    task["status"] = "running"

    def progress_callback(step, pct):
        task["step"] = step
        task["progress"] = pct

    try:
        # Step 1: Download the drum track JSON
        result = download_drum_track(
            song_url=song_url or None,
            song_id=song_id,
            progress_callback=progress_callback,
        )

        if not result.get("success"):
            if result.get("requires_track_selection"):
                task["status"] = "requires_track_selection"
                task["tracks"] = result.get("tracks", [])
                task["cdn_urls"] = result.get("cdn_urls", [])
                task["artist"] = result.get("artist")
                task["title"] = result.get("title")
                task["output_format"] = output_format
                task["global_mapping"] = global_mapping
                task["bpm"] = bpm
                task["stem_direction"] = stem_direction
            else:
                task["status"] = "error"
                task["error"] = result.get("error", "Unknown download error")
            return

        track_data = result["data"]
        artist = result["artist"]
        title = result["title"]
        
        # Check for unmapped frets using both default and global mapping
        unmapped = get_unmapped_frets(track_data, custom_mapping=global_mapping)
        if unmapped:
            for u in unmapped:
                preview_xml = generate_measure_preview_xml(track_data, u["first_measure"], highlight_fret=u["fret"])
                u["preview_xml"] = preview_xml

            task["status"] = "requires_mapping"
            task["unmapped_frets"] = unmapped
            task["track_data"] = track_data
            task["artist"] = artist
            task["title"] = title
            task["output_format"] = output_format
            task["global_mapping"] = global_mapping
            task["bpm"] = bpm
            task["stem_direction"] = stem_direction
            task["song_url"] = song_url
            return

        # No unmapped frets, proceed directly to generation
        _proceed_with_generation(task_id, track_data, artist, title, output_format, custom_mapping=global_mapping, bpm=bpm, stem_direction=stem_direction)

    except Exception as e:
        logger.exception(f"Task {task_id} failed")
        task["status"] = "error"
        task["error"] = str(e)


def _run_download_task_resume_track(task_id: str):
    """Resume download after track selection."""
    task = tasks[task_id]
    task["status"] = "running"
    
    def progress_callback(step, pct):
        task["step"] = step
        task["progress"] = pct

    try:
        drum_track_id = task["selected_part_id"]
        cdn_urls = task["cdn_urls"]
        target_url = None
        
        suffix = f"/{drum_track_id}.json"
        for url in cdn_urls:
            if url.endswith(suffix):
                target_url = url
                break
                
        if not target_url:
            raise ValueError(f"Drum track (id={drum_track_id}) not found among captured URLs.")
            
        progress_callback("Downloading selected track...", 0.75)
        import requests
        resp = requests.get(target_url, timeout=15) # HEADERS not easily available here, but standard get works for cloudfront
        resp.raise_for_status()
        track_data = resp.json()
        
        artist = task["artist"]
        title = task["title"]
        global_mapping = task.get("global_mapping", {})
        output_format = task.get("output_format", "musicxml")
        bpm = task.get("bpm")
        stem_direction = task.get("stem_direction", "up")
        
        # Check for unmapped frets
        unmapped = get_unmapped_frets(track_data, custom_mapping=global_mapping)
        if unmapped:
            for u in unmapped:
                preview_xml = generate_measure_preview_xml(track_data, u["first_measure"], highlight_fret=u["fret"])
                u["preview_xml"] = preview_xml

            task["status"] = "requires_mapping"
            task["unmapped_frets"] = unmapped
            task["track_data"] = track_data
            return

        # No unmapped frets, proceed directly to generation
        _proceed_with_generation(task_id, track_data, artist, title, output_format, custom_mapping=global_mapping, bpm=bpm)

    except Exception as e:
        logger.exception(f"Task {task_id} resume track failed")
        task["status"] = "error"
        task["error"] = str(e)


def _run_download_task_resume(task_id: str):
    """Resume generation after receiving custom mappings."""
    task = tasks[task_id]
    task["status"] = "running"
    
    try:
        track_data = task["track_data"]
        artist = task["artist"]
        title = task["title"]
        output_format = task["output_format"]
        
        final_mapping = task.get("global_mapping", {}).copy()
        final_mapping.update(task.get("custom_mapping", {}))
        bpm = task.get("bpm", None)
        stem_direction = task.get("stem_direction", "up")
        
        _proceed_with_generation(task_id, track_data, artist, title, output_format, custom_mapping=final_mapping, bpm=bpm, stem_direction=stem_direction)
    except Exception as e:
        logger.exception(f"Task {task_id} failed during resume")
        task["status"] = "error"
        task["error"] = str(e)


def _proceed_with_generation(task_id: str, track_data: dict, artist: str, title: str, output_format: str, custom_mapping: dict = None, bpm: int = None, stem_direction: str = "up"):
    task = tasks[task_id]
    
    def progress_callback(step, pct):
        task["step"] = step
        task["progress"] = pct
        
    try:
        # Step 2: Generate MusicXML
        progress_callback("Generating MusicXML...", 0.9)

        # Build a clean filename
        safe_artist = "".join(c for c in artist if c.isalnum() or c in " -_").strip()
        safe_title = "".join(c for c in title if c.isalnum() or c in " -_").strip()
        base_filename = f"{safe_artist} - {safe_title} (Drums)"
        
        xml_filename = f"{base_filename}.musicxml"
        xml_path = os.path.join(DOWNLOADS_DIR, xml_filename)

        generate_musicxml(track_data, xml_path, artist=artist, title=title, custom_mapping=custom_mapping, bpm=bpm, stem_direction=stem_direction)
        
        final_filename = xml_filename
        
        # Read the raw XML string so we can pass it to the frontend for OSMD rendering
        with open(xml_path, 'r', encoding='utf-8') as f:
            xml_string = f.read()
            
        playback_map = calculate_playback_map(track_data.get("measures", []))
        swing_map = calculate_swing_map(track_data.get("measures", []))
        
        base_tempo = 120
        automations = track_data.get("automations", {})
        tempo_list = automations.get("tempo", [])
        if tempo_list and len(tempo_list) > 0:
            first_tempo = tempo_list[0]
            base_tempo = first_tempo.get("bpm", 120) if isinstance(first_tempo, dict) else int(first_tempo)

        progress_callback("Done!", 1.0)

        task["status"] = "done"
        task["result"] = {
            "filename": final_filename,
            "downloadUrl": f"/downloads/{final_filename}",
            "artist": artist,
            "title": title,
            "xml_string": xml_string,
            "playback_map": playback_map,
            "swing_map": swing_map,
            "base_tempo": base_tempo
        }

    except Exception as e:
        logger.exception(f"Task {task_id} failed")
        task["status"] = "error"
        task["error"] = str(e)


# ─── Entry Point ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("\n  🥁 Songsterr Drum Tab Downloader")
    
    cert_path = os.path.join(BASE_DIR, 'certs', 'cert.pem')
    key_path = os.path.join(BASE_DIR, 'certs', 'key.pem')
    
    if os.path.exists(cert_path) and os.path.exists(key_path):
        print("  → SSL Certificates found! Starting with HTTPS.")
        print("  → Open https://localhost:5000 in your browser\n")
        app.run(debug=True, host="0.0.0.0", port=5000, threaded=True, ssl_context=(cert_path, key_path))
    else:
        print("  → Open http://localhost:5000 in your browser\n")
        app.run(debug=True, host="0.0.0.0", port=5000, threaded=True)
