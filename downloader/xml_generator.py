"""
MusicXML Generator for Drum Tracks.
Translates Songsterr JSON into MusicXML 4.0 format.
"""

import xml.etree.ElementTree as ET
from xml.dom import minidom
import os
import logging
import copy

logger = logging.getLogger(__name__)

# Divisions per quarter note (determines temporal resolution)
DIVISIONS = 16

# Mapping from Songsterr fret (MIDI pitch) to MusicXML <unpitched> elements
# display-step: Note letter (A-G)
# display-octave: Octave number (usually 4 or 5)
# notehead: 'x', 'circle-x', 'diamond', or None (standard)

DRUM_MAPPING = {
    # Bass Drum (Bottom space - F4)
    36: {"step": "F", "octave": 4, "name": "Bass Drum 1"},
    35: {"step": "F", "octave": 4, "name": "Acoustic Bass Drum"},
    
    # Snare (Third space - C5)
    38: {"step": "C", "octave": 5, "name": "Acoustic Snare"},
    
    # Snare Rim / Cross Stick (Third space - C5, notehead x)
    40: {"step": "C", "octave": 5, "notehead": "x", "name": "Electric Snare / Rimshot"},
    37: {"step": "C", "octave": 5, "notehead": "x", "name": "Side Stick"},
    
    # Toms
    48: {"step": "E", "octave": 5, "name": "High Tom"}, # High Tom (Top space)
    50: {"step": "E", "octave": 5, "name": "High Tom"}, # High Tom alt
    47: {"step": "D", "octave": 5, "name": "Mid Tom"}, # Mid Tom (4th line)
    45: {"step": "D", "octave": 5, "name": "Low Tom"}, # Low Tom alt
    43: {"step": "A", "octave": 4, "name": "High Floor Tom"}, # Floor Tom (2nd space)
    41: {"step": "G", "octave": 4, "name": "Low Floor Tom"}, # Low Floor Tom (2nd line)
    
    # Hi-Hat
    42: {"step": "G", "octave": 5, "notehead": "x", "name": "Closed Hi-Hat"}, # Closed HH (Space above top line)
    46: {"step": "G", "octave": 5, "notehead": "circle-x", "name": "Open Hi-Hat"}, # Open HH
    44: {"step": "D", "octave": 4, "notehead": "x", "name": "Pedal Hi-Hat"}, # Pedal HH (Space below bottom line)
    
    # Ride Cymbal (Top line - F5)
    51: {"step": "F", "octave": 5, "notehead": "x", "name": "Ride Cymbal 1"},
    59: {"step": "F", "octave": 5, "notehead": "x", "name": "Ride Cymbal 2"},
    53: {"step": "F", "octave": 5, "notehead": "diamond", "name": "Ride Bell"}, # Ride Bell
    
    # Crash Cymbals (First ledger line above - A5)
    49: {"step": "A", "octave": 5, "notehead": "x", "name": "Crash Cymbal 1"},
    57: {"step": "B", "octave": 5, "notehead": "x", "name": "Crash Cymbal 2"}, # Crash 2 (above A5)
    55: {"step": "A", "octave": 5, "notehead": "x", "name": "Splash Cymbal"}, # Splash
    52: {"step": "A", "octave": 5, "notehead": "x", "name": "Chinese Cymbal"}, # China
    
    # Percussion
    56: {"step": "G", "octave": 5, "notehead": "triangle", "name": "Cowbell"}, # Cowbell
    31: {"step": "G", "octave": 4, "notehead": "x", "name": "Sticks / Click"}, # Sticks/Click
}

def get_fallback_drum(fret):
    """Dynamic fallback to avoid visual collisions of unmapped frets."""
    if fret is None:
        return {"step": "B", "octave": 4}
    steps = ["C", "D", "E", "F", "G", "A", "B"]
    step = steps[fret % 7]
    octave = 4 + (fret % 2)
    return {"step": step, "octave": octave, "notehead": "diamond"}

def duration_to_ticks(dur_array) -> int:
    """Convert [numerator, denominator] to MusicXML ticks (duration)."""
    # dur_array is usually [1, 4] for quarter, [1, 8] for eighth
    if not dur_array or len(dur_array) != 2:
        return DIVISIONS # default to quarter
    
    num, den = dur_array
    # 4/4 time: a quarter note has denominator 4.
    # DIVISIONS is ticks per quarter note.
    # So quarter note = DIVISIONS ticks.
    # ticks = (num / den) / (1 / 4) * DIVISIONS = (num * 4 * DIVISIONS) / den
    
    return int((num * 4 * DIVISIONS) / den)

def get_note_type_info(dur_array):
    """Convert duration array to MusicXML note type string and dot count."""
    if not dur_array or len(dur_array) != 2:
        return "quarter", 0
    
    num, den = dur_array
    dots = 0
    
    # Detect dotted notes (e.g. 3/16, 3/8)
    if num % 3 == 0:
        dots = 1
        num = (num // 3) * 2
        
    ratio = num / den
    
    if ratio >= 1.0: type_str = "whole"
    elif ratio >= 0.5: type_str = "half"
    elif ratio >= 0.25: type_str = "quarter"
    elif ratio >= 0.125: type_str = "eighth"
    elif ratio >= 0.0625: type_str = "16th"
    elif ratio >= 0.03125: type_str = "32nd"
    else: type_str = "64th"
    
    return type_str, dots

def apply_auto_beaming(measure_elem, divisions):
    """
    Groups contiguous 8th/16th/32nd notes within quarter-note boundaries into beams.
    """
    quarter_ticks = divisions
    notes_with_info = []
    current_tick = 0
    
    for note in measure_elem.findall("note"):
        dur_elem = note.find("duration")
        if dur_elem is None: continue
        
        duration = int(dur_elem.text)
        is_chord = note.find("chord") is not None
        is_rest = note.find("rest") is not None
        type_elem = note.find("type")
        note_type = type_elem.text if type_elem is not None else ""
        
        if is_chord:
            # Chords happen at the same time as the previous note
            tick_start = current_tick - duration
        else:
            tick_start = current_tick
            current_tick += duration
            
        notes_with_info.append({
            "elem": note,
            "tick": tick_start,
            "is_rest": is_rest,
            "type": note_type,
        })
        
    # Group by quarter note boundary
    boundaries = {}
    for n in notes_with_info:
        b_idx = n["tick"] // quarter_ticks
        if b_idx not in boundaries:
            boundaries[b_idx] = []
        boundaries[b_idx].append(n)
        
    # Apply beams within each boundary
    for b_idx, group in boundaries.items():
        beam_sequences = []
        current_seq = []
        
        for n in group:
            if n["is_rest"] or n["type"] not in ["eighth", "16th", "32nd", "64th"]:
                if current_seq:
                    beam_sequences.append(current_seq)
                    current_seq = []
            else:
                current_seq.append(n)
                
        if current_seq:
            beam_sequences.append(current_seq)
            
        # Apply beam tags
        for seq in beam_sequences:
            distinct_ticks = set([n["tick"] for n in seq])
            if len(distinct_ticks) > 1:
                sorted_ticks = sorted(list(distinct_ticks))
                start_tick = sorted_ticks[0]
                end_tick = sorted_ticks[-1]
                
                for n in seq:
                    beam_elem = ET.SubElement(n["elem"], "beam", number="1")
                    if n["tick"] == start_tick:
                        beam_elem.text = "begin"
                    elif n["tick"] == end_tick:
                        beam_elem.text = "end"
                    else:
                        beam_elem.text = "continue"


def get_unmapped_frets(track_data: dict, custom_mapping: dict = None) -> list:
    """Scan track data for frets not present in DRUM_MAPPING or custom_mapping."""
    unmapped = {}
    combined_mapping = DRUM_MAPPING.copy()
    if custom_mapping:
        # custom_mapping keys might be strings if coming from JSON
        combined_mapping.update({int(k): v for k, v in custom_mapping.items()})
        
    for mi, m in enumerate(track_data.get("measures", [])):
        for v in m.get("voices", []):
            for b in v.get("beats", []):
                for n in b.get("notes", []):
                    f = n.get("fret")
                    if f is not None and f not in combined_mapping:
                        if f not in unmapped:
                            unmapped[f] = {"fret": f, "first_measure": mi}
    return [unmapped[f] for f in sorted(unmapped.keys())]


class MusicXMLGenerator:
    def __init__(self, artist: str, title: str, custom_mapping: dict = None, bpm: int = None):
        self.artist = artist
        self.title = title
        self.bpm = bpm
        
        self.mapping = DRUM_MAPPING.copy()
        if custom_mapping:
            self.mapping.update({int(k): v for k, v in custom_mapping.items()})
            
        self.root = ET.Element("score-partwise", version="4.0")
        
        # Build Work/Identification
        work = ET.SubElement(self.root, "work")
        ET.SubElement(work, "work-title").text = title
        
        ident = ET.SubElement(self.root, "identification")
        creator = ET.SubElement(ident, "creator", type="composer")
        creator.text = artist
        
        # Build Part List
        part_list = ET.SubElement(self.root, "part-list")
        self.score_part = ET.SubElement(part_list, "score-part", id="P1")
        ET.SubElement(self.score_part, "part-name").text = "Drumset"
        
        # Build Part
        self.part = ET.SubElement(self.root, "part", id="P1")

    def generate(self, track_data: dict, output_path: str):
        # 1. Collect all used frets to generate MIDI instruments
        used_frets = set()
        for m in track_data.get("measures", []):
            for v in m.get("voices", []):
                for b in v.get("beats", []):
                    for n in b.get("notes", []):
                        f = n.get("fret")
                        if f is not None:
                            used_frets.add(f)
                            
        for f in sorted(used_frets):
            instr_id = f"P1-I{f}"
            score_instr = ET.SubElement(self.score_part, "score-instrument", id=instr_id)
            
            # Find the actual human-readable name from our dictionary
            instr_name = f"Drum {f}"
            if f in self.mapping:
                instr_name = self.mapping[f].get("name", instr_name)
            
            ET.SubElement(score_instr, "instrument-name").text = instr_name
            midi_instr = ET.SubElement(self.score_part, "midi-instrument", id=instr_id)
            ET.SubElement(midi_instr, "midi-channel").text = "10"
            ET.SubElement(midi_instr, "midi-program").text = "1"
            ET.SubElement(midi_instr, "midi-unpitched").text = str(f)

        measures = track_data.get("measures", [])
        tempos = {}
        if self.bpm is not None:
            tempos[0] = self.bpm
        elif "automations" in track_data:
            for t in track_data["automations"].get("tempo", []):
                tempos[t.get("measure", 0)] = t.get("bpm", 120)

        active_ending = None

        for mi, measure_data in enumerate(measures):
            measure_elem = ET.SubElement(self.part, "measure", number=str(mi + 1))
            
            # Attributes for first measure or when changed
            # (Songsterr sometimes repeats signature, but we check if we need it)
            if mi == 0 or "signature" in measure_data:
                attr = ET.SubElement(measure_elem, "attributes")
                if mi == 0:
                    ET.SubElement(attr, "divisions").text = str(DIVISIONS)
                    
                    key = ET.SubElement(attr, "key")
                    ET.SubElement(key, "fifths").text = "0"
                    
                    clef = ET.SubElement(attr, "clef")
                    ET.SubElement(clef, "sign").text = "percussion"
                    ET.SubElement(clef, "line").text = "2"
                
                sig = measure_data.get("signature")
                if sig:
                    time = ET.SubElement(attr, "time")
                    ET.SubElement(time, "beats").text = str(sig[0])
                    ET.SubElement(time, "beat-type").text = str(sig[1])
            
            # Tempo / Direction
            if mi in tempos or "marker" in measure_data:
                dir_elem = ET.SubElement(measure_elem, "direction", placement="above")
                dir_type = ET.SubElement(dir_elem, "direction-type")
                
                if "marker" in measure_data:
                    words = ET.SubElement(dir_type, "words", font_weight="bold")
                    words.text = measure_data["marker"].get("text", "")
                    
                if mi in tempos:
                    # Metronome mark
                    dir_type2 = ET.SubElement(dir_elem, "direction-type")
                    met = ET.SubElement(dir_type2, "metronome")
                    ET.SubElement(met, "beat-unit").text = "quarter"
                    ET.SubElement(met, "per-minute").text = str(tempos[mi])
                    
                    # Sound tempo tag for playback
                    sound = ET.SubElement(dir_elem, "sound")
                    sound.set("tempo", str(tempos[mi]))

            # Barline / Repeats / Endings (Left)
            repeat_open = measure_data.get("repeatStart")
            alt_ending_list = measure_data.get("alternateEnding")
            alt_ending = alt_ending_list[0] if alt_ending_list else None
            
            if alt_ending != active_ending:
                barline_left = ET.SubElement(measure_elem, "barline", location="left")
                if active_ending is not None:
                    ET.SubElement(barline_left, "ending", number=str(active_ending), type="stop")
                if alt_ending is not None:
                    ET.SubElement(barline_left, "ending", number=str(alt_ending), type="start")
                
                if repeat_open:
                    ET.SubElement(barline_left, "bar-style").text = "heavy-light"
                    ET.SubElement(barline_left, "repeat", direction="forward")
                
                active_ending = alt_ending
            elif repeat_open:
                barline_left = ET.SubElement(measure_elem, "barline", location="left")
                ET.SubElement(barline_left, "bar-style").text = "heavy-light"
                ET.SubElement(barline_left, "repeat", direction="forward")

            self._process_measure(measure_elem, measure_data)

            # Barline / Repeats / Endings (Right)
            repeat_close = measure_data.get("repeat")
            
            # Look ahead to see if the ending bracket stops here
            is_ending_end = False
            if active_ending is not None:
                next_alt = None
                if mi + 1 < len(measures):
                    next_alt_list = measures[mi + 1].get("alternateEnding")
                    next_alt = next_alt_list[0] if next_alt_list else None
                if next_alt != active_ending:
                    is_ending_end = True

            if repeat_close or is_ending_end:
                barline_right = ET.SubElement(measure_elem, "barline", location="right")
                
                if is_ending_end:
                    ending_type = "stop" if repeat_close else "discontinue"
                    ET.SubElement(barline_right, "ending", number=str(active_ending), type=ending_type)
                    active_ending = None
                
                if repeat_close:
                    ET.SubElement(barline_right, "bar-style").text = "light-heavy"
                    times = "2"
                    if isinstance(repeat_close, int) and repeat_close > 0:
                        times = str(repeat_close)
                    ET.SubElement(barline_right, "repeat", direction="backward", times=times)

        # Write to file
        xml_str = ET.tostring(self.root, encoding="unicode")
        pretty_xml = minidom.parseString(xml_str).toprettyxml(indent="  ")
        
        if output_path is None:
            return pretty_xml
        
        # Minidom adds an xml declaration, we just write it
        with open(output_path, "w", encoding="utf-8") as f:
            f.write(pretty_xml)
            
        logger.info(f"MusicXML saved to {output_path}")
        return output_path

    def _process_measure(self, measure_elem: ET.Element, measure_data: dict):
        voices = measure_data.get("voices", [])
        if not voices:
            return
            
        beats = voices[0].get("beats", [])
        
        for beat in beats:
            is_rest = beat.get("rest", False)
            dur_array = beat.get("duration", [1, 4])
            ticks = duration_to_ticks(dur_array)
            note_type, dots = get_note_type_info(dur_array)
            
            if is_rest:
                note = ET.SubElement(measure_elem, "note")
                ET.SubElement(note, "rest")
                ET.SubElement(note, "duration").text = str(ticks)
                ET.SubElement(note, "voice").text = "1"
                ET.SubElement(note, "type").text = note_type
                for _ in range(dots):
                    ET.SubElement(note, "dot")
                continue

            notes = beat.get("notes", [])
            for i, n in enumerate(notes):
                is_chord = (i > 0) # Subsequent notes in the same beat are chords
                
                note_elem = ET.SubElement(measure_elem, "note")
                
                if is_chord:
                    ET.SubElement(note_elem, "chord")
                    
                fret = n.get("fret")
                mapping = self.mapping.get(fret)
                if not mapping:
                    mapping = get_fallback_drum(fret)
                
                unpitched = ET.SubElement(note_elem, "unpitched")
                ET.SubElement(unpitched, "display-step").text = mapping["step"]
                ET.SubElement(unpitched, "display-octave").text = str(mapping["octave"])
                
                ET.SubElement(note_elem, "duration").text = str(ticks)
                
                # Tie handling
                if n.get("tie") == "start":
                    ET.SubElement(note_elem, "tie", type="start")
                elif n.get("tie") == "stop":
                    ET.SubElement(note_elem, "tie", type="stop")
                
                if fret is not None:
                    ET.SubElement(note_elem, "instrument", id=f"P1-I{fret}")
                
                ET.SubElement(note_elem, "voice").text = "1"
                ET.SubElement(note_elem, "type").text = note_type
                for _ in range(dots):
                    ET.SubElement(note_elem, "dot")
                
                # Force stems up for all drums to ensure uniform beam height
                ET.SubElement(note_elem, "stem").text = "up"
                
                # Notehead
                if "notehead" in mapping:
                    ET.SubElement(note_elem, "notehead").text = mapping["notehead"]
                    
                # Color Highlight
                if n.get("highlight"):
                    note_elem.set("color", "#EF4444")
                    notehead_elem = note_elem.find("notehead")
                    if notehead_elem is None:
                        notehead_elem = ET.SubElement(note_elem, "notehead")
                        notehead_elem.text = "normal"
                    notehead_elem.set("color", "#EF4444")
                    
                # Articulations (ghost notes)
                if n.get("ghost"):
                    notehead_elem = note_elem.find("notehead")
                    if notehead_elem is None:
                        ET.SubElement(note_elem, "notehead", parentheses="yes").text = "normal"
                    else:
                        notehead_elem.set("parentheses", "yes")

        # Apply auto-beaming after all notes are added to the measure
        apply_auto_beaming(measure_elem, DIVISIONS)

def generate_musicxml(track_data: dict, output_path: str, artist: str = "Unknown", title: str = "Unknown", custom_mapping: dict = None, bpm: int = None) -> str:
    """Convenience function to generate MusicXML."""
    if output_path is not None:
        os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    generator = MusicXMLGenerator(artist, title, custom_mapping, bpm)
    return generator.generate(track_data, output_path)

def generate_measure_preview_xml(track_data: dict, measure_index: int, highlight_fret: int = None) -> str:
    """Generate a tiny MusicXML string for a few measures, for preview purposes."""
    generator = MusicXMLGenerator("Preview", "Preview", None, None)
    
    measures = track_data.get("measures", [])
    start_idx = max(0, measure_index - 1)
    end_idx = min(len(measures), measure_index + 2)
    
    sig = [4, 4]
    for mi, m in enumerate(measures):
        if "signature" in m:
            sig = m["signature"]
        if mi == start_idx:
            break
            
    target_measures = []
    for i in range(start_idx, end_idx):
        m_copy = copy.deepcopy(measures[i])
        
        if i == start_idx:
            m_copy["signature"] = sig
            
        # Strip repeats or alternate endings to keep the preview simple
        m_copy.pop("repeatStart", None)
        m_copy.pop("repeat", None)
        m_copy.pop("alternateEnding", None)
        
        if highlight_fret is not None and i == measure_index:
            for v in m_copy.get("voices", []):
                for b in v.get("beats", []):
                    for n in b.get("notes", []):
                        if n.get("fret") == highlight_fret:
                            n["highlight"] = True
                            
        target_measures.append(m_copy)
    
    dummy_track = {"measures": target_measures}
    
    return generator.generate(dummy_track, None)
