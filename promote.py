#!/usr/bin/env python3
"""Make a candidate set the SHIPPED set — one command, reversible by the same command.

    python3 promote.py --list                       # which set is shipped, which are on trial
    python3 promote.py --provider gpt-image-2 --dry-run
    python3 promote.py --provider gpt-image-2       # switch
    python3 promote.py --provider flux-2-pro        # switch back; the same command, no flag

═══════════════════════════════════════════════════════════════════════════════════════════════
## THIS IMPLEMENTS THE PATH providers.json ALREADY SPECIFIED, RATHER THAN A NEW ONE

The registry header has said since it was written: "the reference set is SHIPPED and a challenger
is on trial. If a challenger wins it is promoted by moving its tree to `assets/`, and the
`provider` field on each entry records which model the shipped bytes came from." That was a
sentence with no executable behind it for as long as there was nothing to promote — which is the
state in which a described path quietly stops being true — so this file is that sentence and
nothing else. In particular the reference set does NOT move to `sets/flux/` to make the two roots
look alike: this repository's CI globs `assets/**/*.png` (`.github/workflows/ci.yml:54`), and
`materialise.py`'s own header records that nothing in the estate reads these repositories at run
time — every consumer holds a hand-made committed copy.

## WHY MOVING A TREE IS SAFE HERE, WHICH IS NOT OBVIOUS

Every manifest records `path` RELATIVE TO ITS OWN PROVIDER ROOT, and every set uses the identical
string: `assets/chrome/mark-1024x1024.png` is what the reference manifest says and what
`candidates/gpt-image-2/MANIFEST.json` says. materialise.py's whole design rests on that
(`destination_of` strips the leading `assets/`), and it is what makes a promotion a MOVE rather
than a rewrite: after `candidates/gpt-image-2/{assets,MANIFEST.json}` become `{assets,MANIFEST.json}`
at the root, not one `path`, one `sha256` or one byte inside either manifest has changed. This
script asserts that afterwards rather than assuming it — every checksum in both manifests is
re-derived from the bytes at their new locations before the swap is allowed to stand. At 392
entries a side that is the largest such check in the estate, and it still runs in under a second.

## THE LOSER IS DEMOTED, NEVER DELETED

The outgoing reference goes to `candidates/<its id>/`, which is precisely where a challenger
lives, and its registry entry is updated to match. Deleting it would destroy the only copy of the
set the comparison was made against and leave every number in COMPARISON.md pointing at nothing.
It also makes the switch its own inverse: after promoting gpt-image-2, `python3 promote.py
--provider flux-2-pro` is a complete, symmetric undo, because flux-2-pro is by then an ordinary
candidate. Nothing about the reverse direction is special-cased — there is one code path and the
two ids are arguments to it.

## WHAT IS CHECKED BEFORE ANYTHING MOVES

  1. The candidate is COMPLETE. `materialise.resolve` is reused rather than reimplemented, so
     "complete" means exactly what it means when a consumer takes the set: every key the
     reference defines, resolved, with the file actually on disk. A partial promotion would ship
     a directory that is mostly one model and quietly partly another. This set is 288 generated
     and 104 derived — and the derived are not a garnish here, they are 96 isometric tiles cut
     from the 32 terrain plates by `project_iso.py` plus 8 crops and favicons from `derive.py` —
     so a candidate that has been generated but never passed through `generate.ts --derive-only`
     stands at 288 of 392 and stops here.
  2. `verify.py --provider <id> --as-shipped` passes on the candidate AS IT STANDS TODAY, at its
     candidate root. Refusing here rather than after the move is the difference between a switch
     that did not happen and a repository in a half-swapped state.
  3. No destination path already exists THAT THE PROMOTION DOES NOT ITSELF VACATE. The winner's
     destinations are `assets/` and `MANIFEST.json` at the root, which are occupied by the
     outgoing reference until the first moves carry it to `candidates/`; the check walks the plan
     in order and asks whether a path is still occupied by the time it is needed. A leftover
     `candidates/flux-2-pro/` from an interrupted run is a stop, not something to merge into.

And after the move, before the registry is written: every sha256 in BOTH manifests is re-derived
from the bytes at their new paths. If a single one disagrees the move is rolled back file by file
and nothing is written. That check is the reason this is safe to run on a repository whose
reference set is permanent by instruction.

## WHAT THIS DOES NOT TOUCH, ON PURPOSE

`PLAN.json` (the plan is the repository's, not a set's — it is regenerated from plan.ts off
`content/*.json`, which live HERE rather than in a sibling game checkout, so it moves when the
content does), `review/` (contact sheets are built on demand and are gitignored), `ART_BIBLE.md`,
and every consumer's `public/` copy.
**A promotion does not materialise anything.** The estate's copies are updated by `python3
materialise.py --provider <id> --into <path>` exactly as before, and the whole point of this
script is that the id in that command stops changing.

## THE CONSUMER SITUATION HERE IS NOT THE SIBLINGS', AND IT WAS MEASURED

`micro-aetherholm-assets`'s copy of this file can end by naming the exact re-materialise command,
because 80 of that consumer's committed PNGs checksum-match its manifest. **That is not true
here, and this file says so rather than printing an incantation that would write the wrong
files.** `tessera-web/public` holds five PNGs, flat at the root, and on this branch: NONE of the
five checksum-matches any entry in `MANIFEST.json`, and four of the five do not even use this
repository's file names (`favicon-32x32.png` against this set's `favicon-32-32x32.png`,
`apple-touch-icon-180x180.png` against `apple-touch-180-180x180.png`). `index.html` asks for the
five names it has. So a `materialise.py --only chrome --flatten` into that directory today would
add eight correctly-named files beside five differently-named ones that the page would go on
serving, and the switch would appear not to have happened.

That is a real defect and it is NOT this file's to fix — it predates both challengers and it
belongs to the consumer's naming, not to any model. It is recorded here because the closing
message of a promotion is exactly where an operator looks for the next command, and sending them
to one that silently no-ops is worse than sending them nowhere.

## WHERE THIS FILE CAME FROM, AND WHAT THE FOURTH PORT FOUND

Ported from `micro-aetherholm-assets/promote.py`, itself ported from `micro-emberkin-assets`'s and
originally from `micro-brand`'s — written first, exercised first, and carrying two comments that
record failures rather than designs. Both arrive here already fixed, because the same code would
have failed the same way:

  * The collision check originally asked `destination.exists()` over every move and so could never
    pass — the winner's destinations are occupied BY THE OUTGOING REFERENCE until the plan moves
    it. The ordered `vacated` walk below is the fixed form.
  * That earlier gate was completeness, and it fired in two of the three earlier repositories for
    the same reason: a shipped derivative with no derivation recipe (`site/avatar` in micro-brand;
    three INFERRED favicons in micro-emberkin-assets). **This repository does not have that defect
    either, and that was measured rather than assumed on this branch**: all 104 of its derivatives
    name a real `derivedFrom` source in MANIFEST.json, none carries an INFERRED note, and
    `materialise.resolve(providers.reference(), None)` resolves 392 of 392.

This is the fourth copy and the first in a repository with no `shared` block in its registry.
`claims.py` — which requires three siblings' `shared` blocks to be byte-equal and reports a
`perRepository` entry present in fewer than two checkouts as unverified — does not exist here and
does not read this file. So there is nothing to add in THIS registry, and the entry that is still
owed is the one across the other three, in one change rather than unilaterally from any of them.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

import materialise
import providers

HERE = Path(__file__).resolve().parent
REGISTRY = HERE / "providers.json"

#: The artefacts that belong to a SET rather than to the repository, and therefore move with it.
#: Deliberately a short, explicit list and not "everything under the root" — the reference set's
#: root IS the repository, so a wildcard there would move verify.py, content/ and plan.ts.
#:
#: `native/` is here because gpt-image-2 refuses to generate below a measured pixel budget, which
#: lands in (524288, 655360]: TWO HUNDRED AND TWENTY-NINE of this set's 288 generations are made
#: larger and Lanczos'd down, and the as-delivered original is kept outside `assets/` (verify.py's
#: orphan walk would fail it, check_parity's subset rule would fail an entry for it). It is the
#: provenance of the shipped bytes — the only copy that still carries the C2PA box the resample
#: drops — so it follows them. 80% of a gpt-image-2 set here, against 76% in
#: micro-aetherholm-assets, 25% in micro-emberkin-assets and 4% in micro-brand: forgetting this
#: entry would strand four fifths of the provenance of a promoted set. `DEPLOYMENT.json` is listed
#: for the same reason and is absent for both sets that exist today: it belongs to a Managed
#: Compute candidate, whose bill is wall-clock, and `artefacts_of` skips what is not on disk.
SET_ARTEFACTS = ("assets", "MANIFEST.json", "native", "DEPLOYMENT.json")


def relative(path: Path) -> str:
    return str(path.relative_to(HERE)) if path != HERE else "."


def artefacts_of(provider: providers.Provider) -> list[Path]:
    """The set artefacts this provider actually has on disk, as absolute paths."""
    return [provider.root / name for name in SET_ARTEFACTS if (provider.root / name).exists()]


def check_manifest_against_bytes(manifest: Path, root: Path) -> list[str]:
    """Every sha256 in one manifest, re-derived from the file at its recorded path.

    Cheap (392 files, one pass) and it is the only check that can tell a correct move from a move
    that lost, truncated or half-copied a file. Run AFTER the move on both sets, which is the
    moment where a mistake would otherwise become the shipped state.

    `nativePath` is checked for existence rather than for content: it is a path INSIDE the set's
    root, so a move that dropped `native/` entirely would otherwise pass every checksum here and
    lose the only bytes that still carry the delivery's C2PA box — for four fifths of a
    gpt-image-2 set in this repository.
    """
    problems: list[str] = []
    if not manifest.exists():
        return [f"{relative(manifest)} is not there"]
    document = json.loads(manifest.read_text())
    for asset in document.get("assets", []):
        path = root / asset["path"]
        if not path.exists():
            problems.append(f'{asset["path"]}: recorded, not on disk')
            continue
        if hashlib.sha256(path.read_bytes()).hexdigest() != asset["sha256"]:
            problems.append(f'{asset["path"]}: checksum no longer matches the manifest')
        native = asset.get("nativePath")
        if native and not (root / native).exists():
            problems.append(f"{native}: as-delivered native named by the manifest, not on disk")
    return problems


def run_verify(provider_id: str) -> tuple[bool, str]:
    """verify.py on one set, as a subprocess, so its exit code is the answer and not a rewrite.

    `--as-shipped` is the whole point of this gate. Without it, verify.py reads this set's art
    direction as fatal for the SHIPPED set and as a reported warning for a candidate — correctly,
    because a candidate is on trial — so a candidate can exit 0 here, be moved onto `assets/`, and
    turn the repository red on the next run under rules it was never held to. The question this
    gate has to ask is not "is the candidate acceptable as a candidate" but "what would this set
    score if it were the shipped one", and that is the flag.

    It is not hypothetical here, and this repository has THREE ground classes rather than the
    siblings' two, so it has three ways to fail it. A `flat` asset must be EXACTLY #12100f in all
    four corners, which no endpoint delivers — the shipped set only passes because
    `normalise_ground.py --provider <id>` was run over it. A `plate` must be full-bleed above a
    0.25 floor. A `scene` edge must sit under a 0.12 luma ceiling. All three are conformance, and
    a candidate that was generated and never normalised reads `warn` on every one of them and
    `FAIL` on every one of them one second after the move.

    What this gate does NOT have to carry is the keying: `check_keyed` (check 8a) is INTEGRITY,
    so a candidate whose 48 avatar plates never went through `cutout.py` is already red under a
    plain `verify.py --provider <id>` and never reaches --as-shipped. That is the right split —
    an unkeyed plate composites as an opaque rectangle over the base figure, which is a broken
    file rather than a finding about a model.
    """
    result = subprocess.run(
        [sys.executable, str(HERE / "verify.py"), "--provider", provider_id, "--as-shipped"],
        capture_output=True,
        text=True,
        cwd=HERE,
    )
    return result.returncode == 0, (result.stdout + result.stderr)


# ── the registry edit ──────────────────────────────────────────────────────────────────────────
#
# providers.json is edited SURGICALLY — a handful of lines located and replaced — rather than
# parsed and re-dumped, and that is a measured decision rather than fastidiousness. The file mixes
# escaped and literal em dashes (some prose was added by an editor that escapes non-ASCII and some
# by one that does not), so `json.dumps(..., indent=2)` does not round-trip it in EITHER
# `ensure_ascii` mode: it rewrites lines of unrelated prose across the whole header. A promotion
# whose diff touches the registry's entire header is a promotion nobody can review, and the review
# is the point. (That mixture is not hypothetical in this file. The gpt-image-2 registration on
# this branch had to be written by line index and re-emitted through
# `json.dumps(..., ensure_ascii=False)` for exactly this reason, after a match on `—` found
# nothing because the line held a literal em dash.)
#
# The safety net is not the string matching. It is `assert_only_expected_changes` below, which
# re-parses the written text and fails unless the parsed document differs from the original in
# exactly the keys this script meant to change — so a textual edit that hit the wrong line is
# caught structurally rather than trusted.


def _entry_span(lines: list[str], provider_id: str) -> tuple[int, int]:
    """The line range [start, end) of one provider's object, located by its `id` line."""
    marker = f'      "id": "{provider_id}",'
    try:
        start = lines.index(marker)
    except ValueError as exc:
        raise SystemExit(f"providers.json has no entry line for {provider_id!r}") from exc
    end = start + 1
    while end < len(lines) and not lines[end].startswith("      \"id\":"):
        if lines[end] == "    {":
            break
        end += 1
    return start, end


def _replace_field(lines: list[str], span: tuple[int, int], field: str, rendered: str) -> None:
    start, end = span
    prefix = f'      "{field}": '
    for index in range(start, end):
        if lines[index].startswith(prefix):
            trailing = "," if lines[index].rstrip().endswith(",") else ""
            lines[index] = f"{prefix}{rendered}{trailing}"
            return
    raise SystemExit(f'providers.json entry has no "{field}" line where one was expected')


def rewrite_registry(text: str, winner: providers.Provider, loser: providers.Provider) -> str:
    lines = text.split("\n")

    reference_line = f'  "reference": "{loser.id}",'
    if reference_line not in lines:
        raise SystemExit('providers.json\'s top-level "reference" line is not where expected')
    lines[lines.index(reference_line)] = f'  "reference": "{winner.id}",'

    winner_span = _entry_span(lines, winner.id)
    _replace_field(lines, winner_span, "root", '"."')
    _replace_field(lines, winner_span, "shipped", "true")

    loser_span = _entry_span(lines, loser.id)
    _replace_field(lines, loser_span, "root", f'"candidates/{loser.id}"')
    _replace_field(lines, loser_span, "shipped", "false")

    return "\n".join(lines)


def assert_only_expected_changes(before: str, after: str, winner_id: str, loser_id: str) -> None:
    """Re-parse both and fail unless exactly the intended keys moved. The real safety net."""
    old = json.loads(before)
    new = json.loads(after)

    expected = json.loads(before)
    expected["reference"] = winner_id
    for entry in expected["providers"]:
        if entry["id"] == winner_id:
            entry["root"], entry["shipped"] = ".", True
        elif entry["id"] == loser_id:
            entry["root"], entry["shipped"] = f"candidates/{loser_id}", False

    if new != expected:
        differing = sorted(
            k for k in set(old) | set(new) if old.get(k) != new.get(k) or expected.get(k) != new.get(k)
        )
        raise SystemExit(
            "REFUSING TO WRITE providers.json — the surgical edit changed something other than "
            f"`reference` and the two entries' `root`/`shipped`. Top-level keys involved: "
            f"{', '.join(differing)}. Nothing has been written; the file on disk is untouched."
        )


# ── the move ───────────────────────────────────────────────────────────────────────────────────


def plan_moves(winner: providers.Provider, loser: providers.Provider) -> list[tuple[Path, Path]]:
    """(source, destination) for every artefact, loser first. Order matters: the loser vacates
    `assets/` and `MANIFEST.json` before the winner is moved onto them."""
    loser_root = HERE / "candidates" / loser.id
    moves = [(path, loser_root / path.name) for path in artefacts_of(loser)]
    moves += [(path, HERE / path.name) for path in artefacts_of(winner)]
    return moves


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--provider", default=None, help="the candidate to make shipped")
    parser.add_argument("--dry-run", action="store_true", help="say what would move; move nothing")
    parser.add_argument("--list", action="store_true", help="which set is shipped and which are on trial")
    parser.add_argument(
        "--skip-verify",
        action="store_true",
        help="do not run verify.py on the candidate first. For a set that is deliberately RED and "
        "is being switched to for a LOOK; the completeness and checksum checks still run.",
    )
    args = parser.parse_args(argv[1:])

    if args.list:
        reference = providers.reference()
        print(f"shipped: {reference.id} ({reference.label}), root {relative(reference.root)}\n")
        for provider in providers.load():
            state = "present" if provider.exists else "not generated"
            role = "SHIPPED" if provider.id == reference.id else "candidate"
            print(f"  {provider.id:<20} {role:<10} {state:<14} {relative(provider.root)}")
        print(
            "\nTo look at a set without switching:  "
            "python3 materialise.py --provider <id> --into /tmp/<id>"
            "\nTo switch:                           python3 promote.py --provider <id>"
        )
        return 0

    if not args.provider:
        parser.error("--provider is required (or use --list)")

    winner = providers.by_id(args.provider)
    loser = providers.reference()
    if winner.id == loser.id:
        print(f"{winner.id} is already the shipped set; nothing to do.")
        return 0
    if not winner.exists:
        raise SystemExit(f"{winner.id} has no manifest at {relative(winner.manifest)} — nothing to promote")

    # ---- 1. completeness, in exactly the sense a consumer means it
    #
    # The error is materialise.py's, re-raised with this command's own vocabulary appended rather
    # than reworded. materialise.py is byte-identical across four repositories, so editing its
    # message to suit this caller would fork a shared file to fix a sentence. What that message
    # ends with — "narrow the switch with --only" — is TRUE OF materialise.py AND FALSE OF THIS
    # ONE: a partial materialise is a useful thing to look at, and a partial promotion is a
    # shipped set that is half one model and half another, which is the one outcome this whole
    # file exists to prevent. So the flag is not offered here and the reason is said out loud,
    # because an error message that names an option the command does not have sends the reader to
    # `--help` to find out who is lying.
    #
    # The likeliest way to arrive here in THIS repository is a run that stopped one step early,
    # and there are three steps to stop before rather than the siblings' one. The pipeline is
    # generate → `normalise_ground.py --provider <id>` → `cutout.py --provider <id>` →
    # `generate.ts --derive-only --provider <id>`, and it is the last that turns 288 generations
    # into 392 assets by cutting 96 tiles off the 32 terrain plates and 8 crops off chrome and
    # keyart. A set that has never been derived stands at exactly 288, which is what the message
    # below will name; a set that skipped cutout.py is complete and fails verify instead.
    try:
        materialise.resolve(winner, None)
    except materialise.IncompleteSetError as incomplete:
        raise SystemExit(
            f"{incomplete}\n"
            "  Read that last line as materialise.py's, because it is: this command has no --only\n"
            "  and will not be given one. A partial materialise is a directory to look at. A\n"
            "  partial promotion is a SHIPPED set that is partly one model and partly another,\n"
            "  with nothing on any file saying which — and every consumer of assets/ would inherit\n"
            "  it. Finish the set, then promote it. If what is missing is the 96 tiles under\n"
            "  assets/tiles/, the step is `generate.ts --derive-only`, which runs project_iso.py\n"
            "  and derive.py in that order.\n"
        ) from incomplete

    # ---- 2. the candidate must pass verify UNDER THE SHIPPED SET'S RULES before anything moves
    if not args.skip_verify:
        ok, output = run_verify(winner.id)
        if not ok:
            print(output)
            raise SystemExit(
                f"\n{winner.id} does not pass `python3 verify.py --provider {winner.id} "
                "--as-shipped`. Nothing has moved. Promoting a set whose manifest is not true about "
                "its own bytes would make that untruth the shipped state, and promoting one that "
                "misses the art direction would move the repository's own definition of correct. "
                "Read the FAIL lines above: if they are conformance rather than integrity, the "
                "choice is to fix the assets — `normalise_ground.py --provider <id>` is the usual "
                "answer for a ground, `cutout.py --provider <id>` for a plate that will not key — "
                "or to accept the deviation knowingly with --skip-verify, which still runs the "
                "completeness and checksum checks."
            )

    moves = plan_moves(winner, loser)

    # ---- 3. no destination is occupied by anything the plan does not itself move out of the way
    #
    # Walked IN ORDER, treating a path as free once an earlier move has vacated it. That is not a
    # refinement: the naive `destination.exists()` form can never pass, because the winner's
    # destinations are `assets/` and `MANIFEST.json` at the root and those are exactly where the
    # OUTGOING reference is sitting until the first moves carry it away. Every promotion this
    # repository could ever attempt would stop here with "REFUSING TO MOVE — these destinations
    # already exist: assets, MANIFEST.json", which reads exactly like the leftover half-swap the
    # check was written to catch. (Found in micro-brand, where it survived undetected because the
    # completeness gate above it always fired first. A gate that is only reachable once an earlier
    # gate is satisfied is untested until the day it is load-bearing — and in this repository,
    # where no derivative is missing a recipe, the first promotion attempted is the day it is.)
    #
    # The real intent is kept: a leftover `candidates/flux-2-pro/` from an interrupted run IS a
    # stop, because merging into it would silently mix two sets. `plan_moves` puts the loser first
    # precisely so that this walk can see the vacancy, and the two are written to agree.
    vacated: set[Path] = set()
    collisions = []
    for source, destination in moves:
        if destination.exists() and destination not in vacated:
            collisions.append(destination)
        vacated.add(source)
    if collisions:
        raise SystemExit(
            "REFUSING TO MOVE — these destinations already exist and nothing in this promotion "
            "vacates them:\n  "
            + "\n  ".join(relative(p) for p in collisions)
            + "\nNothing has moved. Clear them, or work out why a previous promotion left them.\n"
        )

    if args.dry_run:
        print(f"would promote {winner.id} over {loser.id}:\n")
        for source, destination in moves:
            print(f"  {relative(source):<40} ->  {relative(destination)}")
        print(f'\n  providers.json: reference {loser.id} -> {winner.id}')
        print(f'                  {winner.id}: root "." shipped true')
        print(f'                  {loser.id}: root "candidates/{loser.id}" shipped false')
        return 0

    done: list[tuple[Path, Path]] = []
    try:
        for source, destination in moves:
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(source), str(destination))
            done.append((source, destination))

        # ---- 4. both manifests, re-derived from the bytes at their NEW locations
        problems = check_manifest_against_bytes(HERE / "MANIFEST.json", HERE)
        problems += check_manifest_against_bytes(
            HERE / "candidates" / loser.id / "MANIFEST.json", HERE / "candidates" / loser.id
        )
        if problems:
            raise RuntimeError(
                "the sets do not check out at their new locations:\n  " + "\n  ".join(problems)
            )

        before = REGISTRY.read_text()
        after = rewrite_registry(before, winner, loser)
        assert_only_expected_changes(before, after, winner.id, loser.id)
        REGISTRY.write_text(after)
    except BaseException as exc:
        # Rolled back file by file, in reverse, so a failure leaves the repository as it was found
        # rather than half-swapped. The registry is written LAST and only after the bytes check
        # out, so a failure here means it was never touched.
        for source, destination in reversed(done):
            shutil.move(str(destination), str(source))
        raise SystemExit(f"\nPROMOTION ROLLED BACK, nothing changed: {exc}\n") from exc

    # The winner's candidate directory is empty now — every artefact it held was just moved to the
    # root — and an empty `candidates/gpt-image-2/` left lying about says "there is a set here" to
    # every reader and to `ls`, while `promote.py --list` correctly says the set is shipped. git
    # does not track empty directories, so nothing in a fresh clone would show it and only the
    # person who ran the switch would ever see the debris. Pruned AFTER the registry is written, so
    # a rollback never has to recreate it, and only ever under `candidates/`: `rmdir` fails loudly
    # on a non-empty directory, which is the behaviour wanted if this is ever wrong.
    winner_root = HERE / "candidates" / winner.id
    if winner_root.is_dir() and not any(winner_root.iterdir()):
        winner_root.rmdir()

    print(f"promoted {winner.id} ({winner.label}) to the shipped set at assets/")
    print(f"demoted  {loser.id} ({loser.label}) to candidates/{loser.id}/ — kept, not deleted")
    print(
        "\nEvery `path` in both manifests was already relative to its own set root, so no entry "
        "\nchanged and every checksum was re-derived from the bytes where they now live."
        f"\n\nTo switch back:  python3 promote.py --provider {loser.id}"
        "\n\nTHERE IS NO RE-MATERIALISE COMMAND TO PRINT HERE, and that is measured rather than an"
        "\noversight. tessera-web/public holds five PNGs; none checksum-matches this manifest and"
        "\nfour do not use this repository's file names, so nothing in that directory is downstream"
        "\nof this switch today. Fixing that is a change to the consumer's naming and is not this"
        "\ncommand's to make. See this file's header, THE CONSUMER SITUATION HERE."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
