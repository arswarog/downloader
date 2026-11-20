#!/usr/bin/env node
/**
 * speedtest.mjs — downloads a URL 10 times sequentially, reading every response
 * body to the end, and reports total volume, average request time and aggregate
 * download speed.
 *
 * Requires Node.js >= 18 (global fetch, Web Streams, performance).
 */

import { STATUS_CODES } from 'node:http';

const RUNS = 10;
const MIB = 1024 ** 2;
const MB = 1e6;
const LABEL_WIDTH = 12;

function usage() {
  console.log(`Usage: node speedtest.mjs <url> [-v|--verbose] [-h|--help]

Downloads <url> ${RUNS} times sequentially, reading every response body to the end,
then prints aggregated download speed.

Options:
  -v, --verbose  print one line per completed request
  -h, --help     show this help

Exit codes:
  0  all ${RUNS} requests succeeded
  2  partial success (at least one request failed)
  1  fatal error: bad arguments, or no successful requests`);
}

function fail(message) {
  console.error(`speedtest: ${message}`);
  console.error('run with --help for usage');
  process.exit(1);
}

function parseArgs(argv) {
  let url = null;
  let verbose = false;

  for (const arg of argv) {
    if (arg === '-h' || arg === '--help') {
      usage();
      process.exit(0);
    } else if (arg === '-v' || arg === '--verbose') {
      verbose = true;
    } else if (arg.startsWith('-')) {
      fail(`unknown option: ${arg}`);
    } else if (url === null) {
      url = arg;
    } else {
      fail(`unexpected argument: ${arg}`);
    }
  }

  if (url === null) fail('missing <url>');

  let target;
  try {
    target = new URL(url);
  } catch {
    fail(`invalid URL: ${url}`);
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    fail(`unsupported protocol ${target.protocol} (only http and https)`);
  }

  return { target, verbose };
}

/** One request: full body read, byte count, wall time. */
async function measure(url) {
  const started = performance.now();
  try {
    const res = await fetch(url);
    if (!res.ok) {
      await res.body?.cancel();
      const text = res.statusText || STATUS_CODES[res.status] || '';
      return { ok: false, error: `HTTP ${res.status}${text ? ` ${text}` : ''}` };
    }

    let bytes = 0;
    if (res.body) {
      // Chunks are counted and dropped, so memory use does not depend on body size.
      for await (const chunk of res.body) bytes += chunk.byteLength;
    }
    return { ok: true, bytes, ms: performance.now() - started };
  } catch (err) {
    const code = err?.cause?.code ?? err?.cause?.message;
    return { ok: false, error: `${err?.message ?? err}${code ? ` (${code})` : ''}` };
  }
}

function formatBytes(bytes) {
  return `${(bytes / MIB).toFixed(2)} MiB`;
}

function formatSpeed(bytes, ms) {
  if (ms <= 0) return 'n/a';
  const bytesPerSecond = bytes / (ms / 1000);
  return `${(bytesPerSecond / MIB).toFixed(2)} MiB/s (${(bytesPerSecond / MB).toFixed(2)} MB/s)`;
}

function printSummary(target, results, totalBytes, totalMs) {
  const label = (text) => text.padEnd(LABEL_WIDTH);

  console.log(`${label('URL:')} ${target.href}`);
  console.log(`${label('Runs:')} ${RUNS} (sequential)`);
  console.log('');
  console.log(`${label('Total:')} ${formatBytes(totalBytes)}`);
  console.log(`${label('Wall time:')} ${(totalMs / 1000).toFixed(3)} s`);
  console.log(`${label('Avg request:')} ${Math.round(totalMs / results.length)} ms`);
  console.log(`${label('Speed:')} ${formatSpeed(totalBytes, totalMs)}`);
  console.log(`${label('Succeeded:')} ${results.length}/${RUNS}`);
}

async function main() {
  const { target, verbose } = parseArgs(process.argv.slice(2));
  const results = [];

  for (let i = 1; i <= RUNS; i++) {
    const label = `#${String(i).padStart(2, '0')}`;
    const result = await measure(target.href);
    if (result.ok) {
      results.push(result);
      if (verbose) console.log(`${label}  ${formatBytes(result.bytes)}  ${Math.round(result.ms)} ms`);
    } else {
      console.error(`${label} failed: ${result.error}`);
    }
  }

  if (results.length === 0) {
    console.error(`speedtest: no successful requests out of ${RUNS}`);
    process.exitCode = 1;
    return;
  }

  const totalBytes = results.reduce((sum, r) => sum + r.bytes, 0);
  const totalMs = results.reduce((sum, r) => sum + r.ms, 0);

  if (verbose) console.log('');
  printSummary(target, results, totalBytes, totalMs);
  if (totalBytes === 0) console.error('speedtest: warning: total body size is 0 bytes');

  process.exitCode = results.length === RUNS ? 0 : 2;
}

await main();
