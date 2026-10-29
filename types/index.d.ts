export type MemoryFile = {
  name: string
  title: string
  type: string
  description: string
  body: string
}

export type Editing = { name: string; draft: string }

declare module 'claude-code' {
  interface PluginState {
    'memory-pane': {
      dir: string
      files: Shaped<MemoryFile[]>
      editing: Shaped<Editing | null>
      confirming: string | null
      notice: string
    }
  }
}
