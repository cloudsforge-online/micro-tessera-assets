#!/usr/bin/env python3
"""Build labelled contact sheets into review/, so the set can be judged as a set.

`verify.py` measures what is measurable. What it cannot measure is what this set lives or dies by:
whether 96 seed objects read as one household's furniture, whether the eight wards read as eight
PLACES rather than eight palettes, and whether 140 sprites agree about the 2:1 dimetric projection
they were all asked for. Those are COMPARISON.md's criteria 1b, 2 and 4, they are style questions
the eye answers in one glance across a grid, and they cannot be answered one file at a time.

**Two sheet kinds, because this repository has two questions.**

  `python3 sheet.py`        one page per set — the ordinary contact sheet.
  `python3 sheet.py --field` the TILE FIELD: each ward's twelve derived tiles laid edge to edge on
                             the dimetric grid they are actually used on.

The field sheet exists because COMPARISON.md criterion 3 says terrain tiles are "judged as a FIELD
of them, never as one", and it is the only view in which the thing that matters is visible: a seam,
a repeat, or a plate that came back as a landscape and put a horizon line through the ground.
A per-tile contact sheet shows twelve pretty diamonds and hides all three.

Sheets land in review/, which is gitignored: they are scaffolding for a judgement, not artefacts.

    python3 sheet.py                       # every set, reference provider
    python3 sheet.py --provider flux-2-pro
    python3 sheet.py objects               # only this set
    python3 sheet.py --field               # the tile fields
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

import providers

HERE = Path(__file__).resolve().parent
# Sheets land in review/<provider-id>/ so two models' sets cannot overwrite each other's
# scaffolding. Set once by main(); every builder below reads it rather than taking another
# parameter, because the two game repositories' builders have different signatures and threading a
# provider through both would be a bigger change than the feature is worth.
PROVIDER = providers.reference()
REVIEW = HERE / "review"


def review_dir() -> Path:
    out = REVIEW / PROVIDER.id
    out.mkdir(parents=True, exist_ok=True)
    return out

# Tile width per set, and how many across. Wide sets get fewer columns so lettering and
# silhouette detail stay legible at review size.
LAYOUT = {
    "terrain": (240, 4),
    "objects": (200, 8),
    "structure": (210, 6),
    "avatar": (150, 8),
    "backdrop": (600, 2),
    "kiln": (240, 4),
    "glyphs": (170, 6),
    "icons": (170, 4),
    "markers": (210, 6),
    "keyart": (760, 2),
    "chrome": (380, 3),
    "splashes": (500, 3),
}

PAD = 12
LABEL = 26
BACKDROP = (24, 24, 26)
INK = (190, 185, 175)


def font() -> ImageFont.ImageFont:
    try:
        return ImageFont.load_default(size=17)
    except TypeError:
        return ImageFont.load_default()


def build_set(name: str, assets: list[dict]) -> Path | None:
    """One page per set.

    Derivatives are included for `chrome` — the favicons and composites are the whole point of
    reviewing that set, and criterion 3 judges the mark at 16, 32 and 180 px — and excluded
    elsewhere, where they would only repeat their parent. Terrain tiles are derivatives and are
    deliberately NOT shown here: they get the field sheet instead, for the reason in the header.
    """
    chosen = [
        a
        for a in assets
        if a["set"] == name
        and not a["asset"].endswith("-source")
        and not a["asset"].startswith("tiles/")
        and (name == "chrome" or a["derivedFrom"] is None)
    ]
    if not chosen:
        return None
    chosen.sort(key=lambda a: a["asset"])

    tile_width, columns = LAYOUT.get(name, (260, 5))
    heights: list[int] = []
    for a in chosen:
        with Image.open(PROVIDER.root / a["path"]) as image:
            heights.append(round(tile_width * image.size[1] / image.size[0]))
    tile_height = max(heights)

    rows = (len(chosen) + columns - 1) // columns
    sheet = Image.new(
        "RGB",
        (
            columns * tile_width + (columns + 1) * PAD,
            rows * (tile_height + LABEL) + (rows + 1) * PAD,
        ),
        BACKDROP,
    )
    draw = ImageDraw.Draw(sheet)
    typeface = font()

    for index, asset in enumerate(chosen):
        column, row = index % columns, index // columns
        x = PAD + column * (tile_width + PAD)
        y = PAD + row * (tile_height + LABEL + PAD)
        with Image.open(PROVIDER.root / asset["path"]) as image:
            height = round(tile_width * image.size[1] / image.size[0])
            sheet.paste(image.convert("RGB").resize((tile_width, height), Image.LANCZOS), (x, y))
        draw.text((x, y + height + 4), f'{asset["slug"]}  {asset["accent"]}', fill=INK, font=typeface)

    out = review_dir() / f"sheet-{name}.png"
    sheet.save(out, format="PNG")
    return out


#: The dimetric field. Eight columns and six rows of 256x128 diamonds, offset by half a tile on
#: alternate rows, which is how the renderer lays them and therefore the only arrangement in which
#: a seam is visible where it will actually be seen.
FIELD_COLUMNS = 8
FIELD_ROWS = 6


def build_field(ward: str, assets: list[dict]) -> Path | None:
    """One ward's twelve tiles, laid on the grid they are used on. COMPARISON.md criterion 3.

    The tiles are cycled across the field rather than repeated singly, because two failures show
    up only under different neighbours: a seam that matches itself but not its sibling, and a
    `ground-a`/`ground-b` pair cut from one plate that turn out to be visibly the same pixels.
    """
    tiles = [
        a
        for a in assets
        if a["asset"].startswith(f"tiles/{ward}-") and a["derivedFrom"] is not None
    ]
    if not tiles:
        return None
    tiles.sort(key=lambda a: a["asset"])

    tile_w, tile_h = 256, 128
    half_w, half_h = tile_w // 2, tile_h // 2
    width = FIELD_COLUMNS * tile_w + half_w
    height = (FIELD_ROWS + 1) * half_h + tile_h
    field = Image.new("RGB", (width, height + LABEL), BACKDROP)

    loaded = []
    for a in tiles:
        with Image.open(PROVIDER.root / a["path"]) as image:
            loaded.append(image.convert("RGBA"))

    index = 0
    for row in range(FIELD_ROWS * 2):
        # Every other row is offset half a tile — the isometric staggering.
        offset = half_w if row % 2 else 0
        for column in range(FIELD_COLUMNS):
            tile = loaded[index % len(loaded)]
            index += 1
            field.paste(tile, (offset + column * tile_w, row * half_h), tile)

    draw = ImageDraw.Draw(field)
    draw.text(
        (PAD, height + 4),
        f"{ward} — {len(loaded)} tiles cycled across the dimetric grid; look for seams and repeats",
        fill=INK,
        font=font(),
    )
    out = review_dir() / f"field-{ward}.png"
    field.save(out, format="PNG")
    return out


def main(argv: list[str]) -> int:
    global PROVIDER
    parser = argparse.ArgumentParser(description="Contact sheets, one set at a time.")
    providers.add_argument(parser)
    parser.add_argument("--field", action="store_true", help="build the tile field sheets instead")
    parser.add_argument("names", nargs="*")
    args = parser.parse_args(argv)
    chosen = providers.selected(args)
    PROVIDER = chosen[0] if chosen else providers.reference()
    assets = json.loads(PROVIDER.manifest.read_text())["assets"]

    if args.field:
        # Read the ward ids from the content rather than recovering them by string surgery on a
        # slug: `undercroft-path-corner` does not split into a ward and a tile by any rule that
        # also works on `wharf-verge`, and content/wards.json is the thing that knows.
        known = [w["id"] for w in json.loads((HERE / "content" / "wards.json").read_text())["wards"]]
        wards = args.names or known
        for ward in wards:
            built = build_field(ward, assets)
            if built:
                with Image.open(built) as image:
                    print(f"{built.relative_to(HERE)}  {image.size[0]}x{image.size[1]}")
        return 0

    for name in args.names or list(LAYOUT):
        built = build_set(name, assets)
        if built:
            with Image.open(built) as image:
                print(f"{built.relative_to(HERE)}  {image.size[0]}x{image.size[1]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
