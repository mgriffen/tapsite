#!/usr/bin/env bash
# Extract individual icons from tapicons_raw.png composite sheet
# Source: 2816x1536px, dark navy background, 12 icon cards + 1 sparkle
set -euo pipefail

SRC="/home/griffen/projects/tapsite/docs/assets/tapicons_raw.png"
OUT="/home/griffen/projects/tapsite/docs/assets"

echo "=== Step 1: Crop individual icons from composite ==="

# Row 1 (y≈90–500, tall anemone extends to y≈675)
convert "$SRC" -crop 403x410+92+90   +repage "$OUT/icon-jellyfish.png"
convert "$SRC" -crop 835x410+547+90  +repage "$OUT/icon-eyedropper.png"
convert "$SRC" -crop 669x585+1434+90 +repage "$OUT/icon-anemone.png"     # tall card, primary
convert "$SRC" -crop 403x410+2321+90 +repage "$OUT/icon-dna.png"

# Row 2 (y≈520–930)
convert "$SRC" -crop 403x410+92+520   +repage "$OUT/icon-crystals.png"
convert "$SRC" -crop 835x410+547+520  +repage "$OUT/icon-network.png"
convert "$SRC" -crop 669x310+1434+680 +repage "$OUT/icon-datablocks.png"  # shorter card below anemone
convert "$SRC" -crop 403x410+2321+520 +repage "$OUT/icon-molecular.png"

# Row 3 (y≈1040–1445)
convert "$SRC" -crop 403x405+92+1040   +repage "$OUT/icon-hexagon.png"
convert "$SRC" -crop 835x405+547+1040  +repage "$OUT/icon-worldmap.png"
convert "$SRC" -crop 669x405+1434+1040 +repage "$OUT/icon-target.png"
convert "$SRC" -crop 403x405+2321+1040 +repage "$OUT/icon-server.png"

# Decorative sparkle (bottom-right corner)
convert "$SRC" -crop 140x140+2670+1380 +repage "$OUT/icon-sparkle.png"

echo "  Cropped 13 individual icons"
ls -la "$OUT"/icon-*.png

echo ""
echo "=== Step 2: Generate standard web sizes from primary icon (anemone) ==="
# The anemone (669x585) is the largest/most detailed — crop to square first, then resize down.
# Center-crop to 585x585 square (trim 42px from each side horizontally)
convert "$OUT/icon-anemone.png" -gravity center -crop 585x585+0+0 +repage "$OUT/icon-anemone-square.png"

# Standard web icon sizes (from largest to smallest for best quality)
convert "$OUT/icon-anemone-square.png" -resize 512x512 "$OUT/icon-512.png"
convert "$OUT/icon-anemone-square.png" -resize 192x192 "$OUT/icon-192.png"
convert "$OUT/icon-anemone-square.png" -resize 180x180 "$OUT/apple-touch-icon.png"
convert "$OUT/icon-anemone-square.png" -resize 32x32   "$OUT/favicon-32.png"
convert "$OUT/icon-anemone-square.png" -resize 16x16   "$OUT/favicon-16.png"

# Multi-size .ico (contains 16x16 and 32x32)
convert "$OUT/favicon-32.png" "$OUT/favicon-16.png" "$OUT/favicon.ico"

echo "  Generated web icon sizes:"
ls -la "$OUT"/icon-512.png "$OUT"/icon-192.png "$OUT"/apple-touch-icon.png \
       "$OUT"/favicon-32.png "$OUT"/favicon-16.png "$OUT"/favicon.ico

echo ""
echo "=== Done ==="
echo "Review the cropped icons. If a different icon should be the primary, re-run step 2 with that source."
echo "Note: Crop coordinates are best-estimates. Inspect outputs and adjust +/-10px if edges are clipped."
