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

# General MIDI guitar programs used by Songsterr
# (24 = nylon, 25 = steel, 26/27 = electric, 28 = muted, 29 = overdriven,
#  30 = distortion, 31 = harmonics)
GUITAR_INSTRUMENT_IDS = frozenset(range(24, 32))

# Supported instruments: name -> set of Songsterr instrumentIds to match
INSTRUMENT_IDS = {
    "drums": frozenset({DRUM_INSTRUMENT_ID}),
    "guitar": GUITAR_INSTRUMENT_IDS,
}

# Songsterr tags every arrangement with a typed hash ("guitar_Aufu0Z0c",
# "drums_xnXBaqrX", "bass_...", "vocals_...", "other_..."). That type is more
# reliable than instrumentId: a chord/lead-sheet arrangement can carry
# instrumentId 33 (bass) while its hash still says guitar.
INSTRUMENT_HASH_PREFIX = {
    "drums": "drums_",
    "guitar": "guitar_",
}


def track_is_instrument(track: dict, instrument: str) -> bool:
    """
    Return True when a Songsterr track object belongs to ``instrument``.

    Trusts Songsterr's typed ``hash`` first, then falls back to
    ``instrumentId`` (``INSTRUMENT_IDS``) and finally to the track name.
    """
    wanted_prefix = INSTRUMENT_HASH_PREFIX.get(instrument)
    if wanted_prefix and (track.get("hash") or "").startswith(wanted_prefix):
        return True

    if track.get("instrumentId", 0) in INSTRUMENT_IDS.get(instrument, frozenset()):
        return True

    # Last resort, for tracks whose instrumentId is missing or unexpected
    name = (track.get("title") or track.get("name") or "").lower()
    if instrument == "drums":
        return "drum" in name or "perc" in name
    if instrument == "guitar":
        return "guitar" in name
    return False

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


def search_songs(query: str, size: int = 20, instrument: str = "drums",
                 drums_only: bool | None = None) -> list[dict]:
    """
    Search Songsterr for songs matching the query.

    Args:
        query: Search string (artist name, song title, or both)
        size: Maximum number of results to return
        instrument: Which instrument to filter on ("drums" or "guitar").
            If falsy, no filtering is applied and every song is returned.
        drums_only: Deprecated. Kept for backwards compatibility; when set,
            overrides ``instrument`` (True -> "drums", False -> no filter).

    Returns:
        List of song dicts. In addition to the drum-specific keys
        (hasDrums, drumTrackIndex, drumTrackName, drumDifficulty) every song
        now carries the requested instrument under the generic keys
        hasTrack, trackIndex, trackName, trackDifficulty.
    """
    if drums_only is not None:
        instrument = "drums" if drums_only else None

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
        song = _parse_song_record(record, instrument)
        if instrument and not song["hasTrack"]:
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


def _find_track(tracks: list[dict], instrument: str | None) -> int | None:
    """Return the index of the first track matching the requested instrument."""
    if not instrument:
        return None
    for i, track in enumerate(tracks):
        if track_is_instrument(track, instrument):
            return i
    return None


def _parse_song_record(record: dict, instrument: str | None = "drums") -> dict:
    """
    Parse a raw Songsterr search result into a clean song dict.

    Both drums and guitar are detected; ``instrument`` only selects which one
    is exposed through the generic hasTrack/trackIndex/... keys.
    """
    tracks = record.get("tracks", [])

    # Find drum track(s)
    drum_track_index = _find_track(tracks, "drums")
    has_drums = drum_track_index is not None
    drum_track_name = ""
    drum_difficulty = 0
    if has_drums:
        drum_track_name = tracks[drum_track_index].get("name", "Drums")
        drum_difficulty = tracks[drum_track_index].get("difficulty", 0)

    # Also check the popularTrackDrum field
    if not has_drums and record.get("popularTrackDrum") is not None:
        pop_idx = record["popularTrackDrum"]
        if 0 <= pop_idx < len(tracks):
            has_drums = True
            drum_track_index = pop_idx
            drum_track_name = tracks[pop_idx].get("name", "Drums")
            drum_difficulty = tracks[pop_idx].get("difficulty", 0)

    # Find guitar track(s)
    guitar_track_index = _find_track(tracks, "guitar")
    has_guitar = guitar_track_index is not None
    guitar_track_name = ""
    guitar_difficulty = 0
    if has_guitar:
        guitar_track_name = tracks[guitar_track_index].get("name", "Guitar")
        guitar_difficulty = tracks[guitar_track_index].get("difficulty", 0)

    # Requested track (generic keys used by the UI)
    if instrument == "guitar":
        track_index, track_name, track_difficulty = guitar_track_index, guitar_track_name, guitar_difficulty
    else:
        track_index, track_name, track_difficulty = drum_track_index, drum_track_name, drum_difficulty

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
        "hasGuitar": has_guitar,
        "guitarTrackIndex": guitar_track_index,
        "guitarTrackName": guitar_track_name,
        "guitarDifficulty": guitar_difficulty,
        # Generic keys for whichever instrument was requested
        "instrument": instrument,
        "hasTrack": track_index is not None,
        "trackIndex": track_index,
        "trackName": track_name,
        "trackDifficulty": track_difficulty,
    }
