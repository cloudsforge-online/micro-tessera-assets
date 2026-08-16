# How the models were judged, for Tessera

> ## CONCLUDED. This is a record, not an open evaluation.
>
> **Superseded in part by §9.** A second challenger, gpt-image-2, was later run against the same
> 288 recorded prompts and **was promoted**: `assets/` now holds gpt-image-2 and FLUX 2 Pro sits in
> `candidates/flux-2-pro/`, switchable back with one variable. Sections 0–8 are left exactly as
> they were written — they are the record of the FIRST trial, and the sentence below saying FLUX
> ships was true when it was written and is what §9 had to argue against. §9 says what changed,
> what it cost, and what got worse.
>
> **FLUX 2 Pro ships.** The Qwen-Image 2512 challenger was generated in full (288 assets + 104
> derivatives, 392 images in 394 files), judged against the criteria below, and lost on criterion 1 by
> margins nothing else offsets. The owner has since withdrawn that model from the estate, and
> **its images, its manifest, its deployment record and its registry entry have been deleted from
> this repository.** What it measured is here. The evaluation is closed; nothing is waiting on a
> re-run, a replay or a redeployment.
>
> **Read the numbers below as history that was taken, not as claims you can re-derive.** Every one
> of them was measured off the candidate's bytes while those bytes existed. Where a figure used to
> point at `candidates/qwen-image-2512/DEPLOYMENT.json`, that file is gone and the figure has been
> transcribed into §8.5 so that deleting 392 images did not delete the reason the estate chose what
> it chose.
>
> **What survived the deletion, and can still be checked today:** `review/compare/artefacts.json`,
> the by-eye defect tally made by looking at the side-by-side sheets, with its scope stated; the
> 288 recorded literal prompts in `MANIFEST.json`; and the provider seam itself — `providers.json`,
> `backends.ts`, `replay.ts` and `verify.py`'s cross-set checks — which was kept because the estate
> has a stated 3D and animation gap FLUX cannot fill and a next challenger is a question of when.

Sections 0 to 7 were written **before either set existed**, which is the only time criteria can be
written honestly. Once the images are on screen it is very easy to discover that the thing the
winner happens to be good at was the thing that mattered all along. Section 8, the verdict, was
written afterwards and says which criteria it turned on. Both halves are left in the tense they
were written in, because rewriting a criterion after the result is the one thing this document
exists to prevent.

The estate had run this comparison three times and concluded **FLUX decisively** each time. This
run was not a fourth confirmation, and the reason is in §7.0: every previous brief was one Qwen
could not answer in its own idiom. Tessera's was not — and it lost anyway.

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
| Source | `request_meta.cost`, per asset | the deployment record, now transcribed into §8.5 |
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

*Written after both sets existed, against the criteria above and no others.*

**FLUX 2 Pro, decisively — and this time the brief was not the reason.**

That is the same verdict the three earlier runs reached, and §7.0 promised not to let it carry over.
It did not: Tessera is painterly on purpose, the register gap closed almost completely, and Qwen
still lost. The finding worth having is not *who won* but *what closed and what did not*.

### 8.1 The register gap closed. It was never the problem.

The measured prediction in §7.0 was right, and it is the one place Qwen improved dramatically:

| Brief | Qwen KB per megapixel, against FLUX |
| --- | --- |
| micro-brand, flat vector | **7.1×** |
| the two sibling painterly game sets | **2.6×** |
| **Tessera, painterly** | **1.60×** (1038 against 647) |

So the challenger was, for the first time, answering in roughly the right idiom. Its *coherence*
numbers are also genuinely competitive and in two places better than the reference's: accent hue
error spread **6.9° against 9.2°**, and ground luma spread **0.070 against 0.125**. On criterion 2
read purely as arithmetic, Qwen is the tidier of the two.

**And it lost anyway, on criterion 1, by margins that no amount of criterion 2 can offset.** The
brief was never what was holding it back.

### 8.2 Criterion 1a and 1c — prompt adherence, where it was decided

| Measured over the whole category | FLUX | Qwen |
| --- | --- | --- |
| Terrain plates that are a MATERIAL, not a scene (of 32) | **32** | **8** |
| Flat glyphs and icons that are flat vector art (of 40) | **40** | **0** |

Those two rows are the verdict.

**The plates.** The brief asks for a flat overhead material sheet, evenly lit, no horizon, no
perspective, no buildings, nothing standing on it, texture running past all four edges. FLUX
returned 32 of 32 exactly that. Qwen returned **24 landscapes**: `ashfield-path` is a lit building
under a sky, `glasshouse-ground` is an interior room with a framed picture on the wall,
`undercroft-water` is a street receding to a vanishing point. They are frequently *beautiful* — as
concept art `ashfield-path` is the best single image either model produced in this run — and they
are unusable, because `project_iso.py` cuts tiles out of them and a tile with a horizon in it puts
a horizon on the ground. **Each failed plate costs the 12 tiles cut from it**, which is why this
criterion was written to be scored per plate.

**The flat sets.** This is not a near miss. Asked for *"flat geometric vector, one uniform stroke
weight, legible when shrunk to 24 pixels, no gradients, no photographic texture, no bevels, no 3D,
no photo-realism"*, Qwen returned **40 photographs** — portraits of people, cars, street scenes.
`icons/available` is a man standing in a street; `icons/dwell` is a woman lying in grass in
sunglasses. Not one of the 40 is an icon. FLUX returned 40 clean glyphs, including the one that
carries a real accessibility requirement: `pending` is a hollow open ring and `available` is a
solid filled disc, so the two balances §2.12 puts side by side are distinguishable at 16 px by
shape rather than hue.

### 8.3 The measurements that flatter the loser, and why they are reported anyway

Three rows in `compare.py` favour Qwen and are all artefacts of measuring a photograph:

- **"below accent floor": FLUX 47, Qwen 31.** Accent coverage counts pixels within 30° of
  `#6d9a49`. Green foliage in a photograph counts. Qwen scores well on an accent check by
  photographing a hedge.
- **"marks under 50% retention at 16px": FLUX 25, Qwen 7.** A busy photograph retains contrast
  under downscale better than a clean glyph with generous negative space. It retains it as mush.
- **"ground off-target": FLUX 54, Qwen 22.** Measured before normalisation; both sets normalise.

This is exactly why COMPARISON.md separated the arithmetic from criterion 1a, *before* the images
existed. **A model can win every measurable row on this page and still have drawn the wrong thing
288 times**, and the only defence against that is fixing in advance that "is it the idea?" is
judged by eye and outranks the arithmetic. Had the criteria been written afterwards, these three
rows are precisely the ones that would have been promoted.

### 8.4 Criterion 4, and the defect that is mine rather than either model's

The full tally is `review/compare/artefacts.json`, with its scope stated. The headline is §8.2.
Two entries deserve calling out.

**`ARTEFACT_GUARD` did nothing, and this run is more evidence for that than micro-brand's.** The
clause names the frame, the bevel, the recursion and the pastiche and forbids them, in both sets'
prompts, byte-identically. Qwen returned `chrome/mark` and `chrome/capsule` as bevelled 3D stone
objects with specular highlights, cast shadows, a rocky plinth and a volumetric light shaft — the
shaft being separately forbidden by name in the same prompt — and put a framed picture on a wall in
four assets, against a clause reading *"do not draw a framed picture hanging on a wall"*. The
prohibition list does not move it. **A low artefact count for Qwen anywhere in this run is
therefore attributable to the brief, never to the guard.**

**And one defect is neither model's fault: at the time of this comparison, 32 of FLUX's 40 avatar
overlays and 40 of 40 of Qwen's were misregistered.** (FLUX's count has since moved; README §8
defect 1 carries the current number and the passes that produced it. The 32 is left here because
it is what the comparison was scored on.) `verify.py` check 8 measures it and it is the largest single defect count on
either side. But look at what was actually asked: the prompt tells the model to draw *only* the
named region and leave the rest empty — a prohibition, phrased negatively, at the end of a long
prompt. Both models did the positive part beautifully (the garments are the best sprite work in the
set) and ignored the negative part identically. **When two independent models fail the same
instruction the same way, the instruction is the defect.** The paper doll does not composite today,
and that is recorded rather than hidden — see README §9.

### 8.5 Cost, in each model's own unit, never combined

- **FLUX 2 Pro: 868.5 provider image units** over 288 generations, 3.02 per image, 104 derivatives
  free. 490 retries and 459 failed attempts, of which the overwhelming majority are `429
  RateLimitReached` on a shared serverless endpoint — wire contention, not output quality (§5).
- **Qwen-Image 2512: deployment-hours.** **No per-image figure exists or is invented**: the
  endpoint returned `quality` and `usage` as null, so there was no per-image signal at all.

  The deployment record itself was deleted with the candidate tree, so what it measured is
  transcribed here rather than left as a dangling path. An H100 Global Managed Compute deployment,
  `qwen--qwen-image-2512`. **Creation time: never observed, and deliberately never guessed** — the
  owner brought it up before this run began, so its billed life started earlier than anything this
  repository could see, and writing a plausible timestamp would have turned an unknown into a
  figure somebody would later quote. The window it *could* measure, first to last `generatedAt`,
  was 2026-08-03T10:03:07Z to 14:21:00Z: **4.3 wall-clock hours for 288 generations**, which is
  53.7 s per image if read serially against a **measured per-image latency of ~15.4 s**. A second
  window on the same day, 16:55:05Z to 16:58:41Z, regenerated the 40 avatar overlays: **40 images
  in 3 minutes 36 seconds**, after the deployment had been held open roughly six hours to deliver
  them. Teardown was left to the owner, with a completion signal sent the moment the last asset
  landed.

**The operational finding is worth more than either number.** The candidate ran on dedicated
hardware at ~15.4 s per image and was **idle for most of its billed life**, because a candidate may
only generate an asset whose prompt the reference has already recorded, and the reference was a
throttled shared endpoint delivering ~1.5 images per minute. **On this pairing the per-hour
deployment's bill is set by the slowest model in the comparison.** Any future run should finish the
reference set first and bring the per-hour deployment up only then.

### 8.6 What this does and does not license

**Use FLUX for this estate's art.** Nothing here disturbs that.

**Do not read this as "Qwen is worse".** Read it as the far narrower and more useful claim the
criteria actually support: *Qwen will not accept a constraint.* It answered the painterly brief in
the right register, with tidier hue and ground consistency than the reference, and produced
individual images that are better paintings than anything FLUX returned. It then ignored every
instruction about what the image had to *be* — a material and not a scene, a glyph and not a
photograph, a region and not a figure, flat and not bevelled. Every one of its losses is a refused
constraint and none is a failure of craft.

That had a concrete consequence, and it is now moot in this repository: **the estate should stop
concluding this from prohibition-heavy briefs.** Both the currency marks and this run show the same
thing, and the sibling repositories had already built the instrument to test it properly — the
`positive` prompt dialect, which restates prohibitions as positives and refuses to send a prompt
that still carries negation vocabulary. Tessera's 288 recorded literal prompts and checked pipeline
made it the best corpus in the estate to run that experiment against.

**That experiment will not be run here.** The owner withdrew the model, so there is nothing to put
the restated brief to. The dialect machinery is left in place — `dialects.json`, `dialects.ts`,
`dialects.py` and `replay.ts`'s cross-dialect re-derivation are untouched — because it is estate
code shared byte-for-byte with three repositories and the finding it was built to test is about
prompting in general rather than about one vendor. The 288 literal prompts remain the corpus,
whenever there is a second model to ask.

**Two caveats that cut against this verdict, restated so they are not lost:** §7.1 — this set
generates no lettering at all, so the comparison is blind to Qwen's one previously measured win
(9/9 against FLUX rendering a wordmark as *"Home on the Ridge"*), and FLUX invented a dollar sign
on `icons/royalty` here. And §7.4 — neither set was re-rolled by eye, so both are single-pass
output.

---

## 9. The second model to ask: gpt-image-2, on the same 288 prompts

§8.6 closed with "the 288 literal prompts remain the corpus, whenever there is a second model to
ask." This is that. Everything in §§0–7 was fixed before either the reference or the Qwen
challenger existed and none of it has been touched; this section is measured against those criteria
and adds no new ones. What it does add is a decision the earlier trial never had to take, because
its challenger lost: **this one won enough to be promoted, and §9.6 records what promoting it costs
as well as what it buys.**

The prompts are the RECORDED literals from `MANIFEST.json`, replayed unchanged. `reprompt` is
reference-only by design, so no candidate asset was ever asked a different question from the one
the reference was asked — which is what makes the two columns comparable and is also the reason
§9.4's one systematic defect could not be repaired by rewording.

### 9.1 The measurements, side by side

Reproduce with `python3 compare.py --no-sheets`. Read `compare.py`'s own caveats with it; they are
printed beside the rows and are not repeated here.

| | flux-2-pro | gpt-image-2 | better |
| --- | --- | --- | --- |
| below accent floor | 46 | **27** | challenger |
| ground off-target (>0.12 luma) | **52** | 53 | tie |
| nearly blank / delivered≠declared | 0 / 0 | 0 / 0 | tie |
| accent hue error, mean | 9.8° | **6.4°** | challenger |
| accent hue error, SPREAD | 9.2 | **6.7** | challenger |
| accent lightness, SPREAD | 0.125 | **0.103** | challenger |
| ground luma spread | 0.1224 | **0.1207** | tie, and like-for-like here |
| ink coverage spread, in-kind | **0.0916** | 0.0950 | reference |
| median retention at 32px | **84%** | 82% | reference |
| median retention at 16px | **74%** | 67% | reference |
| marks under 50% at 16px | **25** | 40 | reference |
| KB per megapixel, median | 599 | 784 | neither — a register difference, see §2 |
| overlays outside their slot band, of 40 | 12 | **3** | challenger, by 4× |

**The registration row is the one to read first**, because it is the check this repository invented
for itself (`verify.py` check 8) and the only one that measures whether an asset can do its job
rather than whether it is pretty. An avatar overlay is composited onto a base at a fixed offset; a
`legs` garment whose ink starts at 0.27 when the `legs` band starts at 0.38 is drawn over the
torso. The reference misregisters **twelve of forty**. The challenger misregisters **three**, and
all three are near-misses argued asset by asset in `verify.py`'s `ACCEPTED_EXTENTS` — a braid that
hangs to the sternum, a topknot with two loose locks, a tall boot whose shaft is up the calf
because that is what a tall boot is.

Re-derive both columns with:

```sh
python3 - <<'PY'
import json, verify, providers
for prov in providers.load():
    if not prov.exists: continue
    doc = json.loads(prov.manifest.read_text())
    over = 0
    for e in doc["assets"]:
        label = providers.label_of(e)
        if not label.startswith("avatar/") or "base-" in label: continue
        slot = label.split("/")[1].split("-")[0]
        if slot not in verify.SLOT_BANDS: continue
        lo, hi = verify.SLOT_BANDS[slot]
        _, y0, _, y1 = verify.opaque_box(prov.root / e["path"])
        over += y0 < lo - verify.SLOT_MARGIN or y1 > hi + verify.SLOT_MARGIN
    print(prov.id, over)
PY
```

**One number in `compare.py`'s own output must not be read as a gpt-image-2 figure.** Section 4's
by-eye artefact table has a filled column for `flux-2-pro` and a dash for the challenger, because
`review/compare/artefacts.json` holds the tally from the FIRST trial — its two keys are
`flux-2-pro` and `qwen-image-2512`. Its "overlay misregistered: 32" is a reading taken in that era,
against that era's bands, and it is **not** the 12 measured above. Nothing has been back-filled into
that file for this run; §9.4 is the by-eye record for this one and says what it covered.

### 9.2 Cost, in the unit each model bills in — not combined

    flux-2-pro     868.5 provider image units          288 generations, 3.02 per image
    gpt-image-2    1,744,040 output image tokens       288 generations, 6,055.7 per image

104 derivatives are free in both columns: they are Pillow cuts of that model's own output. The two
figures are not divided into each other for the reason §6 gives.

### 9.3 Retries and disclosure, and why neither scores

    assets needing >=1 retry     239/288          25/288
    total retries                975              32
    carries C2PA (measured)      283/392          59/392

The reference ran against a shared serverless deployment under a per-minute quota and 56% of its
attempts came back `429` in about 0.2s against a 16.8s median success; the challenger had a
dedicated deployment and no neighbour. This row counts wire contention on one side and nothing on
the other. C2PA presence is a disclosure fact about the endpoint, not about the picture.

### 9.4 What was looked at, by eye — and the one systematic difference

Scope: all 32 terrain plates, all 24 glyphs, all 8 chrome entries and the 6 avatar overlays that
`verify.py` had flagged, both models, same asset side by side, scored left to right. That is 70 of
288 per model. It is not the whole set and the sheets it was read off are
`review/compare/compare-{terrain,glyphs,avatar,chrome}.png`.

**The difference that explains every legibility row above is one choice, and the brief permits
both.** The glyph and chrome prompts describe a mark that may be *filled or stroked*. FLUX fills.
gpt-image-2 strokes — a consistent, even outline of the same weight on all 24 glyphs and on the
mark the 8 chrome entries are cut from. Stroked art is not worse art; the `category-instruments`
lute and the `category-flooring` rug are better drawings than the reference's, and the reference's
`tool-place` is barely a glyph at all. But a stroke is a thin ring of ink with ground on both sides
of it, and a Lanczos downscale to 16px averages the ring into the ground. That is the whole of
"marks under 50% at 16px: 40 against 25", and it is why the three worst-retaining assets in the
challenger's column are `chrome/favicon-512`, `chrome/favicon-192` and `chrome/apple-touch-180` —
the three places in this product where 16px is not hypothetical.

**It could not be repaired by rewording, and that is a property of the harness rather than an
oversight.** `reprompt` is reference-only on purpose: a candidate that gets a clarified brief is no
longer answering the same question as the set it is being compared with. A plain re-roll replays
the same literal, and the same literal is what produced a stroke.

**Two by-eye findings in the challenger's favour, both about what an overlay has to be.** The
reference's `hair-braid` and `hair-topknot` have a skin-coloured neck, shoulder and ear drawn into
them, so compositing either onto a base paints a second neck over the first; the challenger's are
hair and nothing else. And the challenger's terrain plates are painterly where the reference's are
photographic — lighter, softer, and (`kilnyard-ground`) fired clay rather than a brick course. That
is the register difference the KB/MP row is pointing at, and criterion 2 counts it as a
within-set property: both sets are internally consistent, in different registers.

### 9.5 The three assets whose bytes disagreed with their own manifest

`terrain/grove-verge`, `terrain/grove-water` and `terrain/kilnyard-ground` were committed with
`sha256` and `byteSize` rows that did not match the files beside them. That is not a model
finding — it is a defect in this run's bookkeeping — but it is recorded here because a manifest
that can be wrong once can be wrong silently, and the only reason it was caught is that
`verify.py`'s conformance check is fatal for a shipped set. All three were regenerated and
re-recorded. **A re-roll returns `postProcessing: []` and the endpoint's own delivered ground**, so
`normalise_ground.py --provider` and `cutout.py --provider` have to be re-run over anything
redrawn; skipping that step is what turns a green set red, and it did, twice, before it was written
down.

### 9.6 Verdict: promote, and what promoting costs

**gpt-image-2 is promoted to `assets/` and flux-2-pro is demoted to `candidates/flux-2-pro/`.**
The set that decides it is the avatar overlays: registration is the only measured criterion here
that is about function rather than taste, and 3 against 12 is not a margin that taste arguments
reach. Colour discipline agrees — tighter accent hue, tighter spread, 27 assets below the accent
floor against 46 — and colour discipline is what §2 fixed in advance as the test of whether a set
looks like one hand.

**What is worse after the switch, stated plainly rather than left to be discovered.** The three
chrome favicons are stroked and keep 45% contrast at 16px where the reference's filled mark keeps
more; fifteen more glyphs fall under half contrast at 16px. Nothing else regresses, and the
regression is confined to the two kinds §9.4 names.

**The switch is one variable and it is reversible in both directions.** `providers.json`'s
`reference` names the shipped set; `promote.py` moves five lines of it and vacates the outgoing set
into its own `candidates/` directory rather than deleting it; `materialise.py --provider` resolves
either set against the reference's relative paths; and the estate mounts the result through
`CF_WORLD_ASSETS`, which is a path in one env file. `verify.py`'s `ACCEPTED_EXTENTS` is keyed by
provider id, so the acceptances argued for one set do not silently excuse the other — before that
fix the switch was one-way, and its self-test now covers both sets in both directions.

**The limits of all of the above.** One run, 288 images, one setting, one brief, one pair of eyes,
70 of 288 assets looked at rather than all of them, and a by-eye tally file that still belongs to
the previous trial. The tables reproduce on demand; the prose in §9.4 does not.
