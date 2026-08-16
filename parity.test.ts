/**
 * The prompt-parity suite: the property the whole comparison rests on, asserted rather than
 * maintained by convention.
 *
 *     cd ../studio && node --import tsx --test ../tessera-assets/parity.test.ts
 *
 * The property is **"every model is asked the same question about a given asset"**. It is NOT "the
 * prompt-building code produces the prompt that is on record", and the difference is the design:
 * the clauses in `generate.ts` were edited after the run that produced this set, so most recorded
 * assets carry a prompt the code no longer derives. A test asserting code-equals-record would be
 * red on arrival and "fixing" it would mean regenerating the whole set or weakening the assertion.
 *
 * What the comparison actually needs is that when a candidate is asked for `SAMPLE_KEY`, it is
 * asked the same thing FLUX was asked when that asset was made — whatever that was. That is what
 * `promptForProvider` guarantees by replaying the record.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

import { plannedAssets } from './plan.ts'
import { promptFor } from './generate.ts'
import {
  identityFor,
  promptForProvider,
  referencePrompts,
  MissingReferencePromptError,
  RepromptNotForCandidateError,
} from './replay.ts'
import { PROVIDERS, REFERENCE, providerById, live, ProviderWithdrawnError } from './providers.ts'
import {
  backendFor,
  managedComputeBackend,
  referenceBackend,
  UnimplementedBackendError,
  UNKNOWNS,
  measureC2pa,
  scoringUri,
  managedHeaders,
  MODEL_FIELD,
  modelValueFor,
  isWarming,
  awaitWarm,
  resetWarmingGate,
  WARMING,
  type GenerationRequest,
} from './backends.ts'

// Derived from the registry, never counted. Cosmos 3 Super failed to deploy and is `withdrawn`; a
// third model will be tried again, so these tests assert SHAPE rather than arity.
const CANDIDATES = PROVIDERS.filter((p) => p.id !== REFERENCE.id)
const digest = (value: string): string => createHash('sha256').update(value).digest('hex')
const compute = (planned: Parameters<typeof promptFor>[0]): string => promptFor(planned)

const sampleRequest = (prompt: string): GenerationRequest => ({
  prompt,
  spec: { kind: 'icon', width: 512, height: 512, format: 'png' },
  requestWidth: 512,
  requestHeight: 512,
  kitName: 'sample',
  accent: '#e8622c',
})

test('every provider is given the same prompt for the same asset', () => {
  const recorded = referencePrompts()
  assert.ok(recorded.size > 0, 'the reference manifest carries no prompts to replay')

  let compared = 0
  for (const planned of plannedAssets()) {
    const { key } = identityFor(planned)
    if (!recorded.has(key)) continue // not generated for the reference yet; nothing to replay.
    const prompts = PROVIDERS.map((p) => promptForProvider(p.id, planned, compute))
    assert.equal(
      new Set(prompts.map(digest)).size,
      1,
      `${key}: the providers would be sent different prompts`,
    )
    compared += 1
  }
  assert.ok(compared > 20, `only ${compared} assets had a recorded prompt to compare`)
})

/**
 * Drift, constructed rather than borrowed from history.
 *
 * The sibling repositories test this against assets whose recorded prompt their current code no
 * longer produces — real drift, left behind when clauses were edited after a run. This repository
 * has none, because it is new and nothing has been edited since its run started, and the inherited
 * test asserted `drifted.length > 0` and therefore failed on a repository in a BETTER state than
 * the one it was written for.
 *
 * Its own failure message said what to do: give it a synthetic fixture. So the drift is
 * manufactured here — a `compute` that deliberately returns something no record could contain —
 * which tests the property directly instead of depending on a repository having accumulated a
 * particular kind of history. It also keeps testing once the drift is real.
 */
const DRIFTED = 'FRESHLY COMPUTED — this string is in no manifest and must never reach a wire'
const computeDrifted = (): string => DRIFTED

/** Any asset the reference has actually generated. Undefined before the first generation lands. */
function recordedAsset() {
  const recorded = referencePrompts()
  return plannedAssets().find((planned) => recorded.has(identityFor(planned).key))
}

test('every provider replays the recorded prompt, including the reference', () => {
  const recorded = referencePrompts()
  // The case that makes this worth testing: the current code would produce something OTHER than
  // what is on record. If any provider recomputed instead of replaying, regenerating that asset
  // would ask that model a different question from the one the others answered, and every other
  // check in the repository would stay green while the comparison stopped meaning anything.
  let compared = 0
  for (const planned of plannedAssets()) {
    const record = recorded.get(identityFor(planned).key)
    if (record === undefined) continue
    for (const provider of PROVIDERS) {
      assert.equal(
        promptForProvider(provider.id, planned, computeDrifted),
        record,
        `${identityFor(planned).key}: ${provider.id} was not given the recorded prompt`,
      )
    }
    compared += 1
  }
  assert.ok(compared > 0, 'the reference manifest carries no prompts to replay')
})

test('changing the question is deliberate and reference-only', () => {
  const planned = recordedAsset()
  assert.ok(planned, 'the reference manifest carries no prompts to replay')
  const recorded = referencePrompts().get(identityFor(planned).key)!

  // Only --reprompt gets you the freshly computed string, and only on the reference.
  const reprompted = promptForProvider(REFERENCE.id, planned, computeDrifted, { reprompt: true })
  assert.equal(reprompted, DRIFTED)
  assert.notEqual(reprompted, recorded)

  for (const candidate of CANDIDATES) {
    assert.throws(
      () => promptForProvider(candidate.id, planned, computeDrifted, { reprompt: true }),
      RepromptNotForCandidateError,
    )
  }
})

test('an asset the reference has never generated cannot be generated for a candidate', () => {
  const invented = { ...plannedAssets()[0]!, key: 'no-such/asset' }
  for (const candidate of CANDIDATES) {
    assert.throws(
      () => promptForProvider(candidate.id, invented, compute),
      MissingReferencePromptError,
    )
  }
  // ...and the reference itself may, because it is what establishes the record.
  assert.ok(promptForProvider(REFERENCE.id, invented, compute).length > 0)
})

test('an unimplemented backend throws rather than guessing a wire shape', async () => {
  for (const candidate of CANDIDATES.filter((p) => p.adapter === 'foundry-managed-compute')) {
    assert.equal(candidate.implemented, false)
    const backend = managedComputeBackend(candidate)
    assert.throws(() => backend.bodyFor(sampleRequest('anything')), UnimplementedBackendError)
    // generate must refuse BEFORE it opens a socket: an unknown body has to cost nothing, and on a
    // per-hour deployment "nothing" includes not making a billable call.
    await assert.rejects(backend.generate(sampleRequest('x'), AbortSignal.timeout(1)))
  }
  assert.ok(UNKNOWNS.length >= 8, 'the checklist has been trimmed; that is how a body gets guessed')
  assert.ok(UNKNOWNS[0]!.startsWith('BODY FIELD NAMES'))
})

test('the unimplemented error names the unknowns and leaks no credential', () => {
  let message = ''
  try {
    managedComputeBackend(providerById('cosmos-3-super')).bodyFor(sampleRequest('x'))
  } catch (err) {
    message = (err as Error).message
  }
  for (const heading of ['BODY FIELD NAMES', 'RESPONSE SHAPE', 'C2PA', 'PROMPT LENGTH']) {
    assert.ok(message.includes(heading), `the error no longer mentions ${heading}`)
  }
  assert.equal(/[A-Za-z0-9_-]{32,}/.test(message), false, 'a token-shaped string reached the error')
})

test('the registry describes the models rather than counting them', () => {
  assert.equal(REFERENCE.implemented, true)
  assert.equal(REFERENCE.shipped, true)
  // NOT `assert.equal(REFERENCE.billing.unit, 'provider image unit')`, which is what stood here and
  // is what failed the first time the reference was actually switched. It pinned FLUX's unit onto
  // the ROLE, so promote.py — which only rewrites five lines of providers.json and touches no code
  // — turned red on a promotion that was correct in every other respect. A reference is a position
  // a model occupies, not a model; the only thing the position can be asked to guarantee is that
  // whoever holds it has a unit at all, and the loop at the foot of this test checks that unit
  // against its basis for every provider, reference included.
  assert.ok(REFERENCE.billing.unit.length > 0, 'the reference bills in no unit')
  // Deliberately NOT an arity assertion. The comparison was three-way, is two-way because Cosmos
  // failed to deploy, and will be three-way again — the estate has a 3D/animation gap FLUX cannot
  // fill. A test pinning the count is how a design gets collapsed back into hardcoded providers.
  assert.ok(CANDIDATES.length >= 1)
  assert.ok(live().length >= 1)
  for (const candidate of CANDIDATES) {
    assert.equal(candidate.shipped, false)
    assert.equal(candidate.billing.hourlyRate, null, 'a rate was filled in; check it was measured')
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // BILLING IS ASSERTED AS A CONSISTENT SHAPE, NOT AS A LIST OF KNOWN UNIT STRINGS.
  //
  // This used to read `assert.equal(candidate.billing.unit, 'deployment hour')` for every
  // candidate, on the reasoning that the unit string is not decoration — compare.py refuses to add
  // costs across units and the honesty of COMPARISON.md §6 depends on it being right. The
  // reasoning was correct and the assertion was the wrong shape for it: it pinned the two units
  // that happened to exist, so a third one could only ever arrive by editing a test, and the
  // obvious edit is to widen it into a set of allowed strings that then has to be widened again.
  //
  // gpt-image-2 is the third unit — output image tokens, per image, and neither of the other two.
  // What actually has to hold is not WHICH unit it is but that the unit and the BASIS agree, and
  // that the basis is one compare.py knows how to read: `per image generated` takes the per-image
  // path and needs a response field named as its source, `per hour…` takes the deployment-hour
  // path and needs a DEPLOYMENT.json and a SKU. compare.py branches on `basis` for exactly this
  // reason, and it did NOT until this run: it branched on `unit`, which sent a token-billed
  // serverless endpoint down the deployment-hour arm and asked it for a file it will never have.
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  for (const provider of PROVIDERS) {
    const { unit, basis, source, sku } = provider.billing
    assert.ok(unit.length > 0, `${provider.id}: no billing unit`)
    assert.ok(
      basis.startsWith('per image generated') || basis.startsWith('per hour'),
      `${provider.id}: billing basis "${basis}" is one compare.py cannot dispatch on`,
    )
    if (basis.startsWith('per image generated')) {
      // A per-image provider has to name the response field its figure comes off, because that
      // figure lands in providerCostUnits on every row and there is no other record of where it
      // came from months later.
      assert.ok(
        source.includes('providerCostUnits'),
        `${provider.id}: a per-image basis must say which response field providerCostUnits holds`,
      )
      assert.equal(sku, null, `${provider.id}: a per-image provider has no hardware SKU`)
    } else {
      assert.ok(
        source.includes('DEPLOYMENT.json'),
        `${provider.id}: an hourly basis must name the operator's deployment record as its source`,
      )
      assert.ok(sku !== null, `${provider.id}: an hourly provider bills for a SKU; name it`)
    }
  }

  const cosmos = providerById('cosmos-3-super')
  assert.equal(cosmos.status, 'withdrawn')
  assert.throws(() => backendFor(cosmos, {}), ProviderWithdrawnError)
})

test('the managed wire facts that were measured, pinned', () => {
  // These are facts about the Managed Compute HOST, not about either model that has been on it,
  // which is why they survive the removal of the Qwen deployment: the next challenger lands on the
  // same routes, the same header and the same deployment-name rule.
  const cosmos = providerById('cosmos-3-super')
  assert.equal(cosmos.route, '/managed-deployments/{deployment}/v1/chat/completions')
  assert.equal(
    scoringUri({ baseUrl: 'https://h.example/', apiKey: 'x', deployment: 'nvidia--cosmos3-super', route: cosmos.route! }),
    'https://h.example/managed-deployments/nvidia--cosmos3-super/v1/chat/completions',
  )
  // `api-key`, never Bearer — Bearer is a measured 401 on that host. Asserted on the object the
  // code sends rather than by grepping the source, so a comment cannot fail the build.
  const headers = managedHeaders({ baseUrl: 'https://h.example', apiKey: 'k', deployment: 'd', route: '/r' })
  assert.deepEqual(Object.keys(headers).sort(), ['api-key', 'content-type'])
  assert.equal(headers['authorization'], undefined)
  // `model` is required in the body and its value is the DEPLOYMENT name, not the catalogue name.
  assert.equal(MODEL_FIELD, 'model')
  assert.equal(
    modelValueFor({ baseUrl: '', apiKey: '', deployment: 'nvidia--cosmos3-super', route: '' }),
    'nvidia--cosmos3-super',
  )
  // The near miss: the natural spelling of the Cosmos deployment is a measured 404.
  assert.equal(cosmos.deployment, 'nvidia--cosmos3-super')
  assert.notEqual(cosmos.deployment, 'nvidia--cosmos-3-super')
})

test('a warming 500 is not a failure, and workers share one wait', async () => {
  assert.equal(isWarming(500, 'Model service is unavailable'), true)
  assert.equal(isWarming(500, 'internal server error'), false, 'a real 500 must not be waited out')
  assert.equal(isWarming(400, 'model service is unavailable'), false)

  resetWarmingGate()
  let polls = 0
  let clock = 0
  await Promise.all(
    Array.from({ length: 4 }, () =>
      awaitWarm(
        async () => ++polls >= 3,
        () => {},
        () => clock,
        async (ms) => {
          clock += ms
        },
      ),
    ),
  )
  // Ten workers hammering a container that is loading weights do not make it load faster, and on
  // dedicated hardware there is no 429 to tell them to stop.
  assert.equal(polls, 3, 'the endpoint was polled once per worker per wait')
  assert.ok(WARMING.budgetMs > 0)
  resetWarmingGate()
})

test('c2pa is read off the bytes, never asserted', () => {
  assert.equal(measureC2pa(Buffer.from('\x89PNG....c2pa....')), true)
  assert.equal(measureC2pa(Buffer.from('\x89PNG....IDAT....')), false)
})


/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT REPLACED THE THREE QWEN ENVELOPE TESTS, AND WHY IT IS NOT A REDUCTION
 *
 * Three tests were deleted with the Qwen deployment: they asserted that the OpenAI-images envelope
 * carried the prompt verbatim, that `sizeParamFor` transposed, and that all 68 non-square assets
 * were REQUESTED transposed. The first was a parity assertion and is replaced below. The other two
 * pinned a workaround for one vendor's bug — a bug in an endpoint that no longer exists — and a
 * test that pins a deleted workaround is a test that can only ever fail for the wrong reason.
 *
 * The property those two really protected is not "we transpose". It is **"a delivered image is the
 * size that was asked for, measured on the bytes"**, and that survives in two places that are not
 * specific to any model: `generate.ts`'s `TransposedDeliveryError`, which refuses to keep a rotated
 * file for ANY provider, and `verify.py` check 9, which re-measures every non-square asset across
 * sets. The population both of those act on is pinned here, because a suite that stopped knowing
 * how many non-square assets exist would not notice the day that number went to zero.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
test('the reference envelope carries the prompt verbatim', () => {
  // The end-to-end form of the parity property: compare the string that reaches the WIRE against
  // the string handed in, not two builders against each other. A backend that prepended a system
  // preamble, appended a negative prompt or truncated to a token budget fails here.
  const prompt = 'a prompt with\n\nparagraphs and "quotes" and — dashes'
  const body = referenceBackend(REFERENCE, {
    endpoint: 'https://f.example',
    apiKey: 'k',
    imagePath: '/p',
    model: 'FLUX.2-pro',
    fallbackModel: '',
  }).bodyFor({
    prompt,
    spec: { kind: 'mark', width: 1024, height: 1024, format: 'png' },
    requestWidth: 1024,
    requestHeight: 1024,
    kitName: 'x',
    accent: '#e8622c',
  })
  assert.equal(body['prompt'], prompt)
})

test('the reference asks for the size it wants, and the non-square population is pinned', () => {
  const backend = referenceBackend(REFERENCE, {
    endpoint: 'https://f.example',
    apiKey: 'k',
    imagePath: '/p',
    model: 'FLUX.2-pro',
    fallbackModel: '',
  })

  const nonSquare = plannedAssets().filter((a) => a.width !== a.height)
  // Not a decoration. `TransposedDeliveryError` and verify.py check 9 are both blind on a square,
  // so the number of non-square assets IS the size of the population those two checks can see.
  assert.equal(nonSquare.length, 68, 'doc 23 §2.3 puts 68 non-square generations in this set')

  for (const planned of nonSquare.slice(0, 8)) {
    const body = backend.bodyFor({
      prompt: 'x',
      spec: { kind: 'banner', width: planned.width, height: planned.height, format: 'png' },
      requestWidth: planned.width,
      requestHeight: planned.height,
      kitName: planned.name,
      accent: planned.accent,
    })
    // Width and height as themselves. The reference provider takes these and IGNORES `size` and
    // `aspect_ratio`; nothing in this repository transposes anything any more.
    assert.equal(body['width'], planned.width)
    assert.equal(body['height'], planned.height)
  }
})
