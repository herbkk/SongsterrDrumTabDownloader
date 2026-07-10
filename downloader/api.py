"""
Songsterr API wrapper for search and revision lookups.
Uses Songsterr's internal endpoints — no browser automation needed.
"""

import requests
import time
import logging

logger = logging.getLogger(__name__)

BASE_URL = "https://www.songsterr.com"
SEARCH_URL = f"{BASE_URL}/api/search"
REVISIONS_URL = f"{BASE_URL}/api/meta"

# Drum instrument ID used by Songsterr
DRUM_INSTRUMENT_ID = 1024

# Be polite — minimum delay between API calls
API_DELAY_SECONDS = 0.5

# Mimic a real browser
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.songsterr.com/",
}


def search_songs(query: str, size: int = 20, drums_only: bool = True) -> list[dict]:
    """
    Search Songsterr for songs matching the query.

    Args:
        query: Search string (artist name, song title, or both)
        size: Maximum number of results to return
        drums_only: If True, filter results to only include songs with drum tracks

    Returns:
        List of song dicts with keys:
            songId, artist, title, tracks, hasDrums, drumTrackIndex, drumTrackName, drumDifficulty
    """
    params = {"pattern": query, "size": size}

    try:
        resp = requests.get(SEARCH_URL, params=params, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        data = resp.json()
    except requests.RequestException as e:
        logger.error(f"Search API request failed: {e}")
        return []
    except ValueError as e:
        logger.error(f"Search API returned invalid JSON: {e}")
        return []

    # The API returns {"records": [...]}
    records = data if isinstance(data, list) else data.get("records", [])

    results = []
    for record in records:
        song = _parse_song_record(record)
        if drums_only and not song["hasDrums"]:
            continue
        results.append(song)

    time.sleep(API_DELAY_SECONDS)
    return results


def get_revisions(song_id: int) -> list[dict]:
    """
    Get revision history for a song. The first non-blocked revision
    is typically the current active one.

    Returns:
        List of revision dicts sorted by most recent first.
    """
    url = f"{REVISIONS_URL}/{song_id}/revisions"

    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        revisions = resp.json()
    except requests.RequestException as e:
        logger.error(f"Revisions API request failed for song {song_id}: {e}")
        return []
    except ValueError as e:
        logger.error(f"Revisions API returned invalid JSON: {e}")
        return []

    time.sleep(API_DELAY_SECONDS)
    return revisions


def get_active_revision_id(song_id: int) -> int | None:
    """
    Get the most recent non-blocked revision ID for a song.
    """
    revisions = get_revisions(song_id)

    for rev in revisions:
        if not rev.get("isBlocked", False) and not rev.get("isDeleted", False):
            return rev.get("revisionId")

    # Fallback: return the first revision regardless
    if revisions:
        return revisions[0].get("revisionId")

    return None


def _parse_song_record(record: dict) -> dict:
    """
    Parse a raw Songsterr search result into a clean song dict.
    """
    tracks = record.get("tracks", [])

    # Find drum track(s)
    drum_track_index = None
    drum_track_name = ""
    drum_difficulty = 0
    has_drums = False

    for i, track in enumerate(tracks):
        if track.get("instrumentId") == DRUM_INSTRUMENT_ID:
            has_drums = True
            drum_track_index = i
            drum_track_name = track.get("name", "Drums")
            drum_difficulty = track.get("difficulty", 0)
            break

    # Also check the popularTrackDrum field
    if not has_drums and "popularTrackDrum" in record:
        pop_idx = record["popularTrackDrum"]
        if pop_idx is not None and 0 <= pop_idx < len(tracks):
            has_drums = True
            drum_track_index = pop_idx
            drum_track_name = tracks[pop_idx].get("name", "Drums")
            drum_difficulty = tracks[pop_idx].get("difficulty", 0)

    return {
        "songId": record.get("songId"),
        "artist": record.get("artist", "Unknown Artist"),
        "title": record.get("title", "Unknown Title"),
        "tracks": [
            {
                "index": i,
                "instrument": t.get("instrument", ""),
                "instrumentId": t.get("instrumentId", 0),
                "name": t.get("name", ""),
                "views": t.get("views", 0),
                "difficulty": t.get("difficulty", 0),
            }
            for i, t in enumerate(tracks)
        ],
        "hasDrums": has_drums,
        "drumTrackIndex": drum_track_index,
        "drumTrackName": drum_track_name,
        "drumDifficulty": drum_difficulty,
    }
