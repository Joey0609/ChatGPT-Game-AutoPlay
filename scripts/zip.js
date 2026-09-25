/**
 * Minimal, dependency-free ZIP writer and reader.
 *
 * The repository has no `package.json` and no build tooling: the extension is plain JavaScript that
 * Chrome, Firefox and Edge load directly. The release workflow only needs to turn a folder into a
 * `.zip` the stores accept, so this file implements exactly that with the Node standard library
 * (`zlib.deflateRawSync` plus a CRC32 table) instead of pulling in a dependency.
 *
 * Entries are stored with "deflate" when that is smaller and uncompressed ("store") otherwise, the
 * UTF-8 name flag is always set, and every timestamp is the fixed 1980-01-01 epoch, so two builds of
 * the same sources produce byte-identical archives.
 *
 * `readZip` exists for the tests: it parses the central directory back and inflates every entry, so a
 * build can be verified without shelling out to `unzip`.
 */
'use strict';

const zlib = require('zlib');

const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const END_SIGNATURE = 0x06054b50;

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let index = 0; index < buffer.length; index += 1) {
    crc = CRC_TABLE[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

// 1980-01-01 00:00:00 in MS-DOS format: the oldest value the format can express.
const DOS_TIME = 0;
const DOS_DATE = (1 << 5) | 1;

function toBuffer(data) {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof Uint8Array) return Buffer.from(data);
  return Buffer.from(String(data), 'utf8');
}

function nameBuffer(name) {
  return Buffer.from(String(name).replace(/\\/g, '/'), 'utf8');
}

/**
 * Builds a ZIP archive.
 * @param {Array<{name: string, data: Buffer|Uint8Array|string}>} entries
 * @returns {Buffer}
 */
function createZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const name = nameBuffer(entry.name);
    const raw = toBuffer(entry.data);
    const deflated = zlib.deflateRawSync(raw, { level: 9 });
    const useDeflate = deflated.length < raw.length;
    const body = useDeflate ? deflated : raw;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIGNATURE, 0);
    local.writeUInt16LE(20, 4); // version needed to extract
    local.writeUInt16LE(0x0800, 6); // general purpose flags: file names are UTF-8
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_SIGNATURE, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra length
    central.writeUInt16LE(0, 32); // comment length
    central.writeUInt16LE(0, 34); // disk number start
    central.writeUInt16LE(0, 36); // internal attributes
    central.writeUInt32LE(0, 38); // external attributes
    central.writeUInt32LE(offset, 42); // local header offset
    centralParts.push(central, name);

    offset += local.length + name.length + body.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_SIGNATURE, 0);
  end.writeUInt16LE(0, 4); // this disk
  end.writeUInt16LE(0, 6); // disk with the central directory
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([Buffer.concat(localParts), centralDirectory, end]);
}

/**
 * Parses an archive produced by `createZip` (or any other writer) back into its entries.
 * @param {Buffer} buffer
 * @returns {Array<{name: string, data: Buffer, size: number, compressedSize: number, method: number, crc: number}>}
 */
function readZip(buffer) {
  let end = -1;
  for (let index = buffer.length - 22; index >= 0; index -= 1) {
    if (buffer.readUInt32LE(index) === END_SIGNATURE) { end = index; break; }
  }
  if (end < 0) throw new Error('Not a ZIP archive: the end-of-central-directory record is missing.');

  const count = buffer.readUInt16LE(end + 10);
  let cursor = buffer.readUInt32LE(end + 16);
  const entries = [];

  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) {
      throw new Error(`Corrupt ZIP: entry ${index} does not start with a central directory header.`);
    }
    const method = buffer.readUInt16LE(cursor + 10);
    const crc = buffer.readUInt32LE(cursor + 16);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const size = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.slice(cursor + 46, cursor + 46 + nameLength).toString('utf8');

    if (buffer.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) {
      throw new Error(`Corrupt ZIP: local header for ${name} is missing.`);
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const body = buffer.slice(dataStart, dataStart + compressedSize);
    const data = method === 0 ? Buffer.from(body) : zlib.inflateRawSync(body);

    if (data.length !== size) throw new Error(`Corrupt ZIP: ${name} has the wrong uncompressed size.`);
    if (crc32(data) !== crc) throw new Error(`Corrupt ZIP: ${name} failed its CRC check.`);

    entries.push({ name, data, size, compressedSize, method, crc });
    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

module.exports = { createZip, readZip, crc32 };
