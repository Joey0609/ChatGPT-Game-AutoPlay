/**
 * CRX3 packing, dependency-free.
 *
 * Chrome and Edge install `.crx` files only when they are signed, and the only thing the signature
 * carries is the *extension id*: the first 16 bytes of SHA-256 over the DER public key, mapped to
 * `a`-`p`. A CRX signed with a fresh key therefore gets a brand-new id and Chrome refuses to install
 * it unless that id is explicitly allowed (enterprise policy, `--load-extension` keeps working with
 * the unpacked folder, or the Web Store, which signs with the key it generated for your listing).
 * The workflow only produces a `.crx` when the repository secret `CRX_PRIVATE_KEY` exists, so that
 * everyone who needs one can get the *same* id release after release.
 *
 * Layout (see the CRX3 design document):
 *   "Cr24" | uint32le(3) | uint32le(header length) | CrxFileHeader (protobuf) | zip
 * where the protobuf header holds the RSA public key + signature (field 2) and the signed header
 * data (field 10000, itself a protobuf holding the 16-byte crx id in field 1), and the signature is
 * RSA-PKCS#1 v1.5 over:
 *   "CRX3 SignedData\0" | uint32le(len(signed header data)) | signed header data | zip
 */
'use strict';

const crypto = require('crypto');

const MAGIC = 'Cr24';
const CRX_VERSION = 3;
const SIGNED_DATA_PREFIX = Buffer.from('CRX3 SignedData\x00', 'binary');
const ID_BYTES = 16;

// ------------------------------------------------------------------ protobuf primitives

function varint(value) {
  const bytes = [];
  let rest = value;
  do {
    let byte = rest & 0x7f;
    rest >>>= 7;
    if (rest) byte |= 0x80;
    bytes.push(byte);
  } while (rest);
  return Buffer.from(bytes);
}

function tag(fieldNumber, wireType) {
  return varint((fieldNumber << 3) | wireType);
}

// Length-delimited field (wire type 2): used for every field in the CRX header.
function bytesField(fieldNumber, payload) {
  return Buffer.concat([tag(fieldNumber, 2), varint(payload.length), payload]);
}

class Reader {
  constructor(buffer) {
    this.buffer = buffer;
    this.offset = 0;
  }

  get done() {
    return this.offset >= this.buffer.length;
  }

  varint() {
    let result = 0;
    let shift = 0;
    for (;;) {
      const byte = this.buffer[this.offset];
      this.offset += 1;
      result += (byte & 0x7f) * Math.pow(2, shift);
      if (!(byte & 0x80)) return result;
      shift += 7;
      if (shift > 56) throw new Error('Malformed protobuf: the varint is too long.');
    }
  }

  lengthDelimited() {
    const length = this.varint();
    const value = this.buffer.slice(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }
}

// ------------------------------------------------------------------ key helpers

function publicKeyOf(privateKey) {
  return crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
}

function crxIdOf(publicKeyDer) {
  return crypto.createHash('sha256').update(publicKeyDer).digest().subarray(0, ID_BYTES);
}

// The id Chrome shows in chrome://extensions: every hex nibble becomes 'a'..'p'.
function extensionIdOf(publicKeyDer) {
  return Array.from(crxIdOf(publicKeyDer).toString('hex'))
    .map((nibble) => String.fromCharCode(97 + parseInt(nibble, 16)))
    .join('');
}

// ------------------------------------------------------------------ packing

/**
 * @param {Buffer} archive A ZIP file (the packed extension).
 * @param {string|Buffer|object} privateKey PEM string, or anything `crypto.sign` accepts.
 * @returns {{buffer: Buffer, extensionId: string, crxId: Buffer, publicKey: Buffer}}
 */
function pack(archive, privateKey) {
  if (!Buffer.isBuffer(archive)) throw new TypeError('pack() needs the ZIP archive as a Buffer.');

  const publicKey = publicKeyOf(privateKey);
  const crxId = crxIdOf(publicKey);
  const signedHeaderData = bytesField(1, crxId); // SignedData { bytes crx_id = 1; }

  const signed = Buffer.concat([
    SIGNED_DATA_PREFIX,
    uint32le(signedHeaderData.length),
    signedHeaderData,
    archive
  ]);
  const signature = crypto.sign('sha256', signed, privateKey);
  const proof = Buffer.concat([bytesField(1, publicKey), bytesField(2, signature)]);
  const header = Buffer.concat([bytesField(2, proof), bytesField(10000, signedHeaderData)]);

  const prefix = Buffer.alloc(12);
  prefix.write(MAGIC, 0, 'binary');
  prefix.writeUInt32LE(CRX_VERSION, 4);
  prefix.writeUInt32LE(header.length, 8);

  return {
    buffer: Buffer.concat([prefix, header, archive]),
    extensionId: extensionIdOf(publicKey),
    crxId,
    publicKey
  };
}

function uint32le(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0, 0);
  return buffer;
}

// ------------------------------------------------------------------ verification

function parse(crx) {
  if (!Buffer.isBuffer(crx) || crx.length < 12) throw new Error('Not a CRX file: it is too short.');
  if (crx.slice(0, 4).toString('binary') !== MAGIC) throw new Error('Not a CRX file: the Cr24 magic is missing.');
  const version = crx.readUInt32LE(4);
  if (version !== CRX_VERSION) throw new Error(`Unsupported CRX version ${version}.`);
  const headerLength = crx.readUInt32LE(8);
  const header = crx.slice(12, 12 + headerLength);
  const archive = crx.slice(12 + headerLength);

  const reader = new Reader(header);
  const proofs = [];
  let signedHeaderData = null;
  while (!reader.done) {
    const key = reader.varint();
    const field = key >>> 3;
    const wire = key & 7;
    if (wire !== 2) throw new Error(`Malformed CRX header: field ${field} is not length-delimited.`);
    const value = reader.lengthDelimited();
    if (field === 2) {
      const proof = new Reader(value);
      const entry = { publicKey: null, signature: null };
      while (!proof.done) {
        const proofKey = proof.varint();
        const proofField = proofKey >>> 3;
        if ((proofKey & 7) !== 2) throw new Error('Malformed CRX header: bad key proof field.');
        const proofValue = proof.lengthDelimited();
        if (proofField === 1) entry.publicKey = proofValue;
        else if (proofField === 2) entry.signature = proofValue;
      }
      proofs.push(entry);
    } else if (field === 10000) {
      signedHeaderData = value;
    }
  }

  return { version, headerLength, header, archive, proofs, signedHeaderData };
}

/**
 * Full structural check: recomputes the crx id from the embedded public key and verifies the RSA
 * signature over the archive. Used by `test/test-build.js` so a broken packer cannot ship.
 */
function verify(crx) {
  const problems = [];
  let parsed;
  try {
    parsed = parse(crx);
  } catch (error) {
    return { ok: false, problems: [String(error.message || error)], extensionId: null };
  }

  if (!parsed.signedHeaderData) problems.push('The signed header data is missing.');
  if (!parsed.proofs.length) problems.push('No RSA key proof is present.');
  if (!parsed.archive.length) problems.push('The archive payload is empty.');

  const signedData = (() => {
    const reader = new Reader(parsed.signedHeaderData || Buffer.alloc(0));
    let crxId = null;
    while (!reader.done) {
      const key = reader.varint();
      const value = reader.lengthDelimited();
      if ((key >>> 3) === 1) crxId = value;
    }
    return crxId;
  })();

  let extensionId = null;
  for (const proof of parsed.proofs) {
    if (!proof.publicKey || !proof.signature) {
      problems.push('A key proof is missing its public key or signature.');
      continue;
    }
    const expectedId = crxIdOf(proof.publicKey);
    if (!signedData || !expectedId.equals(signedData)) {
      problems.push('The signed crx id does not match SHA-256 of the public key.');
    }
    if (!extensionId) extensionId = extensionIdOf(proof.publicKey);
    const signed = Buffer.concat([
      SIGNED_DATA_PREFIX,
      uint32le((parsed.signedHeaderData || Buffer.alloc(0)).length),
      parsed.signedHeaderData || Buffer.alloc(0),
      parsed.archive
    ]);
    const label = crxIdOf(proof.publicKey).toString('hex');
    let valid = false;
    try {
      // The embedded DER key needs no PEM wrapper for the verification API.
      const key = crypto.createPublicKey({ key: proof.publicKey, format: 'der', type: 'spki' });
      valid = crypto.verify('sha256', signed, key, proof.signature);
    } catch (error) {
      problems.push(`Could not verify the signature for ${label}: ${error.message}`);
    }
    if (!valid) problems.push(`The signature does not verify for ${label}.`);
  }

  return { ok: problems.length === 0, problems, extensionId, parsed };
}

module.exports = { pack, parse, verify, crxIdOf, extensionIdOf, publicKeyOf, CRX_VERSION };
