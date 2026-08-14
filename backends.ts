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
 * Cosmos 3 Super failed to come up on A100_80GB and was deleted, went one-way when the owner
 * withdrew Qwen-Image 2512, and is two-way again with `gpt-image-2` on trial. Four transitions,
 * and not one of them needed this interface changed. COMPARISON.md keeps what each of those
 * evaluations MEASURED, which is the part of them that was worth having.
 *
 * **AND THAT IS THE ARGUMENT FOR THE SEAM, SETTLED BY EVENTS RATHER THAN ASSERTED.** When the last
 * challenger went there was one live provider, and the case for keeping N-provider machinery was a
 * prediction: the estate has a stated 3D and animation gap FLUX cannot fill
 * (docs/ecosystem/19-new-products.md), so a next challenger was a question of when. The prediction
 * held. Adding `gpt-image-2` cost one registry entry, one member on `AdapterKind`, one backend
 * below and a native-size path in `generate.ts` — against the rewrite it would have been if the
 * seam had been collapsed back to a single hardcoded model. Nothing in this file, in
 * providers.json, in the manifest schema or in compare.py counts providers, and a withdrawn one
 * keeps its entry because the wire facts in it were measured and are cheaper to re-read than to
 * re-establish.
 *
 * What was deleted with Qwen was only what could not outlive it: its `openai-images` envelope, and
 * the transposed-`size` workaround for its bug. The envelope is back below as a NEW
 * implementation of the same vendor shape, probed from scratch — the workaround is not, and none
 * of the eleven probes behind `openaiImagesBackend` found a reason for one.
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
import type { Dimensions } from '../studio/src/sizing.ts'
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
   * What this backend ACTUALLY asked the endpoint for, when that is not what the request named.
   *
   * Null for the reference provider and for every asset a provider can be asked for directly, and
   * that null is the normal case. It is non-null only where an endpoint refuses the size the asset
   * declares and the backend had to ask for a larger one — `gpt-image-2` has a minimum pixel budget
   * that the 1024x384 wordmark and the 512x512 favicon both fall under.
   *
   * It exists because the caller cannot otherwise check the one thing worth checking. `generate.ts`
   * measures the delivered bytes against what was asked for and refuses a transpose; measuring
   * 1536x576 bytes against a 1024x384 request would make that check fire on every wordmark in the
   * set and be switched off, which is how a real rotation gets through. So the backend states what
   * it asked for and the measurement is made against THAT — the check stays live, and the fact that
   * a downscale is owed becomes a piece of data on the result rather than an inference from a size.
   */
  readonly nativeRequest: Dimensions | null
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


/* ------------------------------------------------------------------ openai images */

/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * **THE MEASURED CONTRACT for `/openai/v1/images/generations` on an Azure AI Foundry AIServices
 * resource.** Eleven probe requests, serialised forty seconds apart, before one asset was
 * generated. Nothing below was read off a model card, and three of the eleven contradict what the
 * documentation for this route says.
 *
 *     POST {AZURE_IMAGES_ENDPOINT}
 *     api-key: <AZURE_IMAGES_KEY>
 *     content-type: application/json
 *     {"model":"gpt-image-2","prompt":"…","size":"1024x1024","n":1,"quality":"high"}
 *
 * An adapter of this shape existed here once and was deleted with the Qwen challenger, together
 * with that endpoint's transposed-`size` workaround. This is a new implementation of the same
 * vendor envelope: the shape is shared, the compensations are not, and none of Qwen's are here.
 *
 * 1. **`api-key`, not `Authorization: Bearer`** — the same header the other two adapters use, on a
 *    third host with a third key. Given as measured; not re-probed, because a wrong guess here is a
 *    401 rather than a silent difference.
 * 2. **`model` is REQUIRED in the body.** The route is model-agnostic, so this is the reference
 *    provider's trap arrived at from the opposite direction: there the model is in the path AND
 *    required in the body; here it is in neither the path nor optional.
 * 3. **The response carries `b64_json` ONLY.** There is no `url` field on an item, so there is no
 *    download step, no expiring link and no second request to fail. Decode and write.
 * 4. **PNG is the default.** FLUX returns JPEG unless `output_format:"png"` is sent; this does not,
 *    so nothing is sent. A JPEG brand mark has visible ringing on flat vector edges, so this was
 *    checked rather than assumed — every probe came back with a PNG signature.
 * 5. **`background:"transparent"` is REFUSED**: 400 `image_generation_user_error`, "Transparent
 *    background is not supported for this model." Irrelevant to this set, every asset of which is
 *    specified on a solid #12100f ground, and recorded so nobody spends an hour on it later.
 * 6. **`seed` is REFUSED**: 400 `unknown_parameter`. So `seed` is null on every entry in this set,
 *    exactly as it is on every FLUX entry and for the same reason — nothing true can be recorded.
 *    A disagreement between two runs of this model is anecdotal rather than reproducible, and that
 *    is a real cost of this provider rather than a missing feature of this file.
 * 7. **C2PA is present on every delivered PNG.** Measured with `measureC2pa` on the bytes; the fact
 *    is written here because it was measured, and it is never read back out of here.
 * 8. **THE SIZE CONTRACT, which is the fact that shaped the whole run.** Two rules, one of them
 *    undocumented and bisected:
 *      a. Both dimensions must be divisible by 16. The same granularity FLUX floors to, so
 *         `requestSizeFor`'s existing round-up is correct here unchanged and 1200x630 is a 400.
 *      b. There is a MINIMUM PIXEL BUDGET. 1024x384 (393,216 px), 512x512 (262,144 px) and
 *         1024x512 (524,288 px) are all "below the current minimum pixel budget"; 1024x640
 *         (655,360 px) is accepted. So the threshold is somewhere in (524,288, 655,360] and no
 *         document on this host names it. `MIN_PIXEL_BUDGET` below is the measured ACCEPTANCE
 *         rather than the lower bound, because a guessed threshold that is one pixel wrong costs
 *         a 400 per asset for the length of a run.
 *    Above the budget, arbitrary sizes are honoured EXACTLY — 1200x640, 1280x640 and 1536x576 all
 *    came back at precisely those dimensions. This deployment is not limited to the three sizes the
 *    OpenAI images API documents, which is the single most useful thing the probes established:
 *    the reference set's request sizes can mostly be replayed unchanged.
 * 9. **429 IS THE NORMAL STATE, not an incident.** AIServices S0 in Sweden Central is a shared
 *    quota. Two back-to-back requests returned 429 `RateLimitReached` with "Please retry after 32
 *    seconds" in the body. `concurrency` is 1 in providers.json and that is not caution: every
 *    parallel request that 429s still costs its own retry-after, so fanning out makes the run
 *    slower. A full set is measured in hours and that is the expected shape of it.
 * 10. **`quality` defaults to `"low"`** — 91 output tokens at 1280x640. `"high"` costs 7,024 at
 *    1024x1024 and takes ~45 s instead of ~11 s. This set is generated at `"high"`: FLUX 2 Pro's
 *    serverless deployment has no quality tier, so running the challenger at its cheap default
 *    would be scoring it against a handicap FLUX never had to accept. The tier is in `bodyFor`, so
 *    parity.test.ts asserts it rather than trusting this paragraph.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */

export interface OpenAiImagesConfig {
  /** The full generations URL, from `AZURE_IMAGES_ENDPOINT`. Never logged, never in an error. */
  readonly url: string
  readonly apiKey: string
  readonly model: string
}

/** Both dimensions must be divisible by this or the request is a 400. Measured on 1200x630. */
export const OPENAI_IMAGES_GRID = 16

/**
 * The smallest pixel count measured to be ACCEPTED, not the smallest thought to be.
 *
 * The real threshold is somewhere in (524,288, 655,360] — 1024x512 is refused and 1024x640 is
 * accepted — and it is documented nowhere on this host. Using the accepted end means the worst case
 * is generating an asset slightly larger than it strictly had to be, which costs tokens. Using the
 * refused end, or a number interpolated between them, means a 400 on every asset of a given kind
 * for the length of a run, and 768x768 (589,824 px) sits squarely in the unmeasured gap.
 */
export const MIN_PIXEL_BUDGET = 655_360

/** The quality tier every asset in this set is generated at. See fact 10; asserted by the tests. */
export const OPENAI_IMAGES_QUALITY = 'high'

/**
 * The size to actually ask for, so that a downscale to the declared size is a clean ratio.
 *
 * Returns null when the requested size can be asked for as it stands, which is the normal case and
 * the one that costs nothing. Otherwise it returns the smallest scale of the SAME ASPECT RATIO that
 * clears the pixel budget and lands both dimensions on the 16-grid.
 *
 * **Scaled, never padded and never cropped to a different shape.** A 1024x384 wordmark asked for at
 * 1024x640 would clear the budget with one fewer generation of thought and would compose the mark
 * for a frame two-thirds taller than the one it ships in; the model draws for the canvas it is
 * given. So the aspect ratio is preserved exactly and the factors are searched in order. Every
 * mapping this estate's four asset sets actually hit, all of them measured against the deployment
 * rather than derived from a model card:
 *
 *     1024x384  →  x1.5  →  1536x576   (884,736 px, both /16, exactly 8:3)
 *     1024x512  →  x1.5  →  1536x768   (1,179,648 px, both /16, exactly 2:1)
 *      768x768  →  x1.5  →  1152x1152  (1,327,104 px, both /16, exactly 1:1)
 *      512x512  →  x2    →  1024x1024  (1,048,576 px, both /16, exactly 1:1)
 *      256x512  →  x2.5  →   640x1280  (819,200 px, both /16, exactly 1:2)
 *      256x256  →  x3.5  →   896x896   (802,816 px, both /16, exactly 1:1)
 *
 * The 768x768 row is the one worth pausing on: 589,824 px sits INSIDE the unmeasured gap, so it is
 * treated as refused and scaled. That is the conservative direction on purpose — see
 * MIN_PIXEL_BUDGET — and it costs tokens where guessing the other way would cost a whole run.
 *
 * Halves are in the factor list before whole numbers because 1.5 is what makes the wordmark work
 * and produces an integer on both axes for every size this estate declares; a factor that did not
 * would be skipped by the 16-grid test rather than silently rounded, because rounding here is how
 * an aspect ratio drifts by a pixel and a downscale stops being a clean ratio.
 */
export function nativeRequestFor(width: number, height: number): Dimensions | null {
  if (width * height >= MIN_PIXEL_BUDGET) return null
  for (const factor of [1.5, 2, 2.5, 3, 3.5, 4, 5, 6]) {
    const scaledWidth = width * factor
    const scaledHeight = height * factor
    if (!Number.isInteger(scaledWidth) || !Number.isInteger(scaledHeight)) continue
    if (scaledWidth % OPENAI_IMAGES_GRID !== 0 || scaledHeight % OPENAI_IMAGES_GRID !== 0) continue
    if (scaledWidth * scaledHeight < MIN_PIXEL_BUDGET) continue
    return { width: scaledWidth, height: scaledHeight }
  }
  throw new Error(
    `no native request size exists for ${width}x${height}: no scale of that exact aspect ratio ` +
      `clears the ${MIN_PIXEL_BUDGET}px minimum with both dimensions on the ` +
      `${OPENAI_IMAGES_GRID}-pixel grid. Generating it at a different aspect ratio and cropping ` +
      'would compose the artwork for a frame it does not ship in, which is worse than not ' +
      'generating it; add a factor above only if it is an exact integer on both axes.',
  )
}

/**
 * How long to wait after a 429, read out of the response rather than guessed.
 *
 * Both sources are consulted because neither is reliable alone: the `Retry-After` header is the
 * standard and this endpoint does not always send it, and the body's "Please retry after 32
 * seconds" is what it does send. The larger of the two is taken, plus a second of slack, because
 * retrying one second early costs a whole further retry-after.
 *
 * `null` means the response was not a 429 or said nothing useful, and the caller falls back to its
 * own backoff rather than to a number invented here.
 */
export function retryAfterSeconds(headers: Headers, body: string): number | null {
  const header = Number(headers.get('retry-after'))
  const fromHeader = Number.isFinite(header) && header > 0 ? header : 0
  const match = /retry after (\d+(?:\.\d+)?)\s*second/i.exec(body)
  const fromBody = match?.[1] ? Number(match[1]) : 0
  const seconds = Math.max(fromHeader, fromBody)
  return seconds > 0 ? Math.ceil(seconds) + 1 : null
}

/**
 * The OpenAI images envelope, for `gpt-image-2` on Azure AI Foundry.
 *
 * ## Two things this function is careful about, both of which have cost this estate something
 *
 * **It never lets a credential reach a string.** The URL it posts to is itself sensitive — it names
 * the resource — and Node's `fetch` puts the whole request URL into the message of any transport
 * exception it throws. That is precisely how bitcoind's rpcauth leaked here once, and no redaction
 * rule catches it reliably because a URL is not token-shaped. So the catch below reads the
 * exception's CLASS NAME and its `cause.code`, and never its message; response bodies go through
 * `redact` before they are stored on an attempt; and nothing prints `config`.
 *
 * **It refuses to invent a per-image figure it was not given.** `providerCostUnits` carries
 * `usage.output_tokens`, which is what this provider actually meters, and `providerOutputMegapixels`
 * is null because this provider reports no megapixel figure — the delivered area is knowable from
 * the bytes and writing it into a column named for the PROVIDER's accounting would turn a
 * measurement of ours into a claim about theirs. COMPARISON.md §6 is the reason that distinction is
 * worth a null.
 */
export function openaiImagesBackend(
  provider: Provider,
  config: OpenAiImagesConfig | null = null,
  deps: {
    readonly fetch?: typeof globalThis.fetch
    readonly log?: (m: string) => void
    readonly sleep?: (ms: number) => Promise<void>
  } = {},
): ProviderBackend {
  const fetchImpl = deps.fetch ?? globalThis.fetch
  const log = deps.log ?? ((message: string) => process.stdout.write(`${message}\n`))
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))

  /** How many 429s one asset absorbs before it is reported as a failure rather than a wait. */
  const RATE_LIMIT_BUDGET = 8
  /** Used only when the response said nothing useful about when to come back. */
  const BLIND_BACKOFF_MS = 35_000

  const sizeFor = (request: GenerationRequest): Dimensions =>
    nativeRequestFor(request.requestWidth, request.requestHeight) ?? {
      width: request.requestWidth,
      height: request.requestHeight,
    }

  const bodyFor = (request: GenerationRequest): Record<string, unknown> => {
    const size = sizeFor(request)
    return {
      model: config?.model ?? 'gpt-image-2',
      // Verbatim. The whole comparison is this string being identical to what FLUX was sent.
      prompt: request.prompt,
      size: `${size.width}x${size.height}`,
      n: 1,
      quality: OPENAI_IMAGES_QUALITY,
    }
  }

  return {
    provider,
    bodyFor,

    async generate(request, signal) {
      if (!config) {
        // Names, never values. Both are read from studio/.env.local, which sources them from
        // ~/.config/cloudsforge/azure-images.env.
        throw new Error(
          `${provider.id} has no endpoint configured; set ${provider.env['endpoint']} and ` +
            `${provider.env['apiKey']} in studio/.env.local`,
        )
      }

      const native = nativeRequestFor(request.requestWidth, request.requestHeight)
      const size = native ?? { width: request.requestWidth, height: request.requestHeight }
      const body = bodyFor(request)
      const attempts: Attempt[] = []
      let rateLimited = 0

      for (;;) {
        const startedAt = Date.now()
        let response: Response
        try {
          response = await fetchImpl(config.url, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'api-key': config.apiKey },
            body: JSON.stringify(body),
            signal,
          })
        } catch (err) {
          // NEVER the message and never the object. `fetch` embeds the full request URL in it.
          const kind = err instanceof Error ? err.name : 'unknown'
          const code = (err as { cause?: { code?: string } } | null)?.cause?.code ?? '-'
          attempts.push({
            backend: 'flux',
            model: config.model,
            outcome: 'server_error',
            status: 0,
            detail: `transport ${kind} (${code})`,
            durationMs: Date.now() - startedAt,
          })
          throw new Error(`${provider.id}: transport failure ${kind} (${code})`)
        }

        // ══════════════════════════════════════════════════════════════════════════════════════
        // IN FULL, AND NOT TRUNCATED, BECAUSE THIS IS THE STRING THAT GETS PARSED.
        //
        // It read `.slice(0, 4_000)` here for exactly one pilot run, and that run threw away ten
        // generated images. A success envelope from this endpoint is around 205,000 characters —
        // it is one 154KB PNG as base64 — so `JSON.parse` was handed a string cut off in the
        // middle of `b64_json` and threw `Unterminated string in JSON at position 4000` on every
        // asset, AFTER the endpoint had generated the image and billed for it. Three retries
        // each, two assets, seventeen minutes, nothing on disk and nothing to show for it.
        //
        // The truncation was not a careless line: an attempt's `detail` is stored in the manifest
        // and an upstream error body can be enormous. It was applied at the wrong BOUNDARY. The
        // cap belongs where the string is reported, and `redact` already caps at 500 characters
        // and is called at every one of those points, so the cap is there and only there.
        //
        // The adapter this one replaces got it right by accident of structure: it read `.text()`
        // only inside `if (!response.ok)` and decoded the success path with `response.json()`.
        // One read serving both paths is better — it cannot consume the body twice — but only if
        // the read is honest about what it is for.
        // ══════════════════════════════════════════════════════════════════════════════════════
        const text = await response.text().catch(() => '')

        if (response.status === 429) {
          rateLimited += 1
          const seconds = retryAfterSeconds(response.headers, text)
          const waitMs = seconds !== null ? seconds * 1_000 : BLIND_BACKOFF_MS * rateLimited
          // Recorded as an attempt: "how many 429s did this set absorb" is a real property of this
          // provider and one of the things COMPARISON.md has to be able to answer honestly.
          attempts.push({
            // studio's BackendName union has no name for a candidate backend, the same reason the
            // adapter above gives. The MANIFEST column is not affected: `GenerationResult.backend`
            // is a plain string and this backend returns 'openai-images' there.
            backend: 'flux',
            model: config.model,
            outcome: 'rate_limited',
            status: 429,
            detail: redact(text),
            durationMs: Date.now() - startedAt,
          })
          if (rateLimited > RATE_LIMIT_BUDGET) {
            throw new Error(
              `${provider.id}: ${rateLimited} consecutive 429s on one asset. That is past the ` +
                'per-asset budget, so it is being treated as a quota that is not coming back ' +
                'rather than as a wait. Nothing is wrong with the request; the S0 quota is spent.',
            )
          }
          log(
            `    429 (${rateLimited}/${RATE_LIMIT_BUDGET}) — waiting ${Math.round(waitMs / 1000)}s` +
              `${seconds === null ? ', which the response did not specify' : ''}`,
          )
          await sleep(waitMs)
          continue
        }

        attempts.push({
          backend: 'flux', // as above: studio's union has no name for this envelope.
          model: config.model,
          outcome: response.ok ? 'ok' : response.status >= 500 ? 'server_error' : 'bad_request',
          status: response.status,
          // A successful body is a quarter of a megabyte of base64 and `redact` would store a
          // shredded fragment of it on every row. The SIZE of the envelope is the only part worth
          // keeping — it is how the truncation defect above would have been spotted in one glance
          // at the manifest — so that is what is recorded, and the failure path still keeps the
          // redacted body, which is where the wire facts in this header were all learned.
          detail: response.ok ? `ok, ${text.length} character envelope` : redact(text),
          durationMs: Date.now() - startedAt,
        })

        if (!response.ok) {
          // The body is redacted and the URL is never in it. A 400 here is a wire fact worth
          // reading — every size rule in the header above was learned from one.
          throw new Error(`${provider.id}: HTTP ${response.status} — ${redact(text)}`)
        }

        const payload = JSON.parse(text) as {
          data?: { b64_json?: string }[]
          usage?: { output_tokens?: number }
        }
        const b64 = payload.data?.[0]?.b64_json
        if (!b64) {
          // Measured fact 3: there is no `url` fallback to try. If b64_json is absent the response
          // shape has changed, and guessing at a second field would write a zero-byte PNG.
          throw new Error(
            `${provider.id}: the response carries no data[0].b64_json. This endpoint returns ` +
              'base64 only — there is no url field to fall back to — so the response shape has ' +
              'changed and the decode path needs re-establishing before another asset is paid for.',
          )
        }
        const bytes = Buffer.from(b64, 'base64')

        return {
          bytes,
          backend: 'openai-images',
          model: config.model,
          c2pa: measureC2pa(bytes),
          // What this provider actually meters. Not comparable with FLUX's image units and never
          // added to them; compare.py branches on billing.basis, not on the unit string.
          providerCostUnits: payload.usage?.output_tokens ?? null,
          // Null on purpose: this provider reports no megapixel figure. The delivered area is
          // knowable from the bytes, and putting our measurement in a column named for theirs
          // would turn it into a claim they did not make.
          providerOutputMegapixels: null,
          // Measured fact 6: `seed` is an unknown_parameter here, so there is no seed to record.
          seed: null,
          nativeRequest: native,
          attempts,
        }
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
        // The reference asks for exactly what it was told to ask for. Every declared size in this
        // set clears whatever minimum this endpoint has, so there is never a native to downscale.
        nativeRequest: null,
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

  if (provider.adapter === 'openai-images') {
    // Same rule as Managed Compute: a missing credential yields a backend with no config rather
    // than an exception, so the seam stays constructible in a test that never opens a socket. It
    // refuses at generate time, with the variable NAMES and nothing else.
    //
    // `endpoint` here is the FULL generations URL rather than a base to append a path to, because
    // that is the shape the credential file holds and re-deriving a route from a host is how the
    // reference provider lost an hour to a 404 on a near-miss path.
    const config: OpenAiImagesConfig | null =
      endpoint && apiKey ? { url: endpoint, apiKey, model: 'gpt-image-2' } : null
    return openaiImagesBackend(provider, config)
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
