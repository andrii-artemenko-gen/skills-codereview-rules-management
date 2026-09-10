# Skills rules management

Combine Markdown instruction files into a generated document and keep it synchronized at commit time. The implementation is a generic Markdown utility with no runtime dependencies. It includes no bundled skill library or organization-specific rules.

Requires **Node.js 22.20+**. Staged mode also requires Git and must run from the repository root.

## Install

Install from this public Git repository with [pnpm's Git dependency support](https://pnpm.io/cli/add#install-from-git-repository):

```sh
pnpm add -D github:andrii-artemenko-gen/skills-codereview-rules-management#v0.1.0
```

The package is distributed through GitHub; the command does not assume an npm registry release.

## Generate a document

Keep source documents in your own repository, for example:

```text
rules/
  naming/instructions.md
  structure/instructions.md
INSTRUCTIONS.md                  # generated
```

```sh
pnpm exec rules-sync --pattern 'rules/*/instructions.md' --output INSTRUCTIONS.md
pnpm exec rules-sync --pattern 'rules/*/instructions.md' --output INSTRUCTIONS.md --check
```

Quote the glob so your shell passes it unchanged. Paths use forward slashes and are relative to the current directory. `*` selects one directory level; `**` can select deeper levels. The output is excluded if it matches the input pattern.

Sources are sorted by path and included with a heading identifying each source. Text is preserved, apart from surrounding whitespace. An empty collection produces an empty instructions document, allowing deletion of the last source to remove its old content.

`--check` exits with status 1 when the output is stale and never writes files.

## Pre-commit synchronization

Add scripts to the consuming repository:

```json
{
  "scripts": {
    "instructions:sync": "rules-sync --pattern 'rules/*/instructions.md' --output INSTRUCTIONS.md",
    "instructions:stage": "pnpm instructions:sync --staged",
    "instructions:check": "pnpm instructions:sync --check"
  }
}
```

For an existing [Husky](https://typicode.github.io/husky/) setup, add this to `.husky/pre-commit`, after any tasks that edit the input documents:

```sh
pnpm instructions:stage
```

Or call the same command from your existing Git hook manager. For a plain Git hook, place it in an executable `.git/hooks/pre-commit` file with a `#!/bin/sh` first line.

Run it on **every commit**, independently of a staged-file glob trigger. This also repairs previously stale output and handles deleted or renamed sources. For example, lint-staged's default changed-file filter excludes deletions.

`--staged`:

- Reads matching Markdown files from Git's index, including staged additions and the staged version of partially staged files.
- Omits deleted, untracked, and unstaged additions.
- Rewrites the generated output to match that snapshot and stages only that output.
- Leaves input documents and their unstaged edits untouched.

The output is a generated artifact: local manual edits to it are replaced during synchronization. `--staged --check` checks the indexed output without modifying either the index or working files. Ordinary generation/check mode reads working files, including matching untracked files.

Run `pnpm instructions:check` in CI after checkout as well, because developers can disable local hooks. A failed freshness check should fail the job. Generation checks verify synchronization; they do not evaluate the meaning or consistency of the instructions.

## GitHub Copilot

[GitHub's repository-wide instruction file](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions) is `.github/copilot-instructions.md`. Generate directly to that path:

```sh
pnpm exec rules-sync --pattern 'rules/*/instructions.md' --output .github/copilot-instructions.md --staged
```

Use this output path in the package scripts and pre-commit command above. Commit the source documents and generated file. The generated file contains their full text, so Copilot can read the rules directly.

For pull-request reviews, check **Settings → Copilot → Code review → Use custom instructions when reviewing pull requests**. GitHub documents the reviewing user's instruction setting as relevant too. See [using Copilot code review](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/request-a-code-review/use-code-review).

Keep the repository-wide document focused. GitHub recommends starting with roughly 10–20 specific rules. [Path-specific instructions](https://docs.github.com/en/copilot/tutorials/customize-code-review) can live in `.github/instructions/NAME.instructions.md` with `applyTo` frontmatter for rules that concern only certain files. Generating one large document does not guarantee that Copilot will follow every rule.

## CodeRabbit

CodeRabbit can consume the generated root `INSTRUCTIONS.md`. Configure `.coderabbit.yaml` using [CodeRabbit's code guidelines documentation](https://docs.coderabbit.ai/knowledge-base/code-guidelines):

```yaml
knowledge_base:
  code_guidelines:
    enabled: true
    filePatterns:
      - files: 'INSTRUCTIONS.md'
        applyTo: '**/*'
```

`files` selects instruction documents; `applyTo` selects the files those instructions govern. Narrow `applyTo`, for example to `src/**/*.tsx`, when the content concerns only that boundary.

To share the generated Copilot document, use this entry instead:

```yaml
knowledge_base:
  code_guidelines:
    enabled: true
    filePatterns:
      - files: '.github/copilot-instructions.md'
        applyTo: '**/*'
```

CodeRabbit automatically discovers some filenames, including `.github/copilot-instructions.md`, `AGENTS.md`, and `CLAUDE.md`. Explicit `files`/`applyTo` mapping makes the intended scope clear: ordinary guideline discovery is scoped to the document's containing directory and descendants. A document stored with tooling or documentation therefore needs an appropriate mapping to govern application source elsewhere.

Additional `filePatterns` supplement automatic discovery. An empty list keeps built-in discovery enabled; `code_guidelines.enabled: false` disables guidelines. The filenames are case-sensitive.

Put document references under `knowledge_base.code_guidelines.filePatterns`. `reviews.path_instructions` is not the setting for loading guideline files. Administrators can inspect the rendered guidelines in CodeRabbit's UI to confirm discovery and scope.

Keep your actual rule documents in the repository and access boundary you intend. Using this public utility does not require publishing those documents in this utility's repository. GitHub-based cross-repository guidelines have separate access, organization, and scope rules described in the [CodeRabbit documentation](https://docs.coderabbit.ai/knowledge-base/code-guidelines).

## Custom output format

The JavaScript API lets a consuming project retain its existing document format:

```js
import { syncMarkdown } from 'skills-codereview-rules-management';

syncMarkdown({
  pattern: 'rules/*/instructions.md',
  output: 'INSTRUCTIONS.md',
  staged: process.argv.includes('--staged'),
  check: process.argv.includes('--check'),
  render: (sources) =>
    ['# Project instructions', ...sources.map(({ path, content }) => `## ${path}\n\n${content.trim()}`)].join('\n\n'),
});
```

`render` receives sorted `{ path, content }` objects. `syncMarkdown` returns `{ changed, sourceCount }`; it throws on a stale check or an I/O/Git error. `cwd` defaults to the current directory. TypeScript declarations are included.

The utility concatenates documents. Rule selection, conflict resolution, and the reviewer's adherence remain responsibilities of the consuming workflow.

## Development

```sh
node --test
```

Tests use synthetic documents and temporary Git repositories, including actual commits with a pre-commit hook. No services, credentials, or dependencies are needed.

MIT licensed.
