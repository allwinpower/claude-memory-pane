import type { MemoryFile, NewMemory } from '../types'

export const INDEX = 'MEMORY.md'

// Auto memory folders are named for the project's path, every character
// outside A-Z, a-z and 0-9 turned into '-'.
export const encodeProject = (path: string): string =>
  path.replace(/[^A-Za-z0-9]/g, '-')

// Worktrees share their main repo's memory: git's common dir is that repo's
// `.git`, so its parent is the project.
export const projectOf = (root: string, commonDir?: string): string =>
  commonDir !== undefined && commonDir.endsWith('/.git')
    ? commonDir.slice(0, -'/.git'.length)
    : root

export const memoryDirOf = (home: string, project: string): string =>
  `${home}/.claude/projects/${encodeProject(project)}/memory`

const unquote = (value: string): string =>
  value.trim().replace(/^(["'])(.*)\1$/, '$2')

export const summarize = (name: string, text: string): MemoryFile => {
  if (name === INDEX) {
    return {
      name,
      title: 'Index',
      type: 'index',
      description: 'The list Claude reads at session start',
      body: text.trim(),
    }
  }

  const matched = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text)
  const front = matched?.[1] ?? ''
  const body = text.slice(matched?.[0].length ?? 0).trim()
  const field = (pattern: RegExp): string =>
    unquote(pattern.exec(front)?.[1] ?? '')

  return {
    name,
    title: field(/^name:(.*)$/m) || name.replace(/\.md$/, ''),
    type: field(/^\s+type:(.*)$/m) || field(/^type:(.*)$/m),
    description: field(/^description:(.*)$/m),
    body,
  }
}

export const sortFiles = (files: readonly MemoryFile[]): MemoryFile[] =>
  [...files].sort((a, b) =>
    a.name === INDEX ? -1 : b.name === INDEX ? 1 : a.name.localeCompare(b.name),
  )

const escapeRegExp = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Drops the index lines that link the file: `- [Title](file.md) — hook`.
export const withoutLink = (index: string, name: string): string => {
  const link = new RegExp(`\\]\\((\\./)?${escapeRegExp(name)}\\)`)

  return index
    .split('\n')
    .filter(line => !link.test(line))
    .join('\n')
}

// The kinds Claude's own memories use, with what each is for.
export const TYPES: readonly { value: string; label: string }[] = [
  { value: 'user', label: 'About me (role, preferences)' },
  { value: 'feedback', label: 'How Claude should work' },
  { value: 'project', label: 'Project (goals, decisions)' },
  { value: 'reference', label: 'Reference (links, tickets)' },
]

export const EMPTY_NEW: NewMemory = { name: '', description: '', type: 'project', body: '' }

// The file a new memory is written as, in the shape Claude writes them.
export const fileOf = (memory: NewMemory): string =>
  `---
name: ${memory.name.trim()}
description: ${memory.description.trim()}
metadata:
  type: ${memory.type}
---

${memory.body.trim()}
`

// A file name from a memory's name: lowercase, words joined by '-'.
export const slugOf = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'memory'

// The first of `slug.md`, `slug-2.md`, ... that no existing file takes.
export const freeName = (slug: string, taken: readonly string[]): string => {
  for (let n = 1; ; n += 1) {
    const name = n === 1 ? `${slug}.md` : `${slug}-${n}.md`
    if (!taken.includes(name)) {
      return name
    }
  }
}

// The index with one line added for the file, as Claude writes them.
export const withLink = (index: string, title: string, name: string, hook: string): string => {
  const line = `- [${title}](${name})${hook === '' ? '' : ` — ${hook}`}`
  const body = index.trimEnd()

  return body === '' ? `${line}\n` : `${body}\n${line}\n`
}
