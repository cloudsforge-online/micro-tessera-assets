#!/usr/bin/env python3
"""Check every asset against the numbers it claims, the plan, and the art bible.

Looking at an image tells you whether a stool is appealing and whether a ward reads as a place. It
does not reliably tell you that a ground is #2b2b2d rather than #12100f, that an icon has drifted
thirty degrees of hue off its anchor, that an avatar overlay is registered four pixels left of
every other one, or that a manifest entry still claims a C2PA box the post-processing dropped —
the eye adapts, and 288 files adapt it 288 times. The measurable things are measured here; the
rest is judged on `sheet.py`'s contact sheets, against COMPARISON.md's criteria.

The checks, and where each came from:

  1. **Completeness.** Every asset in PLAN.json has a manifest entry and a file on disk, and
     PLAN.json itself still totals doc 23 §2.3's 288 + 104 = 392.
  2. **Dimensions**, read from the bytes and matched against `declaredSize` — and `deliveredSize`
     re-checked against the pixels, which is what makes check 9 trustworthy.
  3. **Checksum** recomputed from the bytes. This repository rewrites its own files after
     generation (normalise, cutout, project, derive), so this is the check most likely to catch a
     step that forgot to write back.
  4. **C2PA measured off the bytes** and compared to the manifest flag. micro-brand's hardest-won
     check: 54 entries there shipped claiming a box the ground-normalisation commit had dropped,
     and the verifier stayed green because nothing compared the claim to the bytes. Worse,
     `emberkin-assets/verify.py` has NO c2pa check at all — `grep -c c2pa` on it returns 0 — so
     its 83 `c2pa: true` entries are asserted at write time and have never been measured by
     anything. **The estate measures c2pa and never asserts it; a repository that asserts it is a
     repository that will be wrong quietly.**
  5. **Ground, by class**, and Tessera has THREE rather than the siblings' two:
       `flat`  exactly #12100f in all four corners after normalisation — no tolerance, because the
               value is set numerically and any deviation means the step did not run.
       `scene` a picture, held to a darkness ceiling on its edges instead.
       `plate` a MATERIAL SHEET. Neither rule applies: a saltflat plate is cracked white by design
               (doc 23 §2.4) and a grove plate is near-black, so a darkness ceiling would fail the
               art and a flat-ground check would fail all 32. What a plate is checked for is that
               it is FULL BLEED — that its edges are not a mount, a border or a vignette — because
               that is the property `project_iso.py` actually depends on.
  6. **Not degenerate.** A file that is 99.5% ground is a blank, and a blank passes every other
     check on this list.
  7. **Accent coverage**, where the set's floor is above zero: the flat-vector sets (glyphs,
     icons, chrome) must actually be drawn in their declared anchor. The painterly sets carry a
     floor of zero — the accent is recorded on them, not gated.
  8. **NEW — footprint registration.** Every avatar overlay's opaque bounding box lies within the
     vertical band its slot declares. doc 23 §2.15 item 7: a misregistered overlay is invisible in
     a contact sheet and obvious in play, which is the definition of a check worth automating.
 8a. **NEW — the paper doll is keyed.** Every avatar plate has an alpha channel with something
     transparent in it and something opaque in it. **Check 8 grades a bounding box, so it is blind
     to the one failure that is worse than misregistration**: an overlay that never reached
     `cutout.py` has no alpha, composites as an opaque near-black rectangle over the base figure,
     and measures identically to a properly cut one — `opaque_box` falls back to distance-from-
     ground on purpose. A check with a degenerate solution needs the guard beside it, not inside it.
  9. **NEW — Qwen transposition.** For every non-square asset, the candidate's MEASURED dimensions
     equal the reference's rather than their transpose. doc 23 §2.15 item 8. This catches the
     `size` bug at verify time rather than at contact-sheet time, and it has to be measured off
     the bytes because the endpoint's response reports the size it was ASKED for either way.
 10. **Prompt parity** across every set present. The check the whole comparison rests on.

    python3 verify.py                      # every set present on disk
    python3 verify.py --provider flux-2-pro
    python3 verify.py objects glyphs       # only these sets
"""

from __future__ import annotations

import argparse
import colorsys
import hashlib
import json
import sys
from pathlib import Path

from PIL import Image

import providers

HERE = Path(__file__).resolve().parent
PLAN = HERE / "PLAN.json"

GROUND = "#12100f"

# A scene is held to a darkness ceiling at its EDGES. 0.12 passes a near-black with room to spare
# and fails the mid-grey taupe field (about 0.23) the brand run's first live image wore.
MAX_SCENE_EDGE_LUMA = 0.12

# Degrees of hue. Both models render colour lighter than the hex they are given, and lightening
# drags the hue; 30 is where the three sibling runs settled.
MAX_HUE_DRIFT = 30.0
# Below this saturation a pixel is ground, ink or rim light, and its hue is noise.
MIN_SAT = 0.15

# The share of the image that must be drawn within tolerance of the asset's own accent.
# Painterly sets are multi-hued by design: floor zero, accent recorded rather than gated.
MIN_COVERAGE = {
    "glyphs": 0.010,
    "icons": 0.010,
    "chrome": 0.005,
    "terrain": 0.0,
    "objects": 0.0,
    "structure": 0.0,
    "avatar": 0.0,
    "backdrop": 0.0,
    "kiln": 0.0,
    "markers": 0.0,
    "keyart": 0.0,
    "splashes": 0.0,
}
# The share of the image that must be something other than ground. Below this it is a blank.
MIN_INK = 0.02

# A plate must be full bleed. If the outer band is markedly flatter than the middle it is a mount,
# a border or a vignette rather than a material, and project_iso.py will cut that band into the
# world's ground. Measured as the ratio of edge-band luma spread to centre luma spread.
MIN_PLATE_EDGE_ACTIVITY = 0.25

C2PA_MARKER = b"c2pa"

#: The vertical band each overlay slot is allowed to occupy, as a fraction of the frame. These are
#: the extents the `region` strings in content/avatars.json describe, with a generous margin: the
#: point is to catch a hair plate that drew a whole figure or a boots plate that drew them at the
#: waist, not to police a braid that falls three per cent lower than another.
SLOT_BANDS = {
    "hair": (0.0, 0.42),
    "top": (0.10, 0.72),
    "legs": (0.38, 0.94),
    "feet": (0.72, 1.0),
    "held": (0.25, 0.88),
}
SLOT_MARGIN = 0.04


# THE `is_daylight` EXEMPTION USED TO LIVE HERE, AND IT HAS BEEN DELETED.
#
# It skipped the scene darkness ceiling for the eight `-day` ward backdrops, because
# `content/wards.json` defined `day` as "flat even daylight, high sun" while generate.ts's
# SCENE_GROUND_CLAUSE demanded that all four edges "fall away into that darkness rather than into
# grey, white or pale blue" — two sentences of one prompt that contradicted each other. README §8
# recorded it as a content defect made visible rather than a check softened to go green, and said
# it should be deleted once the clause was fixed. The clause is fixed: the darkness requirement is
# now conditional on the light the scene is described as having, and it names the daylight case
# instead of forbidding it. So the ceiling now runs on all sixteen backdrops, and what it finds it
# reports.
#
# WHAT DELETING IT REVEALED, measured rather than predicted, and it is not what README §8 said:
#
#   flux-2-pro       saltflat-day  edge luma 0.416  #64b9c9   over the 0.12 ceiling
#                    wharf-day     edge luma 0.479  #a9bcb9   over the 0.12 ceiling
#                    the other six day backdrops   0.000-0.007, comfortably under
#   qwen-image-2512  ALL EIGHT day backdrops       0.001-0.007, comfortably under
#
# README §8 claimed "both models resolved it the same way". THEY DID NOT. FLUX painted daylight on
# two of eight and Qwen painted the dark clause on eight of eight — its `saltflat-day` corners are
# #1c120a, a near-black, under a brief that says "high sun". So the exemption was written for a
# symmetry that was never there: it was covering two FLUX assets and nothing else, while removing
# the only check that would have noticed Qwen never painting a daylight sky at all.
#
# The two are left RED rather than excused, which is this repository's standing habit for a
# genuine prompt-adherence miss (README §8 item 4). They are also the two most worth regenerating
# against the fixed clause, because it is the clause that now tells a model what a high sun does at
# the top edge of a frame — and `wharf-day`'s #a9bcb9 is a desaturated pale band, which is the
# failure the clause guards against rather than the daylight it now permits.


def hex_to_rgb(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def rgb_to_hex(rgb: tuple[int, int, int]) -> str:
    return "#%02x%02x%02x" % tuple(int(v) for v in rgb)


def _linear(value: int) -> float:
    c = value / 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def luma(rgb) -> float:
    """Relative luminance, sRGB-linearised — the same transfer function WCAG contrast uses."""
    r, g, b = (_linear(int(v)) for v in rgb[:3])
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def hue_degrees(rgb) -> float:
    h, _, _ = colorsys.rgb_to_hls(*(int(v) / 255 for v in rgb[:3]))
    return h * 360


def hue_gap(a: float, b: float) -> float:
    gap = abs(a - b) % 360
    return min(gap, 360 - gap)


def median(values: list[float]) -> float:
    ordered = sorted(values)
    return ordered[len(ordered) // 2] if ordered else 0.0


def sample_corners(image: Image.Image) -> tuple[int, int, int]:
    """Median of four corner patches. A corner is where no composition in the plan puts a subject."""
    width, height = image.size
    patch = max(8, min(width, height) // 24)
    pixels = []
    for left, top in ((0, 0), (width - patch, 0), (0, height - patch), (width - patch, height - patch)):
        for y in range(top, top + patch):
            for x in range(left, left + patch):
                pixels.append(image.getpixel((x, y)))
    return (
        int(median([p[0] for p in pixels])),
        int(median([p[1] for p in pixels])),
        int(median([p[2] for p in pixels])),
    )


def corner_extremes(image: Image.Image) -> list[tuple[int, int, int]]:
    """Every distinct colour found in the four corner patches. Used for the exact-ground check."""
    width, height = image.size
    patch = max(8, min(width, height) // 24)
    found = set()
    for left, top in ((0, 0), (width - patch, 0), (0, height - patch), (width - patch, height - patch)):
        for y in range(top, top + patch, 2):
            for x in range(left, left + patch, 2):
                found.add(image.getpixel((x, y))[:3])
    return sorted(found)


class Reading:
    def __init__(self, coverage, rendered, ink):
        #: Share of the sampled pixels within tolerance of the asset's own accent.
        self.coverage = coverage
        #: That accent AS RENDERED — the median of those pixels.
        self.rendered = rendered
        #: Share of sampled pixels that are not ground. Below MIN_INK the file is a blank.
        self.ink = ink


def read_image(image: Image.Image, accent: str, ground: tuple[int, int, int]) -> Reading:
    width, height = image.size
    step = max(1, min(width, height) // 200)
    accent_hue = hue_degrees(hex_to_rgb(accent))

    total = 0
    matched: list[tuple[int, int, int]] = []
    ink = 0
    for y in range(0, height, step):
        for x in range(0, width, step):
            total += 1
            pixel = image.getpixel((x, y))[:3]
            if sum((pixel[i] - ground[i]) ** 2 for i in range(3)) ** 0.5 > 24:
                ink += 1
            _, lightness, saturation = colorsys.rgb_to_hls(*(v / 255 for v in pixel))
            if saturation < MIN_SAT or not 0.12 < lightness < 0.92:
                continue
            if hue_gap(hue_degrees(pixel), accent_hue) <= MAX_HUE_DRIFT:
                matched.append(pixel)

    rendered = (
        (
            int(median([p[0] for p in matched])),
            int(median([p[1] for p in matched])),
            int(median([p[2] for p in matched])),
        )
        if matched
        else None
    )
    return Reading(len(matched) / total, rendered, ink / total)


def plate_edge_activity(image: Image.Image) -> float:
    """How alive the outer band is, against the middle. A mount or a vignette reads near zero.

    A material sheet has about as much going on at its edge as at its centre — that is what makes
    it a material rather than a picture of one. A framed, matted or vignetted plate has a flat
    outer band, and `project_iso.py` will happily cut a tile out of that band and drop it on the
    world's ground. This is the plate equivalent of the flat-ground check, and it exists because
    neither of the siblings' two ground rules can be applied to a material at all.
    """
    rgb = image.convert("RGB")
    width, height = rgb.size
    band = max(4, min(width, height) // 16)

    def spread(points) -> float:
        values = [luma(p) for p in points]
        if len(values) < 2:
            return 0.0
        mean = sum(values) / len(values)
        return (sum((v - mean) ** 2 for v in values) / len(values)) ** 0.5

    step = max(1, min(width, height) // 120)
    edge = [
        rgb.getpixel((x, y))
        for y in range(0, height, step)
        for x in range(0, width, step)
        if min(x, y, width - 1 - x, height - 1 - y) < band
    ]
    centre = [
        rgb.getpixel((x, y))
        for y in range(band * 2, height - band * 2, step)
        for x in range(band * 2, width - band * 2, step)
    ]
    centre_spread = spread(centre)
    if centre_spread <= 1e-6:
        return 1.0
    return spread(edge) / centre_spread


def opaque_box(path: Path) -> tuple[float, float, float, float] | None:
    """The normalised bounding box of everything that is not ground and not transparent.

    Works before or after `cutout.py`: if the file has an alpha channel the box is taken from
    alpha, and if it does not it is taken from distance to the flat ground. Check 8 has to hold at
    both points in the pipeline, because an overlay can be misregistered from the moment it is
    generated and the cut does not move it.
    """
    with Image.open(path) as raw:
        width, height = raw.size
        if raw.mode in ("RGBA", "LA") or "transparency" in raw.info:
            alpha = raw.convert("RGBA").getchannel("A")
            box = alpha.point(lambda v: 255 if v > 24 else 0).getbbox()
        else:
            rgb = raw.convert("RGB")
            target = hex_to_rgb(GROUND)
            mask = Image.new("L", rgb.size, 0)
            draw = mask.load()
            pixels = rgb.load()
            for y in range(height):
                for x in range(width):
                    r, g, b = pixels[x, y]
                    if (r - target[0]) ** 2 + (g - target[1]) ** 2 + (b - target[2]) ** 2 > 40 * 40:
                        draw[x, y] = 255
            box = mask.getbbox()
    if not box:
        return None
    return (box[0] / width, box[1] / height, box[2] / width, box[3] / height)


def check_keyed(provider, document: dict) -> list[str]:
    """CHECK 8a — every avatar plate carries a real alpha channel, and it keys something.

    **CHECK 8 HAS A DEGENERATE SOLUTION AND THIS IS THE GUARD AGAINST IT.** Check 8 grades an
    opaque BOUNDING BOX, so it is a statement about where paint is and says nothing whatever about
    whether the file can be composited. Two ways to score well on it and ship a broken paper doll:

      * **no alpha at all.** `opaque_box` deliberately falls back to distance-from-ground so that
        check 8 holds before `cutout.py` as well as after it — which is right for check 8 and means
        a plate that never got cut measures exactly like one that did. A paper-doll OVERLAY without
        alpha composites as an opaque 256x512 near-black rectangle and obliterates the base figure
        underneath it. That is strictly worse than being the wrong size, and nothing here saw it.
      * **cut to nothing.** An over-aggressive key shrinks the box toward zero, and a smaller box
        is easier to fit inside a band. `MIN_INK` catches an all-ground file, but it reads RGB and
        an alpha channel of all zeroes leaves the RGB untouched.

    So this asserts the property the RENDERER depends on rather than the one the band test reads:
    the file has an alpha channel, some of it is transparent, and some of it is not. It runs on the
    8 bases as well as the 40 overlays, because a base that lost its key is the same defect.

    It is separated from check 8 rather than folded into it on purpose. They can fail
    independently, and a plate that is correctly registered and unusable should say both things.
    """
    problems: list[str] = []
    for asset in document["assets"]:
        if asset["set"] != "avatar" or asset["derivedFrom"] is not None:
            continue
        path = provider.root / asset["path"]
        if not path.exists():
            continue
        with Image.open(path) as raw:
            if raw.mode not in ("RGBA", "LA") and "transparency" not in raw.info:
                problems.append(
                    f'{asset["path"]}: {raw.mode}, no alpha channel — this plate has not been '
                    "keyed by cutout.py and would composite as an opaque rectangle over the base "
                    "figure. Run `python3 cutout.py` after generating; check 8 cannot see this"
                )
                continue
            alpha = raw.convert("RGBA").getchannel("A")
            lo, hi = alpha.getextrema()
        if hi <= 24:
            problems.append(f'{asset["path"]}: alpha is empty (max {hi}) — the whole plate is cut away')
        elif lo > 24:
            problems.append(
                f'{asset["path"]}: alpha is fully opaque (min {lo}) — nothing was cut away, so the '
                "plate is a rectangle rather than a sprite"
            )
    return problems


def check_registration(provider, document: dict) -> list[str]:
    """CHECK 8 — every avatar overlay sits inside the vertical band its slot declares.

    doc 23 §2.8: every overlay is generated against the same base silhouette, and §2.15 item 7
    makes that a bounding-box match. This is the one place in the pipeline that can fail
    invisibly — a hat drawn at chest height composites cleanly, verifies cleanly, and is obviously
    broken the first time anybody walks past it.

    What it does NOT check is that the plate can be composited at all; see `check_keyed`.
    """
    problems: list[str] = []
    for asset in document["assets"]:
        if asset["set"] != "avatar" or asset["derivedFrom"] is not None:
            continue
        slot = asset["slug"].split("-")[0]
        if slot not in SLOT_BANDS:
            continue  # a base, not an overlay
        path = provider.root / asset["path"]
        if not path.exists():
            continue
        box = opaque_box(path)
        if box is None:
            problems.append(f'{asset["path"]}: overlay is entirely empty')
            continue
        top, bottom = box[1], box[3]
        lo, hi = SLOT_BANDS[slot]
        if top < lo - SLOT_MARGIN or bottom > hi + SLOT_MARGIN:
            problems.append(
                f'{asset["path"]}: {slot} overlay ink spans {top:.2f}-{bottom:.2f} of the frame, '
                f"outside its slot's {lo:.2f}-{hi:.2f} band — it will not register against the "
                "base silhouette"
            )
    return problems


def check_transposition(documents: dict[str, dict]) -> list[str]:
    """CHECK 9 — no candidate delivered a non-square asset rotated.

    THE ONE CHECK THAT HAD TO BE WRITTEN FOR THIS REPOSITORY RATHER THAN INHERITED. Qwen's images
    route takes `size` and transposes it: ask for 1024x384 and you receive 384x1024, while the
    response still REPORTS 1024x384. Nothing in the JSON can catch that, and a square probe cannot
    see it at all — which is how it survived a careful handover. **68 of this set's 288
    generations are non-square**, so an unnoticed regression here would rotate every avatar plate,
    every ward backdrop and all four wide title assets while every log line looked correct.

    `backends.ts` compensates in the envelope by sending height x width. This measures whether the
    compensation is still working, off the delivered bytes, per asset — never off the response.
    """
    reference_id = providers.reference().id
    if reference_id not in documents:
        return []
    reference = {a["asset"]: a for a in documents[reference_id]["assets"]}
    problems: list[str] = []
    for provider_id, document in documents.items():
        if provider_id == reference_id:
            continue
        for asset in document["assets"]:
            want = reference.get(asset["asset"])
            if not want:
                continue
            declared = tuple(int(n) for n in asset["declaredSize"].split("x"))
            if declared[0] == declared[1]:
                continue  # a square cannot show it, which is exactly why this is not a spot check
            if asset["deliveredSize"] != want["deliveredSize"]:
                transpose = "x".join(reversed(want["deliveredSize"].split("x")))
                note = " — that is its TRANSPOSE" if asset["deliveredSize"] == transpose else ""
                problems.append(
                    f'{provider_id}: {asset["asset"]} measured {asset["deliveredSize"]} against '
                    f'the reference\'s {want["deliveredSize"]}{note}'
                )
    return problems


def check_plan_totals() -> list[str]:
    """CHECK 1b — PLAN.json still totals doc 23 §2.3."""
    plan = json.loads(PLAN.read_text())
    problems: list[str] = []
    for field, expected, what in (
        ("total", 288, "generated assets"),
        ("derivedTotal", 104, "derived assets"),
        ("grandTotal", 392, "assets in total"),
    ):
        if plan[field] != expected:
            problems.append(
                f"PLAN.json declares {plan[field]} {what}; doc 23 §2.3 says {expected}"
            )
    return problems


def check_parity(documents: dict[str, dict]) -> list[str]:
    """Every asset present in two or more sets must carry the same prompt in both.

    THE CHECK THE WHOLE COMPARISON RESTS ON. Two models asked different questions produce an
    incomparable answer, and the failure is invisible in the images — it looks like one model being
    worse at prompt adherence, which is exactly the conclusion this exercise is supposed to reach
    honestly or not at all.

    It compares the MANIFESTS, not PLAN.json and not the prompt-building code, because the manifest
    is the only artefact that records what was actually SENT. PLAN.json is regenerated from the
    current clauses on every run and drifts away from the run it describes the moment a clause is
    edited. Checking against the code would be checking against a thing that has already moved.
    """
    if len(documents) < 2:
        return []

    by_key: dict[str, dict[str, str]] = {}
    for provider_id, document in documents.items():
        for asset in document["assets"]:
            # providers.key_of, not a hand-built string: the estate's asset repositories identify
            # an asset differently and that function is the only place the difference lives.
            by_key.setdefault(providers.key_of(asset), {})[provider_id] = asset["prompt"]

    reference_id = providers.reference().id
    problems: list[str] = []
    for key, prompts in sorted(by_key.items()):
        if len(prompts) < 2:
            if reference_id in documents and reference_id not in prompts:
                problems.append(
                    f"{key}: present in {', '.join(sorted(prompts))} but not in the reference set "
                    f"{reference_id} — a candidate replays the reference's recorded prompts, so it "
                    "cannot hold an asset the reference has never generated"
                )
            continue
        distinct: dict[str, list[str]] = {}
        for provider_id, prompt in prompts.items():
            distinct.setdefault(hashlib.sha256(prompt.encode()).hexdigest()[:12], []).append(provider_id)
        if len(distinct) > 1:
            groups = "; ".join(
                f'{digest} = {", ".join(sorted(ids))}' for digest, ids in sorted(distinct.items())
            )
            problems.append(
                f"{key}: the sets were given DIFFERENT prompts ({groups}). The comparison between "
                "them is not valid until they agree — regenerate the candidate, which replays the "
                "reference's recorded prompt rather than computing one"
            )
    return problems


def check_integrity(provider, document: dict) -> list[str]:
    """Things about the manifest as a whole, rather than about any one image."""
    problems: list[str] = []
    declared = document.get("assetCount")
    if declared is not None and declared != len(document["assets"]):
        # It was wrong in two of the estate's three earlier asset repositories when this was
        # written. A manifest whose own summary disagrees with its own body is one nobody can quote.
        problems.append(
            f'MANIFEST.json: assetCount says {declared} and the file carries '
            f'{len(document["assets"])} entries'
        )
    recorded = {a["path"] for a in document["assets"]}
    on_disk = {str(p.relative_to(provider.root)) for p in provider.root.glob("assets/**/*.png")}
    for orphan in sorted(on_disk - recorded):
        problems.append(f"{orphan}: on disk with no manifest entry")
    return problems


def verify_set(provider, document: dict, wanted: set[str]) -> list[str]:
    plan = json.loads(PLAN.read_text())
    ground_target = hex_to_rgb(GROUND)

    failures: list[str] = []
    rows: list[str] = []
    assets = {a["asset"]: a for a in document["assets"]}

    # ---- 1. completeness, against the plan rather than against itself.
    for planned in plan["assets"]:
        if wanted and planned["set"] not in wanted:
            continue
        if planned["key"] not in assets and f'{planned["key"]}-source' not in assets:
            failures.append(f'{planned["key"]}: planned but never generated')
    for planned in plan["derived"]:
        if wanted and planned["set"] not in wanted:
            continue
        if planned["key"] not in assets:
            failures.append(f'{planned["key"]}: planned as a derivative but never built')

    for asset in document["assets"]:
        if wanted and asset["set"] not in wanted:
            continue
        path = provider.root / asset["path"]
        # INTEGRITY: is this manifest TRUE about these bytes. Fatal for every set, always.
        problems: list[str] = []
        # CONFORMANCE: does this art meet this set's own specification. Fatal for the SHIPPED set;
        # reported by name for a candidate. A candidate is on trial, and how far it sits from the
        # art bible is the comparison's first criterion rather than a broken build. Turning CI red
        # for it would mean the only way to land the evidence is to weaken a check, which is the
        # one thing that must not happen. Nothing the shipped set is held to has changed.
        conformance: list[str] = []

        if not path.exists():
            failures.append(f'{asset["path"]}: missing')
            continue

        data = path.read_bytes()
        if hashlib.sha256(data).hexdigest() != asset["sha256"]:
            problems.append("checksum does not match the manifest")

        # ---- 4. the disclosure must be what the bytes say. micro-brand's 54-entry lesson.
        carries_c2pa = C2PA_MARKER in data
        if carries_c2pa != asset["c2pa"]:
            problems.append(
                f'manifest says c2pa={asset["c2pa"]} and the bytes say {carries_c2pa} — '
                "the disclosure has drifted from the file"
            )

        with Image.open(path) as raw:
            image = raw.convert("RGB")
            declared = tuple(int(n) for n in asset["declaredSize"].split("x"))
            if image.size != declared:
                problems.append(
                    f'{image.size[0]}x{image.size[1]} against a declared {asset["declaredSize"]}'
                )
            # ---- 2b. deliveredSize must be what the bytes measure. This is what makes check 9
            # trustworthy: it compares deliveredSize across providers, and that column is only
            # worth comparing if it came from the pixels rather than from a response that reports
            # the size it was asked for whatever it actually sent.
            if asset["derivedFrom"] is None and asset["deliveredSize"] != "unknown":
                measured = f"{image.size[0]}x{image.size[1]}"
                if measured != asset["deliveredSize"] and not asset.get("cropped"):
                    problems.append(
                        f'deliveredSize says {asset["deliveredSize"]} and the bytes measure '
                        f"{measured}"
                    )

            corners = sample_corners(image)
            corner_luma = luma(corners)

            # ---- 5. ground, by class. Three classes, not the siblings' two.
            if asset["groundClass"] == "flat":
                distinct = corner_extremes(image)
                off = [c for c in distinct if c != ground_target]
                if off:
                    conformance.append(
                        f"{len(off)} of {len(distinct)} sampled corner colour(s) are not exactly "
                        f"{GROUND} — nearest stray {rgb_to_hex(off[0])}; normalisation did not "
                        "run or did not take"
                    )
            elif asset["groundClass"] == "plate":
                activity = plate_edge_activity(image)
                if activity < MIN_PLATE_EDGE_ACTIVITY:
                    conformance.append(
                        f"plate edge activity {activity:.2f} against a floor of "
                        f"{MIN_PLATE_EDGE_ACTIVITY} — the outer band is flatter than the middle, "
                        "so this is a mount, a border or a vignette rather than a material, and "
                        "project_iso.py will cut that band into the world's ground"
                    )
            elif corner_luma > MAX_SCENE_EDGE_LUMA:
                conformance.append(
                    f"scene edges at {rgb_to_hex(corners)} are too light (luma {corner_luma:.3f}, "
                    f"ceiling {MAX_SCENE_EDGE_LUMA})"
                )

            reading = read_image(image, asset["accent"], corners)

            # ---- 6. not degenerate. A plate is all ink by definition and cannot fail this.
            if asset["groundClass"] != "plate" and reading.ink < MIN_INK:
                conformance.append(
                    f"only {reading.ink * 100:.2f}% of the image differs from its ground — this "
                    "is a blank"
                )

            # ---- 7. accent coverage, where the set's floor is above zero.
            floor = MIN_COVERAGE.get(asset["set"], 0.0)
            if reading.coverage < floor:
                conformance.append(
                    f'only {reading.coverage * 100:.2f}% of the image is drawn within '
                    f'{MAX_HUE_DRIFT:.0f} degrees of {asset["accent"]} (floor {floor * 100:.1f}%)'
                )

        fatal = problems + (conformance if provider.shipped else [])
        mark = "FAIL" if fatal else ("warn" if conformance else "ok  ")
        rows.append(
            f'{mark} {asset["set"]:<10} {asset["slug"]:<26} {asset["declaredSize"]:>9} '
            f'{asset["groundClass"]:<5} corner {rgb_to_hex(corners)} '
            f"ink {reading.ink * 100:5.1f}%  "
            f'colour {rgb_to_hex(reading.rendered) if reading.rendered else "-":<8} '
            f"{reading.coverage * 100:5.2f}%  c2pa={str(asset['c2pa']).lower()}"
        )
        for problem in problems + conformance:
            rows.append(f"       -> {problem}")
        for problem in fatal:
            failures.append(f'{asset["path"]}: {problem}')

    print("\n".join(rows))
    print(
        f"\ntarget ground {GROUND} (exact on flat assets, luma ceiling {MAX_SCENE_EDGE_LUMA} on "
        f"scene edges, full-bleed floor {MIN_PLATE_EDGE_ACTIVITY} on plates); hue tolerance "
        f"{MAX_HUE_DRIFT:.0f} degrees; c2pa measured off the bytes"
    )
    return failures


def main(argv: list[str]) -> int:
    """Run every check, per provider, and then the three that are about the set of sets.

    A candidate set is expected to be RED while it is being worked on. That must not be able to
    turn the shipped reference set red with it, which is why each set has its own manifest and its
    own pass-or-fail line, and why the default is "every set that exists on disk" rather than a
    fixed list — a challenger that has not been generated yet is the normal state, not a fault.
    """
    parser = argparse.ArgumentParser(description="Verify one or more generated asset sets.")
    providers.add_argument(parser)
    parser.add_argument("sets", nargs="*", help="only these sets")
    args = parser.parse_args(argv)

    chosen = providers.selected(args)
    if not chosen:
        print("no provider has a manifest on disk", file=sys.stderr)
        return 1

    all_failures: list[str] = [f"plan: {p}" for p in check_plan_totals()]
    documents: dict[str, dict] = {}

    for provider in chosen:
        print(f"===== {provider.id}  ({provider.label})")
        document = json.loads(provider.manifest.read_text())
        documents[provider.id] = document
        failures = verify_set(provider, document, set(args.sets))
        failures.extend(check_integrity(provider, document))
        # INTEGRITY, NOT CONFORMANCE, and fatal for every set including a candidate. A
        # misregistered plate is a judgement about art direction; an unkeyed plate is a broken
        # file, and a broken file is not a finding about a model.
        keyed = check_keyed(provider, document)
        if keyed:
            print(f"----- keying: {len(keyed)} avatar plate(s) that cannot be composited")
            for problem in keyed:
                print(f"  -> {problem}")
        failures.extend(keyed)
        registration = check_registration(provider, document)
        if registration:
            print(f"----- registration: {len(registration)} misregistered overlay(s)")
            for problem in registration:
                print(f"  -> {problem}")
        # Conformance, not integrity: fatal for the shipped set, reported for a candidate.
        if provider.shipped:
            failures.extend(registration)
        print(f"{len(failures)} failure(s) in {provider.id}\n")
        all_failures.extend(f"{provider.id}: {f}" for f in failures)

    transposed = check_transposition(documents)
    if len(documents) > 1:
        print(f"===== delivered-size parity: {len(transposed)} transposed or mismatched asset(s)")
        for problem in transposed:
            print(f"  -> {problem}")
    all_failures.extend(f"transposition: {p}" for p in transposed)

    parity = check_parity(documents)
    if len(documents) > 1:
        print(f"===== prompt parity across {len(documents)} sets: {len(parity)} disagreement(s)")
        for problem in parity:
            print(f"  -> {problem}")
    all_failures.extend(f"parity: {p}" for p in parity)

    print(f"\n{len(all_failures)} failure(s) across {len(chosen)} set(s)")
    return 1 if all_failures else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
