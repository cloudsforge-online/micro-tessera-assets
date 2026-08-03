/**
 * The Tessera generation run. Drives `@cloudsforge/studio`'s FLUX 2 Pro engine for the reference
 * set and Qwen-Image 2512's OpenAI-shaped images route for the candidate, and records the
 * provenance the service's `generation_jobs` and `assets` tables record.
 *
 * ## What is reused, and what deliberately is not
 *
 * **Reused verbatim, by import:** `studio/src/backend.ts` (the endpoint contract — `model`
 * required in the body, the dotted spelling, `aspect_ratio` accepted and ignored, dimensions
 * floored to a multiple of 16, `output_format:png` required, C2PA read from the bytes),
 * `specs.ts` (the round-up arithmetic), `sizing.ts` (measure, never relabel) and the licence
 * constant from `assets.ts`. Every one of those facts cost a real request to learn and is under
 * test in the service; a second copy here would be a second place for it to rot. `studio/` is not
 * modified, and neither is any other repository in the estate.
 *
 * **Not reused:** `studio/src/prompt.ts`. Its art direction is "flat geometric vector, one accent,
 * no gradients" — right for a software brand mark and right for this repository's own glyph and
 * icon sets, and wrong for a painterly material plate or a ward at dusk. This is the same call
 * the two sibling game sets made.
 *
 * ## The art direction is not neutral, and doc 23 §1.1 says why
 *
 * Tessera is **painterly on purpose**. Qwen-Image 2512 reads a FLAT brief photographically and
 * returns framed, bevelled game-UI artefacts whatever the prompt asks for — it produced 7.1x the
 * file size per megapixel on micro-brand's flat set against 2.6x on the painterly game sets. A
 * flat brief makes the two-model comparison one-sided before it starts. So the direction below is
 * luminous painterly gouache, and this is the first brief in the estate that gives Qwen somewhere
 * to go. That makes the comparison harder to predict, which is the point of running it.
 *
 * The prompts nonetheless carry a hardening clause aimed at Qwen's *measured* failure modes —
 * the recursive picture-frame grid and the Hokusai pastiche it returned on two micro-brand icons.
 * It is added to BOTH models identically, because a clause that went to one model and not the
 * other would destroy the only property this whole exercise depends on.
 *
 * ## Usage
 *
 *   cd ../studio && node --import tsx ../tessera-assets/generate.ts --plan
 *   cd ../studio && node --import tsx ../tessera-assets/generate.ts
 *   cd ../studio && node --import tsx ../tessera-assets/generate.ts --provider qwen-image-2512
 *   cd ../studio && node --import tsx ../tessera-assets/generate.ts --only objects/seating-stool
 *   cd ../studio && node --import tsx ../tessera-assets/generate.ts --limit 10
 *   cd ../studio && node --import tsx ../tessera-assets/generate.ts --derive-only
 *
 * It runs from `studio/` so `tsx` resolves out of that workspace. **The Foundry keys are read from
 * `../studio/.env.local`, held in one variable each, and never written, logged or echoed** — not
 * on success, not in an error, not in a summary line. They are spend credentials.
 */

import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { ImageBackendError, type Attempt } from '../studio/src/backend.ts'
import { requestSizeFor, specFor, type AssetKind, type AssetSpec } from '../studio/src/specs.ts'
import { reportSizing } from '../studio/src/sizing.ts'
import { GENERATED_LICENCE } from '../studio/src/assets.ts'

import {
  backendFor,
  UnimplementedBackendError,
  type GenerationRequest,
  type ProviderBackend,
} from './backends.ts'
import { REFERENCE, providerById, assetsDirOf, manifestPathOf, type Provider } from './providers.ts'
import { identityFor, promptForProvider } from './replay.ts'
import {
  plannedAssets,
  derivedAssets,
  colourWordForHex,
  AVATARS,
  PALETTE,
  type PlannedAsset,
} from './plan.ts'

const run = promisify(execFile)

const HERE = import.meta.dirname
const PLAN_JSON = join(HERE, 'PLAN.json')
const ENV_FILE = join(HERE, '..', 'studio', '.env.local')

/* ------------------------------------------------------------------ configuration */

/** Read `studio/.env.local` without printing any of it. Copied from the sibling runs. */
async function loadEnvFile(path: string): Promise<void> {
  const text = await readFile(path, 'utf8')
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (!(key in process.env)) process.env[key] = value
  }
}

/* ------------------------------------------------------------------ the prompt */

/** The one ground colour the whole estate sits on. design-system.md §7, verbatim. */
const BRAND_GROUND = '#12100f'

/**
 * The art direction, in one clause, shared by every painterly asset in the repository.
 * ART_BIBLE.md §1 as a prompt; doc 23 §1.1 as an argument.
 */
const PAINTERLY =
  'luminous painterly gouache, warm ash-and-ember key light against cool shadow, visible brush ' +
  'economy, opaque paint with the strokes left showing, no outlines, no bevels, no gloss'

/**
 * The material-plate style. doc 23 §2.4's template, kept in the order the doc states it.
 *
 * A plate is NOT a tile. Diffusion cannot hold an isometric seam, so the seam is produced by
 * `project_iso.py` from a plate that never had to tile in the first place — which is also why the
 * plate is asked for flat-on and evenly lit rather than in projection.
 */
const PLATE_STYLE = `painterly gouache material sheet. ${PAINTERLY}.`

const PLATE_TAIL =
  'This is a flat overhead view of a MATERIAL, filling the entire square from edge to edge with ' +
  'no margin: it is not a scene, not a landscape, not an aerial photograph of a place, and there ' +
  'is nothing standing on it. No objects, no figures, no buildings, no plants placed as props, ' +
  'no horizon, no sky, no vanishing point, no perspective, no cast shadow from anything outside ' +
  'the sheet, and no single light source — the light is even across the whole surface. The ' +
  'texture continues past all four edges and nothing is centred or composed.'

/**
 * The sprite style. doc 23 §2.6's template, which every object, structure part, marker and Kiln
 * asset shares — that sameness is what makes 140 sprites read as one world's furniture.
 */
const SPRITE_STYLE =
  `A single game object painted in ${PAINTERLY}, drawn as one member of an existing family of ` +
  'sprite designs for an isometric world. Three-quarter isometric view from above and to the ' +
  'left, 2:1 dimetric projection — the standard isometric game view, seen from a fixed high ' +
  'angle, never straight on and never from below. Warm ash-and-ember key light from the upper ' +
  'left and cool shadow on the right. Appealing and readable at a glance at small size.'

/** The paper doll. The registration problem is the one place this pipeline can fail invisibly. */
const AVATAR_STYLE =
  `A single character plate painted in ${PAINTERLY}, for a paper-doll avatar in an isometric ` +
  'world, drawn as one member of an existing family of character plates. Flat frontal game-sprite ' +
  'rendering with no perspective distortion, no foreshortening and no dynamic pose.'

/**
 * The same style, for an OVERLAY rather than a base, and the difference is two nouns.
 *
 * `AVATAR_STYLE` opens "a single CHARACTER PLATE ... drawn as one member of an existing family of
 * CHARACTER PLATES", in the first sentence of the prompt, which is the most obeyed position there
 * is. On a base that is exactly right. On an overlay it is an instruction to draw a character, and
 * it was being sent to all 40 overlays alongside a clause asking for a garment in a band — the
 * same competition `silhouetteClause` above describes, in the one position that outranks the rest
 * of the brief. A wardrobe plate is not a character plate and is no longer told that it is.
 */
const OVERLAY_STYLE =
  `A single item of clothing or equipment painted in ${PAINTERLY}, for the wardrobe of a ` +
  'paper-doll avatar in an isometric world, drawn as one member of an existing family of wardrobe ' +
  'plates. Flat frontal game-sprite rendering with no perspective distortion, no foreshortening ' +
  'and no dynamic pose.'

/** Flat chrome, glyphs and icons: the estate's icon discipline, as `studio/src/prompt.ts` puts it. */
const GLYPH_STYLE =
  'A single piece of user-interface artwork for a video game, drawn as one member of an existing ' +
  'family of icons. Flat geometric vector: every shape constructed from circles, squares and ' +
  '45-degree chamfers on one grid, one uniform stroke weight throughout, sharp corners left ' +
  'sharp, generous negative space, optically centred, and legible when it is shrunk to 24 pixels. ' +
  'Flat fills only: no gradients, no photographic texture, no bevels, no drop shadows, no glow, ' +
  'no 3D, no photo-realism, no weathering.'

/** Scenes: backdrops, key art, splashes. */
const SCENE_STYLE =
  `A painted scene for an isometric world game, in ${PAINTERLY}, cinematic and high contrast, ` +
  'saturated without being garish, with real atmospheric depth. It is a painting, not a ' +
  'photograph: no lens flare, no chromatic aberration, no depth-of-field bokeh discs, no ' +
  'letterboxing, no user interface overlay, no watermark and no signature. The painting FILLS ' +
  'THE WHOLE IMAGE, edge to edge and corner to corner.'

/**
 * The flat ground, restated LAST as its own paragraph — the brand run's most expensive lesson
 * (its first live image came back mid-grey taupe with construction guides), carried through both
 * sibling game sets unchanged in substance and unchanged again here.
 *
 * It matters more in Tessera than anywhere before it: every one of these sprites is keyed to
 * alpha by `cutout.py`, and a cutout is only as clean as the ground it is cut from.
 */
const FLAT_GROUND_CLAUSE =
  `The background is one flat, uniform, unbroken near-black warm ash field, hex ${BRAND_GROUND}, ` +
  'filling the entire frame from edge to edge behind the subject — not grey, not taupe, not ' +
  'beige, not cream, not ivory, not off-white, not paper, not parchment, not a gradient, not a ' +
  'vignette, not a radial glow, not a spotlight, not a studio backdrop, and not lighter at the ' +
  'corners or behind the subject. There is NO light beam, no light ray, no shaft of light, no ' +
  'sunbeam and no glow entering the frame from any edge or corner. The subject is bright against ' +
  'a dark ground, never dark against a light one, and the image is never inverted. It is not ' +
  'standing on anything: no floor, no ground plane, no platform, no pedestal, no podium, no ' +
  'horizon line, no cast shadow and no contact shadow. Draw only the subject itself: no ' +
  'construction lines, no grid, no guides, no ruled margins, no registration marks, no colour ' +
  'swatches and no drop shadow.'

/** One-sentence restatement in the final position. Position beats length — the Emberkin finding. */
const DARK_TAIL =
  `Overall this image is DARK. The background is ONE SINGLE FLAT COLOUR, near-black ${BRAND_GROUND}, ` +
  'with no shading, no lighting, no shadow, no floor and no texture of any kind on it anywhere. ' +
  'It is NOT white, NOT cream and NOT grey. The artwork floats free on it with nothing beneath ' +
  'it, and is the only bright thing in the frame.'

/**
 * The scene equivalent: a picture cannot have a flat ground, but it can refuse to be pale.
 *
 * **THIS CLAUSE USED TO CONTRADICT ITS OWN CONTENT, AND THIS IS THE REPAIR.** It read "the four
 * outer edges of the frame fall away into that darkness rather than into grey, white or pale
 * blue" — unconditionally, for every scene. `content/wards.json` simultaneously defines `day` as
 * "flat even daylight, high sun, the ward's own colours at full strength", and eight of the
 * sixteen ward backdrops are day. Both sentences went into the same prompt. A high sun over an
 * immense salt pan has a pale blue sky at the top edge of the frame; the clause forbade it.
 *
 * verify.py carried an `is_daylight` exemption that skipped the darkness ceiling for the eight
 * `-day` backdrops, and README §8 was explicit that this was a content defect made visible rather
 * than a check softened to go green, and that it should be deleted once the clause was fixed. It
 * has been. The exemption is gone.
 *
 * The repair does not delete the darkness requirement, which is load-bearing — it is the clause
 * the brand run's mid-grey taupe first image was written against. It makes it CONDITIONAL ON THE
 * LIGHT THE SCENE IS DESCRIBED AS HAVING, which is the thing the clause should always have been
 * conditional on, and it names both cases explicitly so the model is not left to arbitrate
 * between two sentences of its brief. The guard that actually mattered — that an edge is never a
 * flat pale wash belonging to no part of the scene — is kept and sharpened, because that, and not
 * "an edge is dark", is what the failure looked like.
 */
const SCENE_GROUND_CLAUSE =
  'This picture is anchored at the dark end of its range: its darkest values are a warm ' +
  `near-black ash, hex ${BRAND_GROUND}, and that value is really present in the frame — in the ` +
  'deep shadows, the openings and the undersides. The painting runs corner to corner, and the ' +
  "four outer edges carry the scene's own material at full strength, lit by the light this scene " +
  'is described as having: at dusk and at night that means the edges fall away into the ' +
  'near-black ash, and under a high sun it means the edges are sky, ground and structure painted ' +
  'in their own colours at full saturation. What an edge is never made of is a flat pale wash, a ' +
  'grey haze, a white fog, a bleached band, or a lightened corner that belongs to no part of the ' +
  'scene. Draw only the picture: no border, no frame, no letterbox bars, no drawn vignette ring, ' +
  'no user interface, no logo and no signature.'

const NO_TEXT =
  'Nothing is written anywhere in this image: no text, no lettering, no numerals, no caption, no ' +
  'label, no title, no logo, no watermark and no signature. If any string would appear, leave ' +
  'that area empty instead.'

/**
 * **The artefact guard, and the one clause in this file written from measurement of the CANDIDATE
 * rather than of the reference.**
 *
 * Qwen-Image 2512's measured failure modes on the estate's earlier sets were a framed, bevelled
 * game-UI artefact returned regardless of the ask; a recursive picture-frame grid (an icon drawn
 * as a wall of smaller framed copies of itself); and a Hokusai pastiche on a brief that named no
 * artist. Each sentence below answers one of those by name.
 *
 * It goes to BOTH models, identically and in the same position, and that is not a courtesy — a
 * clause sent to one model and not the other would make the two sets incomparable while every
 * file involved still looked correct, which is exactly the failure `parity.test.ts` exists to
 * make impossible. FLUX pays a few tokens for a guard it does not need; the comparison stays valid.
 */
const ARTEFACT_GUARD =
  'This image IS the artwork, not a picture of artwork. It has no frame, no border, no mount, no ' +
  'matte, no bevelled edge, no rounded corners, no card, no panel, no plaque, no button, no ' +
  'tooltip, no nameplate, no caption bar, no ribbon, no scroll, no stat block, no rarity gem, no ' +
  'inventory slot and no user-interface chrome of any kind around it or behind it. Do not draw a ' +
  'smaller copy of this image inside this image, do not draw a grid or a sheet of variants, do ' +
  'not draw a thumbnail or a preview box, and do not draw a framed picture hanging on a wall. Do ' +
  'not imitate any named artist, print series, woodblock, ukiyo-e or historical illustration ' +
  'style: this is the game\'s own painterly house style and nothing else.'

const ONE_SUBJECT_GUARD =
  'Draw the subject exactly ONCE, filling the frame with a small even margin. Do not repeat it, ' +
  'do not inset a second smaller copy, do not add a variant beside or below it, and do not place ' +
  'any other object anywhere in the frame.'

/**
 * The accent clause for flat vector work, carried from the brand run with Emberkin's amendment:
 * the anchor's plain-language name is stated beside the hex, because a bare hex reads as noise to
 * an image model.
 */
function accentClause(accent: string): string {
  const { name, qualifier } = colourWordForHex(accent)
  const named =
    name === 'its anchor colour' ? '' : `That colour is ${name}${qualifier ? ` — ${qualifier}` : ''}. `
  return (
    `Every drawn element is filled or stroked in ${accent} — that exact colour, at full ` +
    `strength. ${named}There is no second colour anywhere: no ground line, no baseline bar, no ` +
    'shelf, no band and no stripe beneath or behind the subject. Nothing is drawn in plain ' +
    `white, plain grey or the ground colour, and ${accent} is the dominant colour of the ` +
    'artwork rather than a small detail on it.'
  )
}

/** The palette clause for painterly work. Not a single-accent rule — a barrel is oak and iron. */
function paletteClause(accent: string): string {
  const { name, qualifier } = colourWordForHex(accent)
  const phrase = qualifier ? `${name} — ${qualifier}` : name
  return (
    "Its palette is the world's: warm lamplit timber, fired clay, pale limestone and soft brass " +
    `on the subject, against the cool dark. The hue that identifies this subject is ${phrase}, ` +
    `${accent}, and it is clearly present on it. No rainbow, no unrelated accent colours, and ` +
    'nothing pastel.'
  )
}

/** Footprint is a field, never an inference. doc 23 §2.6. */
function footprintClause(footprint: string): string {
  return footprint === '2x2'
    ? 'This object occupies a two-by-two floor footprint, so it is drawn at HALF the depicted ' +
        'scale of a single-tile object and reads as a large piece of furniture within its frame.'
    : 'This object occupies a single one-by-one floor tile, and is drawn to fill the lower two ' +
        'thirds of the frame with headroom above it.'
}

/**
 * The paper-doll registration clause. verify.py check 8 measures what this asks for.
 *
 * The silhouette, the region, the prose placement and the band are all read from
 * `content/avatars.json` rather than restated here, so the prompt and the engine cannot disagree
 * about where a hat goes.
 *
 * **THIS CLAUSE IS THE REPOSITORY'S ONE MEASURED PROMPT DEFECT, AND THIS IS THE REPAIR.** The
 * first run of these 40 overlays put 32 of FLUX's and 40 of Qwen's outside their slot's band. The
 * clause then read `Draw ONLY <region>` followed by "everything outside the named part of the
 * frame is empty" and four `do not`s — a positive half naming the garment and a NEGATIVE half
 * naming where the ink may not go. Both models drew the garment beautifully and both ignored the
 * negative half, identically. When two independent models fail one instruction the same way, the
 * instruction is the defect.
 *
 * Two things changed, and only these two, so that what fixed it is attributable:
 *
 *  1. **The region is stated positively**, by the method `dialects.json`'s `positive` dialect
 *     documents for the estate's briefs: a forbidden REGION becomes a measurement of the region
 *     that IS drawn. "Everything below the jaw is empty" becomes "every drawn pixel sits inside a
 *     band running from the top edge down to three tenths of the frame's height". No word of the
 *     negation vocabulary survives in this clause.
 *  2. **It is restated once, in the final position**, as `registrationTail`. Position beats
 *     length — the Emberkin finding that `DARK_TAIL` already exists for. The old clause sat third
 *     of eight parts and was followed by four paragraphs of prohibitions about ground, frames,
 *     lettering and darkness; the one instruction that had to survive to the end was the one
 *     buried in the middle.
 *
 * WHAT IS DELIBERATELY UNCHANGED is everything else in the brief. `AVATAR_STYLE`, the subject,
 * `paletteClause`, `FLAT_GROUND_CLAUSE`, `ARTEFACT_GUARD`, `NO_TEXT` and `DARK_TAIL` are byte for
 * byte what they were, prohibitions and all. The experiment is therefore about the registration
 * instruction rather than about the prompt's style, which is what makes the before-and-after
 * bounding boxes worth quoting.
 *
 * THE FAILURE MODE TO WATCH is the one the estate's `positive` pilot found and reported against
 * itself: restating things positively lengthens them, and a long positive description crowds out
 * the subject — that pilot regressed "idea unrecognisable" from 2/15 to 8/15. A plate correctly
 * registered but no longer recognisably a boot is a different failure, not a fix.
 *
 * ## THIRD ITERATION: SAY THE EXTENT, NOT ONLY THE BOUNDS
 *
 * The version described above moved FLUX from 32 misregistered of 40 to 28, and moved the pictures
 * much further than that: every overlay used to be a CLOTHED FIGURE and they are now isolated
 * plates. **So the remaining defect is not subject, it is SCALE.** Reading the 40 bounding boxes
 * says so in one line — the ink's mean height is roughly 0.5 of the frame in every slot, whatever
 * band that slot declares:
 *
 *   slot   band height   measured mean ink height   registered
 *   feet   0.20          0.43                       0/8
 *   hair   0.30          0.54                       2/8
 *   legs   0.46          0.63                       1/8
 *   top    0.48          0.56                       3/8
 *   held   0.50          0.55                       6/8
 *
 * `held` is not passing because the instruction worked. It is passing because a 0.50 band centred
 * on the frame is what the model was going to draw anyway. Every slot whose band is SHORT (`feet`)
 * or OFF-CENTRE (`hair`, `legs`) fails, and `legs` fails hardest of the three: seven of its eight
 * boxes are centred within 0.03 of the frame's midline against a band centred at 0.67.
 *
 * **AND THE PREVIOUS CLAUSE ASKED FOR THAT.** It said the item is "drawn as large as it can be
 * while fitting entirely inside the band" — an instruction to MAXIMISE size whose only limit was a
 * band the model cannot measure. A diffusion model obeys the direction and drops the limit, so it
 * drew everything big and centred. **That is also what cost the `hair` slot**, which went 6/8 to
 * 2/8: hair drawn "as large as it can be" is hair filling half a 512-pixel frame, and `hair`'s
 * tolerance ends at 0.46. Three of its six new failures (`crop` 0.21–0.58, `wrapped` 0.17–0.61,
 * `topknot` 0.08–0.61) are not even too TALL, they are too LOW — the centring prior, unopposed
 * once "the head only, the top quarter of the frame" was replaced by a band. So it is one cause,
 * not two: "as large as it can be" plus nothing anchoring the box to a frame edge.
 *
 * The repair is to write the instruction in the vocabulary check 8 GRADES IN. Check 8 measures
 * exactly two numbers — the top and the bottom of the opaque bounding box, as fractions of the
 * frame's height — and the clause now states exactly those two numbers, plus the height between
 * them, and it says "exactly" rather than "as large as it can be". Where a band touches a frame
 * edge (`hair` at 0.0, `feet` at 1.0) it is anchored to THAT EDGE rather than to a percentage,
 * because an edge is a thing a model can see and 80% is not.
 *
 * The identity guard is unchanged in force and shorter in words: the item still fills its box,
 * is still centred, is still "immediately recognisable for what it is", and is still the single
 * subject drawn with all the detail the brief asks for. What it no longer is, is LARGE — that word
 * is deleted from both this clause and the tail, because it was the defect.
 */
function silhouetteClause(planned: PlannedAsset): string {
  const shared = AVATARS.silhouette as string
  if (planned.style === 'avatar-base') {
    return (
      `The figure is composed to a fixed shared silhouette: ${shared}. That composition is ` +
      'identical for every character plate in this set and does not vary with the build.'
    )
  }
  return (
    // THE SHARED SILHOUETTE IS DELIBERATELY NOT DESCRIBED HERE, and that is the second iteration
    // of this repair rather than an oversight. The first iteration DID restate it — "composited
    // onto a base figure drawn to a fixed shared silhouette: a standing adult figure occupying the
    // centre of a tall narrow frame, head near the top, feet just above the bottom edge" — one
    // sentence before the band. Measured over 40 regenerated FLUX plates, that version moved the
    // `held` slot from 1 of 8 registered to 5 of 8 and left `top` at 0 of 8 and `legs` at 1 of 8.
    //
    // The split is the finding. A lantern is an OBJECT and the band tells the model where to put
    // it. A tunic is a GARMENT, and a vivid positive description of a standing adult figure
    // filling a tall frame is itself an instruction to draw one — so the model drew the figure
    // wearing the tunic and the band lost the argument to the more pictorial of two positive
    // clauses. The silhouette is registration data for the compositor, not subject matter, and
    // naming it to an image model spends the prompt's most concrete sentence on the one thing the
    // plate must NOT contain. `content/avatars.json` still holds it; the base plates still state
    // it; an overlay is told its band instead, which is the same information without the picture.
    'This image is a single GARMENT PLATE for a dress-up screen — one layer of a paper doll, ' +
    'drawn on its own so that it can be laid over a separate base figure. It shows ' +
    `${planned.region}, and that is the whole of its subject.\n\n` +
    `EVERY DRAWN PIXEL IN THIS IMAGE SITS INSIDE ${(planned.placement ?? '').toUpperCase()}. ` +
    // THE TWO NUMBERS CHECK 8 GRADES, in the order it reads them off the bounding box.
    `${overlayExtent(planned)} ` +
    `Above that box and below it, the frame is flat ${BRAND_GROUND} background for its full ` +
    // NO WIDTH FIGURE HERE, and that is measured rather than stylistic. This sentence used to add
    // "and about two thirds of the frame width". On a `feet` plate that is 170 px of width inside
    // a 102 px band, and a model asked for both keeps the item's proportions and overflows the
    // band to do it — which is precisely the failure being fixed. Scale is now expressed against
    // the band alone, and width follows from the item's own shape.
    'width, out to all four edges. The item fills that box exactly: centred left to right, as ' +
    'wide as its own shape needs to be, and immediately recognisable for what it is. It is the ' +
    'single subject of this image and it is drawn at that size with all the detail the rest of ' +
    'this brief asks for.\n\n' +
    // VERBATIM FROM THE CLAUSE THAT GENERATED THE FIRST SET, and deliberately so. The first
    // attempt at this repair reworded it too, to "holds the shape of the body part that fills it,
    // while the wearer stays invisible" — and the reference endpoint's content filter refused
    // four of the first eight `feet` overlays outright with BingBlockList_Prompt, having refused
    // almost nothing across the original 288. A garment plate described in terms of body parts
    // reads to a safety classifier as something else. The registration wording is what this
    // change is testing; this sentence is not, so it is left exactly as it was.
    'Draw the item as WORN, in its worn position, with the wearer invisible: the item\'s own ' +
    'outline is the only outline anywhere in the frame.'
  )
}

/**
 * The bounding box of the ink, said in the two numbers verify.py check 8 actually reads.
 *
 * Check 8 opens the file, takes the opaque bounding box, and compares exactly `box.top` and
 * `box.bottom` — as fractions of the frame's HEIGHT — against the slot's band. It never looks at
 * the width, never looks at the area, and never looks at how much of the band is filled. So this
 * sentence names the highest paint, the lowest paint, and the distance between them, and nothing
 * else: an instruction phrased in a vocabulary the measurement cannot see is how the previous
 * prohibition failed, and "as large as it can be" was exactly that.
 *
 * **An edge beats a percentage.** Where the band starts at 0.0 (`hair`) or ends at 1.0 (`feet`)
 * the sentence names the frame's own edge instead of a number, because the top and bottom edges of
 * the picture are things a diffusion model can locate and "80% of the way down" is not. Those are
 * also the two slots whose failures were positional rather than dimensional, and `feet` is the one
 * slot that has never registered a single plate.
 *
 * The shallow-strip sentence is added only where the box is markedly wider than it is tall, which
 * on a 256x512 frame means `hair` and `feet`. It describes the BOX, never the item — the width
 * figure removed in the second iteration stays removed — and it is omitted everywhere it would be
 * near-tautological, because every extra clause here is a clause competing with the garment.
 */
function overlayExtent(planned: PlannedAsset): string {
  const [top, bottom] = planned.band ?? [0, 1]
  const pct = (value: number): string => `${Math.round(value * 100)}%`
  const highest =
    top <= 0.001 ? 'at the very TOP EDGE of the frame' : `${pct(top)} of the way down the frame`
  const lowest =
    bottom >= 0.999
      ? 'at the very BOTTOM EDGE of the frame'
      : `${pct(bottom)} of the way down the frame`
  const ratio = planned.width / (planned.height * (bottom - top))
  const strip =
    ratio >= 1.3
      ? ` That box is a wide shallow strip, about ${
          Math.round(ratio * 10) / 10
        } times as wide as it is tall.`
      : ''
  return (
    `The HIGHEST paint anywhere in this picture is ${highest}, and the LOWEST paint anywhere in ` +
    `it is ${lowest}; between those two lines the item measures exactly ${pct(bottom - top)} of ` +
    `the picture's height.${strip}`
  )
}

/**
 * The registration restated in the FINAL position, one sentence, per slot.
 *
 * The scene equivalent of `DARK_TAIL`, and it exists for the same measured reason: in this estate
 * the last paragraph of a prompt is the one a diffusion model reliably obeys, and the first run
 * proved that a registration instruction placed mid-prompt is a registration instruction that gets
 * dropped. It says the band and nothing else — no style, no subject, no colour — because a tail
 * that repeats the whole brief is a tail that competes with it.
 *
 * **The word `large` has been deleted from it**, and that is the third iteration's whole point in
 * one edit. The tail used to end "the item is drawn once, large, inside that band", which on a
 * `feet` plate is an instruction to draw a boot big and a band 20% of the frame tall, in the same
 * breath, in the most obeyed position in the prompt. It now restates the measured box instead.
 */
function registrationTail(planned: PlannedAsset): string {
  const [top, bottom] = planned.band ?? [0, 1]
  const pct = (value: number): string => `${Math.round(value * 100)}%`
  const highest =
    top <= 0.001 ? 'the very top edge of the tall frame' : `${pct(top)} of the way down the tall frame`
  const lowest = bottom >= 0.999 ? 'its very bottom edge' : `${pct(bottom)} of the way down it`
  return (
    `REGISTRATION, and this governs the whole image: the highest paint in this picture is at ` +
    `${highest}, the lowest paint in it is at ${lowest}, and everything between them measures ` +
    `${pct(bottom - top)} of the picture's height. The rest of the frame is bare flat ` +
    `${BRAND_GROUND} for its full width. The item is drawn once, at exactly that size, in exactly ` +
    `that box.`
  )
}

/**
 * Assemble one prompt. Style first, subject second, colour third, prohibitions LAST — the order
 * `studio/src/prompt.ts` argues for; a prohibition placed before the subject is routinely ignored.
 */
export function promptFor(planned: PlannedAsset): string {
  const parts: string[] = []

  switch (planned.style) {
    case 'plate':
      parts.push(PLATE_STYLE, planned.subject, PLATE_TAIL, ARTEFACT_GUARD, NO_TEXT)
      break
    case 'sprite':
      parts.push(
        SPRITE_STYLE,
        ONE_SUBJECT_GUARD,
        planned.subject,
        planned.footprint ? footprintClause(planned.footprint) : '',
        paletteClause(planned.accent),
        FLAT_GROUND_CLAUSE,
        ARTEFACT_GUARD,
        NO_TEXT,
        DARK_TAIL,
      )
      break
    case 'avatar-base':
    case 'avatar-overlay':
      parts.push(
        planned.style === 'avatar-overlay' ? OVERLAY_STYLE : AVATAR_STYLE,
        planned.subject,
        silhouetteClause(planned),
        paletteClause(planned.accent),
        FLAT_GROUND_CLAUSE,
        ARTEFACT_GUARD,
        NO_TEXT,
        DARK_TAIL,
        // LAST, and only on an overlay. A base occupies the whole frame by definition and has no
        // band to be held to; giving it one would be asking for the defect rather than fixing it.
        planned.style === 'avatar-overlay' ? registrationTail(planned) : '',
      )
      break
    case 'glyph':
      parts.push(
        GLYPH_STYLE,
        ONE_SUBJECT_GUARD,
        planned.subject,
        accentClause(planned.accent),
        FLAT_GROUND_CLAUSE,
        ARTEFACT_GUARD,
        NO_TEXT,
        DARK_TAIL,
      )
      break
    case 'scene':
      parts.push(SCENE_STYLE, planned.subject, SCENE_GROUND_CLAUSE, ARTEFACT_GUARD, NO_TEXT)
      break
  }

  return parts.filter((part) => part.trim().length > 0).join('\n\n')
}

/* ------------------------------------------------------------------ the manifest */

export interface ManifestEntry {
  /**
   * The provider id from providers.json. Without it, two manifests describing two different models
   * would be distinguishable only by which directory they were found in, and compare.py would be
   * reading a fact off a path.
   */
  readonly provider: string
  /** `objects/seating-stool`. Stable across runs; the manifest is keyed on it plus the size. */
  readonly asset: string
  readonly set: string
  readonly slug: string
  readonly name: string
  readonly path: string
  /** What verify.py measures coverage against, where the set's floor is above zero. */
  readonly accent: string
  readonly secondaryAccent: string | null
  /** `flat` (snapped to #12100f), `scene` (darkness ceiling) or `plate` (full-bleed material). */
  readonly groundClass: string
  readonly declaredSize: string
  /** What was asked for — rounded UP to the 16-pixel grid, never down. */
  readonly requestedSize: string
  /**
   * What the bytes on disk actually MEASURE. Never what the response reported: Qwen's images route
   * reports the size it was asked for and delivers its transpose, so a manifest built from the
   * response would be wrong and self-consistent at the same time. verify.py check 8 re-reads this
   * off the bytes and compares it across providers.
   */
  readonly deliveredSize: string
  readonly sizing: string
  readonly cropped: boolean
  /** Set on a derivative; names the file it was cut, projected or composited from. */
  readonly derivedFrom: string | null
  readonly backend: string
  readonly model: string | null
  readonly prompt: string
  /** Null on every entry: neither deployment accepts a seed. doc 23 §2.1 turns on this fact. */
  readonly seed: number | null
  readonly sha256: string
  readonly byteSize: number
  readonly generatedAt: string
  /** Read from the bytes on disk, never assumed from the vendor. verify.py re-checks it. */
  readonly c2pa: boolean
  /** Generations beyond the first that were needed before this file was accepted. */
  readonly retries: number
  readonly licence: string
  readonly providerCostUnits: number | null
  readonly providerOutputMegapixels: number | null
  /** Where in doc 23 and content/ this asset's brief came from. */
  readonly sourceSpec: string
  /** Every post-processing step applied to the bytes since delivery, in order. */
  readonly postProcessing: readonly string[]
  /** The ground actually delivered, before normalisation. Written by normalise_ground.py. */
  readonly deliveredGround: string | null
  /** `1x1` or `2x2` on a seed object, null everywhere else. A field, never an inference. */
  readonly footprint: string | null
  readonly attempts: readonly Attempt[]
  readonly note?: string
}

type Manifest = Record<string, ManifestEntry>

const keyOf = (asset: string, size: string): string => `${asset}@${size}`

async function readManifest(provider: Provider): Promise<Manifest> {
  const path = manifestPathOf(provider)
  if (!existsSync(path)) return {}
  const parsed = JSON.parse(await readFile(path, 'utf8')) as { assets?: ManifestEntry[] }
  const out: Manifest = {}
  for (const entry of parsed.assets ?? []) out[keyOf(entry.asset, entry.declaredSize)] = entry
  return out
}

async function writeManifest(provider: Provider, manifest: Manifest): Promise<void> {
  const assets = Object.values(manifest).sort(
    (a, b) => a.asset.localeCompare(b.asset) || a.path.localeCompare(b.path),
  )
  const document = {
    $comment:
      'Provenance for every image in this repository. One entry per file, carrying the columns ' +
      "studio's generation_jobs and assets tables carry. Generated by generate.ts and updated " +
      'in place by normalise_ground.py, cutout.py, project_iso.py and derive.py; do not edit by ' +
      'hand.',
    provider: provider.id,
    providerLabel: provider.label,
    billing: provider.billing,
    generator: '@cloudsforge/studio via tessera-assets/generate.ts',
    endpoint:
      provider.id === REFERENCE.id
        ? 'Azure AI Foundry, Black Forest Labs FLUX 2 Pro'
        : 'Azure AI Foundry Global Managed Compute, Qwen-Image 2512',
    specification:
      'docs/ecosystem/23-tessera.md §2 (the manifest), content/*.json (the canonical trees), ' +
      'ART_BIBLE.md (the direction).',
    disclosure:
      'Every image here is AI-generated. C2PA is MEASURED off the bytes of each file and never ' +
      'asserted from the vendor — the estate has one repository whose verifier does not check it ' +
      'and 83 entries there are claims nothing has ever tested. Ground normalisation preserves ' +
      'the C2PA chunk by copying every ancillary chunk through; a file re-encoded by Pillow does ' +
      'not, and each derivative names the file it came from and reports the c2pa state actually ' +
      'measured on its own bytes.',
    licence: GENERATED_LICENCE,
    assetCount: assets.length,
    updatedAt: new Date().toISOString(),
    assets,
  }
  await mkdir(provider.root, { recursive: true })
  await writeFile(manifestPathOf(provider), `${JSON.stringify(document, null, 2)}\n`, 'utf8')
}

/* ------------------------------------------------------------------ generation */

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

/** Provenance and shape only; the FLUX backend sends width/height regardless. */
function assetKindFor(planned: PlannedAsset): AssetKind {
  if (planned.set === 'chrome' && planned.slug === 'mark') return 'mark'
  if (planned.width === planned.height) return planned.width <= 256 ? 'icon' : 'tile'
  return 'banner'
}

function specForPlanned(planned: PlannedAsset): AssetSpec {
  return specFor(assetKindFor(planned), { width: planned.width, height: planned.height })
}

function fileNameFor(planned: PlannedAsset, requested: { width: number; height: number }): string {
  const onGrid = requested.width === planned.width && requested.height === planned.height
  return onGrid
    ? `${planned.slug}-${planned.width}x${planned.height}.png`
    : `${planned.slug}-${requested.width}x${requested.height}-asdelivered.png`
}

/** True when a refusal was the content filter rather than a malformed request. */
function isContentRefusal(err: unknown): boolean {
  if (!(err instanceof ImageBackendError) || err.code !== 'bad_request') return false
  const text = `${err.message} ${err.attempts.map((a) => a.detail).join(' ')}`.toLowerCase()
  return text.includes('content_safety') || text.includes('rai policy') || text.includes('blocklist')
}

/**
 * A delivered image whose dimensions are the transpose of what was asked for.
 *
 * The candidate's `size` parameter is transposed at the far end and its RESPONSE reports the size
 * it was asked for, so nothing in the JSON can catch this — only the bytes can. `backends.ts`
 * compensates in the envelope; this class is what happens if that compensation is ever removed,
 * and it is thrown per asset rather than discovered on a contact sheet 288 images later.
 */
export class TransposedDeliveryError extends Error {
  constructor(key: string, wanted: string, got: string) {
    super(
      `${key}: asked for ${wanted} and the bytes measure ${got}, which is its transpose. The ` +
        "candidate endpoint's `size` parameter is transposed and backends.ts compensates by " +
        'sending height x width; if that compensation has been "corrected", every non-square ' +
        'asset in this set is rotated and the response JSON says nothing is wrong.',
    )
    this.name = 'TransposedDeliveryError'
  }
}

async function generateOne(
  provider: Provider,
  backend: ProviderBackend,
  planned: PlannedAsset,
  previousRetries: number,
  reprompt: boolean,
): Promise<ManifestEntry> {
  const spec = specForPlanned(planned)
  const requested = requestSizeFor({ width: planned.width, height: planned.height })
  // Replayed from the reference manifest where there is a record, computed only where there is
  // not. See replay.ts for why that asymmetry is the whole parity guarantee.
  const prompt = promptForProvider(provider.id, planned, promptFor, { reprompt })

  const request: GenerationRequest = {
    prompt,
    spec,
    requestWidth: requested.width,
    requestHeight: requested.height,
    kitName: planned.name,
    accent: planned.accent,
  }

  const MAX_TRANSIENT = 5
  let transient = 0
  let lastError: unknown = null
  const allAttempts: Attempt[] = []

  for (let go = 0; go <= MAX_TRANSIENT; go += 1) {
    try {
      const result = await backend.generate(request, AbortSignal.timeout(300_000))
      allAttempts.push(...result.attempts)

      const sizing = reportSizing(
        result.bytes,
        { width: requested.width, height: requested.height },
        'png',
      )
      const delivered = sizing.actual ? `${sizing.actual.width}x${sizing.actual.height}` : 'unknown'

      // MEASURED, BEFORE THE FILE IS KEPT. A transposed delivery is not a transient fault and
      // must not be written to disk and recorded as if it were the asset.
      if (
        sizing.actual &&
        requested.width !== requested.height &&
        sizing.actual.width === requested.height &&
        sizing.actual.height === requested.width
      ) {
        throw new TransposedDeliveryError(
          planned.key,
          `${requested.width}x${requested.height}`,
          delivered,
        )
      }

      const [directory] = planned.key.split('/')
      const dir = join(assetsDirOf(provider), directory!)
      await mkdir(dir, { recursive: true })
      const fileName = fileNameFor(planned, requested)
      const path = join(dir, fileName)
      await writeFile(path, result.bytes)

      const isSource = fileName.includes('asdelivered')

      return {
        asset: isSource ? `${planned.key}-source` : planned.key,
        set: planned.set,
        slug: planned.slug,
        name: planned.name,
        path: `assets/${directory}/${fileName}`,
        accent: planned.accent,
        secondaryAccent: planned.secondaryAccent,
        groundClass: planned.ground,
        declaredSize: isSource
          ? `${requested.width}x${requested.height}`
          : `${planned.width}x${planned.height}`,
        requestedSize: `${requested.width}x${requested.height}`,
        deliveredSize: delivered,
        sizing: sizing.sizing,
        cropped: false,
        derivedFrom: null,
        provider: provider.id,
        backend: result.backend,
        model: result.model,
        prompt,
        seed: result.seed,
        sha256: sha256(result.bytes),
        byteSize: result.bytes.length,
        generatedAt: new Date().toISOString(),
        // Measured on the bytes, never asserted from the vendor. The standing rule.
        c2pa: result.c2pa,
        retries: previousRetries + transient,
        licence: GENERATED_LICENCE,
        providerCostUnits: result.providerCostUnits,
        providerOutputMegapixels: result.providerOutputMegapixels,
        sourceSpec: planned.source,
        postProcessing: [],
        deliveredGround: null,
        footprint: planned.footprint ?? null,
        attempts: allAttempts,
      }
    } catch (err) {
      lastError = err
      if (err instanceof UnimplementedBackendError) throw err
      // Wrong in the same way on every retry, and wrong about the WHOLE SET rather than this
      // asset: fail the run rather than burn 288 assets' retry budgets discovering it again.
      if (err instanceof TransposedDeliveryError) throw err
      if (err instanceof ImageBackendError) {
        allAttempts.push(...err.attempts)
        if (err.code === 'bad_request' || err.code === 'unauthorised') throw err
      }
      transient += 1
      if (go === MAX_TRANSIENT) break
      const rateLimited =
        err instanceof ImageBackendError && err.attempts.some((a) => a.outcome === 'rate_limited')
      const backoffMs = rateLimited ? 20_000 * (go + 1) : 2_000 * 2 ** go
      process.stdout.write(`    ${planned.key}: transient failure, retrying in ${backoffMs / 1000}s\n`)
      await new Promise((resolve) => setTimeout(resolve, backoffMs))
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

/* ------------------------------------------------------------------ derivatives */

/** The 96 tiles, the two title crops and the six chrome sizes. See each script's own header. */
async function deriveAll(provider: Provider): Promise<ManifestEntry[]> {
  const out: ManifestEntry[] = []
  for (const script of ['project_iso.py', 'derive.py']) {
    const { stdout } = await run('python3', [join(HERE, script), '--provider', provider.id], {
      maxBuffer: 256 * 1024 * 1024,
    })
    out.push(...(JSON.parse(stdout) as ManifestEntry[]))
  }
  return out
}

/* ------------------------------------------------------------------ the reviewable plan */

/** Write PLAN.json: the whole derived set, with every prompt, before anything is spent. */
async function writePlanJson(): Promise<number> {
  const planned = plannedAssets()
  const derived = derivedAssets()
  const requested = (asset: PlannedAsset) =>
    requestSizeFor({ width: asset.width, height: asset.height })
  const document = {
    $comment:
      'The generation plan, derived by plan.ts from content/*.json and written by ' +
      '`generate.ts --plan`. Reviewable before a single generation is paid for. Do not edit by ' +
      'hand: it is regenerated from the content, which is the point of it. `assets` are the 288 ' +
      'GENERATED entries and `derived` are the 104 that are cut, projected or composited from ' +
      'them — 392 in total, which is doc 23 §2.3.',
    generatedAt: new Date().toISOString(),
    palette: PALETTE,
    counts: planned.reduce<Record<string, number>>((acc, asset) => {
      acc[asset.set] = (acc[asset.set] ?? 0) + 1
      return acc
    }, {}),
    total: planned.length,
    derivedTotal: derived.length,
    grandTotal: planned.length + derived.length,
    /** The 68 non-square generations — the block Qwen's transposed `size` would have wrecked. */
    nonSquare: planned.filter((a) => a.width !== a.height).length,
    assets: planned.map((asset) => ({
      key: asset.key,
      set: asset.set,
      name: asset.name,
      declaredSize: `${asset.width}x${asset.height}`,
      requestedSize: `${requested(asset).width}x${requested(asset).height}`,
      groundClass: asset.ground,
      style: asset.style,
      accent: asset.accent,
      secondaryAccent: asset.secondaryAccent,
      lettering: asset.lettering,
      footprint: asset.footprint ?? null,
      sourceSpec: asset.source,
      prompt: promptFor(asset),
    })),
    derived,
  }
  await writeFile(PLAN_JSON, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
  return planned.length
}

/* ------------------------------------------------------------------ main */

interface Selection {
  readonly provider: Provider
  readonly force: boolean
  readonly only: ReadonlySet<string> | null
  readonly deriveOnly: boolean
  readonly planOnly: boolean
  readonly limit: number | null
  readonly concurrency: number
  readonly reprompt: boolean
}

function parseArgs(argv: readonly string[]): Selection {
  const valueOf = (flag: string): string | null => {
    const index = argv.indexOf(flag)
    return index >= 0 && argv[index + 1] ? argv[index + 1]! : null
  }
  const only = valueOf('--only')
  const limit = valueOf('--limit')
  const concurrency = valueOf('--concurrency')
  const provider = providerById(valueOf('--provider') ?? REFERENCE.id)
  return {
    provider,
    reprompt: argv.includes('--reprompt'),
    concurrency: concurrency && Number(concurrency) > 0 ? Number(concurrency) : provider.concurrency,
    force: argv.includes('--force'),
    deriveOnly: argv.includes('--derive-only'),
    planOnly: argv.includes('--plan'),
    only: only ? new Set(only.split(',').map((s) => s.trim()).filter(Boolean)) : null,
    limit: limit && Number.isInteger(Number(limit)) ? Number(limit) : null,
  }
}

async function main(): Promise<void> {
  const selection = parseArgs(process.argv.slice(2))

  const planned = await writePlanJson()
  process.stdout.write(`PLAN.json: ${planned} asset(s) planned\n`)
  if (selection.planOnly) return

  await loadEnvFile(ENV_FILE)
  const provider = selection.provider
  const manifest = await readManifest(provider)
  process.stdout.write(
    `provider ${provider.id} (${provider.label}) — ` +
      `${provider.shipped ? 'the shipped reference set' : 'a candidate set'}, ` +
      `billed per ${provider.billing.unit}\n`,
  )

  if (!selection.deriveOnly) {
    const backend = backendFor(provider)
    let work = plannedAssets().filter((asset) => {
      if (selection.only && !selection.only.has(asset.key)) return false
      if (selection.force) return true
      // THE RESUME RULE. Anything already recorded in THIS provider's manifest is done, and the
      // manifest is written after EVERY SINGLE ASSET below — so an interrupted run, a redeployed
      // endpoint or a hard process kill costs only the assets that were in flight. A previous run
      // in this estate survived exactly that.
      return manifest[identityFor(asset).key] === undefined
    })
    if (selection.limit !== null) work = work.slice(0, selection.limit)

    process.stdout.write(`${work.length} asset(s) to generate\n`)

    const CONCURRENCY = selection.concurrency
    let cursor = 0
    let failures = 0
    const failed: string[] = []
    const worker = async (): Promise<void> => {
      for (;;) {
        const index = cursor
        cursor += 1
        const asset = work[index]
        if (!asset) return
        const previous = manifest[identityFor(asset).key]
        const previousRetries = previous ? previous.retries + 1 : 0
        try {
          let entry: ManifestEntry
          try {
            entry = await generateOne(provider, backend, asset, previousRetries, selection.reprompt)
          } catch (err) {
            if (!isContentRefusal(err)) throw err
            // The Emberkin run measured this deployment's content filter to be NON-DETERMINISTIC:
            // six refused prompts, re-issued verbatim, all succeeded on the next attempt. So the
            // one honest cheap retry is the same prompt again; a second refusal is treated as real.
            process.stdout.write(`    ${asset.key}: content filter refused, repeating verbatim\n`)
            entry = await generateOne(provider, backend, asset, previousRetries + 1, selection.reprompt)
          }
          manifest[keyOf(entry.asset, entry.declaredSize)] = entry
          process.stdout.write(
            `  ok  ${asset.key} ${entry.deliveredSize} ` +
              `${(entry.byteSize / 1024).toFixed(0)}KB c2pa=${entry.c2pa} retries=${entry.retries}\n`,
          )
          await writeManifest(provider, manifest)
        } catch (err) {
          if (err instanceof TransposedDeliveryError) throw err
          failures += 1
          failed.push(asset.key)
          const message = err instanceof Error ? err.message : String(err)
          process.stdout.write(`  FAIL ${asset.key}: ${message}\n`)
        }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker))
    if (failures > 0) {
      process.stdout.write(`\n${failures} asset(s) failed:\n  ${failed.join('\n  ')}\n`)
    }
  }

  // Derivatives are rebuilt from whatever is on disk every run, so a regenerated source can never
  // leave a stale tile, crop or favicon behind it.
  for (const entry of await deriveAll(provider)) {
    manifest[keyOf(entry.asset, entry.declaredSize)] = entry
  }
  await writeManifest(provider, manifest)
  process.stdout.write(`\nmanifest: ${Object.keys(manifest).length} entries\n`)
}

/**
 * Only when this file is the program, never on import.
 *
 * `parity.test.ts` imports `promptFor` from here, and a bare `await main()` at module scope meant
 * that importing it started a real generation run — against a live, billed endpoint, from a test.
 * micro-brand shipped that bug and then fixed it; this repository inherits the guard rather than
 * the bug. A module that spends money when it is READ is a hazard whatever else is true of it.
 */
const invokedDirectly = process.argv[1] !== undefined && process.argv[1].endsWith('generate.ts')

if (invokedDirectly) {
  await main().catch((err: unknown) => {
    if (err instanceof UnimplementedBackendError) {
      process.stderr.write(`\n${err.message}\n`)
      process.exitCode = 2
      return
    }
    throw err
  })
}
