# The Tessera art bible

The direction, fixed before a single generation. `generate.ts` is this document as prompts, and
`verify.py` is the part of it that can be measured. Where the two disagree, this is wrong and the
code is right — a bible that drifts from the run it governed is decoration.

---

## 1. Why painterly, and why that choice is not neutral

`docs/ecosystem/23-tessera.md` §1.1 decides it on two facts, and the second is measured rather
than argued.

**Painterly hides what diffusion cannot hold steady.** A hand-painted world is *supposed* to vary
from tile to tile and from chair to chair. A flat-vector world is not: two vector chairs that
disagree by three pixels read as a bug, and there is no seed in this pipeline to make them agree
(`studio/src/migrations.ts:154-252` has no `seed` column, and grepping `seed` across `studio/src`
returns nothing). Painterly turns the medium's worst property into the style's best one.

**And the flat brief was rigging the comparison.** Qwen-Image 2512 reads a flat-graphic brief
photographically and returns framed, bevelled game-UI artefacts whatever the prompt asks for. On
micro-brand's flat set it produced **7.1× the file size per megapixel** it produced on the
painterly game sets (**2.6×**). The owner asked for every asset from both models; that is only
worth the spend if the comparison means something, and painterly gives Qwen somewhere to go.

So the house style, in one line, and it is the line every painterly prompt in the repository
opens with:

> **Luminous painterly gouache, warm ash-and-ember key light against cool shadow, visible brush
> economy, opaque paint with the strokes left showing, no outlines, no bevels, no gloss.**

**Brush economy is the load-bearing phrase.** It asks for paint that stops when the form reads —
not for detail, not for realism, not for texture. A world assembled out of user placements can
carry variation in the *handling* and cannot carry variation in the *level of finish*: one
hyper-detailed chair next to eight economical ones makes the eight look unfinished, which is the
single most-cited failure of user-generated worlds and the thing §1 of the design promises this
medium avoids.

## 2. The ground, and the three ground classes

Grounds normalise **numerically** to `#12100f`, as everywhere in this estate
(`brand/normalise_ground.py:27` — `TARGET = (0x12,0x10,0x0F)`), because neither model will hit an
exact hex and a set whose grounds disagree does not read as one family however dark each of them
is alone.

Tessera has **three** ground classes where the sibling repositories have two, and the third is not
a convenience:

| Class | What it is | The rule | Count |
| --- | --- | --- | --- |
| `flat` | a sprite on the pinned ash ground | exactly `#12100f` in all four corners, no tolerance | 236 |
| `scene` | a picture, edge to edge | a darkness ceiling on its edges; never snapped | 26 |
| `plate` | a **material sheet** | **full bleed** — no mount, no border, no vignette | 32 |

A plate cannot take either of the other rules and the reason is the art, not the code: the
`saltflat` plate is **cracked white by design** and the `grove` plate is near-black, so a darkness
ceiling would fail the correct answer and a flat-ground check would fail all 32. What a plate is
actually required to be is *a material rather than a picture of one*, and the measurable form of
that is that its outer band is as alive as its middle — because `project_iso.py` cuts tiles out of
that band and drops them on the world's ground.

**Transparency is a post-step.** Diffusion does not emit alpha. Every sprite is painted on the
pinned ground and keyed by `cutout.py`, which adds an alpha channel and **does not touch RGB** —
so a corner pixel is still exactly `#12100f`, merely also transparent, and the flat-ground check
survives the cut.

## 3. Projection

**2:1 dimetric isometric, viewed from above and to the left.** The base ground tile is 256×128. A
1×1 object occupies one tile of floor and is painted on 512×512 — three tiles of headroom, so a
lamp-post fits. A 2×2 object uses the same canvas at half the depicted scale.

This is the one direction in the bible with **no downstream repair**. A ground that is the wrong
colour is normalised; a sprite that is the wrong shape is re-rolled; a sprite drawn straight-on or
in perspective is simply unusable, and 140 sprites have to agree about it or the world does not
compose. It is COMPARISON.md criterion 1b for that reason.

**One canonical facing per object.** The second is a horizontal mirror applied at render time.
Forced, not lazy: without a seed the pipeline cannot render the same chair four times, and a design
that assumed four facings would be assuming a column the schema does not have.

## 4. Colour

The world's palette is **warm lamplit timber, fired clay, pale limestone and soft brass against
the cool dark**. Not a single-accent rule — a barrel is oak and iron — but each subject carries one
identifying hue, and that hue is named in plain words beside its hex, because a bare hex reads as
noise to an image model. That is Emberkin's measured amendment and it is in `PALETTE` in `plan.ts`.

**Never name an object to get a colour.** Naming an object drags a diffusion model to that
object's photographic average. Every entry in `PALETTE` names a hue and its direction round the
wheel and nothing else.

**UI chrome wears Forge Worlds' accent `#6d9a49`**, as Emberkin and Aetherholm both do
(`ui/packages/ui/src/surfaces.ts:455` and `:477`). A title wears its product's colour rather than
claiming its own. The 42 flat-vector assets — glyphs, economy icons, chrome — are the only work in
this repository held to an accent floor; the painterly sets carry a floor of zero and have their
accent recorded rather than gated.

**Shape carries meaning, never hue alone.** `pending` is an open ring and `available` is a solid
disc, because the economy shows them as two figures side by side and they must be distinguishable
at 16 px by someone who cannot tell the two accent colours apart.

## 5. What is never drawn

Three prohibitions, each answering a defect this estate actually measured rather than one a model
might in principle have.

**No frame, no bevel, no UI chrome around the art.** The image *is* the artwork, not a picture of
artwork. Qwen returned framed, bevelled game-UI artefacts across all three earlier sets regardless
of the ask.

**No recursion and no variant sheets.** No smaller copy of the image inside the image, no grid of
alternates, no thumbnail, no framed picture on a wall. Qwen returned a recursive picture-frame grid
on a micro-brand icon; FLUX returned 5 of 14 favicons as the mark plus a smaller framed copy of
itself, because "draw it simpler" is read as "show both".

**No named-artist pastiche.** Qwen returned a Hokusai pastiche from a brief that named no artist.
This is the game's own house style and nothing else.

These live in one clause, `ARTEFACT_GUARD`, and it goes to **both models identically**. A clause
sent to one and not the other would make the two sets incomparable while every file still looked
correct — which is the exact failure `parity.test.ts` exists to make impossible. FLUX pays a few
tokens for a guard it does not need, and COMPARISON.md §4 discloses that when it reads the
artefact counts.

## 6. Lettering: none

**This repository generates no lettering at all.** doc 23 §2.14 specifies `keyart/wordmark-ground`
— a ground *for* a wordmark — and no wordmark. Type is set by the client over generated art.

The reason is measured: the brand run found FLUX misspelling text on wide compositions and
rendering a wordmark as *"Home on the Ridge"*, and concluded "let the model draw the marks, and set
the type yourself" (`brand/README.md` §5). Every prompt here therefore ends with a clause saying
nothing is written anywhere in the image.

**This has a cost, and it is stated rather than buried.** Qwen's one clean win across three
comparisons was lettering, 9/9 correct. Refusing to generate lettering makes this comparison blind
to the challenger's best measured capability. COMPARISON.md §7.1 says so, and a reader choosing a
model for a lettered asset should read the brand run instead of this one.

## 7. Composition, per set

- **Terrain plates** — flat overhead, evenly lit, no subject, no horizon, no light direction. The
  texture continues past all four edges and nothing is centred. A plate that composed itself is a
  plate that cannot be cut.
- **Seed objects, structure, markers, Kiln** — one subject, centred, small even margin, filling the
  lower two thirds with headroom above. Footprint is a **field** in `content/objects.json`, not
  something the model is asked to infer.
- **Avatars** — a fixed shared silhouette, stated in the prompt and read from
  `content/avatars.json` so the prompt and the engine cannot disagree about where a hat goes. An
  overlay draws **only** its slot's region and leaves the rest of the frame empty; it is drawn as
  *worn*, in its worn position, with the wearer invisible. This is the one place the pipeline can
  fail invisibly, so `verify.py` check 8 measures it.
- **Backdrops** — a horizon per ward, wide, with the darkest values at the edges.
- **Glyphs and icons** — flat geometric vector on one grid, one stroke weight, legible at 24 px.
- **Key art and splashes** — painted, edge to edge, dark at the frame's edges, no letterboxing and
  no interface overlay.
