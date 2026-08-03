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
 *
 * ## AND WHAT A DIALECT CHANGES, WHICH IS ONE LINE AND NOT THE GUARANTEE
 *
 * That probe came back with a result the design above did not anticipate: **Qwen does not
 * truncate.** It receives the prohibitions in full and disregards them while honouring the
 * positives, so the prohibition-last technique this estate built against FLUX does not transfer —
 * and these briefs are prohibition-heavy, which may make them close to the worst possible shape of
 * brief for it. That is a second question worth asking: not "which model is better on identical
 * input", which the sets above answer, but "which is better when each is prompted the way it
 * wants".
 *
 * A **dialect** is how it gets asked without damaging the first answer. It is a named,
 * deterministic, total function from the recorded prompt to the prompt a set is sent; `literal` is
 * the identity and is what every set here was until now. Parity is asserted **within** a dialect
 * exactly as points 1–3 above assert it, and **across** dialects by RE-DERIVATION, which is
 * strictly stronger than the equality it replaces: `verify.py --parity` applies the dialect's rules
 * to the reference's record and fails on one differing byte. `dialects.ts` holds the full argument
 * and `dialects.json` holds the rules — the same file, byte for byte, in all three asset
 * repositories, because the estate's briefs share their clause vocabulary even where their subjects
 * do not.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */

import { readFileSync, existsSync } from 'node:fs'

import { requestSizeFor } from '../studio/src/specs.ts'

import { REFERENCE, manifestPathOf, providerById } from './providers.ts'
import { LITERAL, applyDialect, residualNegations, ResidualNegationError } from './dialects.ts'
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

/**
 * `--reprompt` is refused outside the literal dialect, and this is a separate refusal from the one
 * above rather than an extension of it.
 *
 * The literal record is the INPUT every dialect derives from. Reprompting in a derived dialect
 * would write a new record that no dialect produced from anything, and the moment that exists
 * `verify.py --parity` can no longer re-derive the set — the cross-dialect guarantee stops being
 * checkable while every file involved still looks correct, which is precisely the class of silent
 * failure this whole design exists to make impossible.
 */
export class RepromptNotForDialectError extends Error {
  constructor(providerId: string, dialect: string, key: string) {
    super(
      `--reprompt was used with --provider ${providerId} on ${key}, which generates in the ` +
        `"${dialect}" dialect. Only the "${LITERAL.id}" dialect may change the question an asset ` +
        'is asked, because it holds the record every other dialect is DERIVED from — a reprompt ' +
        'here would write a record nothing produced, and verify.py --parity could no longer ' +
        're-derive this set from the reference. Reprompt against the reference, then regenerate.',
    )
    this.name = 'RepromptNotForDialectError'
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
 *
 * **And then translate it into the provider's dialect.** That is one line, and it is the only line
 * in the repository where a provider's prompt differs from the record. Note what it does NOT
 * change:
 *
 *   * the record is still the reference set's and still the only input — a positive-dialect
 *     candidate STILL cannot generate an asset the reference has never generated, because the
 *     transform would have nothing to apply to. `MissingReferencePromptError` fires exactly as
 *     before, for every candidate, whatever its dialect;
 *   * `compute` still takes no provider, so there is still nowhere to put a per-MODEL tweak. A
 *     dialect is per-SET and declared in a registry, not per-model and hidden in a builder;
 *   * within a dialect every provider gets the byte-identical string, because `applyDialect` is a
 *     pure function of the record and the dialect id.
 *
 * The residual check is the last gate: a prompt labelled positive that still carries prohibitions
 * would be a set whose label is untrue of its own contents, so it refuses to be sent rather than
 * being generated and caught afterwards — on a per-hour deployment, afterwards costs money.
 */
export function promptForProvider(
  providerId: string,
  planned: PlannedAsset,
  compute: (planned: PlannedAsset) => string,
  options: { readonly reprompt?: boolean } = {},
): string {
  const identity = identityFor(planned)
  const recorded = referencePrompts().get(identity.key)
  const dialect = providerById(providerId).dialect

  if (options.reprompt) {
    if (providerId !== REFERENCE.id) throw new RepromptNotForCandidateError(providerId, identity.key)
    if (dialect !== LITERAL.id) throw new RepromptNotForDialectError(providerId, dialect, identity.key)
    return compute(planned)
  }
  // A dialect translates the record; it never substitutes for one.
  const literal =
    recorded !== undefined
      ? recorded
      : providerId === REFERENCE.id
        ? compute(planned)
        : (() => {
            throw new MissingReferencePromptError(identity.key)
          })()

  const translated = applyDialect(dialect, literal)
  const owed = residualNegations(dialect, translated)
  if (owed.length > 0) throw new ResidualNegationError(dialect, identity.key, owed)
  return translated
}
