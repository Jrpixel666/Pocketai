// Rough, zero-network fit estimate for live HuggingFace search results.
// Search results carry no file sizes or param counts (those need a per-model
// detail call), so this infers an order-of-magnitude parameter count from the
// common "<N>B" naming convention in the repo id and compares a 4-bit-quant
// size estimate against a conservative slice of device RAM. It's a sort/hint
// signal for picking among search results, not the precise estimate
// `memoryEstimator.ts` produces once a model's real GGUF metadata is known.

import {HuggingFaceModel} from './types';

// Matches "7B", "13b", "3.8B" and MoE naming like "8x7B" (captured separately
// so total weight count can be reconstructed as experts * per-expert size).
const MOE_PARAM_RE =
  /(\d+(?:\.\d+)?)\s*[xX]\s*(\d+(?:\.\d+)?)\s*[bB](?:illion)?\b/;
const PARAM_RE = /(\d+(?:\.\d+)?)\s*[bB](?:illion)?\b/;

// Repo ids come straight from the HF API response; TypeScript's `string`
// type is a compile-time promise only; a malformed or truncated payload can
// still hand this a non-string at runtime, and `.split`/`.match` on that
// would throw. Treat anything that isn't a usable string as "can't estimate"
// rather than letting it propagate.
export function estimateParamsBillionFromModelId(
  modelId: string,
): number | null {
  if (typeof modelId !== 'string' || modelId.length === 0) {
    return null;
  }
  const name = modelId.split('/').pop() ?? modelId;
  const moeMatch = name.match(MOE_PARAM_RE);
  if (moeMatch) {
    // "8x7B": 8 experts of ~7B each. Active params at inference are lower,
    // but the quantized file still has to hold every expert, so total count
    // is what gates whether it fits on disk/RAM.
    const params = parseFloat(moeMatch[1]) * parseFloat(moeMatch[2]);
    return isSaneParamCount(params) ? params : null;
  }
  const match = name.match(PARAM_RE);
  if (!match) {
    return null;
  }
  const params = parseFloat(match[1]);
  return isSaneParamCount(params) ? params : null;
}

// Guards against a nonsensical parse feeding bogus numbers into the byte-size
// math below (e.g. a regex quirk yielding 0 or an absurdly large value) —
// not a crash risk by itself (JS arithmetic never throws on this), but it
// keeps "fits"/"tooLarge" from being decided by a meaningless number.
function isSaneParamCount(paramsBillion: number): boolean {
  return (
    Number.isFinite(paramsBillion) && paramsBillion > 0 && paramsBillion <= 3000
  );
}

// ~4-bit quantization (Q4_K_M-class), the common default for on-device GGUF,
// plus headroom for the KV cache and runtime buffers.
const BYTES_PER_PARAM_Q4 = 0.6;
const RUNTIME_HEADROOM = 1.25;

export function estimateQuantizedModelBytes(paramsBillion: number): number {
  return paramsBillion * 1e9 * BYTES_PER_PARAM_Q4 * RUNTIME_HEADROOM;
}

// Mobile OSes reserve a large, device-dependent slice of RAM for themselves;
// only treat a conservative fraction of total RAM as available to the model.
const USABLE_RAM_FRACTION = 0.55;
// Within the usable budget, leave a further margin before calling a fit
// "comfortable" rather than merely "possible".
const COMFORTABLE_FRACTION = 0.8;

export type DeviceFit = 'fits' | 'tight' | 'tooLarge' | 'unknown';

export function estimateDeviceFit(
  modelId: string,
  ramBytes: number | null,
): {paramsBillion: number | null; fit: DeviceFit} {
  const paramsBillion = estimateParamsBillionFromModelId(modelId);
  // A zero/negative/non-finite reading (a bad native-module response, a
  // mocked value in tests, ...) must not silently become a zero budget —
  // that would mark every model "tooLarge" instead of admitting we don't
  // know, which is the whole point of the "unknown" bucket.
  if (
    paramsBillion === null ||
    ramBytes === null ||
    !Number.isFinite(ramBytes) ||
    ramBytes <= 0
  ) {
    return {paramsBillion, fit: 'unknown'};
  }
  const estimatedBytes = estimateQuantizedModelBytes(paramsBillion);
  const budget = ramBytes * USABLE_RAM_FRACTION;
  if (estimatedBytes > budget) {
    return {paramsBillion, fit: 'tooLarge'};
  }
  return {
    paramsBillion,
    fit: estimatedBytes <= budget * COMFORTABLE_FRACTION ? 'fits' : 'tight',
  };
}

// Sorts device-fit-aware results: comfortable fits first, then tight fits,
// then unknown-size entries, then models likely too large for this device.
// Stable within each bucket, so it keeps the server's relevance ordering.
export function sortByDeviceFit(
  models: HuggingFaceModel[],
  ramBytes: number | null,
): HuggingFaceModel[] {
  if (!Array.isArray(models)) {
    return [];
  }
  const rank: Record<DeviceFit, number> = {
    fits: 0,
    tight: 1,
    unknown: 2,
    tooLarge: 3,
  };
  return models
    .map(model => ({
      model,
      fit: model ? estimateDeviceFit(model.id, ramBytes).fit : 'unknown',
    }))
    .sort((a, b) => rank[a.fit] - rank[b.fit])
    .map(({model}) => model);
}

// Curated keywords covering the common HF naming conventions for models
// fine-tuned to remove refusal/safety behavior (ablation, "decensoring",
// etc). Matched against the repo id and, when present, tags.
export const UNCENSORED_SEARCH_TERMS = [
  'uncensored',
  'abliterated',
  'unfiltered',
];

const UNCENSORED_TAGS = ['not-for-all-audiences', 'uncensored'];

export function looksUncensored(model: HuggingFaceModel): boolean {
  if (!model || typeof model.id !== 'string') {
    return false;
  }
  const id = model.id.toLowerCase();
  if (UNCENSORED_SEARCH_TERMS.some(term => id.includes(term))) {
    return true;
  }
  const tags = Array.isArray(model.tags) ? model.tags : [];
  return tags.some(
    tag =>
      typeof tag === 'string' && UNCENSORED_TAGS.includes(tag.toLowerCase()),
  );
}
