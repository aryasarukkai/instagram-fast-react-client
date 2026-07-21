#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
APP_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
PROTOCOL_DIR="$APP_DIR/protocol"
TARGET_TRIPLE=$(rustc --print host-tuple)
OUTPUT_DIR="$APP_DIR/src-tauri/binaries"

if [ "$TARGET_TRIPLE" != "aarch64-apple-darwin" ]; then
  echo "The first SpeedGram sidecar milestone currently targets Apple Silicon macOS." >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"
cd "$PROTOCOL_DIR"
uv sync --python 3.12 --group dev
uv run --python 3.12 pyinstaller \
  --clean \
  --noconfirm \
  --onefile \
  --name speedgram-protocol \
  --hidden-import brotli \
  --hidden-import zstandard \
  --distpath "$PROTOCOL_DIR/dist" \
  --workpath "$PROTOCOL_DIR/build" \
  --specpath "$PROTOCOL_DIR/build" \
  "$PROTOCOL_DIR/sidecar.py"
cp "$PROTOCOL_DIR/dist/speedgram-protocol" "$OUTPUT_DIR/speedgram-protocol-$TARGET_TRIPLE"
chmod 700 "$OUTPUT_DIR/speedgram-protocol-$TARGET_TRIPLE"
echo "Built $OUTPUT_DIR/speedgram-protocol-$TARGET_TRIPLE"
