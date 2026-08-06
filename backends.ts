/**
 * The provider seam: one interface, N implementations, one of which works.
 *
 * ## Why this file exists at all
 *
 * `generate.ts` used to call `fluxBackend` from the studio service directly, which was right while
 * there was one model. There is now a registry of them, and the non-FLUX ones are not FLUX-shaped:
 * a Foundry Global Managed Compute deployment is reached on its own host, with its own key, on
 * `/managed-deployments/<deployment>/v1/chat/completions` — not the
 * `/providers/blackforestlabs/v1/flux-2-pro` route the reference provider uses. So the thing that
 * varies — the envelope a prompt is posted inside — is named and isolated here, and everything
 * that must NOT vary stays outside it.
 *
 * **N, not three, and not one.** The comparison was briefed as three-way, ran two-way because
 * Cosmos 3 Super failed to come up on A100_80GB and was deleted, and is one-way today because the
 * owner has withdrawn Qwen-Image 2512 from the estate: FLUX 2 Pro is the shipped set and the
 * challenger's images, manifest and registry entry are gone. COMPARISON.md keeps what that
 * comparison MEASURED, which is the part that was worth having.
 *
 * **The seam stays.** One live provider is a fact about today, not a shape for the code. The
 * estate has a stated 3D and animation gap FLUX cannot fill (docs/ecosystem/19-new-products.md),
 * so a next challenger is a question of when rather than if, and reinstating this interface,
 * `providers.json`'s N-provider registry, `replay.ts`'s prompt record and `verify.py`'s parity and
 * delivered-size checks would be a rewrite rather than an edit. What was deleted with Qwen is only
 * what could not outlive it: its envelope, and the transposed-`size` workaround for its bug.
 * Nothing in this file, in providers.json, in the manifest schema or in compare.py counts
 * providers. A withdrawn one keeps its entry, because the wire facts in it were measured and are
 * cheaper to re-read than to re-establish.
 *
 * ## What must not vary, and how this file guarantees it
 *
 * The whole comparison rests on every model receiving the same prompt. `GenerationRequest`
 * carries `prompt` as an opaque string that no backend may alter, and every backend exposes
 * `bodyFor()` so that claim is testable rather than trusted: `parity.test.ts` asserts, for each
 * implemented backend, that the prompt in the body is `===` the prompt in the request. A backend
 * that prepended a system preamble, appended a negative prompt, or truncated to a token budget
 * would fail that test.
 *
 * ## How much of the Managed Compute backend is real
 *
 * Route, auth header, deployment naming, warming detection and error classification are written
 * and tested — they were measured against a live deployment on this host. The REQUEST BODY is
 * not, and `bodyFor` throws.
 *
 * That line is where it is on purpose. A Managed Compute endpoint's request schema is the model's
 * own signature, not a standard, and there is no swagger on this host to read. Shipping a
 * plausible body that returns 200 with a differently-interpreted prompt would not look like a
 * failure; it would look like "the challenger is worse at prompt adherence", which is exactly the
 * conclusion this exercise is meant to reach honestly or not at all. So `UNKNOWNS` is a list rather
 * a lament, `probe.ts` asks the server to fill in the first item, and `generate` calls `bodyFor`
 * before it opens a socket so an unknown body costs nothing — which on a per-hour deployment means
 * not even a billable second.
 *
 * ## Credentials
 *
 * Read from `process.env`, which `generate.ts` populates from the gitignored `studio/.env.local`.
 * The names are in providers.json; the VALUES appear in exactly one place, the request headers.
 * Never in an error, never in an attempt detail, never in the manifest, never on stdout.
 */

import {
  fluxBackend,
  bodyFor as fluxBodyFor,
  ImageBackendError,
  type Attempt,
  type ImageRequest,
} from '../studio/src/backend.ts'
import type { AssetSpec } from '../studio/src/specs.ts'
import type { AttemptOutcome } from '../studio/src/backend.ts'

import { ProviderWithdrawnError, type Provider } from './providers.ts'

/* ------------------------------------------------------------------ the request and the result */

/**
 * One asset, asked for. Identical for every provider by construction: there is no provider field
 * on it, so there is nowhere for a provider-specific tweak to hide.
 */
export interface GenerationRequest {
  /** Verbatim, and never rewritten by a backend. The one thing parity depends on. */
  readonly prompt: string
  readonly spec: AssetSpec
  readonly requestWidth: number
  readonly requestHeight: number
  readonly kitName: string
  readonly accent: string
}

export interface GenerationResult {
  readonly bytes: Buffer
  /** What went in the manifest's `backend` column. The adapter, not the vendor's marketing name. */
  readonly backend: string
  readonly model: string | null
  /**
   * MEASURED on the bytes returned, never asserted from the vendor. This estate's standing rule,
   * and the one that already cost it 54 entries claiming a C2PA box the files had not carried
   * since the ground-normalisation commit. It is computed in exactly one place — `measureC2pa`
   * below — so a new backend cannot forget to do it or be tempted to hardcode it.
   */
  readonly c2pa: boolean
  /**
   * The provider's own per-call accounting, where the provider HAS per-call accounting. Null on a
   * Managed Compute deployment, and that null is meaningful: it bills per hour of existence, so
   * there is no per-image number to record and inventing one would be a lie. See COMPARISON.md §6.
   */
  readonly providerCostUnits: number | null
  readonly providerOutputMegapixels: number | null
  /** Null where the model accepts no seed. FLUX 2 Pro does not; the candidates may. */
  readonly seed: number | null
  readonly attempts: readonly Attempt[]
}

export interface ProviderBackend {
  readonly provider: Provider
  /** The exact JSON body this backend would POST. Exposed so parity is asserted, not assumed. */
  bodyFor(request: GenerationRequest): Record<string, unknown>
  generate(request: GenerationRequest, signal: AbortSignal): Promise<GenerationResult>
}

/** The C2PA box identifier, in the PNG's metadata chunks. One marker, read one way, everywhere. */
const C2PA_MARKER = Buffer.from('c2pa')

export const measureC2pa = (bytes: Buffer): boolean => bytes.includes(C2PA_MARKER)

/* ------------------------------------------------------------------ managed compute */

/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * **THE MEASURED CONTRACT, so far.** Established by probing live deployments on this host, not
 * read off a model card. Two of these contradict what the reference provider does.
 *
 * These are facts about the HOST, not about either model that was on it, which is why they are
 * kept now that the Qwen deployment has been removed from the estate: the next Managed Compute
 * challenger lands on the same routes, the same header and the same warming sequence, and every
 * line below cost a real request to learn. Where an observation names `qwen--qwen-image-2512` it
 * is a measurement that was taken, reported as taken; that deployment no longer exists.
 *
 *     POST {FOUNDRY2_BASE_URL}/managed-deployments/{deployment}/v1/chat/completions
 *     api-key: <FOUNDRY2_API_KEY>
 *     content-type: application/json
 *
 * 1. **`api-key`, NOT `Authorization: Bearer`.** Bearer is a flat 401 on this host. Same header
 *    name as the reference provider, different host and different key.
 * 2. **The route carries the deployment name**, so one host serves every candidate and the
 *    provider registry has to name which deployment it means. Both `qwen--qwen-image-2512` and
 *    `nvidia--cosmos3-super` were verified against a bogus-name control; the near-miss spelling
 *    `nvidia--cosmos-3-super`, which is what anyone would type, is a 404.
 * 3. **A sibling `/v1/messages` route exists** (the Anthropic spelling) and is also real — both
 *    answer 400 to a GET rather than 404. Which of the two a given model actually serves images on
 *    is part of the open unknown below.
 * 4. **There is no schema document.** `/managed-deployments/<name>/swagger.json` is 404 with a
 *    valid key. The body has to be established by asking the server, which is what `probe.ts` does.
 * 4a. **`model` is REQUIRED in the body, and its value is the DEPLOYMENT NAME.** Measured by
 *    posting `{}` and reading the reply. This is the reference provider's trap 1 all over again —
 *    the model is already in the URL and must still be in the body — with a twist that makes it
 *    worse rather than better:
 *
 *        POST … body {}                              → 400 "Missed model deployment"
 *        POST … body {"model":"Qwen-Image-2512"}      → 404 DeploymentNotFound
 *        POST … body {"model":"qwen--qwen-image-2512"}→ 500 "Model service is unavailable."
 *
 *    So the catalogue name of the model is NOT the value; the deployment name is, and the two are
 *    different strings. On the reference provider the equivalent mistake was the hyphenated path
 *    segment against the dotted model name. Same shape of error, same 404, same hour lost to it.
 *    `MODEL_FIELD` below is the one body field this repository is prepared to assert, because the
 *    server named it and then accepted a value for it.
 * 5. **`500 Model service is unavailable` means WARMING, not broken.** The observed state sequence
 *    is 400 (no such deployment) → 500 (exists, weights still loading) → serving. A container that
 *    restarts mid-run re-enters that state. See `WARMING` below for why this cannot be treated as
 *    an ordinary 5xx.
 * 6. **No shared quota.** This is dedicated hardware, so 429 is not the limit — the GPU is. The
 *    right concurrency is measured, not assumed, and lives in providers.json.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */

export interface ManagedComputeConfig {
  readonly baseUrl: string
  readonly apiKey: string
  readonly deployment: string
  /** `/managed-deployments/{deployment}/v1/chat/completions`, from providers.json. */
  readonly route: string
}

export function scoringUri(config: ManagedComputeConfig): string {
  return `${config.baseUrl.replace(/\/+$/, '')}${config.route.replace('{deployment}', config.deployment)}`
}

/**
 * The headers, built in one place so the auth scheme cannot be got wrong in a second one.
 *
 * `api-key`, never `Authorization: Bearer` — measured, and Bearer is a flat 401 on this host. That
 * is the natural mistake to make, because Bearer is what every other Azure ML scoring endpoint
 * wants, so the choice is made once here and asserted by a test that reads the object rather than
 * the source text.
 */
export function managedHeaders(config: ManagedComputeConfig): Record<string, string> {
  return { 'content-type': 'application/json', 'api-key': config.apiKey }
}

/**
 * The one body field that is not a guess: the server asked for it by name and then accepted a
 * value for it. Everything else about the body is still open, which is why `bodyFor` still throws.
 */
export const MODEL_FIELD = 'model'

/** The value that field takes: the deployment name, not the model's catalogue name. Measured. */
export const modelValueFor = (config: ManagedComputeConfig): string => config.deployment

/**
 * What remains unknown for a Managed Compute deployment. Route, auth and the `model` field have
 * come off this list because they were measured; everything below is still to be established, and
 * `managedComputeBackend` refuses to build a body until the first item is.
 */
export const UNKNOWNS: readonly string[] = [
  'BODY FIELD NAMES — THE BLOCKING ONE. `model` is settled (see 4a in the header): required, and ' +
    'its value is the deployment name. What is NOT settled is how the prompt and the size are ' +
    'carried. The route is /v1/chat/completions, so the leading hypothesis is an OpenAI chat ' +
    'envelope — {"model", "messages":[{"role":"user","content":"<prompt>"}]} — with the image ' +
    'coming back in the assistant message. It is a HYPOTHESIS and it is not implemented. There is ' +
    'no swagger to read, so run `probe.ts` once the container is warm: it posts the fields that ' +
    'are known to be required and prints the validation error naming whatever is missing next. ' +
    'Implement `bodyFor` from that reply, not from this paragraph.',
  'RESPONSE SHAPE. Base64 in the message content, a data: URL, a pre-signed URL, or a content ' +
    'part of type image_url. This determines the decode path and it is the second thing the first ' +
    'successful exchange settles.',
  'SIZE PARAMETERS. Whether width/height are accepted at all on a chat-shaped route, and whether ' +
    'either is honoured or silently ignored — the reference provider accepts and IGNORES ' +
    '`aspect_ratio` and `size`, which is worse than rejecting them because nothing fails.',
  'DIMENSION GRANULARITY. The reference provider floors each delivered dimension to a multiple of ' +
    '16, which is the entire reason `requestSizeFor` rounds up and an OG card is asked for at ' +
    '1200x640 and cut to 1200x630. Probe 1200x630 and 1024x384 and MEASURE what comes back before ' +
    'reusing that arithmetic; if the granularity differs, the request sizes differ.',
  'OUTPUT FORMAT. Whether PNG is the default or has to be asked for. The reference provider ' +
    'returns JPEG unless `output_format:"png"` is sent, and a JPEG brand mark has visible ringing ' +
    'on flat vector edges.',
  'SEED. Whether a seed parameter is accepted and echoed back. The reference provider takes none, ' +
    'so `seed` is null on all 94 entries; if a candidate accepts one, record it, because a seeded ' +
    'model makes a disagreement between two runs reproducible rather than anecdotal.',
  'NEGATIVE PROMPT. Whether the model has a separate negative-prompt parameter. If it does, it ' +
    'must be left EMPTY: the reference prompts carry their prohibitions inside the prompt text, ' +
    'and moving them into a different field would give this model a different instruction from the ' +
    'other two. That is a parity decision, not a quality one.',
  'PROMPT LENGTH — ANSWERED on the deployment that has since been removed, and the answer ruled ' +
    'out the obvious explanation. That model did NOT ' +
    'truncate. Probed with a 2,238-character prompt whose FINAL clause was "the entire background ' +
    'is solid pure green, hex #00ff00, edge to edge": the image came back green. So the late ' +
    'clauses of a 2,000-character brand prompt are received and acted on.\n\n    That matters ' +
    'because it kills the comfortable theory about why this model draws construction guides into ' +
    'artwork that explicitly forbids them. It is not that it never saw the prohibition. It is that ' +
    'it obeys POSITIVE instructions late in a prompt ("make the background green") and disregards ' +
    'NEGATIVE ones ("no grid, no guides, no construction lines") — and it reads the style ' +
    'paragraph\'s "constructed ... on a single grid" as a thing to DRAW. That is the same misread ' +
    'FLUX made on its first image, which prompts.ts fixed by moving the prohibition last; the fix ' +
    'does not transfer, because position was never this model\'s problem.\n\n    The implication ' +
    'for a FUTURE set is to state the constraint positively — "the background is one unbroken flat ' +
    'field" rather than "no grid, no guides". It is deliberately NOT applied to this comparison: ' +
    'changing a prompt for one model is the one thing parity forbids.',
  'CONCURRENCY. How many requests one A100_80GB serves before latency collapses. There is no ' +
    'shared quota to hit, so nothing will answer 429 to tell you; the signal is the median latency ' +
    'rising. This sets the run width and therefore the wall-clock, and the wall-clock IS the bill.',
  'C2PA. Whether the bytes carry a C2PA box at all. Do not assume either way — `measureC2pa` reads ' +
    'it off the bytes and the manifest records what was measured. A candidate set with no C2PA is ' +
    'a legitimate outcome and a disclosure fact worth having; a candidate set CLAIMING C2PA it ' +
    'does not carry is the defect this repository has already shipped once.',
]

export class UnimplementedBackendError extends Error {
  readonly provider: string
  readonly unknowns: readonly string[]

  constructor(provider: Provider, unknowns: readonly string[], preamble?: string) {
    super(
      (preamble ? `${preamble}\n\n` : '') +
        `the ${provider.label} backend cannot build a request body yet: ${unknowns.length} wire ` +
        `facts about the Managed Compute endpoint are not established. The first one blocks the ` +
        `rest. Run \`probe.ts --provider ${provider.id}\` and implement bodyFor from what the ` +
        `server actually answers.\n\n  ${unknowns.join('\n  ')}\n`,
    )
    this.name = 'UnimplementedBackendError'
    this.provider = provider.id
    this.unknowns = unknowns
  }
}

/* ---- the warming gate */

/**
 * A 500 that says the model service is unavailable is not a failure. It is an A100 loading tens of
 * gigabytes of weights, and it lasts minutes.
 *
 * Treating it as an ordinary 5xx would be expensive twice over. Once because the per-asset retry
 * budget is three attempts with a few seconds between them, so a warming container would burn
 * through every asset in the work list in about a minute and report 233 failures against a
 * deployment that was about to start working. And once because the bill is wall-clock: the hour
 * spent discovering that is charged whether or not a single image came back.
 *
 * So warming is its own state. It does not count against an asset's retries, it waits in units of
 * `WARMING.pollMs`, and — the part that matters with concurrency above one — every worker that
 * hits it awaits ONE shared poll rather than each starting its own. Ten workers hammering a
 * loading container do not make it load faster.
 */
export const WARMING = {
  /** Matched case-insensitively against the response body. */
  markers: ['model service is unavailable', 'model is not ready', 'still loading'],
  pollMs: 20_000,
  /** After this long the state is no longer "warming", it is "wrong". Fail rather than bill on. */
  budgetMs: 30 * 60_000,
} as const

export function isWarming(status: number, body: string): boolean {
  if (status !== 500 && status !== 503) return false
  const text = body.toLowerCase()
  return WARMING.markers.some((marker) => text.includes(marker))
}

let warmingGate: Promise<void> | null = null

/**
 * Wait out a warming container once, however many callers are waiting.
 *
 * `poll` reports true when the endpoint is serving. Deliberately returns rather than throws when
 * the budget runs out: the caller's own attempt then fails normally and records why.
 */
export async function awaitWarm(
  poll: () => Promise<boolean>,
  log: (message: string) => void,
  now: () => number = Date.now,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<void> {
  if (warmingGate) return warmingGate
  const startedAt = now()
  warmingGate = (async () => {
    for (;;) {
      const waitedMs = now() - startedAt
      if (waitedMs > WARMING.budgetMs) {
        log(
          `    still warming after ${(waitedMs / 60_000).toFixed(0)} minutes — that is past the ` +
            'budget, so it is being treated as a fault rather than a wait',
        )
        return
      }
      log(`    endpoint is warming (weights still loading); waiting ${WARMING.pollMs / 1000}s`)
      await sleep(WARMING.pollMs)
      if (await poll()) {
        log(`    endpoint is serving after ${((now() - startedAt) / 60_000).toFixed(1)} minutes`)
        return
      }
    }
  })().finally(() => {
    warmingGate = null
  })
  return warmingGate
}

/** Test seam: forget any in-flight gate. */
export function resetWarmingGate(): void {
  warmingGate = null
}

/* ---- the backend */

/**
 * A key can appear in an upstream error body, and an attempt detail is stored in the manifest.
 * Deliberately crude and deliberately over-broad: the cost of redacting a harmless string is a
 * slightly less helpful message; the cost of not redacting a key is the key.
 */
export function redact(value: string): string {
  return value
    .replace(/[A-Za-z0-9_-]{32,}/g, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500)
}

/**
 * Managed Compute: route, auth, warming and error classification are real; the body is not.
 *
 * `generate` deliberately calls `bodyFor` FIRST, so an unimplemented body fails before a request
 * is made rather than after — no HTTP call, no billable second, and the error is the checklist
 * rather than a 400 from the far end. Everything after that line is written and waiting.
 */
export function managedComputeBackend(
  provider: Provider,
  config: ManagedComputeConfig | null = null,
  deps: { readonly fetch?: typeof globalThis.fetch; readonly log?: (m: string) => void } = {},
): ProviderBackend {
  const fetchImpl = deps.fetch ?? globalThis.fetch
  const log = deps.log ?? ((message: string) => process.stdout.write(`${message}\n`))

  const bodyFor = (_request: GenerationRequest): Record<string, unknown> => {
    throw new UnimplementedBackendError(
      provider,
      UNKNOWNS,
      config
        ? `the route and credentials for ${provider.id} ARE established (${config.deployment} on ` +
            'the configured host, api-key header) and the transport below is written. What is ' +
            'missing is only the shape of the JSON.'
        : undefined,
    )
  }

  return {
    provider,
    bodyFor,

    async generate(request, signal) {
      if (!config) {
        throw new Error(
          `${provider.id} has no endpoint configured; set ${provider.env['endpoint']} and ` +
            `${provider.env['apiKey']} in studio/.env.local`,
        )
      }
      // Before the wire, not after: an unknown body must cost nothing.
      const body = bodyFor(request)

      const url = scoringUri(config)
      const attempts: Attempt[] = []
      const startedAt = Date.now()
      const post = async (payload: unknown): Promise<Response> =>
        fetchImpl(url, {
          method: 'POST',
          headers: managedHeaders(config),
          body: JSON.stringify(payload),
          signal,
        })

      for (;;) {
        const response = await post(body)
        const text = (await response.text().catch(() => '')).slice(0, 2_000)

        if (isWarming(response.status, text)) {
          // Does not count as an attempt against the asset. It is the deployment, not the request.
          await awaitWarm(async () => {
            const again = await post(body)
            return !isWarming(again.status, (await again.text().catch(() => '')).slice(0, 2_000))
          }, log)
          continue
        }

        attempts.push({
          backend: 'flux', // studio's AttemptOutcome union has no name for a candidate backend yet.
          model: config.deployment,
          outcome: response.ok ? 'ok' : response.status >= 500 ? 'server_error' : 'bad_request',
          status: response.status,
          detail: redact(text),
          durationMs: Date.now() - startedAt,
        })

        // The decode path lands here once the response shape is known. Until then, reaching this
        // line at all is impossible: bodyFor threw before the first request was made.
        throw new UnimplementedBackendError(provider, UNKNOWNS)
      }
    },
  }
}


/* ------------------------------------------------------------------ the reference backend */

/**
 * FLUX 2 Pro, via the studio service's own engine.
 *
 * A thin adapter and deliberately nothing more. Every verified fact about that endpoint —
 * `model` required in the body despite being in the path, the dotted spelling, `output_format:png`
 * required, the fallback rule, the redaction of keys out of attempt details — lives in
 * `studio/src/backend.ts` and is unit-tested there. Reimplementing any of it here would be a
 * second place for it to rot, and this repository deliberately has no dependencies of its own.
 */
export function referenceBackend(
  provider: Provider,
  config: { endpoint: string; apiKey: string; imagePath: string; model: string; fallbackModel: string },
): ProviderBackend {
  const inner = fluxBackend(config, { deadlineMs: 300_000 })

  const toImageRequest = (request: GenerationRequest): ImageRequest => ({
    prompt: request.prompt,
    spec: request.spec,
    requestWidth: request.requestWidth,
    requestHeight: request.requestHeight,
    kitName: request.kitName,
    accent: request.accent,
  })

  return {
    provider,

    // The service's own body builder, not a copy: `model` being required in the body is the single
    // most surprising thing about that API and the most likely line to be "cleaned up" by someone
    // who notices the model is already in the URL.
    bodyFor: (request) => fluxBodyFor(config.model, toImageRequest(request)),

    async generate(request, signal) {
      const result = await inner.generate(toImageRequest(request), signal)
      return {
        bytes: result.bytes,
        backend: result.backend,
        model: result.model,
        c2pa: measureC2pa(result.bytes),
        providerCostUnits: result.providerMeta?.cost ?? null,
        providerOutputMegapixels: result.providerMeta?.outputMegapixels ?? null,
        // FLUX 2 Pro accepts no seed parameter, so nothing true can be recorded.
        seed: null,
        attempts: result.attempts,
      }
    },
  }
}

/* ------------------------------------------------------------------ selection */

export function backendFor(provider: Provider, env: NodeJS.ProcessEnv = process.env): ProviderBackend {
  // Before anything else. A withdrawn provider is not a configuration problem to be diagnosed from
  // a 404 forty seconds later; it is a deployment that is not there.
  if (provider.status === 'withdrawn') throw new ProviderWithdrawnError(provider)

  const read = (key: string | undefined, fallback = ''): string =>
    (key ? (env[key] ?? '').trim() : '') || fallback

  const endpoint = read(provider.env['endpoint']).replace(/\/+$/, '')
  const apiKey = read(provider.env['apiKey'])

  if (provider.adapter === 'foundry-managed-compute') {
    // A missing credential yields a backend with no config rather than an exception, so that the
    // seam is still constructible in a test and in `probe.ts --dry`. It refuses at generate time.
    const config: ManagedComputeConfig | null =
      endpoint && apiKey && provider.deployment && provider.route
        ? { baseUrl: endpoint, apiKey, deployment: provider.deployment, route: provider.route }
        : null
    return managedComputeBackend(provider, config)
  }

  if (!endpoint || !apiKey) {
    // Names, never values.
    throw new Error(
      `${provider.env['endpoint']} and ${provider.env['apiKey']} must be set in studio/.env.local`,
    )
  }
  return referenceBackend(provider, {
    endpoint,
    apiKey,
    imagePath: read(provider.env['imagePath'], '/providers/blackforestlabs/v1/flux-2-pro'),
    // Dots, not hyphens. The hyphenated path segment is a 404 as a model name.
    model: read(provider.env['model'], 'FLUX.2-pro'),
    fallbackModel: read(env['STUDIO_IMAGE_FALLBACK_MODEL'] ? 'STUDIO_IMAGE_FALLBACK_MODEL' : undefined),
  })
}

export { ImageBackendError }
export type { Attempt }
