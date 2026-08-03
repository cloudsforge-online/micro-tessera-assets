#!/usr/bin/env python3
"""Judge the generated sets against each other, on the criteria COMPARISON.md fixes in advance.

    python3 compare.py                      # every set present: sheets + the measured report
    python3 compare.py --no-sheets          # the numbers only
    python3 compare.py --provider flux-2-pro --provider qwen-image-2512

## What this is, and what it is not

`sheet.py` renders one set so a person can look at it. This renders the SAME asset from every set
side by side — two columns today, N whenever there are N — which is the only arrangement in which
"which is better" is a judgeable question rather than a memory test. It then measures the criteria
that can honestly be measured, so the human judgement is spent on the ones that cannot.

**It does not produce a score.** A single number per model would average a set that is coherent but
dull with one that is brilliant three times in twenty, and those are not the same product. What it
produces is a verdict per criterion with named examples, which is what COMPARISON.md asks for.

## The criteria, and which of them are arithmetic

  1. **Prompt adherence** — partly measurable. Ground fidelity, accent coverage, stray hue and
     delivered size are arithmetic. "Did it draw the idea in plan.ts" is not, and is not attempted.
  2. **Style coherence WITHIN the set** — measurable, and the interesting one. It also carries
     more weight the fewer models there are: with a single challenger, "which is better" collapses
     into a per-asset beauty contest unless the set-level judgement is doing real work.
     Aetherholm: painterly islands, buildings and airships under ART_BIBLE.md, plus flat icon and heraldry sets.
     Judged WITHIN this set only. The estate's three asset sets are deliberately unalike, and a
     model that makes them look like each other has failed rather than succeeded — so there is no
     cross-repository coherence number here, and there must not be one. Not "is this image
     good" but "does this image look like it came from the same hand as the other 93". Measured as
     the SPREAD of four quantities across the set: how far the model renders each accent from the
     hex it was given, the hue it drags that accent to, how much ink it puts down for a given kind,
     and how consistent the ground is. Low spread is a family; high spread is a portfolio.
     Judged WITHIN a set, never across: these sets are deliberately unlike each other.
  3. **Legibility at the size the asset is used at** — measurable. A favicon is judged at 32 and 16
     pixels, not at 512, and a mark that survives being a browser tab is a different mark from one
     that looks best in a case study. Measured as contrast retention under Lanczos downscale.
  4. **Artefact rate** — partly measurable. The taxonomy is fixed in COMPARISON.md §4 from defects
     this estate actually saw; the three that leave a numeric trace are counted here, and the three
     that only an eye can catch are tallied by hand into review/compare/artefacts.json, which this
     reads if it exists and says is missing if it does not.
  5. **Retries** — free, from the manifests.
  6. **Cost** — in the unit each model actually bills in. Never combined. See §6.

No numpy, same as verify.py, and the pixel helpers are imported from it rather than copied so the
two tools cannot disagree about what "the ground" or "the accent" means.
"""

from __future__ import annotations

import argparse
import colorsys
import json
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

import providers
from verify import (
    GROUND,
    hex_to_rgb,
    hue_degrees,
    hue_gap,
    luma,
    median,
    read_image,
    rgb_to_hex,
    sample_corners as sample_ground,
)

# This repository's verifier owns its own accent floors per set; compare.py only needs a ceiling
# for "the ground came back pale", and it uses the same number the verifier does.
MAX_GROUND_LUMA = 0.12

HERE = Path(__file__).resolve().parent
REVIEW = HERE / "review" / "compare"

# The sizes a favicon is actually seen at. 16 is the browser tab; 32 is the retina tab and the
# bookmark bar. Nobody sees the 512 except us.
LEGIBILITY_SIZES = (32, 16)


def spread(values: list[float]) -> float:
    """Standard deviation. The coherence measure: it is the SPREAD that matters, not the mean.

    A model that renders every accent 18% too light has a bias, which is correctable and invisible
    once the set is seen together. A model that renders one accent 4% too light and the next 34%
    too light has no house style, and no amount of post-processing fixes that.
    """
    if len(values) < 2:
        return 0.0
    mean = sum(values) / len(values)
    return math.sqrt(sum((v - mean) ** 2 for v in values) / (len(values) - 1))


def ink_share(image: Image.Image, ground: tuple[int, int, int], step: int = 4) -> float:
    """Share of pixels meaningfully brighter than this image's own ground.

    Its own ground, not #12100f: the question is how much of the frame the model chose to draw on,
    which must not be contaminated by whether it got the ground colour right. That is criterion 1's
    job, and mixing the two would let a model with a pale ground look like a bold draughtsman.
    """
    width, height = image.size
    base = luma(ground)
    marked = total = 0
    for y in range(0, height, step):
        for x in range(0, width, step):
            total += 1
            if luma(image.getpixel((x, y))[:3]) - base > 0.02:
                marked += 1
    return marked / max(total, 1)


def contrast_retention(image: Image.Image, ground: tuple[int, int, int], size: int) -> float:
    """How much of the mark's contrast survives being resampled down to `size` pixels.

    RMS deviation of luma from the ground, at `size`, divided by the same at full resolution. A
    heavy, simple mark holds most of it. A mark built from hairlines averages itself into the
    background and comes back near zero — which is exactly the failure that cannot be seen on a
    contact sheet, because a contact sheet shows the 512.
    """

    def rms(sample: Image.Image) -> float:
        base = luma(ground)
        pixels = list(sample.getdata())
        if not pixels:
            return 0.0
        return math.sqrt(sum((luma(p[:3]) - base) ** 2 for p in pixels) / len(pixels))

    full = image.copy()
    full.thumbnail((256, 256), Image.LANCZOS)
    small = image.convert("RGBA").resize((size, size), Image.LANCZOS).convert("RGB")
    reference = rms(full)
    return rms(small) / reference if reference > 0 else 0.0


class SetReading:
    """Everything measured about one provider's set, before any of it is turned into a verdict."""

    def __init__(self, provider: providers.Provider) -> None:
        self.provider = provider
        self.document = json.loads(provider.manifest.read_text())
        self.assets = self.document["assets"]
        self.generated = [a for a in self.assets if not a.get("derivedFrom")]

        # criterion 1
        self.ground_luma: list[float] = []
        self.pale_grounds: list[str] = []
        self.unaccented: list[str] = []
        self.stray_hue: list[str] = []
        self.wrong_size: list[str] = []
        # criterion 2
        self.lightness_error: list[float] = []
        self.hue_error: list[float] = []
        self.ink_by_kind: dict[str, list[float]] = {}
        # criterion 3
        self.retention: dict[int, list[float]] = {size: [] for size in LEGIBILITY_SIZES}
        self.illegible: list[str] = []
        # criterion 5
        self.c2pa = sum(1 for a in self.assets if a["c2pa"])
        # A cheap, objective proxy for "flat vector or photograph".
        self.bytes_per_mp: list[float] = []

    def measure(self) -> None:
        for asset in self.assets:
            path = self.provider.root / asset["path"]
            if not path.exists():
                continue
            name = providers.label_of(asset)

            if asset["deliveredSize"] != asset["declaredSize"] and not asset.get("derivedFrom"):
                self.wrong_size.append(name)

            with Image.open(path) as raw:
                image = raw.convert("RGB")
                # PNG bytes per megapixel. Flat geometric art is large areas of identical colour
                # and compresses enormously; photographic texture — paper grain, fibre, soft
                # shadow — does not. It is a blunt instrument and it is not a quality judgement,
                # but it separates "drew a flat mark" from "photographed an object" without an eye,
                # across a whole set, for free. Reported under criterion 2, because a model that
                # answers a flat-graphic brief photographically has a house style problem rather
                # than a per-image one.
                megapixels = (image.size[0] * image.size[1]) / 1_000_000
                if megapixels > 0 and not asset.get("derivedFrom"):
                    self.bytes_per_mp.append(asset["byteSize"] / megapixels / 1024)
                ground = sample_ground(image)
                ground_l = luma(ground)
                self.ground_luma.append(ground_l)
                if ground_l > MAX_GROUND_LUMA:
                    self.pale_grounds.append(f"{name} {rgb_to_hex(ground)}")

                # This repository's own reader. Note there is no "third hue" measure: a painterly
                # island or a species portrait is polychrome BY DESIGN, so a second hue is the
                # specification here rather than the defect it is in the flat brand set. The
                # equivalent signal for these sets is `ink` — an asset that came back essentially
                # blank.
                reading = read_image(image, asset["accent"], ground)
                if reading.coverage < 0.005:
                    self.unaccented.append(name)
                if reading.ink < 0.02:
                    self.stray_hue.append(f"{name} is {reading.ink * 100:.1f}% ink — nearly blank")

                if reading.rendered:
                    # How far this model moved the accent it was handed. Signed for lightness
                    # because a model that is uniformly light is coherent; unsigned for hue because
                    # direction round the wheel is not a house style, it is an error.
                    _, want_l, _ = colorsys.rgb_to_hls(*(v / 255 for v in hex_to_rgb(asset["accent"])))
                    _, got_l, _ = colorsys.rgb_to_hls(*(v / 255 for v in reading.rendered))
                    self.lightness_error.append(got_l - want_l)
                    self.hue_error.append(
                        hue_gap(hue_degrees(reading.rendered), hue_degrees(hex_to_rgb(asset["accent"])))
                    )

                # Grouped by SET rather than by kind: this repository's assets carry `set`
                # (species, biomes, ui...) and comparing a species portrait's ink
                # coverage against a UI icon's would measure the plan, not the model.
                self.ink_by_kind.setdefault(asset["set"], []).append(ink_share(image, ground))

                # Legibility is asked of the artefacts that are actually shrunk: the favicon source
                # and the mark. Shrinking an OG card to 16 pixels answers a question nobody asked.
                # The assets that are actually shrunk in play: icons and small square art.
                # Shrinking a 1536-wide key-art scene to 16 pixels answers a question nobody asked.
                declared = tuple(int(n) for n in asset["declaredSize"].split("x"))
                if declared[0] == declared[1] and declared[0] <= 512:
                    for size in LEGIBILITY_SIZES:
                        kept = contrast_retention(image, ground, size)
                        self.retention[size].append(kept)
                        if size == 16 and kept < 0.5:
                            self.illegible.append(f"{name} keeps {kept * 100:.0f}% at 16px")

    # ---- criterion 5: retries, from the manifests alone

    @property
    def retried(self) -> int:
        return sum(1 for a in self.generated if a["retries"] > 0)

    @property
    def total_retries(self) -> int:
        return sum(a["retries"] for a in self.generated)

    @property
    def failed_attempts(self) -> int:
        return sum(
            1 for a in self.generated for attempt in a.get("attempts", []) if attempt["outcome"] != "ok"
        )

    # ---- criterion 2: the coherence numbers

    @property
    def ink_spread(self) -> float:
        """Mean within-kind spread. Within-kind because a mark and an OG card SHOULD differ."""
        spreads = [spread(v) for v in self.ink_by_kind.values() if len(v) > 1]
        return sum(spreads) / len(spreads) if spreads else 0.0

    # ---- criterion 6: cost, in this provider's own unit and no other

    def cost(self) -> tuple[str, str]:
        """Returns (figure, how it was arrived at). Never a number without its unit."""
        billing = self.provider.billing
        if billing["unit"] == "provider image unit":
            # Summed over GENERATED entries only. A derivative inherits its parent's cost so a
            # human can see what the file behind it cost, and summing the whole manifest therefore
            # double-counts: aetherholm-assets reads as 316.5 units that way against a true 289.5.
            units = sum(a["providerCostUnits"] or 0 for a in self.generated)
            per = units / len(self.generated) if self.generated else 0
            return (
                f"{units:g} {billing['unit']}s",
                f"{len(self.generated)} generations, {per:.2f} per image, "
                f"{len(self.assets) - len(self.generated)} derivatives free",
            )

        window = self.provider.deployment
        if not window.exists():
            return (
                "UNKNOWN",
                f"bills per {billing['unit']}; {window.name} has not been written, so the hours "
                "this deployment existed are not on record and no figure is invented here",
            )
        record = json.loads(window.read_text())
        hours = record.get("hours")
        rate = record.get("hourlyRate", billing.get("hourlyRate"))
        if hours is None:
            return ("UNKNOWN", f"{window.name} records no hours")
        figure = f"{hours:g} {billing['unit']}s"
        # `or`, not `.get(default)`: the default never fires on an explicit null, and these
        # fields are explicitly null precisely when the news is bad. A missing deletedAt rendering
        # as "deleted None" would read like a formatting nit while quietly hiding that the meter
        # is still running.
        deleted = record.get("deletedAt") or "NOT DELETED — STILL BILLING"
        created = record.get("createdAt") or "unknown (predates this run; billed lifetime is longer)"
        detail = (
            f"{record.get('sku') or billing.get('sku')}, created {created}, "
            f"deleted {deleted}; {len(self.generated)} generations in that window"
        )
        if rate:
            detail += f"; at the recorded rate that is {hours * rate:.2f} per hour-unit x hours"
        if record.get("sharedWith"):
            # The single most misleading thing a reader could do with this number is divide it by
            # this repository's generation count. One deployment served every set, so the hours are
            # JOINT and there is no non-arbitrary way to split them — by asset count, by wall
            # clock, by pixels? Each gives a different answer and none is a fact.
            detail += (
                f"; these hours are SHARED with {', '.join(record['sharedWith'])} — one deployment "
                "served every set, so they cannot be attributed to this repository alone and must "
                "not be divided by its generation count"
            )
        return (figure, detail)


# ------------------------------------------------------------------ the side-by-side sheets


def font(size: int = 18) -> ImageFont.ImageFont:
    try:
        return ImageFont.load_default(size=size)
    except TypeError:  # Pillow older than 9.2 has no size argument on the default font.
        return ImageFont.load_default()


def build_sheet(kind: str, readings: list[SetReading], tile_width: int = 420) -> Path | None:
    """One sheet per kind: a row per surface, a COLUMN PER MODEL.

    The column order is the registry order in providers.json, reference first, and it is the same
    on every sheet — a comparison in which the models move around between pages is a comparison
    nobody can hold in their head.
    """
    rows: list[tuple[str, list[dict | None]]] = []
    indexed = [{providers.key_of(a): a for a in r.assets} for r in readings]
    keys = sorted(
        {
            key
            for index in indexed
            for key, asset in index.items()
            if asset.get("set", asset.get("kind")) == kind
        }
    )
    for key in keys:
        rows.append((key, [index.get(key) for index in indexed]))
    if not rows:
        return None

    # The aspect comes from whichever set actually has the first asset — not from readings[0],
    # which may be a set that has not generated it yet.
    owner, first = next(
        (reading, asset)
        for _, cells in rows
        for reading, asset in zip(readings, cells)
        if asset is not None
    )
    with Image.open(owner.provider.root / first["path"]) as probe:
        aspect = probe.size[1] / probe.size[0]
    tile_height = round(tile_width * aspect)

    pad, label, header = 14, 26, 40
    columns = len(readings)
    sheet = Image.new(
        "RGB",
        (
            columns * tile_width + (columns + 1) * pad,
            header + len(rows) * (tile_height + label) + (len(rows) + 1) * pad,
        ),
        (24, 24, 26),
    )
    draw = ImageDraw.Draw(sheet)
    typeface = font()

    for column, reading in enumerate(readings):
        draw.text(
            (pad + column * (tile_width + pad), 10),
            f"{reading.provider.label}  ({reading.provider.id})",
            fill=(232, 98, 44),
            font=font(20),
        )

    for row, (key, cells) in enumerate(rows):
        y = header + pad + row * (tile_height + label + pad)
        for column, (reading, asset) in enumerate(zip(readings, cells)):
            x = pad + column * (tile_width + pad)
            if asset is None:
                draw.rectangle([x, y, x + tile_width, y + tile_height], outline=(70, 60, 58))
                draw.text((x + 12, y + tile_height // 2), "not generated", fill=(120, 112, 105), font=typeface)
                continue
            path = reading.provider.root / asset["path"]
            with Image.open(path) as image:
                sheet.paste(
                    image.convert("RGB").resize((tile_width, tile_height), Image.LANCZOS), (x, y)
                )
            # Truncated to the tile. A caption that overruns its column collides with the next
            # one and the sheet becomes unreadable exactly where it is supposed to be doing its
            # job — this is the artefact a person judges the comparison from.
            caption = f'{key}  r{asset["retries"]}'
            while typeface.getlength(caption) > tile_width - 6 and len(caption) > 8:
                caption = caption[:-1]
            draw.text((x, y + tile_height + 4), caption, fill=(190, 185, 175), font=typeface)

    REVIEW.mkdir(parents=True, exist_ok=True)
    out = REVIEW / f"compare-{kind}.png"
    sheet.save(out, format="PNG")
    return out


# ------------------------------------------------------------------ the report


def report(readings: list[SetReading]) -> None:
    def row(name: str, values: list[str], width: int = 26) -> None:
        print(f"  {name:<34}" + "".join(f"{v:<{width}}" for v in values))

    ids = [r.provider.id for r in readings]
    print("\n" + "=" * (36 + 26 * len(ids)))
    row("", ids)
    print("=" * (36 + 26 * len(ids)))

    print("\n1. PROMPT ADHERENCE  (measurable part; the idea itself is judged by eye)")
    row("assets", [str(len(r.assets)) for r in readings])
    row("generated (rest are derived)", [str(len(r.generated)) for r in readings])
    row(f"ground off-target (>{MAX_GROUND_LUMA} luma)", [str(len(r.pale_grounds)) for r in readings])
    row("median ground luma", [f"{median(r.ground_luma):.4f}" for r in readings])
    row("below accent floor", [str(len(r.unaccented)) for r in readings])
    row("nearly blank", [str(len(r.stray_hue)) for r in readings])
    row("delivered != declared", [str(len(r.wrong_size)) for r in readings])
    for reading in readings:
        for label, examples in (
            ("pale ground", reading.pale_grounds),
            ("unaccented", reading.unaccented),
            ("nearly blank", reading.stray_hue),
        ):
            if examples:
                print(f"    {reading.provider.id} {label}: {', '.join(examples[:6])}")

    print("\n2. STYLE COHERENCE WITHIN THE SET  (spread, not average — lower is one hand)")
    print(f"   target ground {GROUND}; judged within each set, never between them")
    row("accent lightness: bias", [f"{sum(r.lightness_error)/max(len(r.lightness_error),1):+.3f}" for r in readings])
    row("accent lightness: SPREAD", [f"{spread(r.lightness_error):.3f}" for r in readings])
    row("accent hue error: mean deg", [f"{sum(r.hue_error)/max(len(r.hue_error),1):.1f}" for r in readings])
    row("accent hue error: SPREAD", [f"{spread(r.hue_error):.1f}" for r in readings])
    row("ink coverage spread (in-kind)", [f"{r.ink_spread:.4f}" for r in readings])
    row("ground luma spread", [f"{spread(r.ground_luma):.4f}" for r in readings])
    row("KB per megapixel (median)", [f"{median(r.bytes_per_mp):.0f}" for r in readings])
    print("   CONFOUND, and it is a big one: the reference set has had normalise_ground.py run over")
    print("   it (commit 8314af3, \"snap every ground to the exact ash value\"), which is why its")
    print("   ground luma spread is exactly 0. A candidate set as generated has not. Ground spread")
    print("   is therefore NOT a like-for-like model comparison, and the honest reading is the")
    print("   candidate's absolute figure on its own. The accent, ink and KB/MP rows are unaffected:")
    print("   normalisation rewrites near-ground pixels only and leaves the artwork alone.")
    print("   KB/MP is a proxy, not a verdict: flat geometric art is large areas of one colour and")
    print("   compresses hard; photographic texture does not. A large gap here means the two models")
    print("   answered the same brief in different REGISTERS, which criterion 2 cares about most.")

    print("\n3. LEGIBILITY AT THE SIZE IT IS USED  (contrast kept under Lanczos downscale)")
    for size in LEGIBILITY_SIZES:
        row(f"median retention at {size}px", [f"{median(r.retention[size]) * 100:.0f}%" for r in readings])
    row("marks under 50% at 16px", [str(len(r.illegible)) for r in readings])
    for reading in readings:
        if reading.illegible:
            print(f"    {reading.provider.id}: {', '.join(reading.illegible[:6])}")

    print("\n4. ARTEFACT RATE")
    print("   Countable here: pale ground, no accent present, nearly-blank output — all above.")
    tally = REVIEW / "artefacts.json"
    if tally.exists():
        counts = {k: v for k, v in json.loads(tally.read_text()).items() if not k.startswith("$")}
        scope = json.loads(tally.read_text()).get("$scope")
        if scope:
            print(f"   Tallied by eye over: {scope}")
        for defect in sorted({d for provider in counts.values() for d in provider}):
            row(defect, [str(counts.get(i, {}).get(defect, "-")) for i in ids])
    else:
        print(f"   By eye, and NOT counted: inset duplicate, invented lettering, construction")
        print(f"   guides. Tally them into {tally.relative_to(HERE)} — COMPARISON.md §4 fixes the")
        print(f"   taxonomy and the procedure. Until it exists this criterion has no verdict, which")
        print(f"   is the honest state rather than a zero.")

    print("\n5. RETRIES  (free, from the manifests)")
    row("assets needing >=1 retry", [f"{r.retried}/{len(r.generated)}" for r in readings])
    row("total retries", [str(r.total_retries) for r in readings])
    row("failed attempts logged", [str(r.failed_attempts) for r in readings])
    row("carries C2PA (measured)", [f"{r.c2pa}/{len(r.assets)}" for r in readings])

    print("\n6. COST  — IN THE UNIT EACH MODEL BILLS IN. THESE ARE NOT THE SAME NUMBER.")
    for reading in readings:
        figure, detail = reading.cost()
        print(f"   {reading.provider.id:<20} {figure}")
        print(f"   {'':<20} {detail}")
    units = {r.provider.billing["unit"] for r in readings}
    if len(units) > 1:
        print(
            "\n   These figures are NOT added, averaged or divided into each other, and no "
            "\n   'per image' number is derived for a deployment-hour provider. Per-image billing "
            "\n   charges for output; per-hour billing charges for EXISTENCE, including every hour "
            "\n   a deployment sat idle before, between and after the run. A ratio between them is "
            "\n   a statement about how fast the run was organised, not about the models."
        )


def main() -> int:
    parser = argparse.ArgumentParser(description="Compare the generated sets against each other.")
    providers.add_argument(parser)
    parser.add_argument("--no-sheets", action="store_true", help="skip the side-by-side images")
    parser.add_argument("--kinds", nargs="*", default=["islands", "buildings", "ships", "shipicons", "icons", "heraldry", "keyart", "splashes", "title"],
                        help="which sets to build side-by-side sheets for")
    args = parser.parse_args()

    chosen = providers.selected(args)
    if not chosen:
        print("no provider has a manifest on disk")
        return 1

    readings = []
    for provider in chosen:
        reading = SetReading(provider)
        reading.measure()
        readings.append(reading)

    if not args.no_sheets:
        for kind in args.kinds:
            built = build_sheet(kind, readings)
            if built:
                print(f"{built.relative_to(HERE)}  {Image.open(built).size}")

    report(readings)

    if len(readings) < 2:
        print(
            f"\nOnly {readings[0].provider.id} exists, so nothing has been compared — the numbers "
            "\nabove are that set's baseline. A candidate set cannot be generated until its "
            "\nendpoint serves and backends.ts's UNKNOWNS are answered."
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
