# How the models are judged, for Tessera

Sections 0 to 7 were written **before either set existed**, which is the only time criteria can be
written honestly. Once the images are on screen it is very easy to discover that the thing the
winner happens to be good at was the thing that mattered all along. Section 8, the verdict, was
written afterwards and says which criteria it turned on.

The estate has run this comparison three times and concluded **FLUX decisively** each time. This
run is not a fourth confirmation, and the reason is in §7.0: every previous brief was one Qwen
could not answer in its own idiom. Tessera's is not.

---

## 0. What is being compared, and what is not

**Compared:** the **288 GENERATED** assets, per model. 576 files.

**Not compared:** the **104 DERIVED**. 96 terrain tiles are a deterministic cut-and-project of that
model's own plates; 6 chrome sizes are Lanczos downscales and composites of that model's own mark;
2 title cards are centre crops of that model's own key art. Running Pillow against a candidate's
output costs nothing and says nothing about the model, and asking a model for them separately would
break the relationship the `derivedFrom` column asserts.

They are still verified, and they still appear in the side-by-side sheets — a plate whose tiles
seam visibly has failed criterion 1c, but that is a property of the plate, not of the projection.

**One number that is not what it looks like.** Summing `providerCostUnits` across a whole manifest
double-counts, because a derivative inherits its parent's cost so a reader can see what the file
behind it cost. `compare.py` sums over generated entries only.

---

## 1. Prompt adherence

*Did it draw what it was asked for?*

Partly arithmetic. `compare.py` counts ground fidelity against `#12100f` on the 236 flat-ground
assets, accent coverage on the 42 flat-vector glyphs, icons and chrome against their `#6d9a49`
floor, a third hue neither the accent nor the ember explains, and delivered size against declared.

Three parts are specific to this title and are judged by eye from the side-by-side sheets:

**1a. Is it the idea?** Every entry in `content/` names one specific construction — "a low
three-legged wooden stool with a round dished seat", "an OPEN RING, unfilled, with a single gap at
its top". A model that returns a beautiful generic chair has failed this completely, and no
measurement will say so.

**1b. Is it in projection?** doc 23 §2.1 fixes **2:1 dimetric isometric, viewed from above-left**,
and 140 sprites have to agree about it or the world does not compose. A sprite drawn straight-on,
in perspective, or from a different height is *unusable* rather than merely worse — this is the
one adherence failure in the set with no downstream repair.

**1c. Does the plate tile?** A terrain plate is asked for flat-on, evenly lit, with no subject, no
horizon and no composition, precisely so `project_iso.py` can cut it. A plate that came back as a
*landscape* — with a light direction, a vanishing point, or a thing standing on it — cannot be cut
into ground, and the 12 tiles behind it fail with it. Scored per plate, so one failure costs 12.

## 2. Style coherence within the set

*Do these look like they came from one hand?*

**The one that matters most, and the hardest thing for an image model.** Tessera is not 288 good
images; it is 288 images that are recognisably one world's. Single-image quality is where models
look alike and set-level consistency is where they come apart — and this set is larger than any
predecessor in the estate precisely because, in a world-building title, **the asset set is the
product** (doc 23 §2.3).

Measured as **spread, not average**, and that distinction is the whole criterion. A model that
renders every accent 18% lighter than the hex it was given has a *bias*, which is uniform,
correctable and invisible once the set is seen together. A model that renders one accent 4% light
and the next 34% light has no house style, and nothing downstream fixes that. `compare.py` reports
both; the verdict is on the second.

**Judged WITHIN the set, never against the sibling repositories.** Emberkin's species sheets,
Aetherholm's painterly islands and Tessera's isometric world are deliberately unalike. A model that
makes them look like each other has failed, not succeeded, and there is no cross-repository
coherence number here.

Two sub-judgements this set adds, both by eye:

- **Do the 96 seed objects read as one household's furniture?** They are twelve categories that
  must nonetheless sit in one room together.
- **Do the eight wards read as eight PLACES rather than eight palettes?** A ward archetype that
  differs from its neighbour only in hue has failed the world-building brief.

## 3. Legibility at the size the asset is actually used at

*Does it survive being what it actually is?*

Each set is judged at **its own** size, not at review size, and this is the failure a contact sheet
structurally cannot show:

| Set | Judged at | Why |
| --- | --- | --- |
| Glyphs, economy icons | **16 and 24 px** | doc 23 §2.12: `pending` and `available` must be distinguishable at 16px by someone who cannot tell the two accent colours apart |
| Seed objects, structure, markers | **~128 px on the diamond** | a 1x1 object occupies one 256x128 tile on screen, not the 512 canvas it was drawn on |
| Terrain tiles | **256x128, tiled** | judged as a FIELD of them, never as one |
| Avatar plates | **~96 px tall** | an avatar in a crowd of sixty |
| Chrome mark | **16, 32, 180 px** | it is a browser tab |

Measured as **contrast retention**: RMS deviation of luma from the ground after a Lanczos downscale,
over the same at full resolution. A heavy, simple shape keeps most of it; one built from hairlines
averages itself into the background.

## 4. Artefact rate

*How often does it produce something that is simply wrong?*

The taxonomy is fixed **here, in advance**, and every entry is a defect this estate actually
measured rather than one a model might in principle have. The last four rows are Qwen's own
measured failure modes from the earlier runs, listed so that a fair count exists for them rather
than an impression.

| Defect | Countable? | Where it was first seen |
| --- | --- | --- |
| Pale or non-uniform ground | yes, `compare.py` | the brand run's first live image, a taupe field |
| Unaccented glyph | yes | `hub`'s OG card in grey, `worlds` drawn entirely in white |
| Third hue taking over | yes | the check that would have caught `#ff4d00` everywhere |
| Delivered size ≠ declared | yes, `verify.py` 8 | Qwen's transposed `size` parameter |
| **Wrong projection** (1b) | **by eye** | new to this title; the failure with no repair |
| **Plate came back a landscape** (1c) | **by eye** | new to this title; costs 12 tiles each |
| **Overlay misregistered** | yes, `verify.py` 7 | new to this title; invisible in a sheet, obvious in play |
| Inset duplicate | **by eye** | 3 of 11 brand favicons: the mark plus a smaller framed copy |
| Construction guides drawn | **by eye** | margin box and quarter grid ruled across the brand run's first image |
| Nameplate / card frame | **by eye** | Emberkin portraits returning as trading cards with a name banner |
| **Framed, bevelled game-UI artefact** | **by eye** | **Qwen**, across all three earlier sets, regardless of the ask |
| **Recursive picture-frame grid** | **by eye** | **Qwen**, on a micro-brand icon |
| **Named-artist pastiche** (Hokusai) | **by eye** | **Qwen**, on a micro-brand icon, from a brief naming no artist |
| **3D bevel, specular highlight, cast shadow, plinth** | **by eye** | **Qwen**, `currency-ember` in micro-brand |
| **Construction grid drawn INTO the artwork** | **by eye** | **Qwen**, `currency-spark` in micro-brand |

**The two currency marks are the cleanest evidence in the estate, and they arrived after these
criteria were fixed.** `micro-brand` generated `currency-ember` and `currency-spark` with both
models on a prompt neither had seen before. Qwen returned, for the first, a bevelled 3D ring with a
specular highlight, a cast shadow and a stone plinth; and for the second, a **ruled lattice with
circle guides inside a drawn bounding box** — against a prompt that says, verbatim, *"no
construction lines, no grid, no guides, no ruled margins, no border, no frame, no bounding box"*.

That is the finding that matters most for reading §8 below: **the prohibition list does not move
it.** Both defects are named in the prompt and both appeared anyway, which means a low artefact
count on Tessera cannot be credited to `ARTEFACT_GUARD` and must be credited to the brief. It also
predicts *where* to look: those two marks are flat, and Tessera's flat categories are the glyphs,
the economy icons, the markers and the chrome. If the reflex is about the idiom rather than about
Qwen, it should reappear there and be absent from the painterly sets — and that is a testable
claim, not an impression, so §8 tests it set by set.

The countable ones are in the report. The by-eye ones are tallied by hand into
`review/compare/artefacts.json`, keyed by provider id and defect name; `compare.py` reads it if it
exists and **says the criterion has no verdict if it does not**, rather than printing zero.

**Procedure, so the tally is comparable:** open `review/compare/compare-<set>.png`, which puts the
same asset from every model in one row, and score left to right per row. Never one model's whole
set followed by the other's — that is 288 separate judgements each made against a memory of the last.

**One clause in the prompt is aimed at three of those rows**, and it is disclosed here rather than
buried: `ARTEFACT_GUARD` in `generate.ts` names the frame, the recursion and the pastiche and
forbids them. It goes to **both** models identically, in the same position, because a clause sent
to one and not the other would destroy parity. FLUX pays a few tokens for a guard it does not need.
The honest reading of a low Qwen artefact count is therefore *"low, having been explicitly told
not to"*, and §8 reads it that way.

## 5. Retries

*How much work was it to get an acceptable set?*

**Read this row with care.** In the earlier runs the reference set accumulated retries over repeated
human review passes while the candidate was generated once and never re-rolled, so the reference
looked *worse* for having had more attention paid to it. Comparing those numbers directly credits a
model for work nobody did to it.

What the row can honestly be used for is `attempts` with a non-`ok` outcome — the machine's own
count of what went wrong on the wire, which is free from the manifests and reflects the endpoint
rather than anyone's taste. A retry count is a real signal at 3× difference and noise at 1.2×.

## 6. Cost — in the unit each model bills in

**These are not the same number and are never combined.**

| | FLUX 2 Pro | Qwen-Image 2512 |
| --- | --- | --- |
| Bills for | each image generated | **each hour the deployment exists** |
| Unit | provider image unit | deployment hour (H100) |
| Source | `request_meta.cost`, per asset | `candidates/qwen-image-2512/DEPLOYMENT.json` |
| Idle cost | zero | full |

`compare.py` prints each in its own unit and derives **no** per-image figure for a per-hour
provider. The reason is not pedantry:

- Per-image billing charges for **output**. Per-hour billing charges for **existence** — including
  every hour the deployment sat idle before the run, between interruptions, and after the last
  asset if nobody deleted it.
- A per-image figure for a per-hour provider is therefore a statement about **how well the run was
  organised**, not about the model. Run the same 288 assets twice, once starting the moment the
  endpoint went healthy and once the next morning, and the "cost per image" differs by an order of
  magnitude with byte-identical output.
- This is already concrete in the estate: Cosmos 3 Super billed for its entire deployment lifetime
  and produced **zero images**, because it never came up. No per-image number can express that.

**A live defect this run inherited and must not repeat.**
`brand/candidates/qwen-image-2512/DEPLOYMENT.json` records
`teardown.state: "NOT TORN DOWN — STILL BILLING"`. That A100 was never torn down. This run records
its own window honestly and reports completion the moment the last asset lands so the deployment
can be deleted.

## 7. Known asymmetries, stated rather than discovered later

**7.0 — the one that makes this run worth doing, and it favours the challenger.**
Qwen-Image 2512 reads a **flat** brief photographically and returns framed, bevelled game-UI
artefacts whatever the prompt asks for. Measured: **7.1× the file size per megapixel** on
micro-brand's flat vector set against **2.6×** on the painterly game sets. A flat brief makes the
comparison one-sided before it starts — Qwen is not being asked a question it can answer.

Tessera's art direction is **painterly on purpose**, and doc 23 §1.1 says so explicitly, listing
this measurement as one of the two facts that decided it. So this is the **first genuinely fair
brief** the estate has put to Qwen, and the previous three verdicts do not carry over. If FLUX wins
here it wins on merit rather than on brief.

**7.1 — the one criterion Qwen previously won is not exercised at all.**
Its single clean win across three runs was **lettering: 9/9 correct, against FLUX rendering a
wordmark as "Home on the Ridge"**. This set generates **no lettering whatsoever** — doc 23 §2.14
specifies `keyart/wordmark-ground`, a ground *for* a wordmark, and no wordmark, because type is set
by the client over generated art. That decision predates this run and is not mine, but its effect
is real: **the comparison below is blind to Qwen's best measured capability.** A reader deciding
which model to use for a lettered asset should ignore §8 entirely and read the brand run.

**7.2 — the reference set is post-processed; the candidate is post-processed identically.**
Unlike the earlier runs, `normalise_ground.py` and `cutout.py` are run over **both** sets here, so
ground-luma spread is like-for-like for the first time. What is still not like-for-like is human
curation: neither set was re-rolled by eye in this run, which at least makes them equal.

**7.3 — C2PA is not a quality signal and is not scored.** FLUX delivers it; Qwen does not. It is
measured off the bytes on both and recorded as a disclosure fact.

**7.4 — the artefact guard.** See §4's closing paragraph.

---

## 8. The verdict

*Written after the sets existed, against the criteria above and no others.*

<!-- FILLED IN AFTER GENERATION -->
