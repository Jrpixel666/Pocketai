#!/bin/bash
# Downloads the GGUF model that ships inside the Android APK. The file is too
# large for git, so it is fetched before building instead of committed.
set -euo pipefail

REPO="mradermacher/Llama-3.2-1B-Instruct-abliterated-GGUF"
FILE="Llama-3.2-1B-Instruct-abliterated.Q4_K_M.gguf"
EXPECTED_SIZE=955445792

DEST_DIR="$(cd "$(dirname "$0")/.." && pwd)/android/app/src/main/assets/models"
DEST="$DEST_DIR/$FILE"

mkdir -p "$DEST_DIR"

if [ -f "$DEST" ] && [ "$(stat -c %s "$DEST")" -eq "$EXPECTED_SIZE" ]; then
  echo "Bundled model already present: $DEST"
  exit 0
fi

echo "Downloading $FILE from $REPO..."
curl -L --fail --retry 5 --retry-delay 5 -C - -o "$DEST.part" \
  "https://huggingface.co/$REPO/resolve/main/$FILE"

ACTUAL_SIZE=$(stat -c %s "$DEST.part")
if [ "$ACTUAL_SIZE" -ne "$EXPECTED_SIZE" ]; then
  echo "Size mismatch: got $ACTUAL_SIZE, expected $EXPECTED_SIZE" >&2
  exit 1
fi

mv "$DEST.part" "$DEST"
echo "Bundled model saved to $DEST"
