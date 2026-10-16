/**
 * 把 ssh2 不认识的私钥格式转换成它认识的格式（只在内存里转换，不写盘）：
 * - PKCS#8（-----BEGIN PRIVATE KEY----- / BEGIN ENCRYPTED PRIVATE KEY，云服务器控制台、openssl 常见）
 *   → RSA 转 PKCS#1 PEM、EC 转 SEC1 PEM、Ed25519 转 OpenSSH 格式
 * - PuTTY .ppk 第 3 版（PuTTYgen 0.75+ 默认）的无密码私钥 → 同上
 *   （有密码的 ppk v3 用 Argon2 加密，提示在 PuTTYgen 里导出 OpenSSH 格式或 ppk v2）
 * 其余格式（OpenSSH、PKCS#1 / SEC1 PEM、ppk v2）ssh2 本身就支持，原样返回。
 */
import crypto from 'node:crypto'

function sshString(buf: Buffer | string): Buffer {
  const b = typeof buf === 'string' ? Buffer.from(buf) : buf
  const len = Buffer.alloc(4)
  len.writeUInt32BE(b.length)
  return Buffer.concat([len, b])
}

/** OpenSSH openssh-key-v1 格式的无密码 Ed25519 私钥 */
export function ed25519ToOpenSsh(seed: Buffer, pub: Buffer, comment = ''): string {
  const pubBlob = Buffer.concat([sshString('ssh-ed25519'), sshString(pub)])
  const check = crypto.randomBytes(4)
  let priv = Buffer.concat([check, check, sshString('ssh-ed25519'), sshString(pub), sshString(Buffer.concat([seed, pub])), sshString(comment)])
  const pad: number[] = []
  for (let i = 1; (priv.length + pad.length) % 8 !== 0; i++) pad.push(i)
  priv = Buffer.concat([priv, Buffer.from(pad)])
  const nkeys = Buffer.alloc(4)
  nkeys.writeUInt32BE(1)
  const blob = Buffer.concat([Buffer.from('openssh-key-v1\0'), sshString('none'), sshString('none'), sshString(''), nkeys, sshString(pubBlob), sshString(priv)])
  const b64 = blob.toString('base64').replace(/(.{70})/g, '$1\n').replace(/\n$/, '')
  return `-----BEGIN OPENSSH PRIVATE KEY-----\n${b64}\n-----END OPENSSH PRIVATE KEY-----\n`
}

function fromKeyObject(k: crypto.KeyObject): string {
  const type = k.asymmetricKeyType
  if (type === 'rsa') return String(k.export({ type: 'pkcs1', format: 'pem' }))
  if (type === 'ec') return String(k.export({ type: 'sec1', format: 'pem' }))
  if (type === 'ed25519') {
    const jwk = k.export({ format: 'jwk' }) as any
    return ed25519ToOpenSsh(Buffer.from(jwk.d, 'base64url'), Buffer.from(jwk.x, 'base64url'))
  }
  throw new Error(`不支持的私钥算法：${type}（支持 RSA、ECDSA、Ed25519）`)
}

// ─── PuTTY ppk v3（无密码）────────────────────────────────────────────────

class Reader {
  private o = 0
  constructor(private b: Buffer) {}
  bytes(): Buffer {
    const n = this.b.readUInt32BE(this.o)
    const out = this.b.subarray(this.o + 4, this.o + 4 + n)
    this.o += 4 + n
    return out
  }
  str(): string { return this.bytes().toString('utf8') }
}

/** mpint → 无符号大端字节（去掉符号位补的 0） */
function unsigned(b: Buffer): Buffer {
  let i = 0
  while (i < b.length - 1 && b[i] === 0) i++
  return b.subarray(i)
}
const toBig = (b: Buffer) => BigInt(`0x${unsigned(b).toString('hex') || '0'}`)
const fromBig = (n: bigint) => {
  let hex = n.toString(16)
  if (hex.length % 2) hex = `0${hex}`
  return Buffer.from(hex, 'hex')
}
const b64u = (b: Buffer) => unsigned(b).toString('base64url')

function ppkV3ToSupported(text: string): string {
  const field = (name: string) => (text.match(new RegExp(`^${name}:\\s*(.*)$`, 'm')) || [])[1]?.trim() || ''
  const lines = (name: string) => {
    const m = text.match(new RegExp(`^${name}-Lines:\\s*(\\d+)\\s*$`, 'm'))
    if (!m) throw new Error('PuTTY 私钥文件不完整')
    const start = text.slice(m.index! + m[0].length).split('\n').map((l) => l.trim()).filter(Boolean)
    return Buffer.from(start.slice(0, Number(m[1])).join(''), 'base64')
  }
  const algo = (text.match(/^PuTTY-User-Key-File-3:\s*(\S+)/m) || [])[1] || ''
  if (field('Encryption') !== 'none') {
    throw new Error('这是有密码的 PuTTY 3 格式私钥（.ppk）：请在 PuTTYgen 里加载后用「Conversions → Export OpenSSH key」导出，或「Key → Parameters for saving key files」选 PPK 版本 2 再保存')
  }
  const pub = new Reader(lines('Public'))
  const priv = new Reader(lines('Private'))
  const type = pub.str()
  if (type !== algo) throw new Error('PuTTY 私钥文件已损坏（算法不一致）')
  if (type === 'ssh-ed25519') {
    const pk = pub.bytes()
    const seed = priv.bytes()
    return ed25519ToOpenSsh(unsigned(seed).length === 32 ? seed.subarray(seed.length - 32) : seed, pk)
  }
  if (type === 'ssh-rsa') {
    const e = pub.bytes(); const n = pub.bytes()
    const d = priv.bytes(); const p = priv.bytes(); const q = priv.bytes(); const iqmp = priv.bytes()
    const D = toBig(d)
    const jwk = {
      kty: 'RSA', n: b64u(n), e: b64u(e), d: b64u(d), p: b64u(p), q: b64u(q),
      dp: fromBig(D % (toBig(p) - 1n)).toString('base64url'), dq: fromBig(D % (toBig(q) - 1n)).toString('base64url'), qi: b64u(iqmp),
    }
    return fromKeyObject(crypto.createPrivateKey({ key: jwk as any, format: 'jwk' }))
  }
  const ec: Record<string, { crv: string; size: number }> = {
    'ecdsa-sha2-nistp256': { crv: 'P-256', size: 32 },
    'ecdsa-sha2-nistp384': { crv: 'P-384', size: 48 },
    'ecdsa-sha2-nistp521': { crv: 'P-521', size: 66 },
  }
  if (ec[type]) {
    pub.str() // curve 名称
    const Q = pub.bytes()
    const d = unsigned(priv.bytes())
    const { crv, size } = ec[type]
    const pad = (b: Buffer) => Buffer.concat([Buffer.alloc(Math.max(0, size - b.length)), b])
    const jwk = { kty: 'EC', crv, x: Q.subarray(1, 1 + size).toString('base64url'), y: Q.subarray(1 + size).toString('base64url'), d: pad(d).toString('base64url') }
    return fromKeyObject(crypto.createPrivateKey({ key: jwk as any, format: 'jwk' }))
  }
  throw new Error(`不支持的 PuTTY 私钥算法：${type}`)
}

/**
 * 返回 ssh2 能直接用的私钥；转换过的私钥已经解密，passphrase 置空。
 * 密码缺失 / 错误抛出中文错误。
 */
export function normalizePrivateKey(key: string, passphrase?: string): { key: string; passphrase?: string; converted: string | null } {
  if (/-----BEGIN (ENCRYPTED )?PRIVATE KEY-----/.test(key)) {
    const encrypted = /BEGIN ENCRYPTED PRIVATE KEY/.test(key)
    if (encrypted && !passphrase) throw new Error('这个私钥有密码保护，请填写「私钥密码」')
    let k: crypto.KeyObject
    try {
      k = crypto.createPrivateKey({ key, format: 'pem', passphrase: encrypted ? passphrase : undefined })
    } catch {
      throw new Error(encrypted ? '私钥密码不对' : '私钥内容不完整或已损坏（PKCS#8）')
    }
    return { key: fromKeyObject(k), passphrase: undefined, converted: 'PKCS#8' }
  }
  if (/^PuTTY-User-Key-File-3:/m.test(key)) return { key: ppkV3ToSupported(key), passphrase: undefined, converted: 'PuTTY ppk v3' }
  return { key, passphrase, converted: null }
}
