import { generateKeyPair, randomBytes, sign } from "node:crypto";
import { promisify } from "node:util";

const generateKeys = promisify(generateKeyPair);
const OIDS = Object.freeze({
  SHA256_RSA: "1.2.840.113549.1.1.11", COMMON_NAME: "2.5.4.3",
  BASIC_CONSTRAINTS: "2.5.29.19", SUBJECT_ALT_NAME: "2.5.29.17",
});
const TAGS = Object.freeze({
  BOOLEAN: 0x01, INTEGER: 0x02, BIT_STRING: 0x03, OCTET_STRING: 0x04,
  NULL: 0x05, OID: 0x06, UTF8_STRING: 0x0c, UTC_TIME: 0x17,
  SEQUENCE: 0x30, SET: 0x31, DNS_NAME: 0x82, VERSION: 0xa0, EXTENSIONS: 0xa3,
});
const LENGTHS = Object.freeze({ SHORT_MAX: 128, BYTE_MAX: 256, ONE_OCTET: 0x81, TWO_OCTETS: 0x82 });
const BITS = Object.freeze({ BYTE_SHIFT: 8, BYTE_MASK: 0xff, OID_SHIFT: 7, OID_MASK: 0x7f, CONTINUE: 0x80 });
const OID_FIRST_ARC_RADIX = 40;
const SERIAL_BYTES = 16;
const UTC_DIGITS_END = 14;
const CERT_LIFETIME_MS = 86_400_000;
const CERT_CLOCK_MARGIN_MS = 60_000;
const RSA_MODULUS_BITS = 2048;

function der(tag, ...contents) {
  const bytes = Buffer.concat(contents);
  const encodedLength = bytes.length < LENGTHS.SHORT_MAX
    ? Buffer.from([bytes.length])
    : bytes.length < LENGTHS.BYTE_MAX ? Buffer.from([LENGTHS.ONE_OCTET, bytes.length])
      : Buffer.from([LENGTHS.TWO_OCTETS, bytes.length >> BITS.BYTE_SHIFT, bytes.length & BITS.BYTE_MASK]);
  return Buffer.concat([Buffer.from([tag]), encodedLength, bytes]);
}

function oid(value) {
  const parts = value.split(".").map(Number);
  const encoded = [parts[0] * OID_FIRST_ARC_RADIX + parts[1]];
  for (const part of parts.slice(2)) {
    const digits = [part & BITS.OID_MASK];
    let remaining = part >>> BITS.OID_SHIFT;
    while (remaining) { digits.unshift(BITS.CONTINUE | (remaining & BITS.OID_MASK)); remaining >>>= BITS.OID_SHIFT; }
    encoded.push(...digits);
  }
  return der(TAGS.OID, Buffer.from(encoded));
}

const sequence = (...bytes) => der(TAGS.SEQUENCE, ...bytes);
const algorithm = () => sequence(oid(OIDS.SHA256_RSA), der(TAGS.NULL));
const name = (text) => sequence(der(TAGS.SET, sequence(oid(OIDS.COMMON_NAME), der(TAGS.UTF8_STRING, Buffer.from(text)))));
const pem = (label, bytes) => `-----BEGIN ${label}-----\n${bytes.toString("base64").match(/.{1,64}/g).join("\n")}\n-----END ${label}-----\n`;

function certificate({ publicKey, signingKey, subject, issuer, isCa, hosts = [] }) {
  const time = (milliseconds) => {
    const stamp = new Date(milliseconds).toISOString().replace(/[-:T]/g, "").slice(2, UTC_DIGITS_END) + "Z";
    return der(TAGS.UTC_TIME, Buffer.from(stamp));
  };
  const serialBytes = randomBytes(SERIAL_BYTES);
  serialBytes[0] |= BITS.CONTINUE;
  const serial = der(TAGS.INTEGER, Buffer.concat([Buffer.from([0]), serialBytes]));
  const constraints = sequence(
    oid(OIDS.BASIC_CONSTRAINTS), der(TAGS.BOOLEAN, Buffer.from([BITS.BYTE_MASK])),
    der(TAGS.OCTET_STRING, isCa ? sequence(der(TAGS.BOOLEAN, Buffer.from([BITS.BYTE_MASK]))) : sequence()),
  );
  const extensions = [constraints];
  if (hosts.length) extensions.push(sequence(
    oid(OIDS.SUBJECT_ALT_NAME), der(TAGS.OCTET_STRING, sequence(...hosts.map((host) => der(TAGS.DNS_NAME, Buffer.from(host))))),
  ));
  const now = Date.now();
  const tbs = sequence(
    der(TAGS.VERSION, der(TAGS.INTEGER, Buffer.from([2]))), serial, algorithm(), name(issuer),
    sequence(time(now - CERT_CLOCK_MARGIN_MS), time(now + CERT_LIFETIME_MS)), name(subject),
    publicKey.export({ type: "spki", format: "der" }), der(TAGS.EXTENSIONS, sequence(...extensions)),
  );
  return pem("CERTIFICATE", sequence(tbs, algorithm(), der(TAGS.BIT_STRING, Buffer.concat([Buffer.from([0]), sign("sha256", tbs, signingKey)]))));
}

/** Generate fresh fixture-only trust and server keys; never bake or print private keys. */
export async function generateFixtureTls(namespace) {
  const issuer = "Disposable Kubernetes fixture CA";
  const host = `pforge-claw-dispatcher.${namespace}.svc`;
  const [caKeys, serverKeys] = await Promise.all([
    generateKeys("rsa", { modulusLength: RSA_MODULUS_BITS }),
    generateKeys("rsa", { modulusLength: RSA_MODULUS_BITS }),
  ]);
  const ca = certificate({ publicKey: caKeys.publicKey, signingKey: caKeys.privateKey, subject: issuer, issuer, isCa: true });
  const cert = certificate({
    publicKey: serverKeys.publicKey, signingKey: caKeys.privateKey, subject: host, issuer, isCa: false,
    hosts: [host, `${host}.cluster.local`, "pforge-claw-dispatcher", "localhost"],
  });
  const key = serverKeys.privateKey.export({ type: "pkcs8", format: "pem" });
  return { ca, cert, key };
}
