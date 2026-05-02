# Contributing

Contributions are welcome. Please open an issue before submitting a pull request for non-trivial changes.

## Prerequisites

- [Bun](https://bun.sh) (used for running tests, install, and build)
- Node.js ≥ 18 (required by the engine field; Bun handles it at runtime)

## Setup

```sh
git clone https://github.com/tim-hilde/opencode-update-notifier
cd opencode-update-notifier
bun install
```

This also installs the [lefthook](https://github.com/evilmartians/lefthook) git hooks:

- **pre-commit** — runs Biome format/lint on staged `.ts` files, then typechecks
- **pre-push** — runs the full test suite

## Commands

| Command | Description |
|---|---|
| `bun test` | Run tests |
| `bun run typecheck` | TypeScript type check |
| `bun run lint` | Biome lint check |
| `bun run format` | Biome auto-format |
| `bun run build` | Build to `dist/` via tsup |

## Project structure

```
src/
  index.ts          Plugin entry point — hasRun guard, wiring
  types.ts          Shared types and dependency interfaces
  parse.ts          Parse raw plugin strings into {name, version}
  cache.ts          Read/write local cache (~/.cache/…/cache.json)
  registry.ts       Fetch latest version from npm registry
  notify.ts         Format and send the TUI toast
  check.ts          Orchestrate cache + registry + semver comparison
  config/
    sources.ts      Locate config files (global, project, env, managed)
    load.ts         Parse and deduplicate plugin entries from config files
test/               Unit tests (bun:test)
```

All source modules use **dependency injection** — no module-level side effects. This keeps every unit testable in isolation without mocking globals.

## Testing

Tests follow a strict TDD cycle: write the failing test first, then implement the minimum code to make it pass.

```sh
bun test                        # run all tests
bun test test/parse.test.ts     # run a single file
```

## Code style

Formatting and linting are enforced by [Biome](https://biomejs.dev). Run `bun run format` to auto-fix, or let the pre-commit hook handle it.

Key conventions:
- All local value imports use `.js` extensions (required by `"module": "NodeNext"`)
- `import type` is used for type-only imports
- No module-level side effects — all I/O is passed as injected dependencies

## Releasing

This project uses [Changesets](https://github.com/changesets/changesets).

1. Make your changes and commit them.
2. Run `bunx changeset` and follow the prompts to describe the change.
3. Commit the generated changeset file.
4. Open a pull request. The release workflow will create a "Version Packages" PR automatically once merged to `main`.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
