/**
 * Prompt parity: the rule that guarantees every model is asked the same question about an asset.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * The comparison is worthless if the models are asked different things. Three layers, in
 * increasing order of how hard each is to defeat:
 *
 * 1. **`promptFor` in generate.ts takes no provider argument.** There is nowhere to put a per-model
 *    tweak. The provider-specific envelope — the route, the auth header, the body field names —
 *    lives entirely in `backends.ts`, behind an interface that takes the prompt as an opaque string.
 *
 * 2. **Once an asset is on record, every provider REPLAYS that record — the reference included.**
 *    `referencePrompts()` reads the string that was actually sent, out of the reference
 *    MANIFEST.json, and every run posts it byte for byte. Only an asset that has never been
 *    generated computes a fresh prompt, and only for the reference provider, because the reference
 *    is the thing that establishes the record.
 *
 *    That asymmetry is not fussiness. `promptFor` in this repository no longer produces what most
 *    of the recorded assets were actually generated from — the clauses were edited after the run,
 *    and PLAN.json, which is regenerated every time, has drifted with them. So a candidate
 *    replaying PLAN.json would be asked a different question from the one FLUX answered, while
 *    every file involved looked perfectly correct.
 *
 *    It is also why this exercise needs no shared prompt library across the three asset
 *    repositories: replay does not need to know how a prompt is built, only what it was. Their
 *    prompt vocabularies are genuinely different — a flat geometric brand system, species sheets,
 *    painterly islands under an art bible — and an abstraction spanning all three would fit none.
 *
 * 3. **`verify.py` fails if any asset carries different prompts in two sets.** That runs in CI, on
 *    the artefacts, and it is what catches a backend quietly appending a negative prompt.
 *
 * The one thing none of this can guarantee is that the models *perceive* the same prompt. A text
 * encoder with a 77-token budget receives the first paragraph and discards the ground clause,
 * which is deliberately last. That is a measurement to make against each live endpoint before the
 * run — `UNKNOWNS`' PROMPT LENGTH entry in `backends.ts` — not something a test can assert.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */

import { readFileSync, existsSync } from 'node:fs'

import { requestSizeFor } from '../studio/src/specs.ts'

import { REFERENCE, manifestPathOf } from './providers.ts'
import type { PlannedAsset } from './plan.ts'

/** How one planned asset is named in a manifest. Computed in ONE place; everything agrees with it. */
export interface AssetIdentity {
  readonly requested: { readonly width: number; readonly height: number }
  readonly onGrid: boolean
  /** `species/aetherion` or `species/aetherion-source`. The manifest's `asset` column. */
  readonly recordedAsset: string
  readonly declaredSize: string
  /** `species/aetherion@512x512`. The manifest key, and the key parity is judged on. */
  readonly key: string
}

export function identityFor(planned: PlannedAsset): AssetIdentity {
  const requested = requestSizeFor({ width: planned.width, height: planned.height })
  const onGrid = requested.width === planned.width && requested.height === planned.height
  const recordedAsset = onGrid ? planned.key : `${planned.key}-source`
  const declaredSize = onGrid
    ? `${planned.width}x${planned.height}`
    : `${requested.width}x${requested.height}`
  return { requested, onGrid, recordedAsset, declaredSize, key: `${recordedAsset}@${declaredSize}` }
}

export class MissingReferencePromptError extends Error {
  constructor(key: string) {
    super(
      `no reference prompt recorded for ${key}. A candidate set replays the prompt the reference ` +
        'set actually sent rather than recomputing one, so an asset the reference has never ' +
        'generated cannot be generated for a candidate either — generating it from freshly ' +
        'computed clauses would put a different question to this model than to FLUX, which is the ' +
        'one thing the comparison may not do. Generate it for the reference provider first.',
    )
    this.name = 'MissingReferencePromptError'
  }
}

export class RepromptNotForCandidateError extends Error {
  constructor(providerId: string, key: string) {
    super(
      `--reprompt was used with --provider ${providerId} on ${key}. Only the reference provider ` +
        'may change the question an asset is asked, because the reference manifest is the record ' +
        'the other sets replay. Reprompt against the reference first, then regenerate the ' +
        'candidates so every set is answering the same thing.',
    )
    this.name = 'RepromptNotForCandidateError'
  }
}

let cached: Map<string, string> | null = null

/** Every prompt the reference set actually sent, keyed the way `identityFor` keys an asset. */
export function referencePrompts(): Map<string, string> {
  if (cached) return cached
  const path = manifestPathOf(REFERENCE)
  const out = new Map<string, string>()
  if (existsSync(path)) {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
      assets?: ReadonlyArray<{
        asset: string
        declaredSize: string
        prompt: string
        derivedFrom: string | null
      }>
    }
    for (const entry of parsed.assets ?? []) {
      // Derivatives inherit their parent's prompt and are not generated; replaying one would ask
      // the model for a file that is supposed to be cut from another file.
      if (entry.derivedFrom) continue
      out.set(`${entry.asset}@${entry.declaredSize}`, entry.prompt)
    }
  }
  cached = out
  return out
}

/**
 * The prompt to send, for this provider, for this asset.
 *
 * Replay if there is a record; compute only where there is none, and only for the reference. The
 * effect is that the question an asset is asked is fixed the first time it is asked, for every
 * model, until somebody deliberately changes it with `--reprompt`.
 */
export function promptForProvider(
  providerId: string,
  planned: PlannedAsset,
  compute: (planned: PlannedAsset) => string,
  options: { readonly reprompt?: boolean } = {},
): string {
  const identity = identityFor(planned)
  const recorded = referencePrompts().get(identity.key)

  if (options.reprompt) {
    if (providerId !== REFERENCE.id) throw new RepromptNotForCandidateError(providerId, identity.key)
    return compute(planned)
  }
  if (recorded !== undefined) return recorded
  if (providerId === REFERENCE.id) return compute(planned)
  throw new MissingReferencePromptError(identity.key)
}
