import type { MemoryFile } from '../types'

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
