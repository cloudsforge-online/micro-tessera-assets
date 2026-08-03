#!/usr/bin/env python3
"""Read providers.json, and resolve a provider id to the set of files that belong to it.

Thirty lines rather than a class hierarchy, because there is exactly one thing to answer: given a
provider id, which manifest and which asset tree. Every Python tool in this repository — verify.py,
derive.py, sheet.py, normalise_ground.py, compare.py — takes `--provider` and asks that question
here, so none of them contains a path built by hand.

    python3 providers.py            # what is registered, and which sets exist on disk
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass
from pathlib import Path

HERE = Path(__file__).resolve().parent
REGISTRY = HERE / "providers.json"


@dataclass(frozen=True)
class Provider:
    id: str
    label: str
    vendor: str
    adapter: str
    #: Which prompt dialect this set was generated in; the rules are in dialects.json and the
    #: transform is dialects.py. `adapter` says how a set was POSTED, this says what was posted.
    #: Two providers can share a deployment, a route, a key and a model and still be two different
    #: experiments; the registry held exactly such a pair while the Qwen challenger was on trial,
    #: and both went when the owner withdrew that model. Parity is enforced WITHIN a dialect and
    #: RE-DERIVED across dialects; see verify.py's check_parity.
    dialect: str
    #: Repository-relative root. "." for the reference provider; see providers.json's header.
    root: Path
    #: "live" or "withdrawn". A withdrawn provider's deployment no longer exists; its entry is kept
    #: because the wire facts in it were measured. Nothing here counts providers.
    status: str
    shipped: bool
    implemented: bool
    concurrency: int
    billing: dict
    env: dict

    @property
    def assets(self) -> Path:
        return self.root / "assets"

    @property
    def manifest(self) -> Path:
        return self.root / "MANIFEST.json"

    @property
    def deployment(self) -> Path:
        """Where the operator records when this deployment existed. Only meaningful hourly."""
        return self.root / "DEPLOYMENT.json"

    @property
    def exists(self) -> bool:
        return self.manifest.exists()


def _document() -> dict:
    return json.loads(REGISTRY.read_text())


def key_of(entry: dict) -> str:
    """The identity of one asset, spelled the way THIS repository spells it.

    Driven by providers.json's `identity` block rather than hardcoded, because it is the one thing
    that really differs between the estate's three asset repositories — micro-brand keys on
    surface + kind, the two game sets key on a single dotted `asset` path. Everything else in this
    file is identical across all three, and stays that way because of this function.
    """
    fields = _document()["identity"]["key"]
    return "/".join(str(entry[f]) for f in fields[:-1]) + "@" + str(entry[fields[-1]])


def label_of(entry: dict) -> str:
    """The short human name for one asset, for a report line or a sheet caption."""
    return "/".join(str(entry[f]) for f in _document()["identity"]["label"])


def load() -> list[Provider]:
    document = _document()
    out = []
    for raw in document["providers"]:
        out.append(
            Provider(
                id=raw["id"],
                label=raw["label"],
                vendor=raw["vendor"],
                adapter=raw["adapter"],
                # No default. A provider with no declared dialect is a set nobody can say what was
                # sent to, and defaulting it to "literal" would silently claim a set is part of the
                # controlled comparison when the person who added it never said so.
                dialect=raw["dialect"],
                root=(HERE / raw["root"]).resolve(),
                status=raw.get("status", "live"),
                shipped=bool(raw["shipped"]),
                implemented=bool(raw["implemented"]),
                concurrency=int(raw["concurrency"]),
                billing=raw["billing"],
                env=raw["env"],
            )
        )
    return out


def reference() -> Provider:
    """The provider whose set every other set is judged against, and replays the prompts of."""
    wanted = _document()["reference"]
    return by_id(wanted)


def by_id(provider_id: str) -> Provider:
    for provider in load():
        if provider.id == provider_id:
            return provider
    known = ", ".join(p.id for p in load())
    raise SystemExit(f"unknown provider {provider_id!r}; providers.json registers: {known}")


def live() -> list[Provider]:
    """Every provider that can be run against today. Never a hardcoded pair."""
    return [p for p in load() if p.status == "live"]


def in_dialect(dialect: str) -> list[Provider]:
    """The providers sharing one prompt dialect — the group prompt parity is asserted over.

    Before there was one implicit group holding every provider. There are now N explicit ones, each
    holding the same property, and nothing here assumes a group has one member or that there is one
    group.
    """
    return [p for p in load() if p.dialect == dialect]


def present() -> list[Provider]:
    """Every registered provider that actually has a manifest on disk.

    This is what the tools default to. A run of verify.py or compare.py must not fail merely
    because a challenger has not been generated yet — that is the normal state, not a fault, and it
    is the state a withdrawn provider is permanently in.
    """
    return [p for p in load() if p.exists]


def add_argument(parser) -> None:
    """The one flag, spelled the same way by every tool here."""
    parser.add_argument(
        "--provider",
        action="append",
        default=None,
        metavar="ID",
        help="provider id from providers.json; repeatable. Default: every set present on disk.",
    )


def selected(args) -> list[Provider]:
    if not getattr(args, "provider", None):
        return present()
    return [by_id(value) for value in args.provider]


if __name__ == "__main__":
    for provider in load():
        state = "present" if provider.exists else "not generated"
        shipped = "shipped" if provider.shipped else "candidate"
        adapter = "implemented" if provider.implemented else "STUB"
        print(
            f"{provider.id:<26} {provider.dialect:<9} {provider.status:<10} {shipped:<9} "
            f"{adapter:<11} {state:<13} "
            f"{provider.root.relative_to(HERE) if provider.root != HERE else '.'}"
        )
    sys.exit(0)
