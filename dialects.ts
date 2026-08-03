/**
 * The TypeScript half of the dialect seam. Reads the same `dialects.json` `dialects.py` reads.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ## WHAT A DIALECT IS
 *
 * A named, deterministic, **total** function from the prompt on record for an asset to the prompt a
 * provider set is actually sent. `literal` is the identity function and carries zero rules;
 * `positive` restates every prohibition in this estate's briefs as an assertion about what IS in
 * the frame.
 *
 * ## WHY IT DOES NOT WEAKEN PROMPT PARITY
 *
 * `prompts.ts` guarantees that all providers replay the recorded prompt byte for byte. That
 * guarantee is what makes the FLUX-vs-Qwen comparison mean anything, and it is unchanged — it is
 * now scoped to a dialect and enforced three ways rather than one:
 *
 * 1. **Within a dialect, nothing has changed.** Every provider in a dialect is sent the identical
 *    string for a given asset. `parity.test.ts` asserts it per dialect group.
 *
 * 2. **Across dialects the check is STRONGER than the equality it replaces.** A dialect is a pure
 *    function whose input is the reference set's own record, so a candidate's prompt is not merely
 *    "different" — it is re-derivable. `verify.py --parity` applies the dialect's rules to the
 *    reference's recorded prompt and fails if one byte differs. Equality could only ever say "these
 *    two strings differ"; this says "this string is not what this dialect produces from the record".
 *
 * 3. **A set cannot be in a dialect by accident.** The dialect is on the provider entry, on every
 *    manifest entry, and in `compare.py`'s header, and `compare.py` refuses to print a
 *    single-question verdict over a selection that spans two of them. There is no path by which two
 *    sets generated from different prompts get compared without that being stated on the page.
 *
 * ## THE RESIDUAL RULE
 *
 * What makes "positive" a measured property rather than a claim. Each dialect declares the
 * vocabulary it forbids itself; after the rules run, the result is scanned for it, and a prompt
 * still carrying any of it **cannot be sent** — `promptForProvider` throws. An asset only enters the
 * positive set if the restatement genuinely cleared it, so the rule list grows with the corpus
 * rather than being written once and hoped over.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const HERE = import.meta.dirname

export interface DialectRule {
  readonly find: string
  readonly replace: string
  /** `$1`-style backreferences are permitted in `replace`. dialects.py translates them to `\1`. */
  readonly regex?: boolean
  readonly why: string
}

export interface Dialect {
  readonly id: string
  readonly label: string
  /** The dialect this one derives FROM. Null on the literal dialect, which is the record. */
  readonly source: string | null
  /**
   * Whether a prompt in this dialect may still carry the negation vocabulary. False for `literal`,
   * which is the estate's own prohibition-heavy house style and is supposed to.
   */
  readonly checkResiduals: boolean
  readonly summary: readonly string[]
  readonly rules: readonly DialectRule[]
}

interface DialectDocument {
  readonly literal: string
  readonly negationVocabulary: readonly string[]
  readonly dialects: readonly Dialect[]
}

const document = JSON.parse(readFileSync(join(HERE, 'dialects.json'), 'utf8')) as DialectDocument

export const DIALECTS: readonly Dialect[] = document.dialects
export const NEGATION_VOCABULARY: readonly string[] = document.negationVocabulary

export function dialectById(id: string): Dialect {
  const found = DIALECTS.find((d) => d.id === id)
  if (!found) {
    throw new Error(
      `unknown dialect "${id}"; dialects.json registers: ${DIALECTS.map((d) => d.id).join(', ')}`,
    )
  }
  return found
}

/** The dialect the record is IN, and the one the controlled comparison is conducted in. */
export const LITERAL: Dialect = dialectById(document.literal)

/** Apply one dialect's rules, in order, replacing every occurrence. Pure; no I/O; no provider. */
export function applyDialect(id: string, prompt: string): string {
  let out = prompt
  for (const rule of dialectById(id).rules) {
    out = rule.regex
      ? out.replace(new RegExp(rule.find, 'g'), rule.replace)
      : out.split(rule.find).join(rule.replace)
  }
  return out
}

/**
 * The negation vocabulary a transformed prompt still carries, deduplicated and in registry order.
 *
 * Empty for the literal dialect by construction: the estate's own style is prohibition-heavy, that
 * is the very thing under test, and flagging it would be flagging the control.
 */
export function residualNegations(id: string, prompt: string): readonly string[] {
  if (!dialectById(id).checkResiduals) return []
  const owed: string[] = []
  for (const word of NEGATION_VOCABULARY) {
    if (new RegExp(`\\b${word}\\b`, 'i').test(prompt) && !owed.includes(word)) owed.push(word)
  }
  return owed
}

/**
 * Thrown when a dialect's rules did not clear a prompt of its prohibitions.
 *
 * This is a refusal to SPEND, not a lint. The whole hypothesis being tested is "does Qwen honour a
 * brief with no prohibitions in it"; generating against a brief that still holds four of them would
 * answer a question nobody asked, on a deployment billed by the hour, and the resulting set would
 * carry a `dialect: positive` label that is not true of its own prompts.
 */
export class ResidualNegationError extends Error {
  constructor(dialect: string, key: string, owed: readonly string[]) {
    super(
      `${key}: the ${dialect} dialect left ${owed.length} prohibition word(s) in the prompt — ` +
        `${owed.join(', ')}. A set labelled "${dialect}" whose prompts still carry prohibitions ` +
        'would answer a different question from the one it claims to, so this asset cannot be ' +
        `generated until dialects.json has a rule that restates the clause holding it. Run ` +
        '`python3 dialects.py --residuals` to see every asset in this state.',
    )
    this.name = 'ResidualNegationError'
  }
}
