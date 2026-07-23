import clipboard from 'clipboardy'

export function copyToClipboard(text: string): { ok: boolean; detail?: string } {
  try {
    clipboard.writeSync(text)
    return { ok: true }
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) }
  }
}
