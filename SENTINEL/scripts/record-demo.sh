#!/usr/bin/env bash
# Record a 90-second demo dry-run video.
# Output: demo-dry-run-<timestamp>.mp4 in the repo root.
#
# Requires ffmpeg. Install:
#   macOS:  brew install ffmpeg
#   Linux:  apt install ffmpeg  /  dnf install ffmpeg
#
# Usage:
#   ./scripts/record-demo.sh              # auto-detect display
#   ./scripts/record-demo.sh --list       # list capture devices
#   DURATION=90 ./scripts/record-demo.sh  # default is 95s (5s buffer)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DURATION="${DURATION:-95}"
OUTFILE="$REPO_ROOT/demo-dry-run-$(date +%Y%m%d-%H%M%S).mp4"

if ! command -v ffmpeg >/dev/null 2>&1; then
    echo "ERROR: ffmpeg not found."
    echo "  macOS:  brew install ffmpeg"
    echo "  Linux:  sudo apt install ffmpeg"
    exit 1
fi

if [[ "${1:-}" == "--list" ]]; then
    case "$(uname)" in
        Darwin) ffmpeg -f avfoundation -list_devices true -i "" 2>&1 | grep -E "^\[|AVFoundation" || true ;;
        Linux)  echo "Available displays: check \$DISPLAY — typically ':0'"; ffmpeg -f x11grab -list_devices true -i "" 2>&1 || true ;;
    esac
    exit 0
fi

echo "Recording ${DURATION}s demo to: $OUTFILE"
echo "Press Ctrl+C to stop early."
echo ""
echo "START the demo in your browser NOW — recording begins in 3 seconds..."
sleep 3

case "$(uname)" in
    Darwin)
        # Capture screen 1 (index 1). Change to 2 if using an external monitor.
        ffmpeg -f avfoundation -framerate 30 -i "1:none" \
            -t "$DURATION" \
            -c:v libx264 -preset fast -crf 23 -pix_fmt yuv420p \
            "$OUTFILE"
        ;;
    Linux)
        DISPLAY="${DISPLAY:-:0}"
        RESOLUTION=$(xdpyinfo 2>/dev/null | awk '/dimensions/{print $2}' || echo "1920x1080")
        ffmpeg -f x11grab -framerate 30 -s "$RESOLUTION" -i "${DISPLAY}.0+0,0" \
            -t "$DURATION" \
            -c:v libx264 -preset fast -crf 23 -pix_fmt yuv420p \
            "$OUTFILE"
        ;;
    *)
        echo "ERROR: Unsupported OS '$(uname)'. Record manually and save as demo-dry-run.mp4."
        exit 1
        ;;
esac

echo ""
echo "✅ Saved: $OUTFILE"
echo "   Copy to public/demo-backup.mp4 to enable the in-browser fallback player."
echo "   cp \"$OUTFILE\" \"$REPO_ROOT/public/demo-backup.mp4\""
