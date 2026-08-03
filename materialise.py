#!/usr/bin/env python3
"""Boot the estate against a CHOSEN asset set: resolve one by identity, and materialise it.

    python3 materialise.py --list
    python3 materialise.py --provider flux-2-pro       --into ../network-site/public --only network
    python3 materialise.py --provider qwen-image-2512  --into ../network-site/public --only network
    python3 materialise.py --provider qwen-image-2512  --into /tmp/x --dry-run

═══════════════════════════════════════════════════════════════════════════════════════════════
## THE PROBLEM

The estate should be able to start against FLUX, against a challenger, or against a model that
does not exist yet, and switching should be total rather than partial. What it must NOT mean is
"move files into `assets/`". The reference set is permanent by instruction; roughly twenty sibling
repositories point at `assets/<surface>/favicon-32x32.png` and friends; four CI jobs byte-compare
against those exact paths. Moving them would rewrite the `path` of every entry in every manifest.

## WHAT WAS MEASURED FIRST, BECAUSE IT DECIDED THE DESIGN

Nothing in the estate reads these repositories at run time. Every consumer holds a COMMITTED COPY
in its own `public/`, which Vite copies verbatim into `dist/` and the Dockerfile bakes into an
nginx image (`emberkin-web/Dockerfile:39`, and the same `COPY public ./public` in fifteen more).
`deploy/compose/docker-compose.estate.yml` mounts exactly one volume and it is `initdb.sql` — there
is no asset mount anywhere. And there is no tooling that put those copies there: they were made by
hand, which is why `aetherholm-web/index.html:37` still says the assets repository "does not exist
yet" long after it did.

So the seam that actually exists is the COPY, and today it is manual, unrecorded and undated.

## THE MECHANISM, AND THE TWO THAT WERE REJECTED

**Chosen: resolution by identity, executed at materialisation time.** A consumer never names a
set. It names a destination, and this resolves every asset the reference set defines against the
CHOSEN set, then writes the bytes out under the SAME relative path the reference uses. That path
is identical in every manifest by construction — `assets/admin/favicon-192x192.png` is the literal
string in the reference manifest and in every candidate's — so a consumer's `/favicon-32x32.png`
keeps working, byte for byte, whichever set is behind it. The variable lives in exactly one place:
the invocation. Identity was already a solved problem here (`providers.key_of`, driven by
`providers.json`'s `identity` block), which is why the resolver is thirty lines rather than a
framework, and why this file is byte-identical in all three asset repositories.

**Rejected — serve-time selection** (a gateway or nginx maps a stable URL onto a chosen directory).
It cannot work, and that is a measurement rather than a preference: no consumer fetches these
repositories over HTTP. Each web app's nginx serves its own baked copy out of
`/usr/share/nginx/html`, so there is no shared origin to rewrite; `deploy/gateway/dynamic/
estate-web.yml` routes by Host only and has no `/assets` or `/art` rule to hang this on. Choosing
it would mean first inventing the runtime seam it assumes, then still leaving the literal
`/favicon-32x32.png` in sixteen `index.html` files pointing at whatever was baked in.

**Rejected — a build-time variable every consumer honours.** The paths are literal strings in
sixteen `index.html` files, nine CI `test -f dist/$asset` checks and seven byte-comparing tests.
HTML cannot read a variable without a templating step the estate does not have, so "every consumer
honours it" means roughly fifty edits across repositories owned by other people, each one a place
the switch can be half-applied. Materialising instead leaves every one of those literals correct
and untouched.

## WHEN THE CHOSEN SET IS INCOMPLETE, THIS FAILS AND WRITES NOTHING

336 entries across the three repositories, of which 235 are generated and 101 derived, and a
challenger is normally partial for most of its life — the Qwen brand set is 97 of 98 today and its
Emberkin set is 134 of 137. So incompleteness is the common case, not the exceptional one.

A missing asset therefore **fails loudly, names every gap, and materialises nothing at all**. It
never falls back to the reference for the entries the chosen set lacks. A silent fallback would
produce a directory that is mostly Qwen and quietly partly FLUX, and every judgement made by
looking at it — which is the entire point of running a challenger — would be a judgement about a
blend nobody chose and nothing recorded. Partial writes are avoided the same way: the whole set is
resolved before the first byte is written.

`--only` narrows the contract as well as the copy, so materialising one surface out of a set that
is incomplete elsewhere is allowed, and is exactly how a single web app takes its own surface.

## THE RECEIPT

`SET.json` is written beside the files, naming the provider, the count and the sha256 of every
file. Without it "which set is this container serving?" is answerable only by eye, and the two
sets are deliberately the same shapes in the same colours.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

import providers

HERE = Path(__file__).resolve().parent

#: Files that are part of a set but are not shippable artefacts. `generate.ts` names an off-grid
#: delivery `<kind>-<w>x<h>-asdelivered.png` and keeps it beside the derivative that was cut from
#: it, because it is the copy that still carries its C2PA chunk. It is provenance, not something a
#: browser ever asks for, so it counts towards COMPLETENESS but is never copied into a `public/`.
NOT_SHIPPABLE = "-asdelivered"


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def entries_of(provider: providers.Provider) -> dict[str, dict]:
    """Index one provider's manifest by identity, spelled this repository's way."""
    if not provider.manifest.exists():
        return {}
    document = json.loads(provider.manifest.read_text())
    return {providers.key_of(entry): entry for entry in document.get("assets", [])}


def wanted(keys: dict[str, dict], only: list[str] | None) -> dict[str, dict]:
    """Narrow the contract to the assets asked for. `--only network` takes `network/...`.

    Matched on `label_of` — surface + kind here, the dotted asset path in the game repositories —
    so the same flag means the obvious thing in all three without this file knowing which it is in.
    """
    if not only:
        return keys
    return {
        key: entry
        for key, entry in keys.items()
        if any(providers.label_of(entry).startswith(prefix) for prefix in only)
    }


class IncompleteSetError(SystemExit):
    """Raised instead of writing a set that does not have everything the reference defines."""


def resolve(chosen: providers.Provider, only: list[str] | None) -> list[tuple[str, dict, Path]]:
    """Every asset the reference defines, resolved against the CHOSEN set. Total, or it raises.

    Returns (identity, chosen entry, absolute source path). Nothing is written by this function —
    resolution completes before materialisation begins, which is what makes a failed switch leave
    the destination exactly as it found it rather than half-swapped.
    """
    reference = providers.reference()
    contract = wanted(entries_of(reference), only)
    if not contract:
        raise SystemExit(
            f"nothing matches --only {', '.join(only or [])} in the reference set "
            f"({reference.id}); check the spelling against `python3 materialise.py --list`"
        )
    available = entries_of(chosen)

    resolved: list[tuple[str, dict, Path]] = []
    missing: list[str] = []
    for key in sorted(contract):
        entry = available.get(key)
        if entry is None:
            missing.append(key)
            continue
        source = chosen.root / entry["path"]
        if not source.exists():
            missing.append(f"{key} (recorded at {entry['path']}, but the file is not there)")
            continue
        resolved.append((key, entry, source))

    if missing:
        listed = "\n  ".join(missing)
        raise IncompleteSetError(
            f"\nINCOMPLETE SET — nothing was written.\n\n"
            f"{chosen.id} is missing {len(missing)} of the {len(contract)} asset(s) the reference "
            f"set ({reference.id}) defines:\n  {listed}\n\n"
            "This is deliberately fatal and there is deliberately no fallback. Filling the gaps "
            "from the reference would produce a directory that is mostly one model and quietly "
            "partly another, and every comparison made by looking at it would be a comparison "
            "with something nobody chose. Generate the missing assets, or narrow the switch with "
            "--only.\n"
        )
    return resolved


def destination_of(entry: dict, flatten: bool) -> Path:
    """Where one asset lands under the destination directory.

    Relative to the set root, so `assets/admin/favicon-192x192.png` becomes
    `admin/favicon-192x192.png`. That string is the SAME in every provider's manifest, which is the
    whole reason a consumer never has to change.

    `--flatten` drops the leading segment, because the estate's web apps do not mirror this
    layout: `micro-network-site` holds `public/favicon-32x32.png` and its `index.html:61` asks for
    `/favicon-32x32.png`, flat, having taken exactly one surface out of a repository that has
    fourteen. `micro-emberkin-web` is the other shape — `public/art/` mirrors `assets/` exactly and
    wants no flattening — which is why this is a flag rather than a rule.
    """
    relative = Path(entry["path"]).relative_to("assets")
    if flatten and len(relative.parts) > 1:
        return Path(*relative.parts[1:])
    return relative


def assert_no_collisions(resolved: list[tuple[str, dict, Path]], flatten: bool) -> None:
    """Refuse to flatten a selection whose assets would land on top of one another.

    Flattening is only meaningful for a selection that is already one surface deep. Flattening the
    whole brand set would put `site/mark-1024x1024.png` and `hub/mark-1024x1024.png` on the same
    destination path, and the survivor would be whichever happened to be copied last — a directory
    that looks complete, is silently missing thirteen marks, and reports no error. So: collisions
    are fatal, and like an incomplete set they are detected before anything is written.
    """
    if not flatten:
        return
    seen: dict[Path, str] = {}
    clashes: list[str] = []
    for key, entry, _ in resolved:
        target = destination_of(entry, flatten=True)
        if target in seen:
            clashes.append(f"{target}  <-  {seen[target]}  AND  {key}")
        seen[target] = key
    if clashes:
        listed = "\n  ".join(clashes)
        raise SystemExit(
            f"\nFLATTENED PATHS COLLIDE — nothing was written.\n\n"
            f"{len(clashes)} destination(s) would be written twice:\n  {listed}\n\n"
            "--flatten drops the leading path segment, so it only makes sense for a selection "
            "that is already one surface deep. Narrow it with --only, or drop --flatten.\n"
        )


def materialise(
    chosen: providers.Provider,
    into: Path,
    resolved: list[tuple[str, dict, Path]],
    dry_run: bool,
    flatten: bool,
) -> dict:
    """Write the chosen set out under the paths the consumers already hardcode."""
    reference = providers.reference()
    files: list[dict] = []
    written = 0
    for key, entry, source in resolved:
        relative = destination_of(entry, flatten)
        record = {
            "key": key,
            "path": str(relative),
            "sha256": entry["sha256"],
            "declaredSize": entry["declaredSize"],
            "shipped": NOT_SHIPPABLE not in source.name,
        }
        files.append(record)
        if NOT_SHIPPABLE in source.name:
            continue
        if not dry_run:
            target = into / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
            # Measured off the bytes that landed, never inherited from the manifest: the manifest
            # records what the generator wrote, and this records what the destination now holds.
            record["materialisedSha256"] = digest(target)
        written += 1

    receipt = {
        "$comment": [
            "Which asset set this directory currently holds, written by materialise.py.",
            "",
            "Without this the question 'which model's art is this container serving?' is only",
            "answerable by eye, and the sets are deliberately the same shapes in the same",
            "colours. Do not edit by hand; re-run materialise.py to change it.",
        ],
        "provider": chosen.id,
        "providerLabel": chosen.label,
        "vendor": chosen.vendor,
        "shipped": chosen.shipped,
        "reference": reference.id,
        "isReference": chosen.id == reference.id,
        "flattened": flatten,
        "assetCount": len(files),
        "materialisedCount": written,
        "materialisedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "files": files,
    }
    if not dry_run:
        into.mkdir(parents=True, exist_ok=True)
        (into / "SET.json").write_text(json.dumps(receipt, indent=2) + "\n")
    return receipt


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--provider", default=None, help="provider id from providers.json")
    parser.add_argument("--into", default=None, help="destination directory, e.g. ../site/public")
    parser.add_argument(
        "--only",
        action="append",
        default=None,
        metavar="PREFIX",
        help="narrow to assets whose label starts with PREFIX; repeatable. Narrows the "
        "completeness contract too, so one surface may be taken from an otherwise partial set.",
    )
    parser.add_argument(
        "--flatten",
        action="store_true",
        help="drop the leading path segment, so `network/favicon-32x32.png` lands as "
        "`favicon-32x32.png`. What a web app that takes one surface needs. Collisions are fatal.",
    )
    parser.add_argument("--dry-run", action="store_true", help="resolve and report; write nothing")
    parser.add_argument("--list", action="store_true", help="which sets exist, and how complete")
    args = parser.parse_args(argv[1:])

    if args.list:
        reference = providers.reference()
        contract = entries_of(reference)
        print(f"reference: {reference.id} ({len(contract)} assets)\n")
        for provider in providers.load():
            if not provider.exists:
                print(f"  {provider.id:<20} not generated")
                continue
            have = entries_of(provider)
            gaps = [k for k in contract if k not in have]
            state = "COMPLETE" if not gaps else f"missing {len(gaps)}"
            print(f"  {provider.id:<20} {len(have):>4} assets  {state}")
            for gap in sorted(gaps):
                print(f"  {'':<20}      - {gap}")
        return 0

    if not args.provider or not args.into:
        parser.error("--provider and --into are both required (or use --list)")

    chosen = providers.by_id(args.provider)
    if not chosen.exists:
        raise SystemExit(
            f"{chosen.id} has no manifest at {chosen.manifest} — it has not been generated. "
            "`python3 materialise.py --list` shows which sets exist."
        )

    resolved = resolve(chosen, args.only)
    assert_no_collisions(resolved, args.flatten)
    into = Path(args.into).resolve()
    receipt = materialise(chosen, into, resolved, args.dry_run, args.flatten)

    verb = "would materialise" if args.dry_run else "materialised"
    print(
        f"{verb} {receipt['materialisedCount']} file(s) of {receipt['assetCount']} resolved "
        f"from {chosen.id} ({chosen.label}) into {into}"
    )
    if not chosen.shipped:
        print(
            f"NOTE: {chosen.id} is a CANDIDATE set, not the shipped one. "
            f"The shipped set is {providers.reference().id}."
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
