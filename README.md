# Songsterr Drum Tab Downloader

A lightweight, dependency-minimal tool that downloads drum tablature from Songsterr. It parses the raw track data and converts it into professional **MusicXML** notation, with built-in high-fidelity PDF rendering.

## Features
- **Clean UI**: Modern, dark-themed web interface built with Flask and TailwindCSS.
- **Search & Direct URL**: Find songs directly via search or paste a Songsterr URL.
- **Direct API Extraction:** Fetches raw JSON data directly from Songsterr's backend.
- **MusicXML Generation:** Precisely translates timing, steps, octaves, and noteheads (standard, crosses, diamonds, etc.) into perfect `.musicxml` files.
- **Interactive Visual Mapping:** Easily configure global or custom drum mappings via a gorgeous drag-and-drop SVG staff interface.
- **In-Browser Sheet Music Rendering:** Instantly previews the downloaded drum tab inside the browser using OpenSheetMusicDisplay (OSMD).
- **Native PDF Export:** Generates high-resolution PDF sheet music directly in the browser via jsPDF, ensuring perfect notation alignment without needing external software.
- **Custom PDF Styling:** Adjust page format (A4/Letter, Portrait/Landscape), zoom scale, and toggle headers/measure numbers to perfectly format your exported sheet music.
- **Local Library History:** Automatically tracks and caches your download history in the browser for instant one-click reloading.
- **Batch Processing:** Paste a list of URLs to sequentially download multiple tabs automatically.
- **BPM Override:** Set a custom tempo for playback and notation directly from the settings panel.

---

## Deployment (Recommended: Docker)

If you are running this on a server, deploying with Docker is the easiest method. The provided `docker-compose.yml` is configured to automatically start the server when your machine restarts.

1. **Clone or download** this repository to your server.
2. **Open a terminal** in the project directory.
3. **Start the container in the background**:
   ```bash
   docker compose up -d
   ```
4. Access the web interface at `http://<YOUR_SERVER_IP>:5000`.

To view the server logs at any time, run `docker compose logs -f`.

## Local Setup (Without Docker)

### Prerequisites
1. **Python**: Python 3.11+ is recommended.

### Setup Instructions
1. **Clone or download** this repository.
2. **Open a terminal** in the project directory.
3. **Install the dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

### How to Run
1. Start the Flask server:
   ```bash
   python app.py
   ```
2. Open your web browser and navigate to:
   ```
   http://127.0.0.1:5000
   ```

## Legal Notice
This tool is intended strictly for **personal use, practice, and learning**. Songsterr's Terms of Service restrict automated access to their platform. Do not use this tool to mass-scrape or distribute copyrighted tablature.
