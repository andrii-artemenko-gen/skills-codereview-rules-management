import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { syncMarkdown } from '../src/index.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));

function fixture(t) {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'rules-sync-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const put = (file, content) => {
    mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
    writeFileSync(path.join(cwd, file), content);
  };
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  git('init', '-q');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'core.autocrlf', 'false');
  git('config', 'core.hooksPath', '.git/hooks');
  return { cwd, put, git, options: { cwd, pattern: 'rules/*/instructions.md', output: 'INSTRUCTIONS.md' } };
}

test('working files are sorted, scoped, and stable; check mode never writes', (t) => {
  const { cwd, put, options } = fixture(t);
  put('rules/zeta/instructions.md', 'Second.\n');
  put('rules/alpha/instructions.md', 'Перший. ☕\n');
  put('rules/alpha/nested/instructions.md', 'Outside the direct glob.');
  assert.deepEqual(syncMarkdown(options), { changed: true, sourceCount: 2 });
  const output = readFileSync(path.join(cwd, 'INSTRUCTIONS.md'), 'utf8');
  assert.ok(output.indexOf('Перший') < output.indexOf('Second'));
  assert.ok(!output.includes('Outside'));
  assert.deepEqual(syncMarkdown(options), { changed: false, sourceCount: 2 });
  put('rules/alpha/instructions.md', 'Changed.');
  assert.throws(() => syncMarkdown({ ...options, check: true }), /out of date/);
  assert.equal(readFileSync(path.join(cwd, 'INSTRUCTIONS.md'), 'utf8'), output);
});

test('an actual pre-commit hook handles adds, partial staging, renames, and deleting the last source', (t) => {
  const { cwd, put, git } = fixture(t);
  put(
    'sync.mjs',
    `import { syncMarkdown } from ${JSON.stringify(new URL('../src/index.js', import.meta.url).href)};\nsyncMarkdown({ pattern: 'rules/*/instructions.md', output: 'INSTRUCTIONS.md', staged: true });\n`,
  );
  put('.git/hooks/pre-commit', `#!/bin/sh\n"${process.execPath}" sync.mjs\n`);
  chmodSync(path.join(cwd, '.git/hooks/pre-commit'), 0o755);
  put('rules/alpha/instructions.md', 'Initial.');
  git('add', 'sync.mjs', 'rules/alpha/instructions.md');
  git('commit', '-qm', 'Initial');
  assert.match(git('show', 'HEAD:INSTRUCTIONS.md'), /Initial\./);

  put('rules/alpha/instructions.md', 'Staged update.');
  git('add', 'rules/alpha/instructions.md');
  put('rules/alpha/instructions.md', 'Staged update.\nUnstaged addition.');
  put('rules/untracked/instructions.md', 'Untracked addition.');
  git('commit', '-qm', 'Partial update');
  assert.match(git('show', 'HEAD:INSTRUCTIONS.md'), /Staged update\./);
  assert.doesNotMatch(git('show', 'HEAD:INSTRUCTIONS.md'), /Unstaged|Untracked/);
  assert.match(readFileSync(path.join(cwd, 'rules/alpha/instructions.md'), 'utf8'), /Unstaged/);
  assert.equal(git('show', 'HEAD:rules/alpha/instructions.md'), 'Staged update.');

  put('rules/alpha/instructions.md', 'Staged update.');
  git('mv', 'rules/alpha', 'rules/beta');
  git('commit', '-qm', 'Rename');
  assert.match(git('show', 'HEAD:INSTRUCTIONS.md'), /rules\/beta/);
  assert.doesNotMatch(git('show', 'HEAD:INSTRUCTIONS.md'), /rules\/alpha/);
  git('rm', 'rules/beta/instructions.md');
  git('commit', '-qm', 'Delete last source');
  assert.doesNotMatch(git('show', 'HEAD:INSTRUCTIONS.md'), /Staged|Untracked|rules\/beta/);
});

test('staged mode handles UTF-8 bytes and file names with spaces and newlines', (t) => {
  const { put, git, options } = fixture(t);
  put('rules/space and\nnewline/instructions.md', 'Привіт ☕\nNext line.');
  git('add', '.');
  syncMarkdown({ ...options, staged: true });
  assert.match(git('show', ':INSTRUCTIONS.md'), /Привіт ☕\nNext line\./);
});

test('staged check reads the index and does not alter working files or staging', (t) => {
  const { cwd, put, git, options } = fixture(t);
  put('rules/alpha/instructions.md', 'Committed contract.');
  git('add', '.');
  syncMarkdown({ ...options, staged: true });
  put('INSTRUCTIONS.md', 'Local output edit.');
  const index = git('write-tree');
  syncMarkdown({ ...options, staged: true, check: true });
  assert.equal(git('write-tree'), index);
  assert.equal(readFileSync(path.join(cwd, 'INSTRUCTIONS.md'), 'utf8'), 'Local output edit.');
  put('rules/alpha/instructions.md', 'Changed contract.');
  git('add', 'rules/alpha/instructions.md');
  assert.throws(() => syncMarkdown({ ...options, staged: true, check: true }), /out of date/);
  assert.match(git('show', ':INSTRUCTIONS.md'), /Committed contract/);
});

test('generation repairs stale output even when only unrelated files are staged', (t) => {
  const { put, git, options } = fixture(t);
  put('rules/alpha/instructions.md', 'Source of truth.');
  put('INSTRUCTIONS.md', 'Stale generated content.');
  git('add', '.');
  git('commit', '-qm', 'Stale baseline');
  put('notes.txt', 'Unrelated change.');
  git('add', 'notes.txt');
  syncMarkdown({ ...options, staged: true });
  assert.match(git('show', ':INSTRUCTIONS.md'), /Source of truth/);
  assert.doesNotMatch(git('show', ':INSTRUCTIONS.md'), /Stale generated/);
});

test('custom rendering preserves the caller format and the output never becomes an input', (t) => {
  const { cwd, put, options } = fixture(t);
  put('rules/alpha/instructions.md', 'Alpha.');
  const custom = { ...options, pattern: '**/*.md', render: (sources) => sources.map((s) => s.content).join('\n') };
  syncMarkdown(custom);
  assert.equal(readFileSync(path.join(cwd, options.output), 'utf8'), 'Alpha.\n');
  assert.deepEqual(syncMarkdown(custom), { changed: false, sourceCount: 1 });
});

test('hidden source directories work in both modes', (t) => {
  const { cwd, put, git, options } = fixture(t);
  put('.rules/alpha/instructions.md', 'Hidden directory.');
  const hidden = { ...options, pattern: '.rules/*/instructions.md' };
  syncMarkdown(hidden);
  const expected = readFileSync(path.join(cwd, options.output), 'utf8');
  git('add', '.rules');
  syncMarkdown({ ...hidden, staged: true });
  assert.equal(git('show', ':INSTRUCTIONS.md'), expected);
});

test('output symlinks and escaping paths are rejected before changing their targets', (t) => {
  const { cwd, put, options } = fixture(t);
  put('target.txt', 'Keep this content.');
  symlinkSync('target.txt', path.join(cwd, options.output));
  assert.throws(() => syncMarkdown(options), /symbolic link/);
  assert.equal(readFileSync(path.join(cwd, 'target.txt'), 'utf8'), 'Keep this content.');
  rmSync(path.join(cwd, 'target.txt'));
  assert.throws(() => syncMarkdown(options), /symbolic link/);
  assert.equal(existsSync(path.join(cwd, 'target.txt')), false);
  assert.throws(() => syncMarkdown({ ...options, output: '../outside.md' }), /relative path/);
});

test('CLI exposes generation and fails a stale check without creating output', (t) => {
  const { cwd, put } = fixture(t);
  put('rules/alpha/instructions.md', 'CLI source.');
  const args = [cli, '--pattern', 'rules/*/instructions.md', '--output', 'INSTRUCTIONS.md'];
  assert.throws(() => execFileSync(process.execPath, [...args, '--check'], { cwd, stdio: 'pipe' }));
  assert.equal(existsSync(path.join(cwd, 'INSTRUCTIONS.md')), false);
  execFileSync(process.execPath, args, { cwd, stdio: 'pipe' });
  execFileSync(process.execPath, [...args, '--check'], { cwd, stdio: 'pipe' });
});
