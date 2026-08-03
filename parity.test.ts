/**
 * The prompt-parity suite: the property the whole comparison rests on, asserted rather than
 * maintained by convention.
 *
 *     cd ../studio && node --import tsx --test ../aetherholm-assets/parity.test.ts
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
  openAiImagesBackend,
  sizeParamFor,
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

test('every provider replays the recorded prompt, including the reference', () => {
  const recorded = referencePrompts()
  // The case that makes this worth testing: an asset whose recorded prompt the current code no
  // longer produces. If ANY provider recomputed instead of replaying, regenerating one of these
  // would ask that model a different question from the one the others answered, and every other
  // check in the repository would stay green while the comparison stopped meaning anything.
  const drifted = plannedAssets().filter((planned) => {
    const record = recorded.get(identityFor(planned).key)
    return record !== undefined && record !== promptFor(planned)
  })
  assert.ok(drifted.length > 0, 'no drifted asset to test against; give this a synthetic fixture')
  for (const planned of drifted) {
    for (const provider of PROVIDERS) {
      assert.equal(
        promptForProvider(provider.id, planned, compute),
        recorded.get(identityFor(planned).key),
        `${identityFor(planned).key}: ${provider.id} was not given the recorded prompt`,
      )
    }
  }
})

test('changing the question is deliberate and reference-only', () => {
  const recorded = referencePrompts()
  const drifted = plannedAssets().find((planned) => {
    const record = recorded.get(identityFor(planned).key)
    return record !== undefined && record !== promptFor(planned)
  })!
  const reprompted = promptForProvider(REFERENCE.id, drifted, compute, { reprompt: true })
  assert.equal(reprompted, promptFor(drifted))
  assert.notEqual(reprompted, recorded.get(identityFor(drifted).key))
  for (const candidate of CANDIDATES) {
    assert.throws(
      () => promptForProvider(candidate.id, drifted, compute, { reprompt: true }),
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
    managedComputeBackend(providerById('qwen-image-2512')).bodyFor(sampleRequest('x'))
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
  assert.equal(REFERENCE.billing.unit, 'provider image unit')
  // Deliberately NOT an arity assertion. The comparison was three-way, is two-way because Cosmos
  // failed to deploy, and will be three-way again — the estate has a 3D/animation gap FLUX cannot
  // fill. A test pinning the count is how a design gets collapsed back into hardcoded providers.
  assert.ok(CANDIDATES.length >= 1)
  assert.ok(live().length >= 1)
  for (const candidate of CANDIDATES) {
    assert.equal(candidate.billing.unit, 'deployment hour')
    assert.equal(candidate.billing.hourlyRate, null, 'a rate was filled in; check it was measured')
  }
  const cosmos = providerById('cosmos-3-super')
  assert.equal(cosmos.status, 'withdrawn')
  assert.throws(() => backendFor(cosmos, {}), ProviderWithdrawnError)
})

test('the managed wire facts that were measured, pinned', () => {
  const qwen = providerById('qwen-image-2512')
  // Qwen turned out to serve on an OpenAI-shaped images route, not under /managed-deployments/.
  assert.equal(qwen.route, '/openai/v1/images/generations')
  assert.equal(
    scoringUri({ baseUrl: 'https://h.example/', apiKey: 'x', deployment: qwen.deployment!, route: qwen.route! }),
    'https://h.example/openai/v1/images/generations',
  )
  // `api-key`, never Bearer — Bearer is a measured 401 on that host. Asserted on the object the
  // code sends rather than by grepping the source, so a comment cannot fail the build.
  const headers = managedHeaders({ baseUrl: 'https://h.example', apiKey: 'k', deployment: 'd', route: '/r' })
  assert.deepEqual(Object.keys(headers).sort(), ['api-key', 'content-type'])
  assert.equal(headers['authorization'], undefined)
  // `model` is required in the body and its value is the DEPLOYMENT name, not the catalogue name.
  assert.equal(MODEL_FIELD, 'model')
  assert.equal(modelValueFor({ baseUrl: '', apiKey: '', deployment: 'qwen--qwen-image-2512', route: '' }), 'qwen--qwen-image-2512')
  // Still true on the images route: `model` carries the deployment name, not the catalogue name.
  // The near miss: the natural spelling of the Cosmos deployment is a measured 404.
  assert.equal(providerById('cosmos-3-super').deployment, 'nvidia--cosmos3-super')
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

test('the Qwen envelope carries the prompt verbatim and transposes the size', () => {
  const qwen = providerById('qwen-image-2512')
  assert.equal(qwen.adapter, 'foundry-openai-images')
  assert.equal(qwen.implemented, true)
  const backend = openAiImagesBackend(qwen, {
    baseUrl: 'https://h.example',
    apiKey: 'k',
    deployment: 'qwen--qwen-image-2512',
    route: '/openai/v1/images/generations',
  })
  const prompt = 'first paragraph\n\nthe name is "Forge Trade" — accent #2a9e93\n\nlast paragraph'
  const body = backend.bodyFor({
    prompt,
    spec: { kind: 'wordmark', width: 1024, height: 384, format: 'png' },
    requestWidth: 1024,
    requestHeight: 384,
    kitName: 'Forge Trade',
    accent: '#2a9e93',
  })

  // Parity: untouched, un-prefixed, un-truncated.
  assert.equal(body['prompt'], prompt)
  assert.equal(body['model'], 'qwen--qwen-image-2512')
  // Required; the OpenAI default `url` is a measured 400 from the model itself.
  assert.equal(body['response_format'], 'b64_json')
  assert.equal(body['n'], 1)

  // THE TRAP. Asking this endpoint for 1024x384 delivers 384x1024 while reporting 1024x384, so
  // the envelope asks for the transpose. A square probe cannot see this — which is how it survived
  // a careful handover — and every wordmark, OG card and banner in the estate is non-square.
  assert.equal(body['size'], '384x1024')
  assert.equal(sizeParamFor(1280, 640), '640x1280')
  assert.equal(sizeParamFor(512, 512), '512x512', 'squares are unaffected, which is why it hides')

  // width/height are a measured `unrecognized_request_argument` here; the reference provider is
  // the exact mirror image, taking those and ignoring `size`.
  assert.equal(body['width'], undefined)
  assert.equal(body['height'], undefined)
  assert.deepEqual(
    Object.keys(body).sort(),
    ['model', 'n', 'prompt', 'response_format', 'size'],
    'the body grew a field; if it is prompt-adjacent, parity is at risk',
  )
})

test('the two implemented backends are given the identical prompt for one asset', () => {
  // The end-to-end version of the parity property: same asset, both live providers, compare the
  // strings that reach the wire rather than the strings that go into the builders.
  const qwen = providerById('qwen-image-2512')
  const prompt = 'a prompt with\n\nparagraphs and "quotes" and — dashes'
  const request = {
    prompt,
    spec: { kind: 'mark' as const, width: 1024, height: 1024, format: 'png' as const },
    requestWidth: 1024,
    requestHeight: 1024,
    kitName: 'x',
    accent: '#e8622c',
  }
  const qwenBody = openAiImagesBackend(qwen, {
    baseUrl: 'https://h.example',
    apiKey: 'k',
    deployment: qwen.deployment!,
    route: qwen.route!,
  }).bodyFor(request)
  const fluxBody = referenceBackend(REFERENCE, {
    endpoint: 'https://f.example',
    apiKey: 'k',
    imagePath: '/p',
    model: 'FLUX.2-pro',
    fallbackModel: '',
  }).bodyFor(request)
  assert.equal(qwenBody['prompt'], fluxBody['prompt'])
  assert.equal(qwenBody['prompt'], prompt)
})

test('c2pa is read off the bytes, never asserted', () => {
  assert.equal(measureC2pa(Buffer.from('\x89PNG....c2pa....')), true)
  assert.equal(measureC2pa(Buffer.from('\x89PNG....IDAT....')), false)
})
