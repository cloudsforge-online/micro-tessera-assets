/**
 * The work list, DERIVED from the canonical content in `content/`.
 *
 * `docs/ecosystem/23-tessera.md` §6 puts the canonical JSON in THIS repository — "so the engine
 * and the art prompts read the same file and cannot drift" — which is the opposite of the
 * arrangement `micro-aetherholm-assets` ended up with, and deliberately so. There the service
 * shipped first and the art repository imports it; here `micro-tessera` does not exist yet, so the
 * content is authored here and the service will read it. Either direction is fine. TWO copies is
 * the drift defect this estate keeps paying for, and there is exactly one copy of every tree below.
 *
 * The counts are asserted against doc 23 §2.3's table before anything is spent, because a set that
 * is quietly 94 objects instead of 96 breaks an argument rather than a build: §7.2 rests the whole
 * no-pay-to-win resolution on "96 seed objects, free to every account forever".
 *
 * 288 generated + 104 derived = 392. The derived are declared here too, in `derivedAssets()`, so
 * the total is checkable before a single image exists rather than inferred from a finished run.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const HERE = import.meta.dirname
const read = (name: string): any => JSON.parse(readFileSync(join(HERE, 'content', name), 'utf8'))

export const WARDS = read('wards.json')
export const OBJECTS = read('objects.json')
export const STRUCTURE = read('structure.json')
export const AVATARS = read('avatars.json')
export const UI = read('ui.json')
export const TITLE = read('title.json')

/* ------------------------------------------------------------------ the contract asserted */

/** Doc 23 §2.3, as arithmetic. A miscount here is cheaper than a miscount after 288 generations. */
function assertContentContract(): void {
  const problems: string[] = []
  const want = (got: number, expected: number, what: string): void => {
    if (got !== expected) problems.push(`expected ${expected} ${what}, content/ carries ${got}`)
  }
  want(WARDS.wards.length, 8, 'ward archetypes (doc 23 §2.4)')
  want(WARDS.plates.length, 4, 'plates per ward (§2.4)')
  want(WARDS.tiles.length, 12, 'tiles per ward (§2.5)')
  want(OBJECTS.categories.length, 12, 'object categories (§2.6)')
  for (const category of OBJECTS.categories) {
    want(category.items.length, 8, `items in category ${category.id} (§2.6)`)
  }
  want(STRUCTURE.parts.length, 24, 'structure kit parts (§2.7)')
  want(AVATARS.builds.length, 4, 'avatar builds (§2.8)')
  want(AVATARS.poses.length, 2, 'avatar poses (§2.8)')
  want(AVATARS.slots.length, 5, 'avatar overlay slots (§2.8)')
  for (const slot of AVATARS.slots) want(slot.items.length, 8, `overlays in slot ${slot.id} (§2.8)`)
  want(UI.toolGlyphs.length, 12, 'tool glyphs (§2.11)')
  want(UI.economyIcons.length, 16, 'status and economy icons (§2.12)')
  want(UI.markers.length, 12, 'parcel markers, gates and beacons (§2.13)')
  want(UI.kiln.length, 8, 'Kiln and provenance assets (§2.10)')
  want(TITLE.keyart.length, 4, 'generated key art assets (§2.14)')
  want(TITLE.chrome.length, 2, 'generated chrome assets (§2.14)')
  want(TITLE.splashes.length, 6, 'event and season splashes (§2.14)')
  // Time-of-day: four wards carry dusk and night, so eight variants. §2.9.
  const variants = WARDS.wards.reduce((n: number, w: any) => n + w.timeOfDay.length, 0)
  want(variants, 8, 'time-of-day backdrop variants (§2.9)')
  if (problems.length > 0) {
    throw new Error(`content/ has drifted from doc 23 §2.3:\n  ${problems.join('\n  ')}`)
  }
}
assertContentContract()

/* ------------------------------------------------------------------ the palette */

/** Chrome only: a title wears its product's colour, and Tessera's product is Forge Worlds. */
export const WORLDS_MOSS: string = UI.accent

export interface ColourWord {
  readonly name: string
  readonly qualifier: string
}

/**
 * Named hues, not named objects. The Emberkin rule, measured there: naming an OBJECT drags a
 * diffusion model to that object's photographic average, so every entry below names a hue and its
 * direction round the wheel and nothing else.
 */
export const PALETTE: Readonly<Record<string, ColourWord>> = {
  '#6d9a49': { name: 'a moss green', qualifier: 'a mid-tone yellow-leaning green, not emerald and not olive' },
  '#e8622c': { name: 'an ember orange', qualifier: 'a hot red-leaning orange' },
  '#d2703a': { name: 'a fired terracotta', qualifier: 'an earthy orange-brown' },
  '#a4634a': { name: 'a warm brick red-brown', qualifier: 'a muted red leaning to clay' },
  '#8fa06a': { name: 'a sage green', qualifier: 'a dusty grey-leaning green' },
  '#5f8a4a': { name: 'a leaf green', qualifier: 'a saturated mid green' },
  '#5f8fa8': { name: 'a slate blue', qualifier: 'a cool desaturated blue' },
  '#c8bfae': { name: 'a pale mineral bone', qualifier: 'a warm off-white with grey in it' },
  '#b7ae9b': { name: 'a muted bone', qualifier: 'a warm pale grey' },
}

export function colourWordForHex(hex: string): ColourWord {
  return PALETTE[hex.toLowerCase()] ?? { name: 'its anchor colour', qualifier: '' }
}

/* ------------------------------------------------------------------ the shape of one asset */

export type SetName =
  | 'terrain'
  | 'objects'
  | 'structure'
  | 'avatar'
  | 'backdrop'
  | 'kiln'
  | 'glyphs'
  | 'icons'
  | 'markers'
  | 'keyart'
  | 'chrome'
  | 'splashes'

/**
 * Three ground classes, not two — and the third is Tessera's, not inherited.
 *
 * `flat`  a sprite on the pinned #12100f ground: normalised numerically, cut to alpha by cutout.py.
 * `scene` a picture, edge to edge: held to a darkness ceiling at its edges, never snapped.
 * `plate` a MATERIAL SHEET, edge to edge, with no ground and no subject. A saltflat plate is
 *         cracked white by design (§2.4) and a grove plate is near-black, so neither the flat rule
 *         nor the scene darkness ceiling can apply to it. What a plate is checked for instead is
 *         that it fills the frame — no border, no mount, no vignette — and is not a blank.
 */
export type GroundClass = 'flat' | 'scene' | 'plate'

/** How the prompt is assembled. Distinct from the set, because sets share styles. */
export type StyleClass = 'plate' | 'sprite' | 'avatar-base' | 'avatar-overlay' | 'glyph' | 'scene'

export interface PlannedAsset {
  readonly key: string
  readonly set: SetName
  readonly slug: string
  readonly name: string
  readonly width: number
  readonly height: number
  readonly ground: GroundClass
  readonly style: StyleClass
  /** The dominant colour, measured by verify.py where the set's floor is above zero. */
  readonly accent: string
  readonly secondaryAccent: string | null
  /** The ONLY string permitted in an image. Null on all 288: this set generates no lettering. */
  readonly lettering: string | null
  readonly subject: string
  readonly source: string
  readonly priority: number
  /** `1x1` or `2x2` on a seed object. A FIELD, never something the model is asked to infer. */
  readonly footprint?: string
  /** Avatar overlays only: which part of the shared silhouette this plate is allowed to occupy. */
  readonly region?: string
}

/** A derivative, declared before it exists so 288 + 104 = 392 is checkable up front. */
export interface DerivedAsset {
  readonly key: string
  readonly set: SetName
  readonly slug: string
  readonly name: string
  readonly width: number
  readonly height: number
  /** The `key` of the generated asset it is cut, projected or composited from. */
  readonly from: string
  readonly how: string
}

/* ------------------------------------------------------------------ set 1: terrain plates */

function terrainAssets(): PlannedAsset[] {
  const out: PlannedAsset[] = []
  for (const ward of WARDS.wards) {
    for (const plate of WARDS.plates) {
      out.push({
        key: `terrain/${ward.id}-${plate}`,
        set: 'terrain',
        slug: `${ward.id}-${plate}`,
        name: `${ward.name} — ${plate}`,
        width: 1024,
        height: 1024,
        ground: 'plate',
        style: 'plate',
        accent: ward.accent,
        secondaryAccent: null,
        lettering: null,
        // §2.4's template, with the ward description and the plate phrase substituted.
        subject: `${ward.description}, ${WARDS.platePhrase[plate]}`,
        source: 'docs/ecosystem/23-tessera.md §2.4; content/wards.json',
        priority: 10,
      })
    }
  }
  return out
}

/* ------------------------------------------------------------------ set 3: seed objects */

function objectAssets(): PlannedAsset[] {
  const out: PlannedAsset[] = []
  for (const category of OBJECTS.categories) {
    for (const item of category.items) {
      out.push({
        key: `objects/${category.id}-${item.slug}`,
        set: 'objects',
        slug: `${category.id}-${item.slug}`,
        name: `${category.name} — ${item.slug}`,
        width: 512,
        height: 512,
        ground: 'flat',
        style: 'sprite',
        accent: '#d2703a',
        secondaryAccent: null,
        lettering: null,
        subject: item.subject,
        source: 'docs/ecosystem/23-tessera.md §2.6; content/objects.json',
        priority: 20,
        footprint: item.footprint,
      })
    }
  }
  return out
}

/* ------------------------------------------------------------------ set 4: structure kit */

function structureAssets(): PlannedAsset[] {
  return STRUCTURE.parts.map((part: any) => ({
    key: `structure/${part.slug}`,
    set: 'structure' as const,
    slug: part.slug,
    name: part.slug,
    width: 512,
    height: 512,
    ground: 'flat' as const,
    style: 'sprite' as const,
    accent: '#a4634a',
    secondaryAccent: null,
    lettering: null,
    subject: part.subject,
    source: 'docs/ecosystem/23-tessera.md §2.7; content/structure.json',
    priority: 25,
  }))
}

/* ------------------------------------------------------------------ sets 5–6: avatars */

function avatarAssets(): PlannedAsset[] {
  const out: PlannedAsset[] = []
  for (const build of AVATARS.builds) {
    for (const pose of AVATARS.poses) {
      out.push({
        key: `avatar/base-${build.id}-${pose.id}`,
        set: 'avatar',
        slug: `base-${build.id}-${pose.id}`,
        name: `base ${build.id} ${pose.id}`,
        width: 256,
        height: 512,
        ground: 'flat',
        style: 'avatar-base',
        accent: '#c8bfae',
        secondaryAccent: null,
        lettering: null,
        subject: `${build.subject}, ${pose.subject}, wearing plain undergarments only`,
        source: 'docs/ecosystem/23-tessera.md §2.8; content/avatars.json',
        priority: 30,
      })
    }
  }
  for (const slot of AVATARS.slots) {
    for (const item of slot.items) {
      out.push({
        key: `avatar/${slot.id}-${item.slug}`,
        set: 'avatar',
        slug: `${slot.id}-${item.slug}`,
        name: `${slot.name} — ${item.slug}`,
        width: 256,
        height: 512,
        ground: 'flat',
        style: 'avatar-overlay',
        accent: '#c8bfae',
        secondaryAccent: null,
        lettering: null,
        subject: item.subject,
        source: 'docs/ecosystem/23-tessera.md §2.8; content/avatars.json',
        priority: 31,
        region: slot.region,
      })
    }
  }
  return out
}

/* ------------------------------------------------------------------ sets 7–8: backdrops */

function backdropAssets(): PlannedAsset[] {
  const out: PlannedAsset[] = []
  for (const ward of WARDS.wards) {
    for (const time of ['day', ...ward.timeOfDay] as string[]) {
      out.push({
        key: `backdrop/${ward.id}-${time}`,
        set: 'backdrop',
        slug: `${ward.id}-${time}`,
        name: `${ward.name} — ${time}`,
        width: 1536,
        height: 640,
        ground: 'scene',
        style: 'scene',
        accent: ward.accent,
        secondaryAccent: null,
        lettering: null,
        subject: `${ward.horizon}. ${WARDS.timeOfDay[time]}`,
        source: 'docs/ecosystem/23-tessera.md §2.9; content/wards.json',
        priority: 40,
      })
    }
  }
  return out
}

/* ------------------------------------------------------------------ set 9: Kiln art */

function kilnAssets(): PlannedAsset[] {
  return UI.kiln.map((item: any) => ({
    key: `kiln/${item.slug}`,
    set: 'kiln' as const,
    slug: item.slug,
    name: item.slug,
    width: 768,
    height: 768,
    ground: 'flat' as const,
    style: 'sprite' as const,
    accent: '#e8622c',
    secondaryAccent: null,
    lettering: null,
    subject: item.subject,
    source: 'docs/ecosystem/23-tessera.md §2.10; content/ui.json',
    priority: 45,
  }))
}

/* ------------------------------------------------------------------ set 10: glyphs */

function glyphAssets(): PlannedAsset[] {
  const out: PlannedAsset[] = []
  for (const category of OBJECTS.categories) {
    out.push({
      key: `glyphs/category-${category.id}`,
      set: 'glyphs',
      slug: `category-${category.id}`,
      name: `category — ${category.id}`,
      width: 256,
      height: 256,
      ground: 'flat',
      style: 'glyph',
      accent: WORLDS_MOSS,
      secondaryAccent: null,
      lettering: null,
      subject: category.glyph,
      source: 'docs/ecosystem/23-tessera.md §2.11; content/objects.json',
      priority: 50,
    })
  }
  for (const tool of UI.toolGlyphs) {
    out.push({
      key: `glyphs/tool-${tool.slug}`,
      set: 'glyphs',
      slug: `tool-${tool.slug}`,
      name: `tool — ${tool.slug}`,
      width: 256,
      height: 256,
      ground: 'flat',
      style: 'glyph',
      accent: WORLDS_MOSS,
      secondaryAccent: null,
      lettering: null,
      subject: tool.subject,
      source: 'docs/ecosystem/23-tessera.md §2.11; content/ui.json',
      priority: 51,
    })
  }
  return out
}

/* ------------------------------------------------------------------ set 11: economy icons */

function iconAssets(): PlannedAsset[] {
  return UI.economyIcons.map((icon: any) => ({
    key: `icons/${icon.slug}`,
    set: 'icons' as const,
    slug: icon.slug,
    name: icon.slug,
    width: 256,
    height: 256,
    ground: 'flat' as const,
    style: 'glyph' as const,
    accent: WORLDS_MOSS,
    secondaryAccent: null,
    lettering: null,
    subject: icon.subject,
    source: 'docs/ecosystem/23-tessera.md §2.12; content/ui.json',
    priority: 55,
  }))
}

/* ------------------------------------------------------------------ set 12: markers */

function markerAssets(): PlannedAsset[] {
  return UI.markers.map((marker: any) => ({
    key: `markers/${marker.slug}`,
    set: 'markers' as const,
    slug: marker.slug,
    name: marker.slug,
    width: 512,
    height: 512,
    ground: 'flat' as const,
    style: 'sprite' as const,
    accent: '#e8622c',
    secondaryAccent: null,
    lettering: null,
    subject: marker.subject,
    source: 'docs/ecosystem/23-tessera.md §2.13; content/ui.json',
    priority: 60,
  }))
}

/* ------------------------------------------------------------------ sets 13–15: title art */

function titleAssets(): PlannedAsset[] {
  const out: PlannedAsset[] = []
  for (const art of TITLE.keyart) {
    out.push({
      key: `keyart/${art.slug}`,
      set: 'keyart',
      slug: art.slug,
      name: `key art — ${art.slug}`,
      width: art.width,
      height: art.height,
      ground: art.ground,
      style: 'scene',
      accent: WORLDS_MOSS,
      secondaryAccent: '#e8622c',
      lettering: null,
      subject: art.subject,
      source: 'docs/ecosystem/23-tessera.md §2.14; content/title.json',
      priority: 5,
    })
  }
  out.push({
    key: 'chrome/mark',
    set: 'chrome',
    slug: 'mark',
    name: 'title mark',
    width: 1024,
    height: 1024,
    ground: 'flat',
    style: 'glyph',
    accent: WORLDS_MOSS,
    secondaryAccent: null,
    lettering: null,
    subject: TITLE.mark,
    source: 'docs/ecosystem/23-tessera.md §2.14; content/title.json',
    priority: 1,
  })
  out.push({
    key: 'chrome/capsule',
    set: 'chrome',
    slug: 'capsule',
    name: 'title capsule',
    width: 1024,
    height: 512,
    ground: 'flat',
    style: 'glyph',
    accent: WORLDS_MOSS,
    secondaryAccent: null,
    lettering: null,
    subject: `${TITLE.mark} The whole lockup sits in the LEFT THIRD of this wide frame and the right two thirds are left completely empty`,
    source: 'docs/ecosystem/23-tessera.md §2.14; content/title.json',
    priority: 2,
  })
  for (const splash of TITLE.splashes) {
    out.push({
      key: `splash/${splash.slug}`,
      set: 'splashes',
      slug: splash.slug,
      name: splash.name,
      width: 1024,
      height: 1024,
      ground: 'scene',
      style: 'scene',
      accent: '#e8622c',
      secondaryAccent: WORLDS_MOSS,
      lettering: null,
      subject: splash.subject,
      source: 'docs/ecosystem/23-tessera.md §2.14; content/title.json',
      priority: 65,
    })
  }
  return out
}

/* ------------------------------------------------------------------ the whole plan */

export function plannedAssets(): readonly PlannedAsset[] {
  const all = [
    ...titleAssets(),
    ...terrainAssets(),
    ...objectAssets(),
    ...structureAssets(),
    ...avatarAssets(),
    ...backdropAssets(),
    ...kilnAssets(),
    ...glyphAssets(),
    ...iconAssets(),
    ...markerAssets(),
  ]
  const seen = new Set<string>()
  for (const asset of all) {
    if (seen.has(asset.key)) throw new Error(`duplicate asset key ${asset.key}`)
    seen.add(asset.key)
    // §2.1: every dimension is a multiple of 16, so the FLUX round-up is a no-op and the two sets
    // declare identical sizes. The only sizes that are not are the two derived title cards, which
    // are cropped rather than requested.
    if (asset.width % 16 !== 0 || asset.height % 16 !== 0) {
      throw new Error(`${asset.key} is ${asset.width}x${asset.height}, not on the 16-pixel grid`)
    }
  }
  if (all.length !== 288) {
    throw new Error(`doc 23 §2.3 says 288 generated assets; this plan derives ${all.length}`)
  }
  return all.sort((a, b) => a.priority - b.priority || a.key.localeCompare(b.key))
}

/**
 * The 104 derivatives, declared rather than discovered.
 *
 * 96 terrain tiles projected and cut from the 32 plates, 2 title cards cropped from key art, and
 * 6 chrome sizes cut or composited from the mark. Nothing here is generated; each names its parent.
 */
export function derivedAssets(): readonly DerivedAsset[] {
  const out: DerivedAsset[] = []
  for (const ward of WARDS.wards) {
    for (const tile of WARDS.tiles) {
      const source = WARDS.tileSources[tile]
      out.push({
        key: `tiles/${ward.id}-${tile}`,
        set: 'terrain',
        slug: `${ward.id}-${tile}`,
        name: `${ward.name} — ${tile}`,
        width: 256,
        height: 128,
        from: `terrain/${ward.id}-${source.from}`,
        how: `project_iso.py: cut at (${source.region[0]}, ${source.region[1]}) of the ${source.from} plate, then 2:1 dimetric projection`,
      })
    }
  }
  out.push({
    key: 'keyart/og-1200x630',
    set: 'keyart',
    slug: 'og-1200x630',
    name: 'OG card',
    width: 1200,
    height: 630,
    from: 'keyart/wide',
    how: 'derive.py: centre crop. 630 is not a multiple of 16, so it is cropped and never requested (§2.1)',
  })
  out.push({
    key: 'keyart/social-wide',
    set: 'keyart',
    slug: 'social-wide',
    name: 'social wide card',
    width: 1600,
    height: 900,
    from: 'keyart/hero',
    how: 'derive.py: centre crop of the 2048x1152 hero at the same 16:9 ratio, then Lanczos to 1600x900',
  })
  const chrome: ReadonlyArray<[string, number, number, string]> = [
    ['favicon-32', 32, 32, 'derive.py: Lanczos downscale of the 1024 mark'],
    ['favicon-192', 192, 192, 'derive.py: Lanczos downscale of the 1024 mark'],
    ['favicon-512', 512, 512, 'derive.py: Lanczos downscale of the 1024 mark'],
    ['apple-touch-180', 180, 180, 'derive.py: Lanczos downscale of the 1024 mark'],
    ['og-title', 1200, 630, 'derive.py: the mark composited centre-left on the brand ground, then cropped'],
    ['wordmark-lockup', 1536, 512, 'derive.py: the mark composited into the left third of keyart/wordmark-ground'],
  ]
  for (const [slug, width, height, how] of chrome) {
    out.push({
      key: `chrome/${slug}`,
      set: 'chrome',
      slug,
      name: slug,
      width,
      height,
      from: 'chrome/mark',
      how,
    })
  }
  if (out.length !== 104) {
    throw new Error(`doc 23 §2.3 says 104 derived assets; this plan derives ${out.length}`)
  }
  return out
}
