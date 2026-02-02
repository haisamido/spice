/**
 * Test Setup and Utilities
 *
 * Shared utilities for test result writing and summary generation.
 */

import { writeFileSync, readdirSync, existsSync, readFileSync, mkdirSync } from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';
import { afterAll } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Test result summary entry
 */
interface TestResultEntry {
  suite: string;
  file: string;
  path: string;
  timestamp: string;
  testCount?: number;
}

/**
 * Generate a markdown table row
 */
function tableRow(cells: string[]): string {
  return `| ${cells.join(' | ')} |`;
}

/**
 * Generate the test results summary README.md
 */
export function generateTestResultsSummary(): void {
  const testsDir = __dirname;
  const results: TestResultEntry[] = [];

  // Scan all subdirectories for results
  const subdirs = readdirSync(testsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .map((d) => d.name);

  for (const subdir of subdirs) {
    const resultsDir = join(testsDir, subdir, 'results');
    if (!existsSync(resultsDir)) continue;

    const files = readdirSync(resultsDir).filter((f) => f.endsWith('.json'));

    for (const file of files) {
      const filepath = join(resultsDir, file);
      try {
        const content = JSON.parse(readFileSync(filepath, 'utf-8'));
        results.push({
          suite: content.suite || subdir,
          file: file,
          path: relative(testsDir, filepath),
          timestamp: content.timestamp || 'N/A',
          testCount: content.tests ? Object.keys(content.tests).length : undefined,
        });
      } catch {
        // Skip invalid JSON files
      }
    }
  }

  // Generate README content
  const lines: string[] = [
    '# Test Results Summary',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Results by Test Suite',
    '',
    tableRow(['Suite', 'Result File', 'Tests', 'Timestamp']),
    tableRow(['---', '---', '---', '---']),
  ];

  for (const result of results) {
    lines.push(
      tableRow([
        result.suite,
        `[${result.file}](${result.path})`,
        result.testCount?.toString() || '-',
        result.timestamp,
      ])
    );
  }

  lines.push('');
  lines.push('## Test Directories');
  lines.push('');

  for (const subdir of subdirs) {
    const resultsDir = join(testsDir, subdir, 'results');
    if (existsSync(resultsDir)) {
      lines.push(`- [${subdir}/](${subdir}/)`);
      lines.push(`  - [results/](${subdir}/results/)`);
    }
  }

  lines.push('');

  // Write README
  writeFileSync(join(testsDir, 'README.md'), lines.join('\n'));
}

/**
 * Create a results directory for a test suite
 */
export function createResultsDir(testFilePath: string): string {
  const testDir = dirname(testFilePath);
  const resultsDir = join(testDir, 'results');
  mkdirSync(resultsDir, { recursive: true });
  return resultsDir;
}

/**
 * Write test results to JSON file
 */
export function writeTestResults(
  resultsDir: string,
  filename: string,
  data: Record<string, unknown>
): void {
  const filepath = join(resultsDir, filename);
  writeFileSync(filepath, JSON.stringify(data, null, 2));
}

// Register summary generation after all tests complete
afterAll(() => {
  // Generate summary at the end of test run
  // Note: This runs after each test file, but the last one wins
  try {
    generateTestResultsSummary();
  } catch {
    // Silently ignore errors during summary generation
  }
});
