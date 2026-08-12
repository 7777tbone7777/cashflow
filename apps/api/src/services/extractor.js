/**
 * Client for the extractor service.
 *
 * The extractor owns reading a budget and generating documents from it; this
 * app owns the database and the web layer. They talk over Railway's private
 * network, so EXTRACTOR_URL is an internal address in production and a
 * localhost one in development.
 */

const BASE_URL = process.env.EXTRACTOR_URL || 'http://127.0.0.1:8000';

// Extraction reads a whole PDF, so it is slower than a normal request. The
// reference 72-page budget takes about ten seconds.
const EXTRACT_TIMEOUT_MS = 180_000;
const GENERATE_TIMEOUT_MS = 120_000;

export class ExtractorError extends Error {
  constructor(message, status, detail) {
    super(message);
    this.name = 'ExtractorError';
    this.status = status;
    this.detail = detail;
  }
}

async function call(path, { body, headers = {}, timeout = GENERATE_TIMEOUT_MS, raw = false }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  let response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      body,
      headers,
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timer);
    if (error.name === 'AbortError') {
      throw new ExtractorError(`Extractor timed out after ${timeout / 1000}s`, 504);
    }
    // A connection failure here is an operational problem, not a bad document,
    // so say which service is unreachable rather than surfacing ECONNREFUSED.
    throw new ExtractorError(
      `Could not reach the extractor service at ${BASE_URL}. ${error.message}`, 502);
  }
  clearTimeout(timer);

  if (!response.ok) {
    let detail;
    try {
      const payload = await response.json();
      detail = payload?.detail ?? payload;
    } catch {
      detail = await response.text().catch(() => response.statusText);
    }
    const message = typeof detail === 'string' ? detail : (detail?.error || 'Extractor rejected the request');
    throw new ExtractorError(message, response.status, detail);
  }

  return raw ? response : response.json();
}

/** Budget PDF -> structured JSON, with production type and what it still needs. */
export async function extractBudget({ buffer, filename }) {
  const form = new FormData();
  form.append('budget', new Blob([buffer]), filename || 'budget.pdf');
  return call('/extract', { body: form, timeout: EXTRACT_TIMEOUT_MS });
}

/** Budget + config -> pre-populated hot cost day sheets, as an xlsx stream. */
export async function generateHotCost({ budget, config }) {
  const form = new FormData();
  form.append('budget_json', JSON.stringify(budget));
  form.append('production_json', JSON.stringify(config));
  return call('/generate/hotcost', { body: form, raw: true });
}

/** Budget + config -> a weekly grid, or a 422 explaining why it will not emit one. */
export async function generateCashflow({ budget, config, archetypes = null, overrides = null, force = false }) {
  const form = new FormData();
  form.append('budget_json', JSON.stringify(budget));
  form.append('production_json', JSON.stringify(config));
  form.append('archetypes_json', JSON.stringify(archetypes));
  form.append('overrides_json', JSON.stringify(overrides));
  form.append('force', String(force));
  return call('/generate/cashflow', { body: form });
}

/** Completed cash flows -> observed spread profiles per account. */
export async function learnArchetypes(files) {
  const form = new FormData();
  for (const file of files) {
    form.append('cashflows', new Blob([file.buffer]), file.filename);
  }
  return call('/learn', { body: form, timeout: EXTRACT_TIMEOUT_MS });
}

export async function extractorHealth() {
  try {
    const response = await fetch(`${BASE_URL}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    return response.ok ? { ok: true, url: BASE_URL } : { ok: false, url: BASE_URL, status: response.status };
  } catch (error) {
    return { ok: false, url: BASE_URL, error: error.message };
  }
}
