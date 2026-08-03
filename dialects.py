#!/usr/bin/env python3
"""Read dialects.json, and turn one recorded prompt into the prompt a dialect actually sends.

The Python half of the dialect seam. `dialects.ts` is the other half and they read the SAME file,
for the reason providers.json states about itself: one hand-copied registry in this repository is
already one too many.

    python3 dialects.py                 # what is registered, and how many rules each dialect has
    python3 dialects.py --residuals     # every recorded prompt, transformed, and what it still owes

WHAT A DIALECT IS. A named, deterministic, TOTAL function from the prompt on record for an asset to
the prompt a provider set is sent. `literal` is the identity function and has zero rules. `positive`
restates every prohibition in the estate's briefs as an assertion about what IS in the frame.

WHY IT DOES NOT WEAKEN PARITY. Because the function is pure and its input is the reference set's own
record, a candidate in any dialect is provably answering a question DERIVED FROM the same asset's
recorded brief. verify.py --parity re-derives it and compares bytes, which is a stronger check than
the equality it used to run: equality could only say "these two strings differ", and this says
"this string is not what this dialect produces from the record".

    python3 -c "import dialects, json; print(dialects.apply('positive', json.load(open('MANIFEST.json'))['assets'][0]['prompt']))"
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path

HERE = Path(__file__).resolve().parent
REGISTRY = HERE / "dialects.json"

#: `$1` in dialects.json becomes `\1` here. The ONE adapter in the seam, kept to a single line and
#: asserted from the TypeScript side (parity.test.ts) against this file's own output, so the two
#: loaders cannot come to disagree about what a rule means.
_BACKREF = re.compile(r"\$(\d)")


@dataclass(frozen=True)
class Rule:
    find: str
    replace: str
    regex: bool
    why: str

    def apply(self, text: str) -> str:
        if self.regex:
            return re.sub(self.find, _BACKREF.sub(r"\\\1", self.replace), text)
        return text.replace(self.find, self.replace)


@dataclass(frozen=True)
class Dialect:
    id: str
    label: str
    #: The dialect this one is derived FROM. None on the literal dialect, which is the record.
    source: str | None
    #: Whether a prompt in this dialect may still carry the negation vocabulary. False for the
    #: literal dialect, which is the estate's own prohibition-heavy style and is meant to.
    check_residuals: bool
    rules: tuple[Rule, ...]
    summary: tuple[str, ...]

    def apply(self, prompt: str) -> str:
        for rule in self.rules:
            prompt = rule.apply(prompt)
        return prompt


def _document() -> dict:
    return json.loads(REGISTRY.read_text())


def negation_vocabulary() -> tuple[str, ...]:
    return tuple(_document()["negationVocabulary"])


def load() -> list[Dialect]:
    document = _document()
    out = []
    for raw in document["dialects"]:
        out.append(
            Dialect(
                id=raw["id"],
                label=raw["label"],
                source=raw["source"],
                check_residuals=bool(raw["checkResiduals"]),
                summary=tuple(raw.get("summary", [])),
                rules=tuple(
                    Rule(
                        find=r["find"],
                        replace=r["replace"],
                        regex=bool(r.get("regex", False)),
                        why=r["why"],
                    )
                    for r in raw["rules"]
                ),
            )
        )
    return out


def by_id(dialect_id: str) -> Dialect:
    for dialect in load():
        if dialect.id == dialect_id:
            return dialect
    known = ", ".join(d.id for d in load())
    raise SystemExit(f"unknown dialect {dialect_id!r}; dialects.json registers: {known}")


def literal() -> Dialect:
    """The dialect the record is IN, and the one the controlled comparison is conducted in."""
    return by_id(_document()["literal"])


def apply(dialect_id: str, prompt: str) -> str:
    return by_id(dialect_id).apply(prompt)


def residuals(dialect_id: str, prompt: str) -> list[str]:
    """Negation vocabulary still present after the transform, lowercased and deduplicated.

    This is what makes "positive" a measured property rather than a claim. A prompt that still owes
    a residual may not be SENT in this dialect — promptForProvider throws, and this function is what
    verify.py reports the same fact from. The rule list therefore grows with the corpus instead of
    being written once and hoped over.
    """
    dialect = by_id(dialect_id)
    if not dialect.check_residuals:
        return []
    found: list[str] = []
    for word in negation_vocabulary():
        if re.search(rf"\b{re.escape(word)}\b", prompt, re.IGNORECASE) and word not in found:
            found.append(word)
    return found


def _residual_report() -> int:
    """Every recorded prompt in this repository, run through every checked dialect."""
    import providers  # local: only this entry point needs it, and providers.py does not need us

    reference = providers.reference()
    if not reference.exists:
        print("the reference set has no manifest; nothing to transform")
        return 1
    document = json.loads(reference.manifest.read_text())
    failures = 0
    for dialect in load():
        if not dialect.check_residuals:
            continue
        clean = 0
        for asset in document["assets"]:
            if asset.get("derivedFrom"):
                continue
            owed = residuals(dialect.id, dialect.apply(asset["prompt"]))
            if owed:
                failures += 1
                print(f"  {dialect.id}: {providers.key_of(asset)} still owes: {', '.join(owed)}")
            else:
                clean += 1
        print(f"{dialect.id}: {clean} recorded prompt(s) transform clean, {failures} still owe")
    return 1 if failures else 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("--residuals", action="store_true", help="transform every recorded prompt")
    args = parser.parse_args()
    if args.residuals:
        sys.exit(_residual_report())
    for entry in load():
        source = entry.source or "the record itself"
        print(f"{entry.id:<12} {len(entry.rules):>3} rule(s)  from {source:<18} {entry.label}")
    sys.exit(0)
