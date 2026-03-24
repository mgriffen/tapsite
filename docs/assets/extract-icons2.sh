#!/usr/bin/env bash
# Extract individual icons from tapicons_raw2.png composite sheet
# Source: 2816x1536px, white background, 3 themed columns × 4 rows × 3 variants = 36 icons
set -euo pipefail

SRC="/home/griffen/projects/tapsite/docs/assets/tapicons_raw2.png"
OUT="/home/griffen/projects/tapsite/docs/assets/icons2"

mkdir -p "$OUT"

echo "=== Step 1: Crop all 36 icons ==="

# Grid coordinates (measured via pixel analysis):
#
# Icon center-X positions per column:
#   Industrial: 213, 486, 758
#   Abstract:   1130, 1411, 1688
#   Organic:    2063, 2327, 2602
#
# Row Y ranges:
#   R1: y=255-425 (h=170)
#   R2: y=530-715 (h=185)
#   R3: y=820-1010 (h=190)
#   R4: y=1105-1290 (h=185)
#
# Each icon crop: 210px wide, full row height, centered on icon center-X

# --- Industrial theme (pipe/valve/gauge) ---

# Row 1: Faucet/tap variants
convert "$SRC" -crop 210x170+108+255  +repage "$OUT/industrial-r1-v1.png"
convert "$SRC" -crop 210x170+381+255  +repage "$OUT/industrial-r1-v2.png"
convert "$SRC" -crop 210x170+653+255  +repage "$OUT/industrial-r1-v3.png"

# Row 2: Pipe valve variants
convert "$SRC" -crop 210x185+108+530  +repage "$OUT/industrial-r2-v1.png"
convert "$SRC" -crop 210x185+381+530  +repage "$OUT/industrial-r2-v2.png"
convert "$SRC" -crop 210x185+653+530  +repage "$OUT/industrial-r2-v3.png"

# Row 3: Pressure gauge variants
convert "$SRC" -crop 210x190+108+820  +repage "$OUT/industrial-r3-v1.png"
convert "$SRC" -crop 210x190+381+820  +repage "$OUT/industrial-r3-v2.png"
convert "$SRC" -crop 210x190+653+820  +repage "$OUT/industrial-r3-v3.png"

# Row 4: Industrial meter variants
convert "$SRC" -crop 210x185+108+1105 +repage "$OUT/industrial-r4-v1.png"
convert "$SRC" -crop 210x185+381+1105 +repage "$OUT/industrial-r4-v2.png"
convert "$SRC" -crop 210x185+653+1105 +repage "$OUT/industrial-r4-v3.png"

# --- Abstract theme (network/node/flow) ---

# Row 1: Radial network variants
convert "$SRC" -crop 210x170+1025+255  +repage "$OUT/abstract-r1-v1.png"
convert "$SRC" -crop 210x170+1306+255  +repage "$OUT/abstract-r1-v2.png"
convert "$SRC" -crop 210x170+1583+255  +repage "$OUT/abstract-r1-v3.png"

# Row 2: Square grid network variants
convert "$SRC" -crop 210x185+1025+530  +repage "$OUT/abstract-r2-v1.png"
convert "$SRC" -crop 210x185+1306+530  +repage "$OUT/abstract-r2-v2.png"
convert "$SRC" -crop 210x185+1583+530  +repage "$OUT/abstract-r2-v3.png"

# Row 3: Arrow/flow diagram variants
convert "$SRC" -crop 210x190+1025+820  +repage "$OUT/abstract-r3-v1.png"
convert "$SRC" -crop 210x190+1306+820  +repage "$OUT/abstract-r3-v2.png"
convert "$SRC" -crop 210x190+1583+820  +repage "$OUT/abstract-r3-v3.png"

# Row 4: Connected blocks variants
convert "$SRC" -crop 210x185+1025+1105 +repage "$OUT/abstract-r4-v1.png"
convert "$SRC" -crop 210x185+1306+1105 +repage "$OUT/abstract-r4-v2.png"
convert "$SRC" -crop 210x185+1583+1105 +repage "$OUT/abstract-r4-v3.png"

# --- Organic theme (plant/leaf/root) ---

# Row 1: Tree/seedling variants
convert "$SRC" -crop 210x170+1958+255  +repage "$OUT/organic-r1-v1.png"
convert "$SRC" -crop 210x170+2222+255  +repage "$OUT/organic-r1-v2.png"
convert "$SRC" -crop 210x170+2497+255  +repage "$OUT/organic-r1-v3.png"

# Row 2: Root system variants
convert "$SRC" -crop 210x185+1958+530  +repage "$OUT/organic-r2-v1.png"
convert "$SRC" -crop 210x185+2222+530  +repage "$OUT/organic-r2-v2.png"
convert "$SRC" -crop 210x185+2497+530  +repage "$OUT/organic-r2-v3.png"

# Row 3: Leaf/branch variants
convert "$SRC" -crop 210x190+1958+820  +repage "$OUT/organic-r3-v1.png"
convert "$SRC" -crop 210x190+2222+820  +repage "$OUT/organic-r3-v2.png"
convert "$SRC" -crop 210x190+2497+820  +repage "$OUT/organic-r3-v3.png"

# Row 4: Sprouting seedling variants
convert "$SRC" -crop 210x185+1958+1105 +repage "$OUT/organic-r4-v1.png"
convert "$SRC" -crop 210x185+2222+1105 +repage "$OUT/organic-r4-v2.png"
convert "$SRC" -crop 210x185+2497+1105 +repage "$OUT/organic-r4-v3.png"

echo "  Cropped 36 icons"

# --- Additional assets ---

# Header labels
convert "$SRC" -crop 837x131+0+0      +repage "$OUT/header-industrial.png"
convert "$SRC" -crop 735x131+1040+0   +repage "$OUT/header-abstract.png"
convert "$SRC" -crop 829x131+1987+0   +repage "$OUT/header-organic.png"

# Color legend bar
convert "$SRC" -crop 2816x100+0+1400  +repage "$OUT/color-legend.png"

echo "  Cropped headers and color legend"
ls "$OUT"/ | wc -l
echo "  total files"

echo ""
echo "=== Step 2: Generate web favicon sizes ==="
echo "Skipping auto-generation — review the 36 icons first and pick a primary."
echo "Then run: (example using abstract-r1-v2 as primary)"
echo "  convert \$OUT/abstract-r1-v2.png -gravity center -extent 210x210 -resize 512x512 \$OUT/icon-512.png"
echo "  convert \$OUT/abstract-r1-v2.png -gravity center -extent 210x210 -resize 192x192 \$OUT/icon-192.png"
echo "  convert \$OUT/abstract-r1-v2.png -gravity center -extent 210x210 -resize 180x180 \$OUT/apple-touch-icon.png"
echo "  convert \$OUT/abstract-r1-v2.png -gravity center -extent 210x210 -resize 32x32 \$OUT/favicon-32.png"
echo "  convert \$OUT/abstract-r1-v2.png -gravity center -extent 210x210 -resize 16x16 \$OUT/favicon-16.png"
echo "  convert \$OUT/favicon-32.png \$OUT/favicon-16.png \$OUT/favicon.ico"
echo ""
echo "=== Done ==="
