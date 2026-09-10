#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { syncMarkdown } from './index.js';

try {
  const { values } = parseArgs({
    options: {
      pattern: { type: 'string' },
      output: { type: 'string' },
      staged: { type: 'boolean', default: false },
      check: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log(`Usage: rules-sync --pattern 'rules/*/instructions.md' --output INSTRUCTIONS.md [--staged] [--check]

--pattern  Input glob, relative to the current directory. Quote it in your shell.
--output   Generated Markdown file, relative to the current directory.
--staged   Read inputs from the Git index and stage the generated output.
--check    Check freshness without modifying files or the index.

Run staged mode from the Git repository root. --staged --check checks the index.`);
  } else {
    if (!values.pattern || !values.output)
      throw new Error('Both --pattern and --output are required. Use --help for usage.');
    const result = syncMarkdown(values);
    console.log(`${values.output}: ${result.changed ? 'updated' : 'up to date'} (${result.sourceCount} sources).`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
