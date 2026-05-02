# opencode-update-notifier

An [OpenCode](https://opencode.ai) plugin that checks if your pinned npm plugins have newer versions available and shows a TUI notification.

## What it does

On the first session start after OpenCode loads, this plugin:

1. Reads all your OpenCode config files to find version-pinned plugin entries.
2. Queries the npm registry for the latest version of each pinned plugin.
3. Shows a single aggregated toast notification if any plugins have updates available.
4. Caches the registry results locally for 6 hours.

It does **not** auto-update anything. You decide when to run your package manager.

## Installation

Add `opencode-update-notifier` to your OpenCode config:

```jsonc
// ~/.config/opencode/opencode.json
{
  "plugin": [
    "opencode-update-notifier@latest"
  ]
}
```

## Cache

Results are cached at `~/.cache/opencode-update-notifier/cache.json` (or `$XDG_CACHE_HOME/opencode-update-notifier/cache.json`).

To force a fresh registry check, delete this file:

```sh
rm ~/.cache/opencode-update-notifier/cache.json
```

## How update detection works

Only **pinned** plugin entries are checked — entries in the format `@scope/name@version` or `name@version`. Unpinned entries (e.g. `my-plugin` or `./local-plugin`) are silently ignored.

## License

MIT © Tim Hildebrandt
