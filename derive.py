#!/usr/bin/env python3
"""Cut and composite the eight title derivatives, and report their provenance as JSON.

The 96 terrain tiles are the other 96 derivatives and they live in `project_iso.py`, because
projecting a material plate into a dimetric diamond has nothing in common with cropping a card.

Eight here, each existing because of a measured fact rather than a preference:

  * **`keyart/og-1200x630`, cropped from `keyart/wide`.** 1200x630 is a platform requirement and
    630 is not a multiple of 16, which FLUX floors to (`studio/src/specs.ts:126-133`). doc 23 §2.1
    is explicit that sizes off the grid are DERIVED by cropping a compliant generation and never
    requested — so the card is cut from the 2048x768 wide art rather than asked for.
  * **`keyart/social-wide` 1600x900, cut from `keyart/hero`.** Same 16:9 ratio as the 2048x1152
    hero, so this is a straight Lanczos downscale with no crop and no invented pixel.
  * **Four chrome sizes resampled from the mark** — 512, 192, 180 and 32. The brand run generated
    favicons and five of fourteen came back as the mark plus a smaller framed copy of itself
    ("draw it simpler" is read as "show both"); the Emberkin run then cut its favicons from the
    mark with Lanczos and measured the grounds still exactly #12100f afterwards. A favicon is a
    downscale of a mark, so here it simply is one — four files, zero generations, no failure class.
  * **`chrome/og-title` and `chrome/wordmark-lockup`, composited from the mark.** doc 23 §2.14
    files both under "derived from the mark".

**NO GENERATED LETTERING ANYWHERE IN THIS REPOSITORY.** doc 23 §2.14 lists `keyart/wordmark-ground`
— a ground FOR a wordmark — and no wordmark. The brand run measured FLUX rendering a wordmark as
"Home on the Ridge", so type is set over a generated ground rather than asked of a diffusion
model. That has a consequence the comparison must state rather than bury, and COMPARISON.md §4
states it: the one criterion Qwen previously won outright is not exercised by this set.

**A derivative is re-encoded by Pillow, so it loses the PNG's C2PA chunk.** The invisible pixel
watermark survives; the signed box does not. Every source file is kept beside its derivative and
`c2pa` below is MEASURED on the bytes written rather than inherited.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, ImageChops

import providers

HERE = Path(__file__).resolve().parent

# The provider root every emitted path is relative to. Set once by main(); a module-level name
# rather than another parameter threaded through builders. Keeping `assets/...` identical in every
# manifest is what lets compare.py line the same asset up across models without parsing a path.
ROOT = HERE

GROUND = (0x12, 0x10, 0x0F)
C2PA_MARKER = b"c2pa"

OG_DECLARED = (1200, 630)
SOCIAL_WIDE = (1600, 900)
LOCKUP = (1536, 512)


def digest(path: Path) -> tuple[str, int, bool]:
    data = path.read_bytes()
    return hashlib.sha256(data).hexdigest(), len(data), C2PA_MARKER in data


def entry(parent: dict, *, asset: str, slug: str, path: Path, declared: tuple[int, int],
          source: Path, cropped: bool, steps: list[str], note: str,
          ground_class: str | None = None) -> dict:
    """One derivative's provenance, inheriting the parent's generation facts.

    `ground_class` overrides the parent's, and exactly one derivative needs it. `wordmark-lockup`
    is the mark composited onto `keyart/wordmark-ground`, which is a SCENE — so it inherits
    `flat` from the mark and is then measured against the exact-#12100f corner rule, which it
    cannot pass because its background is a painting. verify.py caught that as 308 of 309 corner
    colours being wrong; the file was correct and its manifest entry was not.
    """
    sha, size, c2pa = digest(path)
    with Image.open(path) as image:
        delivered = image.size
    return {
        "provider": parent["provider"],
        "asset": asset,
        "set": parent["set"],
        "slug": slug,
        "name": slug,
        "path": str(path.relative_to(ROOT)),
        "accent": parent["accent"],
        "secondaryAccent": parent["secondaryAccent"],
        "groundClass": ground_class or parent["groundClass"],
        "declaredSize": f"{declared[0]}x{declared[1]}",
        "requestedSize": parent["requestedSize"],
        "deliveredSize": f"{delivered[0]}x{delivered[1]}",
        "sizing": "exact" if tuple(delivered) == declared else "unsized",
        "cropped": cropped,
        "derivedFrom": str(source.relative_to(ROOT)),
        "backend": parent["backend"],
        "model": parent["model"],
        "prompt": parent["prompt"],
        "seed": parent["seed"],
        "sha256": sha,
        "byteSize": size,
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "c2pa": c2pa,
        "retries": parent["retries"],
        "licence": parent["licence"],
        "providerCostUnits": parent["providerCostUnits"],
        "providerOutputMegapixels": parent["providerOutputMegapixels"],
        "sourceSpec": parent["sourceSpec"],
        "postProcessing": list(parent.get("postProcessing", [])) + steps,
        "deliveredGround": parent.get("deliveredGround"),
        "footprint": None,
        "attempts": parent["attempts"],
        "note": note,
    }


def centre_crop(image: Image.Image, ratio: tuple[int, int]) -> Image.Image:
    """The largest centred rectangle of the given aspect ratio. No pixel is invented."""
    width, height = image.size
    want = ratio[0] / ratio[1]
    have = width / height
    if have > want:
        new_width = int(round(height * want))
        left = (width - new_width) // 2
        return image.crop((left, 0, left + new_width, height))
    new_height = int(round(width / want))
    top = (height - new_height) // 2
    return image.crop((0, top, width, top + new_height))


def snap_ground(image: Image.Image, band: int | None = None) -> Image.Image:
    """Anything within a short distance of the brand ground IS the brand ground.

    Lanczos rings at hard edges, and at 32 pixels that ringing moved the sibling runs' corners one
    value off the exact ground the verifier demands. Optionally also mattes the four corner
    squares, which is what the verifier's corner patch actually samples — a FULL frame matte at a
    32-pixel tile's patch depth is the whole image, and the first attempt at this repair in the
    Aetherholm run blanked the favicon.
    """
    rgb = image.convert("RGB")
    pixels = rgb.load()
    width, height = rgb.size
    for y in range(height):
        for x in range(width):
            r, g, b = pixels[x, y]
            if (r - GROUND[0]) ** 2 + (g - GROUND[1]) ** 2 + (b - GROUND[2]) ** 2 <= 400:
                pixels[x, y] = GROUND
            elif band and min(x, width - 1 - x) < band and min(y, height - 1 - y) < band:
                pixels[x, y] = GROUND
    return rgb


def ink_mask(layer: Image.Image) -> Image.Image:
    """An alpha mask cut from each pixel's distance to the flat ground.

    Pasting a rectangle of flat-ground artwork onto a scene whose darks run darker than #12100f
    prints a faint lighter box around it. Each pixel's opacity is instead its largest channel
    distance from the ground, scaled hard — ground pixels vanish, artwork arrives whole, and
    anti-aliased edges keep a soft foot.
    """
    bands = [
        ImageChops.difference(channel, Image.new("L", layer.size, level))
        for channel, level in zip(layer.convert("RGB").split(), GROUND)
    ]
    mask = ImageChops.lighter(ImageChops.lighter(bands[0], bands[1]), bands[2])
    return mask.point(lambda v: min(255, v * 6))


def ink_box(image: Image.Image) -> tuple[int, int, int, int]:
    """The bounding box of everything that is not the flat ground."""
    rgb = image.convert("RGB")
    pixels = rgb.load()
    width, height = rgb.size
    min_x, min_y, max_x, max_y = width, height, 0, 0
    for y in range(0, height, 2):
        for x in range(0, width, 2):
            r, g, b = pixels[x, y]
            if (r - GROUND[0]) ** 2 + (g - GROUND[1]) ** 2 + (b - GROUND[2]) ** 2 > 40 * 40:
                min_x, min_y = min(min_x, x), min(min_y, y)
                max_x, max_y = max(max_x, x), max(max_y, y)
    if max_x <= min_x or max_y <= min_y:
        return (0, 0, width, height)
    return (min_x, min_y, max_x, max_y)


def resample_one(source: Path, target: Path, size: tuple[int, int]) -> dict:
    """Lanczos one file down to one size and report what the result measures. Nothing else.

    ## Why this mode exists, and why it is here rather than in generate.ts

    Some endpoints refuse to generate at a size this set declares. gpt-image-2 has a minimum pixel
    budget — measured, by bisection in the sibling repositories, to sit in (524288, 655360] — and
    TWO HUNDRED AND TWENTY-NINE of this set's 288 generations fall under it:

        512x512  → x2   → 1024x1024   132 assets: 96 seed objects, 24 structures, 12 markers
        256x512  → x2.5 →  640x1280    48 assets: the avatar plates and overlays
        256x256  → x3.5 →   896x896    40 assets: 24 glyphs, 16 economy icons
        768x768  → x1.5 → 1152x1152     8 assets: the kiln sheets
       1024x512  → x1.5 → 1536x768      1 asset:  the wide chrome mark

    Each is generated at the smallest exact-aspect multiple on the 16-grid that clears the budget
    and cut DOWN to the declared size. That is 80% of the set rather than a corner of it — the
    worst ratio in the estate, and the reason this mode is more load-bearing here than in any
    sibling.

    **AND IT INTERACTS WITH THIS TITLE'S ONE UNREPAIRABLE FAILURE, WHICH IS WHY THE DIRECTION
    MATTERS.** doc 23 §2.1 fixes 2:1 dimetric isometric and COMPARISON.md §1b calls a sprite drawn
    in the wrong projection *unusable* rather than merely worse. A Lanczos DOWNSCALE is an affine
    operation on an existing grid: it cannot move a vanishing point or change a viewing height, so
    a plate that came back in projection is still in projection at 512. An upscale would invent the
    edges the projection is read off. That is why nothing here ever enlarges, and why verify.py's
    `check_native` treats a native smaller than its declared size as a failure rather than a note.

    The pixels have to move in Pillow, for the same reason every other resample in this file does:
    `studio/src/sizing.ts` measures and deliberately does not resample, because doing it in pure
    TypeScript is a PNG decoder, a filter reconstructor, a resampler and an encoder, and doing it
    with `sharp` is a native dependency in a repository that has none. And Pillow rather than macOS
    `sips` — design-system.md §7 item 3 names `sips` as the reason the estate's post-processing
    stage exists on exactly one laptop.

    It is in THIS file rather than in a new shared module because `derive.py` is already the
    per-repository Pillow tool. A new `resample.py` would be a fourth file to keep in step across
    four repositories to avoid a thirty-line function.

    **No ground snap here, unlike the chrome sizes above**, and the difference is deliberate. That
    repair exists because a chrome mark is cut to 32 pixels, where Lanczos ringing moves a corner
    off the exact ground and the verifier's corner patch is a quarter of the picture. This mode's
    smallest output is 256 and its typical one is 512, where neither applies — and more to the
    point, this file is the model's own delivery on its way to becoming the asset, not a derivative
    of an asset that already passed. Repairing it here would repair the very thing the comparison
    is trying to measure: whether THIS MODEL puts the ground where the brief says. The ground
    repair belongs where it already is, in normalise_ground.py, which runs afterwards, over every
    set alike, and RECORDS what it changed in `deliveredGround`.

    **This mode never touches the manifest**, on purpose. The caller has the prompt, the model, the
    attempts and the retry count; this has one source file, one target and one size, so it cannot
    corrupt a record it does not read.
    """
    with Image.open(source) as image:
        # RGBA before resizing: a palette image resampled in its own mode gives Lanczos nothing to
        # interpolate between and comes back with the same stair-stepping the downscale was for.
        resized = image.convert("RGBA").resize(size, Image.LANCZOS)
        target.parent.mkdir(parents=True, exist_ok=True)
        resized.save(target, format="PNG", optimize=True)
    sha, byte_size, c2pa = digest(target)
    with Image.open(target) as written:
        measured = written.size
    return {
        "sha256": sha,
        "byteSize": byte_size,
        # Measured on the bytes written, never inherited from the source. Re-encoding drops the
        # C2PA chunk, so this is expected to be False even where the native carried one — and it is
        # reported rather than assumed, because assuming it is the defect this estate shipped once.
        "c2pa": c2pa,
        # The caller REFUSES the file if this is not what it asked for. Reported from the file on
        # disk rather than echoed from the argument, so the check is on the bytes.
        "size": f"{measured[0]}x{measured[1]}",
    }


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Rebuild this set's title derivatives.")
    parser.add_argument("--provider", default=None, help="provider id from providers.json")
    parser.add_argument(
        "--resample",
        nargs=3,
        metavar=("SOURCE", "TARGET", "WxH"),
        default=None,
        help="Lanczos SOURCE down to WxH at TARGET and print the result as JSON. Used by "
        "generate.ts for a provider that refuses to generate at a declared size.",
    )
    args = parser.parse_args(argv[1:])

    if args.resample:
        source, target, wanted = args.resample
        width, height = (int(n) for n in wanted.split("x"))
        json.dump(resample_one(Path(source), Path(target), (width, height)), sys.stdout)
        return 0

    provider = providers.by_id(args.provider) if args.provider else providers.reference()

    global ROOT
    ROOT = provider.root
    if not provider.manifest.exists():
        json.dump([], sys.stdout)
        return 0

    assets = provider.assets
    parents = {a["asset"]: a for a in json.loads(provider.manifest.read_text()).get("assets", [])}
    out: list[dict] = []

    # ---- the OG card: cut from the wide key art. 630 is off the 16-pixel grid, so it is never asked for.
    wide = assets / "keyart" / "wide-2048x768.png"
    wide_parent = parents.get("keyart/wide")
    if wide.exists() and wide_parent:
        target = assets / "keyart" / f"og-{OG_DECLARED[0]}x{OG_DECLARED[1]}.png"
        with Image.open(wide) as raw:
            card = centre_crop(raw.convert("RGB"), OG_DECLARED)
            card.resize(OG_DECLARED, Image.LANCZOS).save(target, format="PNG", optimize=True)
        out.append(
            entry(
                wide_parent,
                asset="keyart/og-1200x630",
                slug="og-1200x630",
                path=target,
                declared=OG_DECLARED,
                source=wide,
                cropped=True,
                steps=["centre-cropped and resampled by derive.py"],
                note=(
                    "Centre-cropped from the 2048x768 wide key art to 1200:630 and resampled. "
                    "Derived rather than generated because 630 is not a multiple of 16 and FLUX "
                    "floors delivered dimensions to 16 — doc 23 §2.1 requires off-grid sizes to "
                    "be cropped from a compliant generation. Re-encoding drops the C2PA chunk; "
                    "the source is kept beside this file."
                ),
            )
        )

    # ---- the social wide card: same ratio as the hero, so a straight downscale.
    hero = assets / "keyart" / "hero-2048x1152.png"
    hero_parent = parents.get("keyart/hero")
    if hero.exists() and hero_parent:
        target = assets / "keyart" / f"social-wide-{SOCIAL_WIDE[0]}x{SOCIAL_WIDE[1]}.png"
        with Image.open(hero) as raw:
            raw.convert("RGB").resize(SOCIAL_WIDE, Image.LANCZOS).save(
                target, format="PNG", optimize=True
            )
        out.append(
            entry(
                hero_parent,
                asset="keyart/social-wide",
                slug="social-wide",
                path=target,
                declared=SOCIAL_WIDE,
                source=hero,
                cropped=False,
                steps=["resampled by derive.py"],
                note=(
                    "Lanczos downscale of the 2048x1152 hero. Both are 16:9, so nothing is "
                    "cropped and no pixel is invented. Re-encoding drops the C2PA chunk."
                ),
            )
        )

    # ---- four chrome sizes, Lanczos-cut from the 1024 mark.
    mark = assets / "chrome" / "mark-1024x1024.png"
    mark_parent = parents.get("chrome/mark")
    if mark.exists() and mark_parent:
        with Image.open(mark) as raw:
            source = raw.convert("RGB")
            for slug, edge in (
                ("favicon-512", 512),
                ("favicon-192", 192),
                ("apple-touch-180", 180),
                ("favicon-32", 32),
            ):
                target = assets / "chrome" / f"{slug}-{edge}x{edge}.png"
                # CORNER squares only, not a frame — see snap_ground's header.
                cut = snap_ground(source.resize((edge, edge), Image.LANCZOS), band=max(8, edge // 24) + 1)
                cut.save(target, format="PNG", optimize=True)
                out.append(
                    entry(
                        mark_parent,
                        asset=f"chrome/{slug}",
                        slug=slug,
                        path=target,
                        declared=(edge, edge),
                        source=mark,
                        cropped=False,
                        steps=["resampled by derive.py"],
                        note=(
                            f"Lanczos downscale of the 1024 mark to {edge}. Derived rather than "
                            "generated: the brand run measured five of fourteen generated "
                            "favicons arriving as the mark plus a framed copy of itself. "
                            "Re-encoding drops the C2PA chunk; the mark is kept beside this file."
                        ),
                    )
                )

        # ---- og-title: the mark on the brand ground at 1200x630.
        target = assets / "chrome" / f"og-title-{OG_DECLARED[0]}x{OG_DECLARED[1]}.png"
        card = Image.new("RGB", OG_DECLARED, GROUND)
        with Image.open(mark) as raw:
            box = ink_box(raw.convert("RGB"))
            trimmed = raw.convert("RGB").crop(box)
            scale = int(OG_DECLARED[1] * 0.62)
            height = round(scale * trimmed.size[1] / trimmed.size[0])
            layer = trimmed.resize((scale, height), Image.LANCZOS)
            card.paste(
                layer,
                ((OG_DECLARED[0] - scale) // 2, (OG_DECLARED[1] - height) // 2),
                ink_mask(layer),
            )
        card.save(target, format="PNG", optimize=True)
        out.append(
            entry(
                mark_parent,
                asset="chrome/og-title",
                slug="og-title",
                path=target,
                declared=OG_DECLARED,
                source=mark,
                cropped=True,
                steps=["composited by derive.py"],
                note=(
                    "The mark trimmed to its ink bounding box, scaled and centred on the flat "
                    "#12100f ground at 1200x630 — the size a scraper rejects anything else for, "
                    "and one that is off the 16-pixel grid so it is composited rather than "
                    "requested. No lettering: this set generates none, doc 23 §2.14. Re-encoding "
                    "drops the C2PA chunk."
                ),
            )
        )

        # ---- wordmark-lockup: the mark set into the left third of the generated wordmark ground.
        ground_art = assets / "keyart" / "wordmark-ground-1536x512.png"
        if ground_art.exists():
            target = assets / "chrome" / f"wordmark-lockup-{LOCKUP[0]}x{LOCKUP[1]}.png"
            with Image.open(ground_art) as raw:
                card = raw.convert("RGB")
                if card.size != LOCKUP:
                    card = card.resize(LOCKUP, Image.LANCZOS)
            with Image.open(mark) as raw:
                box = ink_box(raw.convert("RGB"))
                trimmed = raw.convert("RGB").crop(box)
                scale = int(LOCKUP[1] * 0.58)
                height = round(scale * trimmed.size[1] / trimmed.size[0])
                layer = trimmed.resize((scale, height), Image.LANCZOS)
                card.paste(layer, (int(LOCKUP[0] * 0.09), (LOCKUP[1] - height) // 2), ink_mask(layer))
            card.save(target, format="PNG", optimize=True)
            out.append(
                entry(
                    mark_parent,
                    asset="chrome/wordmark-lockup",
                    slug="wordmark-lockup",
                    path=target,
                    declared=LOCKUP,
                    source=mark,
                    cropped=False,
                    ground_class="scene",
                    steps=["composited by derive.py"],
                    note=(
                        "The mark composited into the left third of the generated "
                        "keyart/wordmark-ground, masked by each pixel's distance from the flat "
                        "ground so no rectangle of not-quite-black arrives with it. The title "
                        "type is set by the client over the ground's deliberately empty upper "
                        "two thirds and is NOT generated — the brand run measured FLUX rendering "
                        "a wordmark as \"Home on the Ridge\". derivedFrom names the mark, which "
                        "is where doc 23 §2.14 files this asset; the ground is the second source "
                        "and is kept beside it. Re-encoding drops the C2PA chunk."
                    ),
                )
            )

    json.dump(out, sys.stdout)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
