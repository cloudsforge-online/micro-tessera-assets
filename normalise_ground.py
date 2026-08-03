#!/usr/bin/env python3
"""Snap every flat-ground asset's background to the brand ash ground, and record what it was.

FLUX will not reproduce an exact hex. Across the brand run the delivered grounds ranged from
#232324 to #3f3a3b against a target of #12100f — all too light, several neutral grey rather than
warm ash, and, worse, inconsistent WITH EACH OTHER, so the set did not read as one family. A mark
placed on the app's real background shows as a visibly lighter square.

Reprompting does not fix this reliably. It is a numeric property, so it is corrected numerically:
pixels near the sampled ground are remapped to the exact brand value, pixels belonging to the
artwork are left alone, and the band between them is blended so anti-aliased edges do not acquire
a halo.

Three things this does that micro-brand's `normalise_ground.py` does not:

  1. **It only touches the assets the plan declares `flat`.** Keyart, the capsule, the hero and
     the social banner are `scene` — they ARE pictures, edge to edge, and snapping a keyart's sky
     to a single hex would not enforce a brand rule, it would destroy the artwork. Those are held
     to a darkness ceiling by `verify.py` instead, and the manifest says which rule was applied to
     which file rather than implying one rule covered everything.
  2. **It preserves every ancillary PNG chunk**, so the C2PA provenance box and the vendor's
     metadata survive the rewrite. The brand version wrote a fresh IHDR/IDAT/IEND and silently
     dropped them. Since every image FLUX returns carries C2PA and a disclosure obligation
     attaches to it, losing it in post-processing is a real cost and it was avoidable in about
     fifteen lines.
  3. **It writes back to the manifest**: the ground as delivered, the new checksum and byte size,
     the re-measured C2PA state, and the post-processing step itself. A manifest whose checksums
     no longer match the files it describes is worse than no manifest, and running a rewrite step
     after the manifest was written is exactly how that happens.

Pure standard library — no Pillow — so this runs anywhere the estate's CI runs. It is parallel
across files because the filter reconstruction is per-byte Python and a 1024 square is three
million bytes of it; `multiprocessing` is stdlib and turns half an hour into a few minutes.

    python3 normalise_ground.py           # every flat asset not already normalised
    python3 normalise_ground.py --force   # re-run over assets already normalised
    python3 normalise_ground.py --dry-run # report the delivered grounds, change nothing
"""

from __future__ import annotations

import json
import multiprocessing
import struct
import sys
import zlib
from pathlib import Path

HERE = Path(__file__).resolve().parent
# Resolved per provider at run time; see main(). Kept as a name so nothing below
# reaches for a hardcoded path.
MANIFEST = HERE / "MANIFEST.json"

TARGET = (0x12, 0x10, 0x0F)
STEP = "ground normalised to #12100f by normalise_ground.py"

# Below NEAR the pixel is ground and is snapped outright; above FAR it is artwork and is untouched.
# Between them it is blended, which is what keeps a 2px anti-aliased edge from turning into a
# visible ring. Compared as squares, so the common case never takes a square root.
NEAR = 46.0
FAR = 96.0
NEAR_SQ = NEAR * NEAR
FAR_SQ = FAR * FAR

C2PA_MARKER = b"c2pa"


class Unsupported(Exception):
    """The file is a PNG this decoder will not touch. Loud, rather than silently mangled."""


def _read(path: Path):
    """Decode a PNG to rows, keeping every chunk that is not IDAT so it can be written back."""
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise Unsupported(f"{path.name} is not a PNG")
    pos = 8
    idat = bytearray()
    before: list[tuple[bytes, bytes]] = []
    after: list[tuple[bytes, bytes]] = []
    width = height = channels = 0
    seen_idat = False
    while pos < len(data):
        length = struct.unpack(">I", data[pos : pos + 4])[0]
        kind = data[pos + 4 : pos + 8]
        chunk = data[pos + 8 : pos + 8 + length]
        if kind == b"IHDR":
            width, height, depth, colour, compression, filt, interlace = struct.unpack(
                ">IIBBBBB", chunk[:13]
            )
            if depth != 8:
                raise Unsupported(f"{path.name} is {depth}-bit; only 8-bit is handled")
            if colour not in (2, 6):
                raise Unsupported(f"{path.name} is colour type {colour}; only 2 and 6 are handled")
            if interlace != 0:
                raise Unsupported(f"{path.name} is interlaced")
            channels = 4 if colour == 6 else 3
            before.append((kind, chunk))
        elif kind == b"IDAT":
            idat += chunk
            seen_idat = True
        elif kind == b"IEND":
            pass
        else:
            (after if seen_idat else before).append((kind, chunk))
        pos += 12 + length

    raw = zlib.decompress(bytes(idat))
    stride = width * channels
    rows: list[bytearray] = []
    prev = bytearray(stride)
    i = 0
    for _ in range(height):
        filt = raw[i]
        i += 1
        line = bytearray(raw[i : i + stride])
        i += stride
        if filt == 0:
            pass
        elif filt == 1:
            for x in range(channels, stride):
                line[x] = (line[x] + line[x - channels]) & 255
        elif filt == 2:
            for x in range(stride):
                line[x] = (line[x] + prev[x]) & 255
        elif filt == 3:
            for x in range(stride):
                a = line[x - channels] if x >= channels else 0
                line[x] = (line[x] + ((a + prev[x]) >> 1)) & 255
        elif filt == 4:
            for x in range(stride):
                a = line[x - channels] if x >= channels else 0
                b = prev[x]
                c = prev[x - channels] if x >= channels else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pred = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[x] = (line[x] + pred) & 255
        else:
            raise Unsupported(f"{path.name} row uses filter {filt}")
        rows.append(line)
        prev = line
    return width, height, channels, rows, before, after


def _write(path: Path, rows, before, after) -> None:
    """Re-encode, carrying every preserved chunk through in its original order.

    This is the whole reason the C2PA box survives normalisation. The chunks that came before the
    image data are written before it and the ones that came after are written after, because a
    reader is entitled to that ordering and a signed provenance box in the wrong place is a box
    that does not verify.
    """
    raw = b"".join(b"\x00" + bytes(r) for r in rows)

    def chunk(kind: bytes, payload: bytes) -> bytes:
        return (
            struct.pack(">I", len(payload))
            + kind
            + payload
            + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)
        )

    out = bytearray(b"\x89PNG\r\n\x1a\n")
    for kind, payload in before:
        out += chunk(kind, payload)
    out += chunk(b"IDAT", zlib.compress(raw, 9))
    for kind, payload in after:
        out += chunk(kind, payload)
    out += chunk(b"IEND", b"")
    path.write_bytes(bytes(out))


def _sample_ground(width, height, channels, rows) -> tuple[int, int, int]:
    """The modal border colour. The border is ground on every flat asset in the set."""
    counts: dict[tuple[int, int, int], int] = {}
    band = max(2, min(width, height) // 40)
    ys = list(range(band)) + list(range(height - band, height))
    for y in ys:
        line = rows[y]
        for x in range(0, width, 2):
            o = x * channels
            key = (line[o] // 8, line[o + 1] // 8, line[o + 2] // 8)
            counts[key] = counts.get(key, 0) + 1
    best = max(counts, key=counts.get)
    return (best[0] * 8 + 4, best[1] * 8 + 4, best[2] * 8 + 4)


def normalise(path: Path, dry_run: bool = False):
    width, height, channels, rows, before, after = _read(path)
    ground = _sample_ground(width, height, channels, rows)
    if dry_run:
        return ground, 0, None, None, None

    changed = 0
    tr, tg, tb = TARGET
    gr, gg, gb = ground
    for y in range(height):
        line = rows[y]
        for x in range(width):
            o = x * channels
            r = line[o] - gr
            g = line[o + 1] - gg
            b = line[o + 2] - gb
            dist_sq = r * r + g * g + b * b
            if dist_sq >= FAR_SQ:
                continue
            if dist_sq <= NEAR_SQ:
                line[o] = tr
                line[o + 1] = tg
                line[o + 2] = tb
            else:
                w = (FAR - dist_sq**0.5) / (FAR - NEAR)
                line[o] = int(round(line[o] + (tr - line[o]) * w))
                line[o + 1] = int(round(line[o + 1] + (tg - line[o + 1]) * w))
                line[o + 2] = int(round(line[o + 2] + (tb - line[o + 2]) * w))
            changed += 1
    # The finishing pass, measured into existence by this repository's own first verify run: the
    # blend band above works RELATIVE TO THE SAMPLED DELIVERED GROUND, so a pixel can end one or
    # two values shy of the target (#13110f against #12100f) and a faint near-ground cloud edge
    # can survive at #201a15 — and the exact-corner check rightly fails both. Anything already
    # within SNAP of the target IS ground for every purpose this file exists for, so it is
    # snapped exactly; the band out to SNAP_FAR is pulled toward the target proportionally so no
    # ring appears. Values this close to near-black are indistinguishable shadow; artwork is
    # untouched.
    SNAP, SNAP_FAR = 20.0, 40.0
    snap_sq, snap_far_sq = SNAP * SNAP, SNAP_FAR * SNAP_FAR
    for y in range(height):
        line = rows[y]
        for x in range(width):
            o = x * channels
            r = line[o] - tr
            g = line[o + 1] - tg
            b = line[o + 2] - tb
            dist_sq = r * r + g * g + b * b
            if dist_sq == 0 or dist_sq >= snap_far_sq:
                continue
            if dist_sq <= snap_sq:
                line[o] = tr
                line[o + 1] = tg
                line[o + 2] = tb
            else:
                w = (SNAP_FAR - dist_sq**0.5) / (SNAP_FAR - SNAP)
                line[o] = int(round(line[o] + (tr - line[o]) * w))
                line[o + 1] = int(round(line[o + 1] + (tg - line[o + 1]) * w))
                line[o + 2] = int(round(line[o + 2] + (tb - line[o + 2]) * w))
            changed += 1
    # The edge matte. A flat sprite exists to be composited onto the game's own ground, so its
    # frame edge must BE that ground — and this run measured FLUX drifting soft cloud wisps and
    # light into the outer margin of the island sprites on roll after roll, through a prompt
    # that forbids exactly that. Re-rolling was tried and lost three times out of five. So the
    # sprite is matted the way a hand pipeline would matte it: exact ground through the depth
    # verify.py's corner patches sample (min/24, plus two for safety), then a fade band twice as
    # deep so nothing acquires a cut edge. Artwork is untouched beyond ~8% of the frame; the
    # subjects are centred with even margins by the plan's own composition rules.
    band_exact = max(8, min(width, height) // 24) + 2
    band_fade = band_exact * 2
    for y in range(height):
        line = rows[y]
        for x in range(width):
            depth = min(x, y, width - 1 - x, height - 1 - y)
            if depth >= band_fade:
                continue
            o = x * channels
            if depth < band_exact:
                if line[o] != tr or line[o + 1] != tg or line[o + 2] != tb:
                    line[o] = tr
                    line[o + 1] = tg
                    line[o + 2] = tb
                    changed += 1
            else:
                w = (band_fade - depth) / (band_fade - band_exact)
                line[o] = int(round(line[o] + (tr - line[o]) * w))
                line[o + 1] = int(round(line[o + 1] + (tg - line[o + 1]) * w))
                line[o + 2] = int(round(line[o + 2] + (tb - line[o + 2]) * w))
                changed += 1
    _write(path, rows, before, after)

    data = path.read_bytes()
    import hashlib

    return ground, changed, hashlib.sha256(data).hexdigest(), len(data), C2PA_MARKER in data


def _job(args):
    relative, dry_run = args
    path = HERE / relative
    try:
        return relative, normalise(path, dry_run), None
    except Unsupported as err:  # a fact about the file, not a crash
        return relative, None, str(err)


def main(argv: list[str]) -> int:
    force = "--force" in argv
    dry_run = "--dry-run" in argv
    if not MANIFEST.exists():
        print("MANIFEST.json does not exist; generate first", file=sys.stderr)
        return 1
    document = json.loads(MANIFEST.read_text())
    assets = document["assets"]

    # Flat ground only, and only the as-delivered files: a derivative is cut from a parent that
    # was already normalised, so normalising it again would be a second pass over the same pixels.
    targets = [
        a
        for a in assets
        if a["groundClass"] == "flat"
        and a["derivedFrom"] is None
        and (force or STEP not in a.get("postProcessing", []))
    ]
    if not targets:
        print("nothing to normalise (every flat asset is already normalised; --force to redo)")
        return 0

    print(f"{len(targets)} flat-ground asset(s) to normalise")
    with multiprocessing.Pool() as pool:
        results = pool.map(_job, [(a["path"], dry_run) for a in targets])

    by_path = {a["path"]: a for a in assets}
    grounds: list[tuple[str, tuple[int, int, int]]] = []
    problems: list[str] = []

    for relative, result, error in results:
        if error:
            problems.append(f"{relative}: {error}")
            continue
        ground, changed, sha, size, c2pa = result
        grounds.append((relative, ground))
        hexed = "#%02x%02x%02x" % ground
        print(f"{relative}  was {hexed}  remapped {changed} px")
        if dry_run:
            continue
        entry = by_path[relative]
        # Written once, at the FIRST normalisation of the file, and never on a re-run: this
        # field records what FLUX delivered, and a --force pass samples an already-normalised
        # file. This repository's own second pass overwrote 81 entries before this guard
        # existed — those now read null, honestly, because the truth is unrecoverable (README
        # §8 records the range measured before the loss).
        if entry.get("deliveredGround") is None and STEP not in entry.get("postProcessing", []):
            entry["deliveredGround"] = hexed
        entry["sha256"] = sha
        entry["byteSize"] = size
        entry["c2pa"] = c2pa
        steps = list(entry.get("postProcessing", []))
        if STEP not in steps:
            steps.append(STEP)
        entry["postProcessing"] = steps

    if not dry_run:
        MANIFEST.write_text(json.dumps(document, indent=2) + "\n")

    # The evidence that the step was needed at all: what FLUX actually delivered, and how far
    # apart the delivered grounds were from each other. One number is a curiosity; a RANGE is the
    # argument, because a set whose grounds disagree does not read as one family however dark
    # each of them is on its own.
    if grounds:
        luma = lambda g: 0.2126 * g[0] + 0.7152 * g[1] + 0.0722 * g[2]  # noqa: E731
        ordered = sorted(grounds, key=lambda item: luma(item[1]))
        lo, hi = ordered[0], ordered[-1]
        print(
            f"\ndelivered grounds ranged #{lo[1][0]:02x}{lo[1][1]:02x}{lo[1][2]:02x} ({lo[0]}) "
            f"to #{hi[1][0]:02x}{hi[1][1]:02x}{hi[1][2]:02x} ({hi[0]}) "
            f"against a target of #{TARGET[0]:02x}{TARGET[1]:02x}{TARGET[2]:02x}"
        )
        distinct = len({g for _, g in grounds})
        print(f"{distinct} distinct delivered grounds across {len(grounds)} file(s)")

    for problem in problems:
        print(f"SKIPPED {problem}", file=sys.stderr)
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
