// Zip files without compression ("stored") — a few files leave the app as one download (the print model: its STL parts, the
// report and the preview). The bytes of every file stay exactly as made, so an STL inside is the same file the CLI writes.
const enc = new TextEncoder();

let CRC: Uint32Array | null = null;
/** CRC-32 (zip, PNG) */
export function crc32(b: Uint8Array): number {
  if (!CRC) { CRC = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; } }
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** a zip archive of the files in the given order (UTF-8 names, a fixed date: the same files make the same archive) */
export function zipStore(files: { name: string; bytes: Uint8Array }[]): Uint8Array {
  const local: Uint8Array[] = [], central: Uint8Array[] = [];
  let offset = 0;
  // 1 January 2020, 00:00 in DOS date / time
  const time = 0, date = ((2020 - 1980) << 9) | (1 << 5) | 1;
  for (const f of files) {
    const name = enc.encode(f.name), crc = crc32(f.bytes), n = f.bytes.length;
    const h = new Uint8Array(30 + name.length), v = new DataView(h.buffer);
    v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(6, 0x0800, true); v.setUint16(8, 0, true);
    v.setUint16(10, time, true); v.setUint16(12, date, true); v.setUint32(14, crc, true); v.setUint32(18, n, true); v.setUint32(22, n, true);
    v.setUint16(26, name.length, true); v.setUint16(28, 0, true); h.set(name, 30);
    const c = new Uint8Array(46 + name.length), w = new DataView(c.buffer);
    w.setUint32(0, 0x02014b50, true); w.setUint16(4, 20, true); w.setUint16(6, 20, true); w.setUint16(8, 0x0800, true); w.setUint16(10, 0, true);
    w.setUint16(12, time, true); w.setUint16(14, date, true); w.setUint32(16, crc, true); w.setUint32(20, n, true); w.setUint32(24, n, true);
    w.setUint16(28, name.length, true); w.setUint32(42, offset, true); c.set(name, 46);
    local.push(h, f.bytes); central.push(c);
    offset += h.length + n;
  }
  const size = central.reduce((s, c) => s + c.length, 0), end = new Uint8Array(22), e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, size, true); e.setUint32(16, offset, true);
  const out = new Uint8Array(offset + size + 22);
  let p = 0;
  for (const part of [...local, ...central, end]) { out.set(part, p); p += part.length; }
  return out;
}
