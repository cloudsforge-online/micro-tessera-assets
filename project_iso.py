#!/usr/bin/env python3
"""Cut 96 isometric terrain tiles out of 32 flat material plates, and report their provenance.

**Why the tiles are derived and the plates are generated.** doc 23 §2.4 states it: diffusion
cannot hold an isometric seam. Ask a model for a 256x128 tile that abuts its own copy on four
edges and it will produce something that looks right in isolation and shows a visible join the
moment two of them touch — and it will do it 96 times, differently. So the seam is not asked for.
It is PRODUCED here, from a plate that never had to tile in the first place.

Three steps per tile:

  1. **Cut** a square region out of the plate at the (x, y) centre `content/wards.json` declares
     for that tile. `ground-a` and `ground-b` are cut from DIFFERENT REGIONS OF THE SAME PLATE,
     which is where painterly earns its keep (§2.5): two cuts of one painting agree with each
     other, and two vector tiles would not.
  2. **Make the cut seamless in itself** by an offset cross-fade — the region is rolled by half
     its width and height and blended across the join with a cosine ramp, so the tile's own
     opposite edges match and a field of them has no repeating hard line.
  3. **Project** to 2:1 dimetric: rotate the square 45 degrees, squash the vertical axis by half,
     and take the 256x128 diamond. Everything outside the diamond is alpha 0, so a tile drops onto
     the grid with no rectangular corners showing.

The diamond mask is computed with a one-pixel antialiased edge. A hard-edged mask leaves a stepped
saw-tooth along every tile boundary that is invisible on one tile and unmistakable on a field of
them, which is the same class of error as the seam and is worth the four extra lines.

Pillow, not macOS `sips` — design-system.md §7 item 3 names `sips` as the reason the estate's
resize stage once existed on exactly one laptop.

**A tile is re-encoded by Pillow, so it does not carry the plate's C2PA chunk.** The invisible
pixel watermark survives; the signed box does not. `c2pa` below is MEASURED on the bytes written
rather than inherited, which is the rule `micro-emberkin-assets/verify.py` has no check for and
this repository's verify.py does.

    python3 project_iso.py --provider flux-2-pro
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image

import providers

HERE = Path(__file__).resolve().parent
CONTENT = HERE / "content"

C2PA_MARKER = b"c2pa"

#: doc 23 §2.1. The base ground tile, and the only size in set 2.
TILE = (256, 128)

#: The square cut out of the 1024 plate before projection. Rotating a square by 45 degrees needs
#: sqrt(2) of its own width to stay inside the frame, so a 362-pixel cut fills a 256-wide diamond
#: with nothing to spare and no upscaling anywhere in the chain.
CUT = 362

#: The set every tile is filed under. Tiles are terrain; they are set 2 of the same family.
SET = "terrain"

# The root every emitted path is relative to. Set once by main().
ROOT = HERE


def digest(path: Path) -> tuple[str, int, bool]:
    data = path.read_bytes()
    return hashlib.sha256(data).hexdigest(), len(data), C2PA_MARKER in data


def cut_region(plate: Image.Image, centre: tuple[float, float]) -> Image.Image:
    """A CUT-square region of the plate, centred on the normalised point the content declares."""
    width, height = plate.size
    half = CUT // 2
    x = min(max(int(centre[0] * width), half), width - half)
    y = min(max(int(centre[1] * height), half), height - half)
    return plate.crop((x - half, y - half, x + half, y + half))


def make_seamless(region: Image.Image) -> Image.Image:
    """Offset by half, then cross-fade the seam that the offset brings into the middle.

    The standard offset trick moves a tile's four outer edges into its centre, where they can be
    blended away. The blend is a cosine ramp rather than a linear one because a linear cross-fade
    leaves a visible soft band of its own — the derivative of the blend is discontinuous at both
    ends of it, and the eye finds that as reliably as it finds a hard seam.
    """
    size = region.size[0]
    half = size // 2
    rolled = Image.new("RGB", region.size)
    rolled.paste(region.crop((half, half, size, size)), (0, 0))
    rolled.paste(region.crop((0, half, half, size)), (size - half, 0))
    rolled.paste(region.crop((half, 0, size, half)), (0, size - half))
    rolled.paste(region.crop((0, 0, half, half)), (size - half, size - half))

    band = max(8, size // 8)
    original = region.load()
    out = rolled.copy()
    pixels = out.load()
    for offset in range(band):
        # Cosine ramp from 0 at the seam's outer limit to 1 at the seam itself.
        weight = 0.5 * (1 - math.cos(math.pi * (band - offset) / band)) * 0.5
        for axis in (0, 1):
            for other in range(size):
                for side in (half - offset - 1, half + offset):
                    if not 0 <= side < size:
                        continue
                    x, y = (side, other) if axis == 0 else (other, side)
                    src = original[(x + half) % size, (y + half) % size]
                    dst = pixels[x, y]
                    pixels[x, y] = tuple(
                        int(round(dst[i] + (src[i] - dst[i]) * weight)) for i in range(3)
                    )
    return out


def project(region: Image.Image) -> Image.Image:
    """Rotate 45 degrees, squash by half, mask to the diamond. 2:1 dimetric, doc 23 §2.1."""
    rotated = region.convert("RGBA").rotate(45, resample=Image.BICUBIC, expand=True)
    side = rotated.size[0]
    squashed = rotated.resize((side, side // 2), Image.LANCZOS)
    # Centre-crop to the tile. The rotated square's inscribed diamond is exactly the tile.
    left = (squashed.size[0] - TILE[0]) // 2
    top = (squashed.size[1] - TILE[1]) // 2
    tile = squashed.crop((left, top, left + TILE[0], top + TILE[1])).convert("RGBA")

    # The antialiased diamond mask. |x|/w + |y|/h <= 0.5 is the diamond; the one-pixel ramp on
    # either side of that boundary is what keeps a field of tiles from showing a saw-tooth join.
    mask = Image.new("L", TILE, 0)
    draw = mask.load()
    half_w, half_h = TILE[0] / 2, TILE[1] / 2
    feather = 1.0 / half_h
    for y in range(TILE[1]):
        dy = abs(y + 0.5 - half_h) / half_h
        for x in range(TILE[0]):
            dx = abs(x + 0.5 - half_w) / half_w
            edge = dx + dy
            if edge <= 1.0 - feather:
                draw[x, y] = 255
            elif edge >= 1.0 + feather:
                draw[x, y] = 0
            else:
                draw[x, y] = int(round(255 * (1.0 + feather - edge) / (2 * feather)))
    tile.putalpha(mask)
    return tile


def entry(parent: dict, *, key: str, slug: str, name: str, path: Path, source: Path, how: str) -> dict:
    sha, size, c2pa = digest(path)
    with Image.open(path) as image:
        delivered = image.size
    return {
        "provider": parent["provider"],
        "asset": key,
        "set": SET,
        "slug": slug,
        "name": name,
        "path": str(path.relative_to(ROOT)),
        "accent": parent["accent"],
        "secondaryAccent": parent["secondaryAccent"],
        # A tile is a cut of a plate and carries the plate's ground class: it is a material, and
        # neither the flat-ground rule nor the scene darkness ceiling applies to it.
        "groundClass": "plate",
        "declaredSize": f"{TILE[0]}x{TILE[1]}",
        "requestedSize": parent["requestedSize"],
        "deliveredSize": f"{delivered[0]}x{delivered[1]}",
        "sizing": "exact" if tuple(delivered) == TILE else "unsized",
        "cropped": True,
        "derivedFrom": parent["path"],
        "backend": parent["backend"],
        "model": parent["model"],
        "prompt": parent["prompt"],
        "seed": parent["seed"],
        "sha256": sha,
        "byteSize": size,
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        # Measured, never inherited: Pillow's writer drops the plate's C2PA box.
        "c2pa": c2pa,
        "retries": parent["retries"],
        "licence": parent["licence"],
        "providerCostUnits": parent["providerCostUnits"],
        "providerOutputMegapixels": parent["providerOutputMegapixels"],
        "sourceSpec": "docs/ecosystem/23-tessera.md §2.5; content/wards.json",
        "postProcessing": list(parent.get("postProcessing", []))
        + ["cut, made seamless and projected to 2:1 dimetric by project_iso.py"],
        "deliveredGround": parent.get("deliveredGround"),
        "footprint": None,
        "attempts": parent["attempts"],
        "note": how,
    }


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Project this set's terrain tiles.")
    parser.add_argument("--provider", default=None, help="provider id from providers.json")
    args = parser.parse_args(argv[1:])
    provider = providers.by_id(args.provider) if args.provider else providers.reference()

    global ROOT
    ROOT = provider.root
    if not provider.manifest.exists():
        # A candidate with nothing generated yet is not an error. It is the normal state of a
        # candidate set until its endpoint serves.
        json.dump([], sys.stdout)
        return 0

    wards = json.loads((CONTENT / "wards.json").read_text())
    parents = {a["asset"]: a for a in json.loads(provider.manifest.read_text()).get("assets", [])}
    out: list[dict] = []

    for ward in wards["wards"]:
        for tile in wards["tiles"]:
            source_spec = wards["tileSources"][tile]
            parent_key = f'terrain/{ward["id"]}-{source_spec["from"]}'
            parent = parents.get(parent_key)
            if not parent:
                continue
            plate_path = provider.root / parent["path"]
            if not plate_path.exists():
                continue

            target_dir = provider.assets / "tiles"
            target_dir.mkdir(parents=True, exist_ok=True)
            target = target_dir / f'{ward["id"]}-{tile}-{TILE[0]}x{TILE[1]}.png'

            with Image.open(plate_path) as raw:
                plate = raw.convert("RGB")
                region = make_seamless(cut_region(plate, tuple(source_spec["region"])))
                project(region).save(target, format="PNG", optimize=True)

            out.append(
                entry(
                    parent,
                    key=f'tiles/{ward["id"]}-{tile}',
                    slug=f'{ward["id"]}-{tile}',
                    name=f'{ward["name"]} — {tile}',
                    path=target,
                    source=plate_path,
                    how=(
                        f'Cut at ({source_spec["region"][0]}, {source_spec["region"][1]}) of the '
                        f'{ward["id"]} {source_spec["from"]} plate, offset cross-faded so the cut '
                        "is seamless against itself, then rotated 45 degrees, squashed 2:1 and "
                        "masked to the dimetric diamond with an antialiased edge. Derived rather "
                        "than generated because diffusion cannot hold an isometric seam "
                        "(doc 23 §2.4); ground-a and ground-b come from different regions of one "
                        "plate, which is how the ground varies without a second generation. "
                        "Re-encoding drops the C2PA chunk; the plate is kept beside this file."
                    ),
                )
            )

    json.dump(out, sys.stdout)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
