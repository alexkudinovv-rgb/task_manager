export const FILE_NAME_MAX = 200
const FALLBACK_NAME = 'файл'

// C0/C1 controls and bidi/zero-width marks (e.g. U+202E turns "txt.exe" into "exe.txt" on screen).
const UNSAFE_CHARS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g

/** A display name for an uploaded file: no path, no control characters, at most 200 characters. */
export function sanitizeFileName(raw: string | undefined | null): string {
  const base = (raw ?? '').normalize('NFC').split(/[\\/]/).pop() ?? ''
  const name = base.replace(UNSAFE_CHARS, '').replace(/\s+/g, ' ').trim()
  if (name === '' || /^\.+$/.test(name)) return FALLBACK_NAME
  const chars = Array.from(name)
  if (chars.length <= FILE_NAME_MAX) return name
  // Keep a short extension so the type stays recognisable.
  const dot = name.lastIndexOf('.')
  const ext = dot > 0 ? Array.from(name.slice(dot)) : []
  if (ext.length > 1 && ext.length <= 16) {
    return chars.slice(0, FILE_NAME_MAX - ext.length).join('').trimEnd() + ext.join('')
  }
  return chars.slice(0, FILE_NAME_MAX).join('').trimEnd()
}

/** Types a browser may show in the page; everything else is served as a download. */
export const INLINE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf'])

const SIGNATURES: [string, (head: Buffer) => boolean][] = [
  ['image/png', (h) => h.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))],
  ['image/jpeg', (h) => h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff],
  ['image/gif', (h) => ['GIF87a', 'GIF89a'].includes(h.subarray(0, 6).toString('latin1'))],
  ['image/webp', (h) => h.subarray(0, 4).toString('latin1') === 'RIFF' && h.subarray(8, 12).toString('latin1') === 'WEBP'],
  ['application/pdf', (h) => h.subarray(0, 5).toString('latin1') === '%PDF-'],
]

/** Bytes of the file start that detectMime needs. */
export const SNIFF_BYTES = 16

const MIME = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/

/**
 * The stored MIME type. Previewable types are decided by the file's magic bytes, not by what the
 * client claims, so a renamed HTML page never becomes an inline "image". Other claims are kept
 * (they are always served as downloads) when they look like a MIME type at all.
 */
export function detectMime(head: Buffer, claimed: string | undefined): string {
  const detected = SIGNATURES.find(([, matches]) => matches(head))
  if (detected) return detected[0]
  const type = (claimed ?? '').split(';')[0]!.trim().toLowerCase()
  if (!MIME.test(type) || INLINE_TYPES.has(type)) return 'application/octet-stream'
  return type
}

/** RFC 6266 / 5987: an ASCII fallback plus the exact UTF-8 name. */
export function contentDisposition(kind: 'inline' | 'attachment', fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || 'file'
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  )
  return `${kind}; filename="${fallback}"; filename*=UTF-8''${encoded}`
}
