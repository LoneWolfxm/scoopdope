#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const currentFile = process.argv[2];
const baselineFile = process.argv[3];
const updateBaseline = process.argv.includes('--update-baseline');

if (!currentFile || !fs.existsSync(currentFile)) {
  console.error('Usage: compare-performance.js <current.json> <baseline.json> [--update-baseline]');
  process.exit(1);
}

const current = JSON.parse(fs.readFileSync(currentFile, 'utf8'));
const baseline = baselineFile && fs.existsSync(baselineFile)
  ? JSON.parse(fs.readFileSync(baselineFile, 'utf8'))
  : null;

// Determine whether the current run contains at least one successful (200) response.
// This guards against wrong-path (all-404) runs being recorded as a new baseline.
function countSuccessfulResponses(result) {
  if (!result || typeof result !== 'object') {
    return 0;
  }

  // Preferred: explicit success counter emitted by the load test scripts.
  if (typeof result.successful_responses === 'number') {
    return result.successful_responses;
  }

  // Fallback: derive from a status-code breakdown if present.
  const statusCodes = result.status_codes || result.statusCodes;
  if (statusCodes && typeof statusCodes === 'object') {
    return Number(statusCodes['200'] || statusCodes[200] || 0);
  }

  // Fallback: derive from a metrics object containing http_req_* counters.
  const metrics = result.metrics || {};
  if (typeof metrics.successful_responses === 'number') {
    return metrics.successful_responses;
  }
  if (typeof metrics.http_reqs_200 === 'number') {
    return metrics.http_reqs_200;
  }

  return 0;
}

const successfulResponses = countSuccessfulResponses(current);

if (successfulResponses <= 0) {
  console.error(
    'ERROR: Current performance results contain no successful (200) responses. ' +
    'This usually indicates the load tests targeted the wrong API path (e.g. missing /api/v1 prefix). ' +
    'Refusing to compare or update the baseline.'
  );
  process.exit(1);
}

const comparison = {
  timestamp: new Date().toISOString(),
  successful_responses: successfulResponses,
  current_metrics: current.metrics,
  baseline_metrics: baseline?.metrics || {},
  metrics: {},
};

Object.keys(current.metrics || {}).forEach(metric => {
  const currentValue = current.metrics[metric];
  const baselineValue = baseline?.metrics?.[metric] || currentValue;
  
  comparison.metrics[metric] = {
    baseline: baselineValue,
    current: currentValue,
    change: currentValue - baselineValue,
    change_percent: baselineValue > 0 ? ((currentValue - baselineValue) / baselineValue) * 100 : 0,
  };
});

if (updateBaseline) {
  if (!baselineFile) {
    console.error('ERROR: --update-baseline requires a baseline file path.');
    process.exit(1);
  }

  const baselineDir = path.dirname(baselineFile);
  if (baselineDir && !fs.existsSync(baselineDir)) {
    fs.mkdirSync(baselineDir, { recursive: true });
  }

  fs.writeFileSync(baselineFile, JSON.stringify(current, null, 2) + '\n');
  console.error(`Baseline updated: ${baselineFile}`);
}

process.stdout.write(JSON.stringify(comparison, null, 2) + '\n');