import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { NewMemory } from '../types'

import {
  INDEX,
  EMPTY_NEW,
  TYPES,
  fileOf,
  freeName,
  memoryDirOf,
  projectOf,
  slugOf,
  sortFiles,
  summarize,
  withLink,
  withoutLink,
} from './memory'

const PANE = 'memories'
// How often the folder is checked for changes while the pane is open.
const POLL_MS = 2000
// Change a tag when that value's fields change: it declines what an earlier
// version stored, which outlives a reload.
const dirAtom = atom({ plugin: 'memory-pane', key: 'dir' } as const, '')
const files = atom({ plugin: 'memory-pane', key: 'files' } as const, [], {
  shape: 'files-2',
})
const editing = atom({ plugin: 'memory-pane', key: 'editing' } as const, null, {
  shape: 'editing-1',
})
const confirming = atom({ plugin: 'memory-pane', key: 'confirming' } as const, null)
const notice = atom({ plugin: 'memory-pane', key: 'notice' } as const, '')
const newDraft = atom({ plugin: 'memory-pane', key: 'newDraft' } as const, null, {
  shape: 'new-1',
})

// The folder the engine loaded this session's auto memory from; before the
// folder has a MEMORY.md, the one it will write to.
const findDir = async ($: EngineInterface): Promise<string> => {
  const usage = await $.session.usage({ breakdown: 'summary' }).catch(() => undefined)
  const loaded = (usage?.context.breakdown?.memoryFiles ?? []).filter(
    file => file.type === 'AutoMem',
  )
  const index = loaded.find(file => file.path.endsWith(`/${INDEX}`)) ?? loaded[0]
  if (index !== undefined) {
    return index.path.slice(0, index.path.lastIndexOf('/'))
  }

  const root = await $.session.root()
  const git = await $.process
    .run(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: root })
    .catch(() => undefined)
  const home = (await $.env.get('HOME')) ?? ''

  return memoryDirOf(home, projectOf(root, git?.exitCode === 0 ? git.stdout.trim() : undefined))
}

// What the folder held at the last reading, so a poll can tell a change
// without reading every file: names and modification times, joined.
let lastSeen = ''

const stamp = (entries: readonly { name: string; mtimeMs: number }[]): string =>
  entries.map(entry => `${entry.name}@${entry.mtimeMs}`).join('|')

const memoryEntries = async ($: EngineInterface, dir: string) =>
  (await $.fs.list(dir).catch(() => [])).filter(
    entry => entry.kind === 'file' && entry.name.endsWith('.md'),
  )

const refresh = async ($: EngineInterface, isFresh = false): Promise<void> => {
  const known = await read($, dirAtom)
  const dir = isFresh || known === '' ? await findDir($) : known
  const entries = await memoryEntries($, dir)
  lastSeen = stamp(entries)
  const list = await Promise.all(
    entries.map(async entry =>
      summarize(entry.name, await $.fs.read(`${dir}/${entry.name}`).catch(() => '')),
    ),
  )
  await update($, dirAtom, () => dir)
  await update($, files, () => sortFiles(list))
}

// Reloads the list when a memory was added, changed or removed since the
// last reading; nothing while the pane is closed.
const pollOnce = async ($: EngineInterface): Promise<void> => {
  const isOpen = (await $.ui.panes()).some(pane => pane.id === PANE)
  const dir = await read($, dirAtom)
  if (!isOpen || dir === '') {
    return
  }
  if (stamp(await memoryEntries($, dir)) !== lastSeen) {
    await refresh($)
  }
}

const say = async ($: EngineInterface, text: string): Promise<void> => {
  await update($, notice, () => text)
}

const startEdit = async ($: EngineInterface, name: string): Promise<void> => {
  const dir = await read($, dirAtom)
  const text = await $.fs.read(`${dir}/${name}`).catch(() => undefined)
  await update($, confirming, () => null)
  if (text === undefined) {
    await say($, `Could not read ${name}.`)
    await refresh($)

    return
  }
  await say($, '')
  await update($, editing, () => ({ name, draft: text }))
}

const save = async ($: EngineInterface, typed?: string): Promise<void> => {
  const edit = await read($, editing)
  if (edit === null) {
    return
  }
  const dir = await read($, dirAtom)
  await $.fs.write(`${dir}/${edit.name}`, typed ?? edit.draft)
  await update($, editing, () => null)
  await say($, `Saved ${edit.name}.`)
  await refresh($)
}

const startNew = async ($: EngineInterface): Promise<void> => {
  await update($, editing, () => null)
  await update($, confirming, () => null)
  await say($, '')
  await update($, newDraft, () => EMPTY_NEW)
}

const setNew = ($: EngineInterface, patch: Partial<NewMemory>) =>
  update($, newDraft, current => (current === null ? null : { ...current, ...patch }))

// Writes the form as a new file named after its name and lists it in the
// index, the way Claude's own memory writes do.
const create = async ($: EngineInterface): Promise<void> => {
  const form = await read($, newDraft)
  if (form === null) {
    return
  }
  const title = form.name.trim() || form.description.trim().slice(0, 40)
  if (title === '' || form.body.trim() === '') {
    await say($, 'A memory needs a name and some text.')

    return
  }
  const dir = await read($, dirAtom)
  const taken = (await read($, files)).map(file => file.name)
  const name = freeName(slugOf(title), taken)
  await $.fs.write(`${dir}/${name}`, fileOf({ ...form, name: title }))

  const indexPath = `${dir}/${INDEX}`
  const index = await $.fs.read(indexPath).catch(() => '')
  await $.fs.write(indexPath, withLink(index, title, name, form.description.trim()))

  await update($, newDraft, () => null)
  await say($, `Created ${name}.`)
  await refresh($)
}

const remove = async ($: EngineInterface, name: string): Promise<void> => {
  const dir = await read($, dirAtom)
  await update($, confirming, () => null)
  // macOS's own `trash` keeps "Put Back" working in Finder.
  const trashed = await $.process.run(['/usr/bin/trash', `${dir}/${name}`]).catch(() => undefined)
  if (trashed?.exitCode !== 0) {
    await say($, `Could not delete ${name}: ${trashed?.stderr.trim() || 'trash failed'}`)

    return
  }

  const indexPath = `${dir}/${INDEX}`
  const index = await $.fs.read(indexPath).catch(() => undefined)
  if (index !== undefined) {
    const kept = withoutLink(index, name)
    if (kept !== index) {
      await $.fs.write(indexPath, kept)
    }
  }
  await say($, `Moved ${name} to the Trash.`)
  await refresh($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'memories',
      description: "Show this project's auto memory in a pane",
    })
    $.clock.every(POLL_MS, () => void pollOnce($).catch(() => undefined))

    return next(e)
  })

  on('command.run', { command: 'memories' }, async $ => {
    await refresh($, true)
    const opened = await $.ui.open({ id: PANE, title: 'Memories' })

    return {
      text: opened.isPlaced ? 'Memories pane opened.' : `Memories pane not shown: ${opened.reason}`,
    }
  })

  // Keeps the pane current when Claude writes or removes a memory.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const dir = await read($, dirAtom)
    const target =
      'file_path' in e && typeof e.file_path === 'string'
        ? e.file_path
        : 'command' in e && typeof e.command === 'string'
          ? e.command
          : ''
    const folder = dir.split('/').at(-2) ?? ''
    if (dir !== '' && target.includes(`${folder}/memory`)) {
      await refresh($)
    }

    return ran
  }).catch(($, e, next) => next(e)) // a failed refresh never holds up the tool

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Text, Button, Markdown } = elements
    const Input = 'Input' in elements ? elements.Input : undefined
    const Select = 'Select' in elements ? elements.Select : undefined
    const dir = await read($, dirAtom)
    const list = await read($, files)
    const edit = await read($, editing)
    const asked = await read($, confirming)
    const said = await read($, notice)
    const fresh = await read($, newDraft)
    const count = list.filter(file => file.name !== INDEX).length

    // A desktop draws a Button's label and not its children, so an icon is
    // a plain Button labelled with its glyph.
    const icon = (key: string, glyph: string, onPress: () => unknown) => (
      <Button key={key} label={glyph} plain dimColor onPress={onPress} />
    )
    const cancel = () => update($, editing, () => null)

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap={1}>
            <Text>{count === 1 ? '1 memory' : `${count} memories`}</Text>
            {fresh === null && Input !== undefined && Select !== undefined && icon('new', '＋', () => startNew($))}
          </Box>
          <Text dimColor wrap="truncate-start">
            {dir === '' ? 'Looking for the memory folder' : dir}
          </Text>
          {said !== '' && <Text dimColor>{said}</Text>}
        </Box>
        {fresh !== null && Input !== undefined && Select !== undefined && (
          <Box flexDirection="column" gap={1} borderStyle="single" borderDimColor paddingX={1}>
            <Text bold>New memory</Text>
            <Input
              key="new-name"
              label="Name"
              placeholder="short title, e.g. coffee order"
              value={fresh.name}
              autoFocus
              onInput={value => void setNew($, { name: value })}
              onSubmit={() => create($)}
            />
            <Input
              key="new-description"
              label="When it matters"
              placeholder="one line Claude reads to decide whether to open this"
              value={fresh.description}
              onInput={value => void setNew($, { description: value })}
              onSubmit={() => create($)}
            />
            <Select
              key="new-type"
              label="Kind"
              options={TYPES}
              value={fresh.type}
              onSelect={value => void setNew($, { type: value })}
            />
            <Input
              key="new-body"
              label="Text"
              placeholder="the memory itself"
              value={fresh.body}
              rows={6}
              submitLabel="✓"
              onInput={value => void setNew($, { body: value })}
              onSubmit={() => create($)}
            />
            <Box flexDirection="row" gap={1}>
              <Button key="save-new" variant="primary" label="Save" onPress={() => create($)} />
              <Button key="cancel-new" label="Cancel" onPress={() => update($, newDraft, () => null)} />
            </Box>
          </Box>
        )}
        {list.length === 0 && <Text dimColor>No memories for this project yet.</Text>}
        {list.map(file => {
          const isEditing = edit?.name === file.name

          return (
            <Box key={`row-${file.name}`} flexDirection="column">
              <Box flexDirection="row" gap={1} alignItems="center">
                <Text bold>{file.title}</Text>
                {isEditing
                  ? [
                      // The desktop and the editor draw a field's submit as
                      // a ✓ button beside it, which nothing hides; only the
                      // terminal, which draws none, gets a ✓ here.
                      e.surface === 'terminal' && icon('save', '✓', () => save($)),
                      icon('cancel', '✕', cancel),
                    ]
                  : [
                      icon(`edit-${file.name}`, '✎', () => startEdit($, file.name)),
                      file.name !== INDEX &&
                        icon(`delete-${file.name}`, '🗑', () =>
                          update($, confirming, () => file.name),
                        ),
                    ]}
              </Box>
              <Text dimColor>{[file.type, file.name].filter(Boolean).join(' · ')}</Text>
              {isEditing && edit !== null ? (
                Input === undefined ? (
                  <Text dimColor>This screen cannot edit text.</Text>
                ) : (
                  <Input
                    key="draft"
                    value={edit.draft}
                    rows={10}
                    submitLabel="✓"
                    autoFocus
                    onInput={value =>
                      void update($, editing, current =>
                        current === null ? null : { ...current, draft: value },
                      )
                    }
                    onSubmit={value => save($, value)}
                  />
                )
              ) : (
                [
                  file.description !== '' && <Text>{file.description}</Text>,
                  file.body !== '' && (
                    <Box paddingLeft={1} borderStyle="single" borderDimColor>
                      <Markdown text={file.body} />
                    </Box>
                  ),
                ]
              )}
              {asked === file.name && (
                <Box flexDirection="row" gap={1} alignItems="center">
                  <Text>Move to Trash?</Text>
                  <Button
                    key={`yes-${file.name}`}
                    variant="primary"
                    label="Delete"
                    onPress={() => remove($, file.name)}
                  />
                  <Button
                    key={`no-${file.name}`}
                    label="Keep"
                    onPress={() => update($, confirming, () => null)}
                  />
                </Box>
              )}
            </Box>
          )
        })}
      </Box>
    )
  })
}
