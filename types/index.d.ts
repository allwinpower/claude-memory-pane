export type MemoryFile = {
  name: string
  title: string
  type: string
  description: string
  body: string
}

export type Editing = { name: string; draft: string }

export type NewMemory = { name: string; description: string; type: string; body: string }

declare module 'claude-code' {
  interface PluginState {
    'memory-pane': {
      dir: string
      files: Shaped<MemoryFile[]>
      editing: Shaped<Editing | null>
      confirming: string | null
      notice: string
      newDraft: Shaped<NewMemory | null>
    }
  }
}
