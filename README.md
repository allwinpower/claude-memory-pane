# memory-pane

A Claude Code mod that adds a `/memories` pane: it lists the auto memory
Claude keeps for the current project and lets you edit or delete each entry
without leaving the session.

Claude's auto memory lives in `~/.claude/projects/<project>/memory/`: one
Markdown file per fact, plus `MEMORY.md`, the index Claude reads at the start
of every session. This pane shows that folder.

## What it does

- Lists every memory with its name, type, description and full text.
- `＋` opens a prefilled template; saving writes the new file, named after its
  `name` field, and adds its line to `MEMORY.md`.
- `✎` opens the file inline for editing; save with the field's `✓` button or
  Enter (Shift+Enter adds a line), cancel with `✕`.
- `🗑` moves a memory to the macOS Trash after a confirmation, and removes its
  line from `MEMORY.md`. The index itself can be edited but not deleted.
- Updates by itself: while the pane is open it checks the folder every two
  seconds, so a memory Claude writes appears without a click.
- Works from a git worktree: it finds the main repository's memory folder.

Claude reads `MEMORY.md` once, at session start, so an edit made in the pane
reaches Claude in the next session.

## Install

At the prompt of a terminal session:

```
/plugin install memory-pane --marketplace allwinpower/claude-memory-pane
```

Answer `y` to add the marketplace, then pick a scope (user scope makes it
available in every project).

From a shell:

```
claude plugin install memory-pane --marketplace allwinpower/claude-memory-pane
```

In the desktop app, where `/plugin` does not run: click **+** next to the
prompt box, then **Plugins**, **Add marketplace** with
`allwinpower/claude-memory-pane`, then **Add plugin**.

Then type `/memories` in any session.

## Requirements

- Claude Code 2.1.309 or later (the mod uses function hooks and UI panes).
- macOS for delete-to-Trash (`/usr/bin/trash`). On other systems the delete
  reports an error and leaves the file alone.

## Development

```
claude plugin validate .
claude plugin test .
```

The tests in `tests/` run against the engine's own test kit and cover
listing, saving, cancelling, deleting and live updates.

## License

MIT
