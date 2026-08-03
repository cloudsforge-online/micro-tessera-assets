/**
 * Ask a Managed Compute deployment what it is and what it wants, without guessing anything.
 *
 *   cd ../studio && node --import tsx ../brand/probe.ts --provider cosmos-3-super
 *   cd ../studio && node --import tsx ../brand/probe.ts --provider cosmos-3-super --wait
 *
 * ## Why this exists rather than a hand-written curl
 *
 * Two questions have to be answered before a single asset is generated, and both of them have
 * answers the endpoint will give you if you ask correctly.
 *
 * **1. Which state is this deployment in?** Four answers, and they look alike in a terminal while
 * meaning completely different things — `404 DeploymentNotFound` (the name is wrong), `500 Model
 * service is unavailable` (it exists, the A100 is loading weights, wait), `400
 * BadRequestForDependentService` (the gateway reached the model service and it rejected our body,
 * which is the GOOD state) and a 400 naming a missing field (also good, and it is the schema
 * arriving). Getting that wrong is expensive in a way it is not on the reference provider, because
 * this deployment bills for every hour it exists whether it serves anything or not: an afternoon
 * spent debugging a name against a container that was simply still loading is an afternoon on the
 * invoice.
 *
 * **2. What does the request body look like?** There is no schema to read:
 * `/managed-deployments/<name>/swagger.json` is 404 even with a valid key. But a schema-validating
 * endpoint answers with the field it wanted, one at a time, and that reply is a measurement rather
 * than a guess — posting `{}` produced `400 Missed model deployment`, which is how `model` came to
 * be the one body field this repository asserts. So this posts only what the server has already
 * named and prints, verbatim and redacted, whatever it says it wants next.
 *
 * **It never posts a candidate body.** The point of the seam in `backends.ts` is that nobody bakes
 * in a plausible request shape that returns 200 while meaning something slightly different; a
 * probe that started trying `{"prompt": ...}`, `{"input": ...}`, `{"messages": ...}` in turn until
 * one worked would be doing exactly that, one HTTP call at a time. Read what the server says, then
 * implement `bodyFor` deliberately.
 *
 * ## Credentials
 *
 * `FOUNDRY2_BASE_URL` and `FOUNDRY2_API_KEY` out of the gitignored `studio/.env.local`. The key is
 * used in one place — the `api-key` header — and every line this script prints goes through
 * `redact` first. `Authorization: Bearer` is a measured 401 on this host and is not offered.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { providerById, PROVIDERS } from './providers.ts'
import {
  redact,
  scoringUri,
  managedHeaders,
  isWarming,
  MODEL_FIELD,
  modelValueFor,
  WARMING,
  type ManagedComputeConfig,
} from './backends.ts'

const ENV_FILE = join(import.meta.dirname, '..', 'studio', '.env.local')

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

type State = 'absent' | 'warming' | 'serving' | 'unauthorised' | 'unreachable'

interface Observation {
  readonly state: State
  readonly status: number | null
  readonly body: string
}

/**
 * One POST, and what its answer means.
 *
 * The payload is the minimum the server has already told us it requires: `{"model": "<deployment
 * name>"}`. That is not a guessed body — posting `{}` first produced `400 Missed model deployment`,
 * which named the field, and posting the deployment name as its value produced a 500 rather than
 * a 404, which confirmed the value. Anything beyond that is still unknown and is not sent.
 *
 * The four answers this host gives are genuinely different situations that look alike in a
 * terminal, and the first version of this function got the first two the wrong way round:
 *
 *     400 "Missed model deployment"   the body is missing a required field — the endpoint is FINE
 *     404 DeploymentNotFound          the `model` value names nothing on this host
 *     500 "Model service unavailable" it exists, the A100 is still loading weights: WAIT
 *     400 anything else               a serving endpoint rejecting our body, and the reply is the
 *                                     schema hint this whole script exists to collect
 */
async function observe(config: ManagedComputeConfig, path: string): Promise<Observation> {
  const url = `${config.baseUrl.replace(/\/+$/, '')}${path}`
  const payload: Record<string, unknown> = { [MODEL_FIELD]: modelValueFor(config) }
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: managedHeaders(config),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60_000),
    })
  } catch (err) {
    return { state: 'unreachable', status: null, body: redact(err instanceof Error ? err.message : String(err)) }
  }
  const body = redact((await response.text().catch(() => '')).slice(0, 4_000))

  if (response.status === 401 || response.status === 403) return { state: 'unauthorised', status: response.status, body }
  if (isWarming(response.status, body)) return { state: 'warming', status: response.status, body }
  // DeploymentNotFound is the one that means the NAME is wrong. A 400 naming a missing body field
  // is the opposite: the endpoint is there and is telling us what it wants.
  if (/DeploymentNotFound|deployment for this resource does not exist/i.test(body)) {
    return { state: 'absent', status: response.status, body }
  }
  if (response.status === 404) return { state: 'absent', status: 404, body }
  return { state: 'serving', status: response.status, body }
}

const EXPLAIN: Record<State, string> = {
  absent: 'the `model` value names no deployment on this host — check `deployment` in '
    + 'providers.json. Note that the value is the DEPLOYMENT name (qwen--qwen-image-2512), not the '
    + "model's catalogue name (Qwen-Image-2512), which is a measured 404. This is the state seven "
    + 'of the eight FLUX model names probed on the reference resource were in, so it is a real '
    + 'possibility rather than a formality, especially where deploymentVerified is false.',
  warming: 'the deployment EXISTS and is loading weights onto the A100. Wait; do not change '
    + 'anything. The clock is already running, so this is billed time either way.',
  serving: 'the deployment is answering. If the body below names a field it expected, that is the '
    + 'schema arriving one field at a time — add it in backends.ts, re-run this, and repeat until '
    + 'it stops complaining. Implement bodyFor from what it said, not from what the route implies.',
  unauthorised: 'the key was refused. Check FOUNDRY2_API_KEY in studio/.env.local, and note that '
    + '`Authorization: Bearer` is a measured 401 on this host — only `api-key` works.',
  unreachable: 'no answer at all. A transport fault, a wrong host, or a timeout.',
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const valueOf = (flag: string): string | null => {
    const index = argv.indexOf(flag)
    return index >= 0 && argv[index + 1] ? argv[index + 1]! : null
  }
  const wait = argv.includes('--wait')
  const wanted = valueOf('--provider')
  await loadEnvFile(ENV_FILE)

  const targets = PROVIDERS.filter(
    (p) => p.adapter === 'foundry-managed-compute' && (!wanted || p.id === wanted),
  )
  if (wanted && targets.length === 0) providerById(wanted) // throws with the registered ids.

  for (const provider of targets) {
    const baseUrl = (process.env[provider.env['endpoint'] ?? ''] ?? '').trim()
    const apiKey = (process.env[provider.env['apiKey'] ?? ''] ?? '').trim()
    if (!baseUrl || !apiKey) {
      process.stdout.write(
        `${provider.id}: ${provider.env['endpoint']} and ${provider.env['apiKey']} are not set in ` +
          'studio/.env.local\n',
      )
      continue
    }
    const config: ManagedComputeConfig = {
      baseUrl,
      apiKey,
      deployment: provider.deployment ?? '',
      route: provider.route ?? '',
    }

    process.stdout.write(`\n===== ${provider.id} (${provider.label})\n`)
    process.stdout.write(`deployment ${config.deployment}`)
    process.stdout.write(provider.deploymentVerified ? ' (verified)\n' : ' (NOT VERIFIED — an assumption)\n')
    // The host is printed; the key never is, and the URL carries no credential.
    process.stdout.write(`POST ${scoringUri(config)}\n`)

    for (;;) {
      const observation = await observe(config, config.route.replace('{deployment}', config.deployment))
      process.stdout.write(`\n  state   ${observation.state.toUpperCase()} (HTTP ${observation.status ?? '-'})\n`)
      process.stdout.write(`  meaning ${EXPLAIN[observation.state]}\n`)
      process.stdout.write(`  body    ${observation.body || '(empty)'}\n`)

      if (observation.state === 'serving') {
        // The sibling route exists on this host too and one of the two is the image route. Which
        // one is not established, so both are reported rather than one being assumed.
        const sibling = config.route.replace('/v1/chat/completions', '/v1/messages')
        if (sibling !== config.route) {
          const other = await observe(config, sibling.replace('{deployment}', config.deployment))
          process.stdout.write(
            `\n  sibling /v1/messages: ${other.state.toUpperCase()} (HTTP ${other.status ?? '-'})\n` +
              `  body    ${other.body || '(empty)'}\n`,
          )
        }
        process.stdout.write(
          '\n  NEXT: if either body above names the fields it expected, that is the schema. ' +
            'Implement bodyFor() in backends.ts from it, assert in parity.test.ts that the prompt ' +
            'reaches it verbatim, and only then run generate.ts.\n',
        )
        break
      }
      if (!wait || observation.state !== 'warming') break
      process.stdout.write(`  waiting ${WARMING.pollMs / 1000}s\n`)
      await new Promise((resolve) => setTimeout(resolve, WARMING.pollMs))
    }
  }
}

await main()
