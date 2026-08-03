#!/usr/bin/env python3
"""Build labelled contact sheets into review/, so the set can be judged as a set.

`verify.py` measures what is measurable. What it cannot measure is what this set lives or dies
by: whether twenty buildings read as one town's architecture, whether ten hulls read as one
fleet at ten scales, whether the twelve islands read as three climates of one world — style
questions the eye answers in one glance across a grid and cannot answer one file at a time —
and whether the wordmark's lettering actually spells Aetherholm.

Sheets land in review/, which is gitignored: they are scaffolding for a judgement, not
artefacts.

    python3 sheet.py             # every set
    python3 sheet.py buildings   # only this set
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
    "islands": (240, 4),
    "buildings": (230, 5),
    "ships": (460, 2),
    "shipicons": (200, 5),
    "icons": (200, 4),
    "heraldry": (230, 4),
    "keyart": (760, 2),
    "splashes": (760, 2),
    "title": (760, 2),
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
    """One page per set. Derivatives are included for `title` (the composites are the point of
    review there) and excluded elsewhere, where they would only repeat their parent."""
    chosen = [
        a
        for a in assets
        if a["set"] == name
        and not a["asset"].endswith("-source")
        and (name == "title" or a["derivedFrom"] is None)
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


def main(argv: list[str]) -> int:
    global PROVIDER
    parser = argparse.ArgumentParser(description="Contact sheets, one set at a time.")
    providers.add_argument(parser)
    parser.add_argument("names", nargs="*")
    args = parser.parse_args(argv)
    chosen = providers.selected(args)
    PROVIDER = chosen[0] if chosen else providers.reference()
    argv = args.names
    assets = json.loads(PROVIDER.manifest.read_text())["assets"]
    wanted = argv or list(LAYOUT)
    for name in wanted:
        built = build_set(name, assets)
        if built:
            with Image.open(built) as image:
                print(f"{built.relative_to(HERE)}  {image.size[0]}x{image.size[1]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
