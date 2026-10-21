import { describe, expect, it } from 'vitest'
import { contentDisposition, detectMime, sanitizeFileName } from './files'

describe('sanitizeFileName', () => {
  it('keeps Cyrillic and strips paths, controls and bidi marks', () => {
    expect(sanitizeFileName('Акт сверки №5.pdf')).toBe('Акт сверки №5.pdf')
    expect(sanitizeFileName('C:\\Users\\me\\отчёт.xlsx')).toBe('отчёт.xlsx')
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd')
    expect(sanitizeFileName('a\u0000b\u001fc\u007f.txt')).toBe('abc.txt')
    expect(sanitizeFileName('invoice\u202Efdp.exe')).toBe('invoicefdp.exe')
    expect(sanitizeFileName('  много   пробелов  .doc ')).toBe('много пробелов .doc')
  })

  it('falls back for empty or dot-only names', () => {
    for (const raw of ['', '   ', '.', '..', '/', undefined, null]) expect(sanitizeFileName(raw)).toBe('файл')
  })

  it('cuts long names to 200 characters, keeping the extension and whole code points', () => {
    const long = sanitizeFileName(`${'ж'.repeat(250)}.pdf`)
    expect(Array.from(long)).toHaveLength(200)
    expect(long.endsWith('.pdf')).toBe(true)
    const emoji = sanitizeFileName('😀'.repeat(250))
    expect(Array.from(emoji)).toHaveLength(200)
    expect(emoji).toBe('😀'.repeat(200))
  })
})

describe('detectMime', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])
  const pdf = Buffer.from('%PDF-1.4')
  const webp = Buffer.from('RIFF\u0000\u0000\u0000\u0000WEBPVP8 ', 'latin1')

  it('trusts magic bytes for previewable types', () => {
    expect(detectMime(png, 'application/octet-stream')).toBe('image/png')
    expect(detectMime(pdf, undefined)).toBe('application/pdf')
    expect(detectMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'image/png')).toBe('image/jpeg')
    expect(detectMime(Buffer.from('GIF89a'), '')).toBe('image/gif')
    expect(detectMime(webp, '')).toBe('image/webp')
  })

  it('never lets a claim alone make a file previewable', () => {
    expect(detectMime(Buffer.from('<html>'), 'image/png')).toBe('application/octet-stream')
    expect(detectMime(Buffer.from('<html>'), 'application/pdf')).toBe('application/octet-stream')
  })

  it('keeps other well-formed claims and drops junk', () => {
    expect(detectMime(Buffer.from('<svg'), 'image/svg+xml')).toBe('image/svg+xml')
    expect(detectMime(Buffer.from('a,b'), 'Text/CSV; charset=utf-8')).toBe('text/csv')
    expect(detectMime(Buffer.from('x'), 'not a type')).toBe('application/octet-stream')
    expect(detectMime(Buffer.from('x'), 'text/html\r\nX-Evil: 1')).toBe('application/octet-stream')
    expect(detectMime(Buffer.alloc(0), undefined)).toBe('application/octet-stream')
  })
})

describe('contentDisposition', () => {
  it('gives an ASCII fallback and the exact UTF-8 name', () => {
    expect(contentDisposition('attachment', 'Отчёт (итог).pdf')).toBe(
      `attachment; filename="_____ (____).pdf"; filename*=UTF-8''%D0%9E%D1%82%D1%87%D1%91%D1%82%20%28%D0%B8%D1%82%D0%BE%D0%B3%29.pdf`,
    )
  })

  it('cannot be broken out of by quotes or backslashes', () => {
    const header = contentDisposition('inline', 'a"b\\c;d.png')
    expect(header).toBe(`inline; filename="a_b_c;d.png"; filename*=UTF-8''a%22b%5Cc%3Bd.png`)
    expect(header).toMatch(/^[\x20-\x7e]+$/)
  })
})
