"""
Traditional drum notation PDF renderer using ReportLab.

Renders Songsterr drum track JSON into a print-ready PDF with:
- 5-line percussion staff
- Standard noteheads (x for cymbals, filled circles for drums)
- Ghost note indicators (parentheses)
- Section markers, tempo markings, time signatures
- Measure numbers, automatic pagination
"""

import os
import logging
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm, cm
from reportlab.pdfgen import canvas
from reportlab.lib.colors import black, white, Color, HexColor

logger = logging.getLogger(__name__)

# ─── Page Layout ────────────────────────────────────────────────────────────────

PAGE_WIDTH, PAGE_HEIGHT = A4
MARGIN_LEFT = 20 * mm
MARGIN_RIGHT = 15 * mm
MARGIN_TOP = 20 * mm
MARGIN_BOTTOM = 20 * mm

CONTENT_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT

# ─── Staff Dimensions ──────────────────────────────────────────────────────────

STAFF_LINE_SPACING = 3.2 * mm        # Distance between staff lines
STAFF_HEIGHT = 4 * STAFF_LINE_SPACING  # 5 lines = 4 gaps
STAFF_TOP_MARGIN = 12 * mm           # Space above staff for cymbals/markers
STAFF_BOTTOM_MARGIN = 8 * mm         # Space below staff for bass drum/pedal HH
SYSTEM_HEIGHT = STAFF_TOP_MARGIN + STAFF_HEIGHT + STAFF_BOTTOM_MARGIN

# Measures per line
MEASURES_PER_LINE = 4

# ─── MIDI Drum Voice Mapping ───────────────────────────────────────────────────
#
# Maps Songsterr "fret" values (MIDI note numbers) to:
#   - label: Short display name
#   - line: Vertical position relative to staff (0 = bottom line, 4 = top line)
#           Values >4 are above staff, <0 are below
#   - head: Notehead type ('x' = cross, 'o' = circle filled, 'O' = open circle,
#           'd' = diamond, 'tri' = triangle)

DRUM_VOICES = {
    # Cymbals (above staff / top line)
    57: {"label": "CR2", "line": 5.5, "head": "x"},    # Crash Cymbal 2
    55: {"label": "SP",  "line": 5.5, "head": "x"},    # Splash Cymbal
    52: {"label": "CH",  "line": 5.5, "head": "x"},    # Chinese Cymbal
    49: {"label": "CR",  "line": 5.0, "head": "x"},    # Crash Cymbal 1
    51: {"label": "RD",  "line": 4.5, "head": "x"},    # Ride Cymbal
    53: {"label": "RB",  "line": 4.5, "head": "d"},    # Ride Bell
    59: {"label": "RD2", "line": 4.5, "head": "x"},    # Ride Cymbal 2

    # Hi-Hat (top line area)
    42: {"label": "HH",  "line": 4.0, "head": "x"},    # Closed Hi-Hat
    46: {"label": "OH",  "line": 4.0, "head": "O"},    # Open Hi-Hat
    44: {"label": "PHH", "line": -0.5, "head": "x"},   # Pedal Hi-Hat (below staff)

    # Snare area (middle)
    38: {"label": "SD",  "line": 3.0, "head": "o"},    # Snare Drum
    40: {"label": "RS",  "line": 3.0, "head": "x"},    # Rim Shot / Side Stick
    37: {"label": "SS",  "line": 3.0, "head": "x"},    # Side Stick

    # Toms
    48: {"label": "T1",  "line": 3.5, "head": "o"},    # High Tom
    50: {"label": "T1",  "line": 3.5, "head": "o"},    # High Tom (alt)
    47: {"label": "T2",  "line": 2.5, "head": "o"},    # Mid Tom
    45: {"label": "T2",  "line": 2.5, "head": "o"},    # Low Tom
    43: {"label": "T3",  "line": 1.5, "head": "o"},    # High Floor Tom
    41: {"label": "T4",  "line": 1.0, "head": "o"},    # Low Floor Tom

    # Bass Drum (bottom)
    36: {"label": "BD",  "line": 0.0, "head": "o"},    # Bass Drum 1
    35: {"label": "BD",  "line": 0.0, "head": "o"},    # Bass Drum 2 / Acoustic Bass

    # Cowbell, tambourine, etc.
    56: {"label": "CB",  "line": 5.0, "head": "d"},    # Cowbell
    54: {"label": "TM",  "line": 5.0, "head": "d"},    # Tambourine
}

# Fallback for unknown fret values
DEFAULT_VOICE = {"label": "?", "line": 2.0, "head": "o"}


# ─── Duration Mapping ──────────────────────────────────────────────────────────

def duration_to_beats(duration_array: list) -> float:
    """Convert Songsterr duration [numerator, denominator] to beat fraction."""
    if not duration_array or len(duration_array) < 2:
        return 1.0
    return duration_array[0] / duration_array[1] * 4  # Convert to quarter-note beats


# ─── PDF Renderer ──────────────────────────────────────────────────────────────

class DrumPDFRenderer:
    """Renders drum track JSON as a traditional notation PDF."""

    def __init__(self, output_path: str, artist: str, title: str):
        self.output_path = output_path
        self.artist = artist
        self.title = title
        self.c = canvas.Canvas(output_path, pagesize=A4)
        self.page_num = 1
        self.y_cursor = PAGE_HEIGHT - MARGIN_TOP

        # PDF Metadata for ForScore
        self.c.setTitle(self.title)
        self.c.setAuthor(self.artist)
        self.c.setSubject("Drum Tab")
        self.c.setKeywords("Drums, Drum Tab, Songsterr")
        self.c.setCreator("SongsterrDrumTabDownloader")

        # Colors
        self.bg_color = white
        self.fg_color = black
        self.accent_color = HexColor("#D97706")  # Amber-600

    def render(self, track_data: dict) -> str:
        """
        Render the full drum track to PDF.

        Args:
            track_data: Songsterr track JSON dict

        Returns:
            Path to the generated PDF file
        """
        measures = track_data.get("measures", [])
        tempos = {}
        if "automations" in track_data:
            for t in track_data["automations"].get("tempo", []):
                tempos[t.get("measure", 0)] = t.get("bpm", 120)

        if not measures:
            logger.warning("No measures found in track data")
            return self.output_path

        # Draw header on first page
        self._draw_header(track_data)

        # Process measures in groups (lines)
        measure_idx = 0
        total_measures = len(measures)

        while measure_idx < total_measures:
            # Check if we need a new page
            if self.y_cursor - SYSTEM_HEIGHT < MARGIN_BOTTOM:
                self._new_page()

            # Determine how many measures fit on this line
            line_measures = []
            for i in range(MEASURES_PER_LINE):
                idx = measure_idx + i
                if idx >= total_measures:
                    break
                line_measures.append((idx, measures[idx]))

            if not line_measures:
                break

            # Draw the system (staff + measures)
            self._draw_system(line_measures, tempos)
            measure_idx += len(line_measures)

        # Draw footer on last page
        self._draw_footer()
        self.c.save()

        logger.info(f"PDF saved to {self.output_path} ({self.page_num} pages)")
        return self.output_path

    def _draw_header(self, track_data: dict):
        """Draw the title header on the first page."""
        c = self.c
        y = self.y_cursor

        # Title
        c.setFont("Helvetica-Bold", 18)
        c.drawCentredString(PAGE_WIDTH / 2, y, self.title)
        y -= 7 * mm

        # Artist
        c.setFont("Helvetica", 13)
        c.drawCentredString(PAGE_WIDTH / 2, y, self.artist)
        y -= 6 * mm

        # Track name / instrument
        track_name = track_data.get("name", "Drums")
        c.setFont("Helvetica-Oblique", 10)
        c.drawCentredString(PAGE_WIDTH / 2, y, track_name)
        y -= 10 * mm

        # Thin separator line
        c.setStrokeColor(HexColor("#CCCCCC"))
        c.setLineWidth(0.5)
        c.line(MARGIN_LEFT, y, PAGE_WIDTH - MARGIN_RIGHT, y)
        y -= 8 * mm

        self.y_cursor = y

    def _draw_footer(self):
        """Draw page number footer."""
        self._draw_page_number()

    def _draw_page_number(self):
        """Draw centered page number at bottom."""
        c = self.c
        c.setFont("Helvetica", 8)
        c.setFillColor(HexColor("#999999"))
        c.drawCentredString(PAGE_WIDTH / 2, MARGIN_BOTTOM - 10 * mm,
                            f"Page {self.page_num}")
        c.setFillColor(black)

    def _new_page(self):
        """Start a new page."""
        self._draw_page_number()
        self.c.showPage()
        self.page_num += 1
        self.y_cursor = PAGE_HEIGHT - MARGIN_TOP

    def _draw_system(self, line_measures: list, tempos: dict):
        """
        Draw one system (horizontal line of music):
        - Staff lines
        - Measure bars
        - Notes within each measure
        """
        c = self.c
        num_measures = len(line_measures)

        # Position calculations
        staff_top_y = self.y_cursor - STAFF_TOP_MARGIN
        staff_bottom_y = staff_top_y - STAFF_HEIGHT
        measure_width = CONTENT_WIDTH / MEASURES_PER_LINE

        # Draw 5 staff lines
        c.setStrokeColor(HexColor("#BBBBBB"))
        c.setLineWidth(0.4)
        for line_num in range(5):
            ly = staff_bottom_y + line_num * STAFF_LINE_SPACING
            c.line(MARGIN_LEFT, ly, MARGIN_LEFT + num_measures * measure_width, ly)

        # Draw measures
        for mi, (measure_idx, measure) in enumerate(line_measures):
            x_start = MARGIN_LEFT + mi * measure_width
            x_end = x_start + measure_width

            # Draw barline at start (only for first measure on line)
            if mi == 0:
                c.setStrokeColor(black)
                c.setLineWidth(0.6)
                c.line(x_start, staff_bottom_y, x_start, staff_top_y)

            # Draw barline at end
            c.setStrokeColor(black)
            is_double = measure.get("doubleBarline", False)
            if is_double:
                c.setLineWidth(0.4)
                c.line(x_end - 1.5 * mm, staff_bottom_y, x_end - 1.5 * mm, staff_top_y)
                c.setLineWidth(1.2)
                c.line(x_end, staff_bottom_y, x_end, staff_top_y)
            else:
                c.setLineWidth(0.6)
                c.line(x_end, staff_bottom_y, x_end, staff_top_y)

            # Measure number
            c.setFont("Helvetica", 6)
            c.setFillColor(HexColor("#999999"))
            c.drawString(x_start + 1 * mm, staff_top_y + 2 * mm, str(measure_idx + 1))
            c.setFillColor(black)

            # Section marker
            marker = measure.get("marker")
            if marker:
                marker_text = marker.get("text", "")
                if marker_text:
                    c.setFont("Helvetica-Bold", 8)
                    c.setFillColor(self.accent_color)
                    c.drawString(x_start + 1 * mm, staff_top_y + 6 * mm, marker_text)
                    c.setFillColor(black)

            # Tempo marking
            if measure_idx in tempos:
                bpm = tempos[measure_idx]
                c.setFont("Helvetica", 7)
                c.setFillColor(HexColor("#666666"))
                c.drawString(x_start + 1 * mm, staff_top_y + 10 * mm, f"♩={bpm}")
                c.setFillColor(black)

            # Time signature (only on first measure or when it changes)
            sig = measure.get("signature")
            if sig and (measure_idx == 0 or mi == 0):
                if measure_idx == 0 or (measure_idx > 0 and
                        sig != line_measures[0][1].get("signature", [4, 4])):
                    self._draw_time_signature(x_start, staff_bottom_y, sig)

            # Draw notes for this measure
            if not measure.get("rest", False):
                self._draw_measure_notes(measure, x_start, x_end, staff_bottom_y)

        self.y_cursor -= SYSTEM_HEIGHT

    def _draw_time_signature(self, x: float, staff_bottom_y: float, sig: list):
        """Draw time signature at the beginning of a system."""
        if not sig or len(sig) < 2:
            return

        c = self.c
        c.setFont("Helvetica-Bold", 12)
        mid_y = staff_bottom_y + STAFF_HEIGHT / 2

        c.drawCentredString(x + 5 * mm, mid_y + 1.5 * mm, str(sig[0]))
        c.drawCentredString(x + 5 * mm, mid_y - STAFF_LINE_SPACING - 1 * mm, str(sig[1]))

    def _draw_measure_notes(self, measure: dict, x_start: float, x_end: float,
                            staff_bottom_y: float):
        """
        Draw all notes within a single measure.
        """
        voices = measure.get("voices", [])
        if not voices:
            return

        # Use the first voice (primary)
        voice = voices[0]
        beats = voice.get("beats", [])

        if not beats:
            return

        # Calculate total duration to determine beat positions
        usable_width = (x_end - x_start) - 8 * mm  # Padding inside measure
        note_area_start = x_start + 5 * mm

        # Calculate cumulative positions based on duration
        total_duration = 0
        beat_positions = []

        for beat in beats:
            dur = beat.get("duration", [1, 4])
            beat_dur = dur[0] / dur[1] * 4 if len(dur) >= 2 else 1.0
            beat_positions.append(total_duration)
            total_duration += beat_dur

        if total_duration == 0:
            total_duration = 4.0  # Default 4/4

        # Draw each beat
        for bi, beat in enumerate(beats):
            if beat.get("rest", False):
                continue

            # X position proportional to time
            x_frac = beat_positions[bi] / total_duration
            x_pos = note_area_start + x_frac * usable_width

            notes = beat.get("notes", [])
            velocity = beat.get("velocity", "mf")
            is_grace = beat.get("graceNote") is not None

            hand_notes = []
            foot_notes = []

            for note in notes:
                if note.get("rest", False):
                    continue

                fret = note.get("fret")
                if fret is None:
                    continue

                # Native Songsterr string coordinate
                # 0 is top line, 4 is bottom line
                string_val = note.get("string", 2)
                y_pos = staff_bottom_y + (4 - string_val) * STAFF_LINE_SPACING

                # Separate feet/hands for stem direction
                # Standard convention: bass drum (35, 36) and pedal hi-hat (44) are feet
                if fret in (35, 36, 44):
                    foot_notes.append(y_pos)
                else:
                    hand_notes.append(y_pos)

                is_ghost = note.get("ghost", False)
                is_accent = note.get("accentuated", False)

                self._draw_notehead(x_pos, y_pos, fret, is_ghost, is_accent, velocity, is_grace)

            # Draw stem
            if not is_grace and notes and not all(n.get("rest", False) for n in notes):
                self._draw_stem(x_pos, staff_bottom_y, hand_notes, foot_notes, beat)

    def _draw_notehead(self, x: float, y: float, fret: int,
                       is_ghost: bool, is_accent: bool, velocity: str, is_grace: bool = False):
        """Draw fret number at position (x, y)."""
        c = self.c

        # Set opacity/color based on velocity
        if velocity in ("ppp", "pp", "p"):
            c.setFillColor(HexColor("#888888"))
        elif velocity in ("mp",):
            c.setFillColor(HexColor("#666666"))
        else:
            c.setFillColor(black)

        text = str(fret)
        if is_ghost:
            text = f"({text})"

        font_size = 6 if is_grace else 8
        
        # Clear the background so lines don't strike through the number
        c.setFillColor(white)
        c.rect(x - 2.5 * mm, y - 1.2 * mm, 5 * mm, 2.4 * mm, stroke=0, fill=1)

        # Draw the text
        if velocity in ("ppp", "pp", "p"):
            c.setFillColor(HexColor("#888888"))
        elif velocity in ("mp",):
            c.setFillColor(HexColor("#666666"))
        else:
            c.setFillColor(black)

        c.setFont("Courier-Bold", font_size)
        c.drawCentredString(x, y - font_size * 0.3, text)

        # Accent marker
        if is_accent:
            c.setFillColor(black)
            c.setStrokeColor(black)
            c.setLineWidth(0.6)
            accent_y = y + font_size + 1 * mm
            c.line(x - 1.2 * mm, accent_y + 1.5 * mm, x, accent_y)
            c.line(x, accent_y, x + 1.2 * mm, accent_y + 1.5 * mm)

        # Reset colors
        c.setFillColor(black)
        c.setStrokeColor(black)

    def _draw_stem(self, x: float, staff_bottom_y: float, hand_notes: list, foot_notes: list, beat: dict):
        """Draw note stem. Stems go up for hand notes, down for feet."""
        c = self.c
        c.setStrokeColor(black)
        c.setLineWidth(0.5)

        beat_type = beat.get("type", 4)

        if hand_notes:
            # Find highest hand note position (max Y)
            max_y = max(hand_notes)
            stem_bottom = max_y + 1.5 * mm
            stem_top = stem_bottom + 6 * mm

            c.line(x, stem_bottom, x, stem_top)

            if beat_type >= 8:
                self._draw_flag(x, stem_top, up=True, count=self._flag_count(beat_type))

        if foot_notes:
            # Find lowest foot note position (min Y)
            min_y = min(foot_notes)
            stem_top = min_y - 1.5 * mm
            stem_bottom = stem_top - 6 * mm

            c.line(x, stem_top, x, stem_bottom)

            if beat_type >= 8:
                self._draw_flag(x, stem_bottom, up=False, count=self._flag_count(beat_type))

    def _flag_count(self, beat_type: int) -> int:
        """Number of flags for a given beat type."""
        flags = {8: 1, 16: 2, 32: 3, 64: 4}
        return flags.get(beat_type, 0)

    def _draw_flag(self, x: float, y: float, up: bool, count: int):
        """Draw flag(s) on a stem."""
        c = self.c
        c.setLineWidth(0.6)

        for i in range(count):
            offset = i * 2 * mm
            if up:
                fy = y - offset
                c.line(x, fy, x + 3 * mm, fy - 2.5 * mm)
            else:
                fy = y + offset
                c.line(x, fy, x + 3 * mm, fy + 2.5 * mm)


def render_drum_pdf(track_data: dict, output_path: str,
                    artist: str = "Unknown", title: str = "Unknown") -> str:
    """
    Convenience function to render a drum track JSON to PDF.

    Args:
        track_data: Songsterr drum track JSON dict
        output_path: Where to save the PDF
        artist: Artist name for the header
        title: Song title for the header

    Returns:
        Path to the generated PDF
    """
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)

    renderer = DrumPDFRenderer(output_path, artist, title)
    return renderer.render(track_data)
