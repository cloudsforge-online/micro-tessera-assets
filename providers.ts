/**
 * The TypeScript half of the provider registry. Reads the same `providers.json` `providers.py`
 * reads, so the two halves cannot disagree about where a set lives or what it costs.
 *
 * Nothing here knows how to CALL a provider — that is `backends.ts`. This file only answers "which
 * providers exist, which one is the reference, and which files belong to each", which is the
 * question every tool in the repository has to answer before it can do anything at all.
 */

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const HERE = import.meta.dirname

export type AdapterKind =
  | 'foundry-serverless'
  /** `/managed-deployments/<name>/v1/chat/completions`. Real, on another host; see backends.ts. */
  | 'foundry-managed-compute'
  /**
   * `/openai/v1/images/generations` on an Azure AI Foundry AIServices resource — the OpenAI images
   * envelope, `api-key` auth, `b64_json` in the response and no `url` field.
   *
   * This member existed once before and was deleted with the Qwen challenger, along with that
   * endpoint's transposed-`size` workaround. It is back because a second model is on trial again,
   * and it is a DIFFERENT implementation of the same shape: the envelope is the vendor's, the bugs
   * being compensated for are not. See `openaiImagesBackend` in backends.ts for the measured
   * contract, all of which was established by probing rather than read off a model card.
   */
  | 'openai-images'

/**
 * Whether a provider can be run against at all.
 *
 * `withdrawn` is not `implemented: false`. An unimplemented backend is one whose wire shape is not
 * known yet; a withdrawn one is a deployment that no longer exists. Cosmos 3 Super failed to come
 * up on A100_80GB and was deleted, and its entry is kept complete rather than removed — the estate
 * has a stated 3D/animation gap FLUX cannot fill (docs/ecosystem/19-new-products.md), so a third
 * model is a question of when. Nothing in this repository counts providers or assumes there are
 * two: the registry is the list, and `live()` is the subset that can be run.
 */
export type ProviderStatus = 'live' | 'withdrawn'

export interface ProviderBilling {
  /** The unit this model actually bills in. Never converted; see COMPARISON.md §6. */
  readonly unit: string
  readonly basis: string
  readonly source: string
  readonly sku: string | null
  readonly hourlyRate: number | null
}

export interface Provider {
  readonly id: string
  readonly label: string
  readonly vendor: string
  readonly adapter: AdapterKind
  /**
   * Which prompt dialect this set was generated in — `dialects.json`, read through `dialects.ts`.
   *
   * `adapter` says how a set was POSTED; this says what was posted. Two providers may share a
   * deployment, a route, a key and a model and still be two different experiments — identical in
   * every wire fact, different in this one field. The registry held exactly such a pair while the
   * Qwen challenger was on trial; both entries went when the owner withdrew that model, and the
   * machinery that made the pair expressible is kept because the next challenger will need it.
   *
   * Parity is enforced WITHIN a dialect and re-derived ACROSS dialects; see `dialects.ts`'s header
   * for why that is stronger than the plain equality it replaces, rather than weaker.
   */
  readonly dialect: string
  /** Absolute. `assets/` and `MANIFEST.json` hang off this. */
  readonly root: string
  readonly status: ProviderStatus
  readonly shipped: boolean
  /** False for a backend that is still a stub. `backendFor` throws rather than guessing a body. */
  readonly implemented: boolean
  readonly concurrency: number
  readonly env: Readonly<Record<string, string>>
  readonly billing: ProviderBilling
  /**
   * Managed Compute only: the deployment name that goes in the route. One host serves both
   * candidates, so the name is what distinguishes them.
   */
  readonly deployment?: string
  /**
   * False where the deployment name above is an assumption rather than a measured fact. Seven of
   * the eight FLUX model names probed on the reference resource answered 404, so an unverified
   * name is a real risk and not a formality. `probe.ts` is what turns this true.
   */
  readonly deploymentVerified?: boolean
  /** `/managed-deployments/{deployment}/v1/chat/completions`. */
  readonly route?: string
}

interface RegistryDocument {
  readonly reference: string
  readonly providers: ReadonlyArray<Omit<Provider, 'root'> & { readonly root: string }>
}

const document = JSON.parse(readFileSync(join(HERE, 'providers.json'), 'utf8')) as RegistryDocument

export const PROVIDERS: readonly Provider[] = document.providers.map((raw) => ({
  ...raw,
  root: resolve(HERE, raw.root),
}))

export function providerById(id: string): Provider {
  const found = PROVIDERS.find((p) => p.id === id)
  if (!found) {
    throw new Error(
      `unknown provider "${id}"; providers.json registers: ${PROVIDERS.map((p) => p.id).join(', ')}`,
    )
  }
  return found
}

/**
 * The provider every other set is judged against — and, more importantly, the one whose recorded
 * prompts a candidate run REPLAYS rather than recomputes. See generate.ts's prompt-parity header.
 */
export const REFERENCE: Provider = providerById(document.reference)

/** Every provider that can actually be run against today. Never a hardcoded pair. */
export const live = (): readonly Provider[] => PROVIDERS.filter((p) => p.status === 'live')

/**
 * The providers sharing one dialect — the group parity is asserted over.
 *
 * This is the seam that lets a second prompt dialect exist without weakening the guarantee the
 * comparison rests on. Before there was one implicit group containing every provider; there are now
 * N explicit ones, each holding the same property, and no code anywhere assumes a group has one
 * member or that there is one group.
 */
export const inDialect = (dialect: string): readonly Provider[] =>
  PROVIDERS.filter((p) => p.dialect === dialect)

/** Every dialect at least one registered provider is actually generated in. */
export const dialectsInUse = (): readonly string[] => [...new Set(PROVIDERS.map((p) => p.dialect))]

export class ProviderWithdrawnError extends Error {
  constructor(provider: Provider) {
    super(
      `${provider.id} is withdrawn: its deployment no longer exists, so there is nothing to run ` +
        'against. Its registry entry is kept because the wire facts in it were measured and are ' +
        'cheaper to re-read than to re-establish. Redeploy it and set status to "live".',
    )
    this.name = 'ProviderWithdrawnError'
  }
}

export const assetsDirOf = (provider: Provider): string => join(provider.root, 'assets')
export const manifestPathOf = (provider: Provider): string => join(provider.root, 'MANIFEST.json')
