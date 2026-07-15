"""
Songsterr page scraper and CDN URL resolver using Selenium.
Loads the page and captures performance logs to intercept the actual
CloudFront CDN URLs requested by the browser.
"""

import json
import time
import logging
import requests
from urllib.parse import urlparse

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.common.exceptions import WebDriverException

from .api import HEADERS, DRUM_INSTRUMENT_ID

logger = logging.getLogger(__name__)

def setup_driver() -> webdriver.Chrome:
    """Configure headless Chrome with network logging enabled."""
    chrome_options = Options()
    chrome_options.add_argument("--headless=new")
    chrome_options.add_argument("--disable-gpu")
    chrome_options.add_argument("--no-sandbox")
    chrome_options.add_argument("--disable-dev-shm-usage")
    chrome_options.add_argument("--window-size=1920,1080")
    chrome_options.add_argument("--mute-audio")
    
    # Critical: enable performance logging to capture network requests
    chrome_options.set_capability(
        "goog:loggingPrefs", {"performance": "ALL", "browser": "ALL"}
    )
    
    # Rely on built-in Selenium Manager (Selenium 4.6+) instead of webdriver-manager
    # This automatically matches the driver to the installed browser version (e.g. Chromium 150)
    driver = webdriver.Chrome(options=chrome_options)
    # Set generous page load timeout
    driver.set_page_load_timeout(30)
    return driver


def fetch_page_state(driver: webdriver.Chrome, url: str) -> dict | None:
    """
    Load the page and extract the state JSON from <script id="state">
    using Selenium's JS executor.
    """
    try:
        driver.get(url)
        # Wait a moment for JS to kick in
        time.sleep(2)
        
        # Extract the state object directly using JS
        state_json_str = driver.execute_script("""
            var el = document.getElementById('state');
            return el ? el.textContent : null;
        """)
        
        if not state_json_str:
            logger.warning("No state script found via JS")
            return None
            
        import urllib.parse
        decoded = urllib.parse.unquote(state_json_str.strip())
        return json.loads(decoded)
    except Exception as e:
        logger.error(f"Failed to fetch page state with Selenium: {e}")
        return None


def extract_metadata(state: dict, page_title: str = "") -> dict | None:
    """Extract metadata from state and page title."""
    if not state:
        return None
    try:
        meta = state.get("meta", state)
        song_id = meta.get("songId") or meta.get("current", {}).get("songId")
        revision_id = meta.get("revisionId") or meta.get("current", {}).get("revisionId")
        
        artist = "Unknown Artist"
        title = "Unknown Title"

        # Extract from page title: "Enter Sandman Drum Tab by Metallica | Songsterr..."
        if page_title and " Tab by " in page_title:
            title_part, rest = page_title.split(" Tab by ", 1)
            title = title_part.strip()
            artist = rest.split(" | ")[0].strip()
            if title.endswith(" Drum"):
                title = title[:-5]
        else:
            # Fallback from JSON
            artist_data = state.get("artist", {})
            if isinstance(artist_data, dict) and "artists" in artist_data:
                artists_map = artist_data.get("artists", {})
                if artists_map:
                    artist = list(artists_map.values())[0]

        tracks = meta.get("tracks", [])
        if not tracks and "current" in meta:
            tracks = meta["current"].get("tracks", [])

        return {
            "songId": song_id,
            "revisionId": revision_id,
            "artist": artist,
            "title": title,
            "tracks": tracks,
        }
    except Exception as e:
        logger.error(f"Metadata extraction failed: {e}")
        return None


def capture_cdn_urls(driver: webdriver.Chrome) -> list[str]:
    """
    Extract all CloudFront JSON URLs from the browser's performance logs.
    """
    urls = []
    try:
        logs = driver.get_log("performance")
        for entry in logs:
            try:
                log_msg = json.loads(entry["message"])["message"]
                method = log_msg.get("method")
                
                # Look for Network.requestWillBeSent
                if method == "Network.requestWillBeSent":
                    req_url = log_msg["params"]["request"]["url"]
                    if "cloudfront.net" in req_url and req_url.endswith(".json"):
                        if req_url not in urls:
                            urls.append(req_url)
            except (KeyError, json.JSONDecodeError):
                continue
    except Exception as e:
        logger.error(f"Failed to capture network logs: {e}")
        
    return urls


def download_drum_track(song_url: str = None, song_id: int = None,
                        progress_callback=None) -> dict:
    """
    Main orchestrator: download the drum track JSON for a song using Selenium.
    """
    def report(step, pct):
        if progress_callback:
            progress_callback(step, pct)
        logger.info(f"[{pct:.0%}] {step}")

    report("Starting download...", 0.0)

    if not song_url and song_id:
        song_url = f"https://www.songsterr.com/a/wsa/x-tab-s{song_id}"
    elif not song_url:
        return {"success": False, "error": "No URL provided"}

    driver = None
    try:
        report("Launching browser...", 0.1)
        driver = setup_driver()
        
        report("Loading song page...", 0.25)
        state = fetch_page_state(driver, song_url)
        
        metadata = extract_metadata(state, driver.title) if state else None
        
        artist = "Unknown Artist"
        title = "Unknown Title"
        drum_track_id = None
        
        if metadata:
            artist = metadata.get("artist", artist)
            title = metadata.get("title", title)
            
            drum_tracks = []
            # Find all drum tracks
            for i, track in enumerate(metadata.get("tracks", [])):
                inst_id = track.get("instrumentId", 0)
                if inst_id == DRUM_INSTRUMENT_ID or "drum" in track.get("title", "").lower() or "perc" in track.get("title", "").lower():
                    drum_tracks.append({
                        "partId": track.get("partId", i),
                        "title": track.get("title", f"Drum Track {i}"),
                        "instrument": track.get("instrument", "Drums")
                    })

        # Give the browser a little more time to make the CDN requests
        time.sleep(1.5)
        
        report("Capturing network requests...", 0.5)
        cdn_urls = capture_cdn_urls(driver)
        
        if not cdn_urls:
            return {"success": False, "error": "No track data found in network logs. The page may not have loaded correctly."}
            
        if len(drum_tracks) > 1:
            # We need user input to select the track
            return {
                "success": False,
                "requires_track_selection": True,
                "tracks": drum_tracks,
                "cdn_urls": cdn_urls,
                "artist": artist,
                "title": title
            }
        elif len(drum_tracks) == 1:
            drum_track_id = drum_tracks[0]["partId"]
        else:
            # Try to guess or fallback
            drum_track_id = 0

        target_url = None
        
        if drum_track_id is not None:
            # Look for the URL ending in /{drum_track_id}.json
            suffix = f"/{drum_track_id}.json"
            for url in cdn_urls:
                if url.endswith(suffix):
                    target_url = url
                    break
        
        if not target_url:
            return {"success": False, "error": f"Drum track (id={drum_track_id}) not found among captured URLs."}
            
        report("Downloading drum track data...", 0.75)
        resp = requests.get(target_url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        track_data = resp.json()
        report("Download complete!", 0.80)
        return {
            "success": True,
            "data": track_data,
            "artist": artist,
            "title": title,
            "cdnUrl": target_url
        }

    except Exception as e:
        logger.exception("Download failed")
        return {"success": False, "error": str(e)}
    finally:
        if driver:
            driver.quit()
