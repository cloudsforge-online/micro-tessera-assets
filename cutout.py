#!/usr/bin/env python3
"""Key every flat-ground sprite to alpha, so it can be placed on the world's own tiles.

**Transparency is a post-step, not a generation.** doc 23 §2.1 states it: diffusion does not emit
alpha. Every object sprite is generated on the pinned `#12100f` ground and cut here, and the step
is recorded in the manifest's `postProcessing` field — the same field
`aetherholm-assets/MANIFEST.json:42` already carries on 91 of its 101 entries.

Which files: the sets whose art is a SPRITE — seed objects, the structure kit, parcel markers, the
Kiln art and every avatar plate. Not the glyphs, icons or chrome. Those are UI art drawn to sit on
the estate's own `#12100f` surfaces, they are never composited over terrain, and cutting them would
gain nothing and cost the exact-corner ground check its meaning.

**The RGB is not touched, only alpha is added.** That is a deliberate constraint, and it is what
lets `verify.py`'s flat-ground check keep working after this step runs: a corner pixel is still
exactly `#12100f`, it is merely also transparent. A cutout that zeroed the colour of its
transparent pixels would pass nothing and would fringe dark when composited by a renderer that
ignores premultiplication.

**Why not Pillow.** Pillow's PNG writer drops ancillary chunks, which is exactly how `micro-brand`
lost the C2PA box on 54 files and then shipped a manifest claiming it was still there
(`brand/verify.py:16-24`). This uses `normalise_ground.py`'s chunk-preserving reader and writer
instead, promoting the image to colour type 6 and carrying every other chunk through untouched —
so a sprite that arrived with C2PA still has C2PA after being cut. doc 23 §2.2: *Tessera uses the
fixed writer from the first asset.* `c2pa` is re-measured off the written bytes regardless, because
the estate measures it and never asserts it.

**The alpha ramp.** A pixel at the ground is alpha 0, a pixel far from it is alpha 255, and the
band between is a linear ramp — the same NEAR/FAR shape the ground normaliser uses, for the same
reason. A hard threshold leaves a 1-pixel dark fringe on every anti-aliased edge, which is
invisible on one sprite and unmistakable on a screen holding two hundred of them.

    python3 cutout.py                        # every uncut sprite in the reference set
    python3 cutout.py --provider flux-2-pro
    python3 cutout.py --force                # re-cut
"""

from __future__ import annotations

import argparse
import hashlib
import json
import multiprocessing
import struct
import sys
import zlib
from pathlib import Path

import normalise_ground
import providers

HERE = Path(__file__).resolve().parent

TARGET = normalise_ground.TARGET
STEP = "keyed to alpha by cutout.py"
C2PA_MARKER = b"c2pa"

#: Distance from the ground below which a pixel is fully transparent, and above which it is fully
#: opaque. Wider than the normaliser's band: the normaliser is repairing a colour, this is deciding
#: what is subject and what is not, and an over-tight cut eats the soft foot of a painted shadow.
NEAR = 30.0
FAR = 86.0

#: The sets that are sprites. Everything else keeps its flat ground; see the header.
CUT_SETS = {"objects", "structure", "markers", "kiln", "avatar"}


def cut(path: Path) -> tuple[int, str, int, bool]:
    """Add an alpha channel keyed to distance from the brand ground. RGB is left alone."""
    width, height, channels, rows, before, after = normalise_ground._read(path)

    tr, tg, tb = TARGET
    span = FAR - NEAR
    out_rows: list[bytearray] = []
    cleared = 0
    for y in range(height):
        line = rows[y]
        new = bytearray(width * 4)
        for x in range(width):
            o = x * channels
            r, g, b = line[o], line[o + 1], line[o + 2]
            distance = ((r - tr) ** 2 + (g - tg) ** 2 + (b - tb) ** 2) ** 0.5
            if distance <= NEAR:
                alpha = 0
                cleared += 1
            elif distance >= FAR:
                alpha = 255
            else:
                alpha = int(round(255 * (distance - NEAR) / span))
            n = x * 4
            new[n], new[n + 1], new[n + 2], new[n + 3] = r, g, b, alpha
        out_rows.append(new)

    # Promote IHDR to colour type 6. Every other chunk — including the C2PA box — is carried
    # through by _write in its original order and is why this file exists rather than a Pillow call.
    promoted: list[tuple[bytes, bytes]] = []
    for kind, chunk in before:
        if kind == b"IHDR":
            fields = list(struct.unpack(">IIBBBBB", chunk[:13]))
            fields[3] = 6
            chunk = struct.pack(">IIBBBBB", *fields) + chunk[13:]
        promoted.append((kind, chunk))

    normalise_ground._write(path, out_rows, promoted, after)
    data = path.read_bytes()
    return cleared, hashlib.sha256(data).hexdigest(), len(data), C2PA_MARKER in data


def _job(args):
    relative, root = args
    path = Path(root) / relative
    try:
        return relative, cut(path), None
    except normalise_ground.Unsupported as err:
        return relative, None, str(err)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Key this set's sprites to alpha.")
    providers.add_argument(parser)
    parser.add_argument("--force", action="store_true", help="re-cut files already cut")
    args = parser.parse_args(argv)

    chosen = providers.selected(args)
    if not chosen:
        print("no provider has a manifest on disk", file=sys.stderr)
        return 1

    problems: list[str] = []
    for provider in chosen:
        document = json.loads(provider.manifest.read_text())
        assets = document["assets"]
        targets = [
            a
            for a in assets
            if a["set"] in CUT_SETS
            and a["derivedFrom"] is None
            and (args.force or STEP not in a.get("postProcessing", []))
        ]
        print(f"===== {provider.id}: {len(targets)} sprite(s) to cut")
        if not targets:
            continue

        with multiprocessing.Pool() as pool:
            results = pool.map(_job, [(a["path"], str(provider.root)) for a in targets])

        by_path = {a["path"]: a for a in assets}
        for relative, result, error in results:
            if error:
                problems.append(f"{provider.id}: {relative}: {error}")
                continue
            cleared, sha, size, c2pa = result
            entry = by_path[relative]
            entry["sha256"] = sha
            entry["byteSize"] = size
            # Measured on the bytes just written, never inherited from before the rewrite.
            entry["c2pa"] = c2pa
            steps = list(entry.get("postProcessing", []))
            if STEP not in steps:
                steps.append(STEP)
            entry["postProcessing"] = steps
            print(f"{relative}  {cleared} px cleared  c2pa={c2pa}")

        # `ensure_ascii=False`, to match generate.ts's JSON.stringify. Without it this tool
        # re-escapes every non-ASCII character generate.ts wrote raw, so MANIFEST.json
        # oscillates between two byte-different encodings of identical data depending on
        # which tool touched it last, and every run shows a diff nobody made.
        provider.manifest.write_text(json.dumps(document, indent=2, ensure_ascii=False) + "\n")

    for problem in problems:
        print(f"SKIPPED {problem}", file=sys.stderr)
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
