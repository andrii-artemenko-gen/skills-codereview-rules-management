import { execFileSync } from 'node:child_process';
import { existsSync, globSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

function git(cwd, args, input) {
  return execFileSync('git', args, { cwd, input, maxBuffer: 16 * 1024 * 1024 });
}

function relativePath(value, label) {
  if (!value || path.isAbsolute(value) || value.split(/[\\/]/).includes('..') || value.includes('\\')) {
    throw new Error(`${label} must be a relative path using forward slashes, without '..'.`);
  }
  return path.posix.normalize(value);
}

function readIndex(cwd) {
  if (git(cwd, ['rev-parse', '--show-prefix']).toString().trim()) {
    throw new Error('Run staged synchronization from the Git repository root.');
  }
  return git(cwd, ['ls-files', '--stage', '-z'])
    .toString()
    .split('\0')
    .filter(Boolean)
    .map((line) => {
      const tab = line.indexOf('\t');
      const [mode, oid, stage] = line.slice(0, tab).split(' ');
      return { path: line.slice(tab + 1), mode, oid, stage };
    });
}

function readBlobs(cwd, entries) {
  if (!entries.length) return new Map();
  const buffer = git(cwd, ['cat-file', '--batch'], entries.map((entry) => entry.oid).join('\n') + '\n');
  const contents = new Map();
  let offset = 0;
  for (const entry of entries) {
    const end = buffer.indexOf(10, offset);
    const [, type, size] = buffer.subarray(offset, end).toString().split(' ');
    if (type !== 'blob') throw new Error(`Cannot read staged file: ${entry.path}`);
    offset = end + 1;
    const length = Number(size);
    contents.set(entry.path, buffer.subarray(offset, offset + length).toString('utf8'));
    offset += length + 1;
  }
  return contents;
}

function renderMarkdown(sources) {
  const sections = sources.map((source) => `## ${source.path}\n\n${source.content.trim()}`);
  return ['<!-- Generated file. Edit the source documents instead. -->', '# Instructions', ...sections].join('\n\n');
}

function validateOutput(cwd, output) {
  let current = cwd;
  for (const segment of output.split('/')) {
    current = path.join(current, segment);
    if (lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) {
      throw new Error(`Output must not pass through a symbolic link: ${output}`);
    }
  }
}

/** Synchronize a document from working files or the Git staged snapshot. */
export function syncMarkdown({
  pattern,
  output,
  cwd = process.cwd(),
  render = renderMarkdown,
  staged = false,
  check = false,
}) {
  cwd = path.resolve(cwd);
  pattern = relativePath(pattern, 'Pattern');
  output = relativePath(output, 'Output');
  validateOutput(cwd, output);
  const outputPath = path.join(cwd, output);
  let sources;
  let current;

  if (staged) {
    const entries = readIndex(cwd).filter(
      (entry) => entry.path === output || path.posix.matchesGlob(entry.path, pattern),
    );
    for (const entry of entries) {
      if (entry.stage !== '0') throw new Error(`Resolve the Git conflict first: ${entry.path}`);
      if (!['100644', '100755'].includes(entry.mode)) throw new Error(`Expected a regular file: ${entry.path}`);
    }
    const contents = readBlobs(cwd, entries);
    sources = entries
      .filter((entry) => entry.path !== output)
      .map((entry) => ({ path: entry.path, content: contents.get(entry.path) }));
    current = contents.get(output) ?? '';
  } else {
    sources = globSync(pattern, { cwd })
      .map((file) => file.split(path.sep).join('/'))
      .filter((file) => file !== output && lstatSync(path.join(cwd, file)).isFile())
      .map((file) => ({ path: file, content: readFileSync(path.join(cwd, file), 'utf8') }));
    current = existsSync(outputPath) ? readFileSync(outputPath, 'utf8') : '';
  }

  sources.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  const content = render(sources).trimEnd() + '\n';
  const changed = current !== content;
  if (check) {
    if (changed) throw new Error(`${output} is out of date.`);
  } else {
    const workingContent = existsSync(outputPath) ? readFileSync(outputPath, 'utf8') : '';
    if (workingContent !== content) {
      mkdirSync(path.dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, content);
    }
    if (staged) git(cwd, ['add', '--', output]);
  }
  return { changed, sourceCount: sources.length };
}
