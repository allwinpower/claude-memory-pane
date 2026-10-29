import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const DIR = '/home/me/.claude/projects/-work-app/memory'
const PANE = {
  plugin: 'memory-pane',
  component: 'Pane',
  requestId: 'memories',
  props: {
    title: 'Memories',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const seed = (): Record<string, string> => ({
  [`${DIR}/MEMORY.md`]:
    '- [Role](user-role.md) — what they do\n- [Deploy](deploy-rule.md) — when to deploy\n',
  [`${DIR}/user-role.md`]:
    '---\nname: user-role\ndescription: Runs the shop\nmetadata:\n  type: user\n---\n\nbody\n',
  [`${DIR}/deploy-rule.md`]:
    '---\nname: deploy-rule\ndescription: "Deploy only when asked"\nmetadata:\n  type: feedback\n---\n',
})

// Stands for the engine: a worktree session of /work/app with no MEMORY.md
// loaded yet, so the mod works the folder out from git.
const engine = (on: On, disk: Record<string, string>, runs: string[][]) => {
  mock.env(on, { HOME: '/home/me' })
  on('command.register', () => ({ value: { command: 'memories' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({
    value: [{ id: 'memories', title: 'Memories', isShown: true, isFocused: false, isPlaced: true }],
  }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ deny: 'no breakdown in tests' }))
  on('session.root', () => ({ value: '/work/app/.claude/worktrees/feature' }))
  on('process.run', (_, e) => {
    runs.push([...e.argv])
    const [command, path = ''] = e.argv
    const stdout = command === 'git' ? '/work/app/.git\n' : ''
    if (command === '/usr/bin/trash') {
      delete disk[path]
    }

    return {
      value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    }
  })
  on('fs.list', (_, e) =>
    e.path === DIR
      ? {
          value: Object.keys(disk).map(path => ({
            name: path.slice(DIR.length + 1),
            kind: 'file' as const,
            size: 1,
            mtimeMs: disk[path]?.length ?? 1,
            isLink: false,
          })),
        }
      : { deny: 'missing' },
  )
  on('fs.read', (_, e) => {
    const text = disk[e.path]

    return text === undefined ? { deny: 'missing' } : { value: text }
  })
  on('fs.write', (_, e) => {
    disk[e.path] = e.text

    return { value: undefined }
  })
}

const open = async ($: Parameters<Parameters<typeof test>[1]>[0]) => {
  await $.session.start({ cwd: '/work/app', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'memories' })

  return $.ui.mount({ ...PANE, surface: 'desktop' })
}

test("the pane lists the main repo's memories from a worktree", async ($, on) => {
  const runs: string[][] = []
  engine(on, seed(), runs)
  const ui = await open($)

  expect(await ui.find({ type: 'Text', text: DIR })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '2 memories' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Runs the shop' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Deploy only when asked' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'feedback · deploy-rule.md' })).toBeDefined()
  // The body after the frontmatter is shown without opening the editor.
  expect(await ui.find({ type: 'Markdown', text: 'body' })).toBeDefined()
  // The index can be edited but not deleted.
  expect(await ui.find({ key: 'edit-MEMORY.md' })).toBeDefined()
  expect(await ui.find({ key: 'delete-MEMORY.md' })).toBe(undefined)
  await ui.unmount()
})

test('Save writes what was typed', async ($, on) => {
  const disk = seed()
  engine(on, disk, [])
  const ui = await open($)

  await ui.press({ key: 'edit-user-role.md' })
  // The desktop's save is the field's own ✓ button: no second one by the title.
  expect((await ui.find({ key: 'draft' }))?.props).toEqual(
    expect.objectContaining({ submitLabel: '✓', rows: 10 }),
  )
  expect(await ui.find({ key: 'save' })).toBe(undefined)
  expect(await ui.find({ key: 'cancel' })).toBeDefined()
  await ui.input({ key: 'draft', text: '---\nname: user-role\n---\nnew body\n', kind: 'submit' })

  expect(disk[`${DIR}/user-role.md`]).toBe('---\nname: user-role\n---\nnew body\n')
  expect(await ui.find({ type: 'Text', text: 'Saved user-role.md.' })).toBeDefined()
  expect(await ui.find({ key: 'draft' })).toBe(undefined)
  await ui.unmount()
})

test('Save works on the terminal too', async ($, on) => {
  const disk = seed()
  engine(on, disk, [])
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'memories' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await ui.press({ key: 'edit-user-role.md' })
  await ui.input({ key: 'draft', text: 'typed', kind: 'change' })
  await ui.press({ key: 'save' })

  expect(disk[`${DIR}/user-role.md`]).toBe('typed')
  await ui.unmount()
})

test('the editor opens inline and Cancel leaves the file alone', async ($, on) => {
  const disk = seed()
  const before = disk[`${DIR}/user-role.md`]
  engine(on, disk, [])
  const ui = await open($)

  await ui.press({ key: 'edit-user-role.md' })
  // The other memories stay listed while one is edited.
  expect(await ui.find({ type: 'Text', text: 'Deploy only when asked' })).toBeDefined()
  expect(await ui.find({ key: 'cancel' })).toBeDefined()
  await ui.input({ key: 'draft', text: 'thrown away', kind: 'change' })
  await ui.press({ key: 'cancel' })

  expect(disk[`${DIR}/user-role.md`]).toBe(before)
  expect(await ui.find({ key: 'draft' })).toBe(undefined)
  expect(await ui.find({ type: 'Text', text: 'Runs the shop' })).toBeDefined()
  await ui.unmount()
})

test('Delete asks, moves the file to the Trash and drops its index line', async ($, on) => {
  const disk = seed()
  const runs: string[][] = []
  engine(on, disk, runs)
  const ui = await open($)

  await ui.press({ key: 'delete-deploy-rule.md' })
  expect(runs).not.toContainEqual(['/usr/bin/trash', `${DIR}/deploy-rule.md`])
  await ui.press({ key: 'yes-deploy-rule.md' })

  expect(runs).toContainEqual(['/usr/bin/trash', `${DIR}/deploy-rule.md`])
  expect(disk[`${DIR}/MEMORY.md`]).toBe('- [Role](user-role.md) — what they do\n')
  expect(await ui.find({ type: 'Text', text: '1 memory' })).toBeDefined()
  await ui.unmount()
})

test('No keeps the file', async ($, on) => {
  const runs: string[][] = []
  engine(on, seed(), runs)
  const ui = await open($)

  await ui.press({ key: 'delete-user-role.md' })
  await ui.press({ key: 'no-user-role.md' })

  expect(runs.some(argv => argv[0] === '/usr/bin/trash')).toBe(false)
  expect(await ui.find({ key: 'delete-user-role.md' })).toBeDefined()
  await ui.unmount()
})

test('a memory Claude writes shows up by itself, with no Refresh button', async ($, on) => {
  const disk = seed()
  const clock = mock.clock(on)
  engine(on, disk, [])
  const ui = await open($)

  expect(await ui.find({ key: 'refresh' })).toBe(undefined)
  disk[`${DIR}/new-fact.md`] = '---\nname: new-fact\ndescription: Just learned\n---\n'
  await clock.advance(2000)

  expect(await ui.find({ type: 'Text', text: 'Just learned' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '3 memories' })).toBeDefined()
  await ui.unmount()
})

test('＋ opens a template; saving writes the file and lists it in the index', async ($, on) => {
  const disk = seed()
  engine(on, disk, [])
  const ui = await open($)

  await ui.press({ key: 'new' })
  expect((await ui.find({ key: 'new-draft' }))?.text).toContain('name: ')
  await ui.input({
    key: 'new-draft',
    text: '---\nname: Coffee order\ndescription: Flat white, no sugar\nmetadata:\n  type: user\n---\n\nAlways.\n',
    kind: 'submit',
  })

  expect(disk[`${DIR}/coffee-order.md`]).toContain('Flat white')
  expect(disk[`${DIR}/MEMORY.md`]).toBe(
    '- [Role](user-role.md) — what they do\n- [Deploy](deploy-rule.md) — when to deploy\n- [Coffee order](coffee-order.md) — Flat white, no sugar\n',
  )
  expect(await ui.find({ key: 'new-draft' })).toBe(undefined)
  expect(await ui.find({ type: 'Text', text: 'Created coffee-order.md.' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '3 memories' })).toBeDefined()
  await ui.unmount()
})

test('saving an untouched template is refused', async ($, on) => {
  const disk = seed()
  const before = { ...disk }
  engine(on, disk, [])
  const ui = await open($)

  await ui.press({ key: 'new' })
  await ui.input({ key: 'new-draft', text: (await ui.find({ key: 'new-draft' }))?.text ?? '', kind: 'submit' })

  expect(disk).toEqual(before)
  expect(await ui.find({ key: 'new-draft' })).toBeDefined()
  await ui.unmount()
})
