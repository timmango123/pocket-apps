// Core tests for JWT 與網址解析 (jwt-decode). Usage: node tests.js
// Expected values come from independent implementations: Python's hmac/base64/json/urllib/datetime
// (run as a subprocess), Node's crypto for RSA/PSS/ECDSA/Ed25519 signatures, Node's url.domainToASCII/Unicode
// and WHATWG URL, and OpenSSL-made X.509 certificates (embedded below).
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const nc = require('crypto'), nurl = require('url');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const JD = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return JD;')();
const subtle = globalThis.crypto.subtle;
let pass = 0, fail = 0;
const S = x => JSON.stringify(x);
function ok(c, msg) { if (c) pass++; else { fail++; console.log('FAIL', msg); } }
function eq(a, b, msg) { ok(S(a) === S(b), `${msg}\n   got  ${S(a)}\n   want ${S(b)}`); }
const CERTS = {"rsa": {"token": "eyJhbGciOiJSUzI1NiIsIng1YyI6WyJNSUlERFRDQ0FmV2dBd0lCQWdJVVcxdHkzdDVjTkIzWVFJaXVVZUYzKzZuOHF6NHdEUVlKS29aSWh2Y05BUUVMQlFBd0ZqRVVNQklHQTFVRUF3d0xjRzlqYTJWMElIUmxjM1F3SGhjTk1qWXhNREkwTVRRME16TTVXaGNOTXpZeE1ESXhNVFEwTXpNNVdqQVdNUlF3RWdZRFZRUUREQXR3YjJOclpYUWdkR1Z6ZERDQ0FTSXdEUVlKS29aSWh2Y05BUUVCQlFBRGdnRVBBRENDQVFvQ2dnRUJBSjlGQmlXK210MXgyVGFtUWk3RHFhdXJXS1JqUjVpOWgrNEdtNDVKY2JPNkY2czI3TGNZVW4xNmFUKyt6U1dQZWk4Y2xxVjBqNjNxWVI0N3dxWEJyU3RDOWNXQUozMGZMY1dMV0ptMFhkZDIyd2JwTE5iMzk4eVdhemdZOFNYQ2RGOW1iR0NtVytLeVNhWEFSKzhMekphWEs0Y1lGeFVJcE5oU24xVDlVaFlDN0k5Nk1iZUdsR1VwbUFtYzJCZlV3dVF2WXl1NEorYitweHFONUlCYjlLZUh1RkphOHNESmF4YnhaT0VIVlJSaEJmK2hIbFlldDZ5RFFzTGVPbTM3RE42UkZucjBMc3AvZllkKyt6Yk5MQnVucFdZcVdnUm94SDhXYlNzNy9ZRkREMy9nMEp2c0ExVU5pblNaRTV3L0NZT3laeTNLdXhkV3Y3ZHkyNThZQmwwQ0F3RUFBYU5UTUZFd0hRWURWUjBPQkJZRUZNb3RwKy81WE1BV2txbVk1eHlHY0RwbzErQWxNQjhHQTFVZEl3UVlNQmFBRk1vdHArLzVYTUFXa3FtWTV4eUdjRHBvMStBbE1BOEdBMVVkRXdFQi93UUZNQU1CQWY4d0RRWUpLb1pJaHZjTkFRRUxCUUFEZ2dFQkFFTTVFUUJDM0U0eTM0RDlsNHk3dk9EamUzUUpkSG8ycnE2YmxrcDEwRUlSQkc1c3FXc0w1RjVndVJnRXhRY1dpNGEvcUJxdjdZVEJna3pwVmtiUEVmbUc1enpYRkV4dldHdE9pclJ6ZGtSWXlITVcrSjlpV1JJM1lBTitVYTk0VlRNY280cWMyVkZSbDFWMUtObGRHeklUY2hGRGQzNTJsT2FYdVdzMW1TeU9jTFppNi9xbTlkbDRJTTdTaklHa0dOZkJ0ck90YzZpL0hOUG5KZXFJR05DdWRYa3hOM09DcmxlRHg3WmU0NVZwSnZPQ2NnZXZEWTZLb3BVeHFwSFl5OTFrVVJyclhJRjdxRUs3ZjNYYnJLRm1iWmRTRUlCMmRSVTdzcjJSTkZOZEYvVE83ZVI3MUZGV1dHdStxSEJVYVhIV0ZmRmNoRnlPSm1LNURRQmhZSTA9Il19.eyJzdWIiOiJjZXJ0LXJzYSIsImlhdCI6MTcwMDAwMDAwMH0.kGlr357EJt5zBtDNVWaQu5NTtb9hwxMd2lngnRoRr6wF6nsvenD2jx0ro4GPzCQE9aGYT6uWXqFyQUxBmTTTw-aIBaTtj8g3K2PHXXvJVZTp8tWk-s-ztgDz6k8IS-Si81oo3g1TKm-cSfkEbbX-xutpW6bIq5EylqAjhDNXeGytAdhYsrRezPmOGVAElKjqq2vSsARBHbqCVmfQqbFq9dkLS2SGuAfDRH8Lf9us3KqIO_6hUFJVZIfkBfXX0NJJr5d2b-55Nfozb1QG8U4zTPrZAsRCa9X3GEe6U1pWZ0Z6ZUHeZhgRVFBgf4PwtGjZ_zsHa_Nx8xDHvLLeS9Uivg", "cert": "-----BEGIN CERTIFICATE-----\nMIIDDTCCAfWgAwIBAgIUW1ty3t5cNB3YQIiuUeF3+6n8qz4wDQYJKoZIhvcNAQEL\nBQAwFjEUMBIGA1UEAwwLcG9ja2V0IHRlc3QwHhcNMjYxMDI0MTQ0MzM5WhcNMzYx\nMDIxMTQ0MzM5WjAWMRQwEgYDVQQDDAtwb2NrZXQgdGVzdDCCASIwDQYJKoZIhvcN\nAQEBBQADggEPADCCAQoCggEBAJ9FBiW+mt1x2TamQi7DqaurWKRjR5i9h+4Gm45J\ncbO6F6s27LcYUn16aT++zSWPei8clqV0j63qYR47wqXBrStC9cWAJ30fLcWLWJm0\nXdd22wbpLNb398yWazgY8SXCdF9mbGCmW+KySaXAR+8LzJaXK4cYFxUIpNhSn1T9\nUhYC7I96MbeGlGUpmAmc2BfUwuQvYyu4J+b+pxqN5IBb9KeHuFJa8sDJaxbxZOEH\nVRRhBf+hHlYet6yDQsLeOm37DN6RFnr0Lsp/fYd++zbNLBunpWYqWgRoxH8WbSs7\n/YFDD3/g0JvsA1UNinSZE5w/CYOyZy3KuxdWv7dy258YBl0CAwEAAaNTMFEwHQYD\nVR0OBBYEFMotp+/5XMAWkqmY5xyGcDpo1+AlMB8GA1UdIwQYMBaAFMotp+/5XMAW\nkqmY5xyGcDpo1+AlMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEB\nAEM5EQBC3E4y34D9l4y7vODje3QJdHo2rq6blkp10EIRBG5sqWsL5F5guRgExQcW\ni4a/qBqv7YTBgkzpVkbPEfmG5zzXFExvWGtOirRzdkRYyHMW+J9iWRI3YAN+Ua94\nVTMco4qc2VFRl1V1KNldGzITchFDd352lOaXuWs1mSyOcLZi6/qm9dl4IM7SjIGk\nGNfBtrOtc6i/HNPnJeqIGNCudXkxN3OCrleDx7Ze45VpJvOCcgevDY6KopUxqpHY\ny91kURrrXIF7qEK7f3XbrKFmbZdSEIB2dRU7sr2RNFNdF/TO7eR71FFWWGu+qHBU\naXHWFfFchFyOJmK5DQBhYI0=\n-----END CERTIFICATE-----"}, "ec": {"token": "eyJhbGciOiJFUzI1NiIsIng1YyI6WyJNSUlCZWpDQ0FSK2dBd0lCQWdJVVdQNEhrRTVsUUdHaXRBcHkrZG5hTG5OUFdqSXdDZ1lJS29aSXpqMEVBd0l3RWpFUU1BNEdBMVVFQXd3SFpXTWdkR1Z6ZERBZUZ3MHlOakV3TWpReE5EUXpNemxhRncwek5qRXdNakV4TkRRek16bGFNQkl4RURBT0JnTlZCQU1NQjJWaklIUmxjM1F3V1RBVEJnY3Foa2pPUFFJQkJnZ3Foa2pPUFFNQkJ3TkNBQVNKOHJIVWxPUUpYTUxYTlJGMCtwbDVvME5tRzZ2cWpBUFlacmhodjhoV2F0ZSsvR2FsejFTc25kNmJYUzZ4ZVh4K2ltV1Zvb091ZmdWMlZUSHQzWDNsbzFNd1VUQWRCZ05WSFE0RUZnUVU3VGs0bjRkMndHUEtwbCtVNDBNTDdhdzQ4K013SHdZRFZSMGpCQmd3Rm9BVTdUazRuNGQyd0dQS3BsK1U0ME1MN2F3NDgrTXdEd1lEVlIwVEFRSC9CQVV3QXdFQi96QUtCZ2dxaGtqT1BRUURBZ05KQURCR0FpRUF5R0t3MEZYd1dlNG9TY05lL1I4bGZBeDNRV2ZIT1BQR3pYU2VqL2lNQjk0Q0lRQ2JHb2c2emRXeUhwdzY4QlFmU3VSc1kwVkpHL2doUmcrdTZDYjVxNWlGakE9PSJdfQ.eyJzdWIiOiJjZXJ0LWVjIiwiaWF0IjoxNzAwMDAwMDAwfQ.MZSu03hlCEXAeqbeCnomKhh_FJRPIKZLMCC8rsIx7Y8zSIHmuMgCwnqQVYkQxEep_Duf6svozZ3FIQn_614NCA", "cert": "-----BEGIN CERTIFICATE-----\nMIIBejCCAR+gAwIBAgIUWP4HkE5lQGGitApy+dnaLnNPWjIwCgYIKoZIzj0EAwIw\nEjEQMA4GA1UEAwwHZWMgdGVzdDAeFw0yNjEwMjQxNDQzMzlaFw0zNjEwMjExNDQz\nMzlaMBIxEDAOBgNVBAMMB2VjIHRlc3QwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNC\nAASJ8rHUlOQJXMLXNRF0+pl5o0NmG6vqjAPYZrhhv8hWate+/Galz1Ssnd6bXS6x\neXx+imWVooOufgV2VTHt3X3lo1MwUTAdBgNVHQ4EFgQU7Tk4n4d2wGPKpl+U40ML\n7aw48+MwHwYDVR0jBBgwFoAU7Tk4n4d2wGPKpl+U40ML7aw48+MwDwYDVR0TAQH/\nBAUwAwEB/zAKBggqhkjOPQQDAgNJADBGAiEAyGKw0FXwWe4oScNe/R8lfAx3QWfH\nOPPGzXSej/iMB94CIQCbGog6zdWyHpw68BQfSuRsY0VJG/ghRg+u6Cb5q5iFjA==\n-----END CERTIFICATE-----"}};
const b64u = o => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');

// ---------- independent fixtures from Python ----------
const PY = String.raw`
import hmac, hashlib, base64, json, sys, datetime
from urllib.parse import parse_qsl, unquote, unquote_plus, urlsplit
def b64u(b): return base64.urlsafe_b64encode(b).rstrip(b'=').decode()
def tok(h, p, key, hn):
    si = b64u(json.dumps(h, ensure_ascii=False).encode()) + '.' + b64u(json.dumps(p, ensure_ascii=False).encode())
    return si + '.' + b64u(hmac.new(key, si.encode(), getattr(hashlib, hn)).digest())
out = {'hs': [], 'tw': [], 'qs': [], 'unq': []}
secrets = [('text', 'your-256-bit-secret', b'your-256-bit-secret'), ('text', '密鑰🔑 with spaces', '密鑰🔑 with spaces'.encode()),
           ('b64', base64.b64encode(bytes(range(64))).decode(), bytes(range(64))), ('hex', 'deadbeef' * 8, bytes.fromhex('deadbeef' * 8))]
for alg, hn in (('HS256', 'sha256'), ('HS384', 'sha384'), ('HS512', 'sha512')):
    for enc, given, raw in secrets:
        p = {'sub': '王小明', 'n': 12345678901234567890, 'f': 1.5, 'arr': [True, None], 'emoji': '😀', 'iat': 1700000000, 'exp': 1700003600}
        out['hs'].append({'alg': alg, 'enc': enc, 'secret': given, 'token': tok({'alg': alg, 'typ': 'JWT'}, p, raw, hn), 'payload': json.dumps(p, indent=2, ensure_ascii=False)})
tz = datetime.timezone(datetime.timedelta(hours=8))
for t in (0, 1, 1516239022, 1700000000, 1792847405, 1999999999, 2147483647, 4102444800, 253402271999, -86400):
    d = datetime.datetime.fromtimestamp(t, tz)
    out['tw'].append([t, d.strftime('%Y/%m/%d') + '（' + '一二三四五六日'[d.weekday()] + '）' + d.strftime('%H:%M:%S'), datetime.datetime.fromtimestamp(t, datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')])
for q in ('a=1&b=2', 'keyword=%E7%8F%8D%E7%8F%A0%E5%A5%B6%E8%8C%B6&size=L', 'q=a+b%2Bc&empty=&flag', 'x=%25E4%25B8%25AD&y=%E4%B8%AD%E6%96%87',
          'redirect=https%3A%2F%2Fa.com%2F%3Fx%3D1%26y%3D2&k=v=w', 'emoji=%F0%9F%98%80&sp=%20lead%20', 'dup=1&dup=2&dup=3', '%E5%90%8D=%E5%80%BC&a%5B%5D=1'):
    out['qs'].append([q, parse_qsl(q, keep_blank_values=True)])
for s in ('%E4%B8%AD%E6%96%87', 'a%20b+c', '100%25', '%2541', '%F0%9F%98%80%21', 'caf%C3%A9'):
    out['unq'].append([s, unquote(s), unquote_plus(s)])
out['big5'] = bytes([0xA4, 0xA4, 0xA4, 0xE5, 0xA6, 0x72, 0xC5, 0xE9]).decode('big5')
print(json.dumps(out, ensure_ascii=False))
`;
const py = spawnSync('python3', ['-c', PY], { encoding: 'utf8' });
if (py.status !== 0) { console.log('FAIL python fixtures could not run: ' + py.stderr); process.exit(1); }
const FX = JSON.parse(py.stdout);

(async () => {
  /* ---------- base64url ---------- */
  for (const n of [0, 1, 2, 3, 4, 5, 31, 32, 33, 255]) {
    const buf = nc.randomBytes(n);
    eq(JD.b64urlEnc(new Uint8Array(buf)), buf.toString('base64url'), `b64url encode ${n} bytes`);
    eq(Buffer.from(JD.b64dec(buf.toString('base64url')).bytes).toString('hex'), buf.toString('hex'), `b64url decode ${n} bytes`);
    eq(Buffer.from(JD.b64dec(buf.toString('base64')).bytes).toString('hex'), buf.toString('hex'), `std base64 with padding decodes ${n} bytes`);
  }
  eq(JD.b64dec('a+b/').notes, ['std'], 'std alphabet noted');
  let e; try { JD.b64dec('abcde'); } catch (x) { e = x.message; } ok(/長度 5/.test(e), 'length%4==1 rejected: ' + e);
  try { JD.b64dec('ab*c'); } catch (x) { e = x.message; } ok(/第 3 個字元「\*」/.test(e), 'bad char reported with position: ' + e);
  try { JD.b64dec('ab=c'); } catch (x) { e = x.message; } ok(/「=」位置不對/.test(e), 'misplaced = rejected');

  /* ---------- HS tokens made by Python ---------- */
  for (const f of FX.hs) {
    const d = JD.detect(f.token), an = JD.analyzeJWT(d.token);
    ok(d.kind === 'jwt' && !an.error && an.alg === f.alg, `${f.alg}/${f.enc} detected and decoded`);
    // Python's json keeps the big integer exactly; our pretty printer must too
    eq(JD.pretty(an.payload.node), f.payload.replace(/\n\s*\n/g, '\n'), `${f.alg}/${f.enc} payload pretty-print equals Python json.dumps(indent=2)`);
    const r = await JD.verify(subtle, an, { secret: f.secret, enc: f.enc });
    eq(r.state, 'ok', `${f.alg} verifies with ${f.enc} secret`);
    const bad = await JD.verify(subtle, an, { secret: (f.enc === 'text' ? 'x' : 'ab') + f.secret, enc: f.enc });
    eq(bad.state, 'bad', `${f.alg}/${f.enc} wrong secret is rejected`);
    if (f.enc !== 'text') { const h = await JD.verify(subtle, an, { secret: f.secret, enc: 'text' }); ok(h.state === 'bad' && h.hint === f.enc, `${f.alg} suggests switching to ${f.enc} (${h.hint})`); }
    const parts = f.token.split('.'); const tam = parts[0] + '.' + b64u(JSON.stringify({ sub: 'admin' })) + '.' + parts[2];
    eq((await JD.verify(subtle, JD.analyzeJWT(tam), { secret: f.secret, enc: f.enc })).state, 'bad', `${f.alg}/${f.enc} tampered payload is rejected`);
  }
  {
    const f = FX.hs[0], an = JD.analyzeJWT(f.token);
    ok(an.payload.unsafe && an.issues.some(i => /精確/.test(i.msg)), 'big integer flagged as beyond JS precision');
    eq(an.claims.find(c => c.key === 'n').value, '12345678901234567890', 'big integer shown exactly');
    const r = await JD.verify(subtle, an, { secret: ' your-256-bit-secret ', enc: 'text' });
    ok(r.state === 'bad' && r.hint === 'trim', 'surrounding spaces in secret detected');
    const short = await JD.verify(subtle, an, { secret: 'your-256-bit-secret' });
    ok(short.notes.some(n => /19 位元組.*32/.test(n)), 'short HS256 secret warned (19 < 32 bytes)');
    const oct = JSON.stringify({ kty: 'oct', k: Buffer.from('your-256-bit-secret').toString('base64url') });
    eq((await JD.verify(subtle, an, { secret: oct })).state, 'ok', 'oct JWK accepted as HMAC secret');
    eq((await JD.verify(subtle, an, { secret: '' })).state, 'need', 'empty secret asks for input');
    eq((await JD.verify(subtle, an, { secret: 'zz', enc: 'hex' })).state, 'error', 'bad hex secret explained');
  }

  /* ---------- asymmetric tokens made by Node crypto ---------- */
  const sign = (alg, payload, key, hdr = {}) => {
    const si = b64u({ alg, typ: 'JWT', ...hdr }) + '.' + b64u(payload);
    const A = JD.ALG[alg]; let sig;
    if (A.fam === 'RS') sig = nc.sign('sha' + alg.slice(2), Buffer.from(si), key);
    else if (A.fam === 'PS') sig = nc.sign('sha' + alg.slice(2), Buffer.from(si), { key, padding: nc.constants.RSA_PKCS1_PSS_PADDING, saltLength: A.salt });
    else if (A.fam === 'ES') sig = nc.sign('sha' + alg.slice(2), Buffer.from(si), { key, dsaEncoding: hdr.der ? 'der' : 'ieee-p1363' });
    else sig = nc.sign(null, Buffer.from(si), key);
    return si + '.' + sig.toString('base64url');
  };
  const rsa = nc.generateKeyPairSync('rsa', { modulusLength: 2048 }), rsa2 = nc.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const ecs = { 'P-256': nc.generateKeyPairSync('ec', { namedCurve: 'P-256' }), 'P-384': nc.generateKeyPairSync('ec', { namedCurve: 'P-384' }), 'P-521': nc.generateKeyPairSync('ec', { namedCurve: 'P-521' }) };
  const ed = nc.generateKeyPairSync('ed25519');
  const pem = (k, type) => k.export({ type, format: 'pem' });
  const P = { sub: 'u1', iat: 1700000000 };
  const cases = [
    ['RS256', rsa], ['RS384', rsa], ['RS512', rsa], ['PS256', rsa], ['PS384', rsa], ['PS512', rsa],
    ['ES256', ecs['P-256']], ['ES384', ecs['P-384']], ['ES512', ecs['P-521']], ['EdDSA', ed],
  ];
  for (const [alg, kp] of cases) {
    const t = sign(alg, P, kp.privateKey), an = JD.analyzeJWT(t);
    const forms = { 'SPKI PEM': pem(kp.publicKey, 'spki'), JWK: JSON.stringify(kp.publicKey.export({ format: 'jwk' })), 'PKCS#8 private PEM': pem(kp.privateKey, 'pkcs8') };
    if (alg[0] === 'R' || alg[0] === 'P') { forms['PKCS#1 RSA PUBLIC KEY'] = pem(kp.publicKey, 'pkcs1'); forms['PKCS#1 RSA PRIVATE KEY'] = pem(kp.privateKey, 'pkcs1'); }
    if (alg[0] === 'E' && alg !== 'EdDSA') forms['SEC1 EC PRIVATE KEY'] = pem(kp.privateKey, 'sec1');
    for (const [name, key] of Object.entries(forms)) {
      const r = await JD.verify(subtle, an, { key });
      eq(r.state, 'ok', `${alg} verifies with ${name}`);
      if (/private/i.test(name)) ok(r.notes.some(n => /私鑰/.test(n)), `${alg} ${name}: private key warning`);
    }
    const other = alg[0] === 'R' || alg[0] === 'P' ? rsa2.publicKey : alg === 'EdDSA' ? nc.generateKeyPairSync('ed25519').publicKey : nc.generateKeyPairSync('ec', { namedCurve: JD.ALG[alg].crv }).publicKey;
    eq((await JD.verify(subtle, an, { key: pem(other, 'spki') })).state, 'bad', `${alg} wrong key rejected`);
    const ps = t.split('.'); const tam = JD.analyzeJWT(ps[0] + '.' + b64u({ sub: 'u2', iat: 1700000000 }) + '.' + ps[2]);
    eq((await JD.verify(subtle, tam, { key: pem(kp.publicKey, 'spki') })).state, 'bad', `${alg} tampered payload rejected`);
  }
  { // key type / curve mismatch explained
    const t = JD.analyzeJWT(sign('RS256', P, rsa.privateKey));
    const r = await JD.verify(subtle, t, { key: pem(ecs['P-256'].publicKey, 'spki') });
    ok(r.state === 'error' && /EC.*RS256.*RSA/.test(r.msg), 'EC key for RS256 explained: ' + r.msg);
    const t2 = JD.analyzeJWT(sign('ES256', P, ecs['P-256'].privateKey));
    const r2 = await JD.verify(subtle, t2, { key: pem(ecs['P-384'].publicKey, 'spki') });
    ok(r2.state === 'error' && /P-384.*P-256/.test(r2.msg), 'wrong curve explained: ' + r2.msg);
    const r3 = await JD.verify(subtle, t2, { key: '-----BEGIN PUBLIC KEY-----\nMFkwEw' });
    ok(r3.state === 'error' && /不完整/.test(r3.msg), 'truncated PEM explained: ' + r3.msg);
    const r4 = await JD.verify(subtle, t2, { key: 'ssh-ed25519 AAAAC3Nza' });
    ok(r4.state === 'error' && /OpenSSH/.test(r4.msg), 'OpenSSH key explained');
    const r5 = await JD.verify(subtle, t2, { key: '{"kty":' });
    ok(r5.state === 'error' && /JSON/.test(r5.msg), 'broken JWK explained');
    const encPem = nc.generateKeyPairSync('ec', { namedCurve: 'P-256', privateKeyEncoding: { type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'x' }, publicKeyEncoding: { type: 'spki', format: 'pem' } }).privateKey;
    const r6 = await JD.verify(subtle, t2, { key: encPem }); ok(r6.state === 'error' && /密碼保護/.test(r6.msg), 'encrypted private key explained');
  }
  { // ES256 with a DER signature is accepted with a warning
    const t = JD.analyzeJWT(sign('ES256', P, ecs['P-256'].privateKey, { der: true }));
    const r = await JD.verify(subtle, t, { key: pem(ecs['P-256'].publicKey, 'spki') });
    ok(r.state === 'ok' && r.notes.some(n => /DER/.test(n)), 'ES256 DER-encoded signature converted and warned');
  }
  { // JWKS with kid selection, and without kid
    const k1 = nc.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwks = JSON.stringify({ keys: [{ ...k1.publicKey.export({ format: 'jwk' }), kid: 'a', alg: 'ES256', use: 'sig' }, { ...ecs['P-256'].publicKey.export({ format: 'jwk' }), kid: 'b', alg: 'ES256', use: 'sig' }] });
    const r = await JD.verify(subtle, JD.analyzeJWT(sign('ES256', P, ecs['P-256'].privateKey, { kid: 'b' })), { key: jwks });
    ok(r.state === 'ok' && r.notes.some(n => /kid「b」選出第 2 把/.test(n)), 'JWKS picks key by kid');
    const r2 = await JD.verify(subtle, JD.analyzeJWT(sign('ES256', P, ecs['P-256'].privateKey)), { key: jwks });
    ok(r2.state === 'ok' && r2.notes.some(n => /第 2 把金鑰驗證成功/.test(n)), 'JWKS without kid tries every key');
    const r3 = await JD.verify(subtle, JD.analyzeJWT(sign('ES256', P, rsa.privateKey === null ? null : nc.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey, { kid: 'b' })), { key: jwks });
    eq(r3.state, 'bad', 'JWKS: token signed by a key not in the set is rejected');
  }
  for (const [n, f] of Object.entries(CERTS)) { // OpenSSL-made certificates
    const an = JD.analyzeJWT(f.token);
    eq((await JD.verify(subtle, an, { key: f.cert })).state, 'ok', `${n} token verifies with X.509 certificate PEM`);
    const c2 = '-----BEGIN CERTIFICATE-----\n' + an.header.obj.x5c[0].replace(/(.{64})/g, '$1\n').trim() + '\n-----END CERTIFICATE-----';
    eq((await JD.verify(subtle, an, { key: c2 })).state, 'ok', `${n} token verifies with the x5c header certificate`);
    eq((await JD.verify(subtle, an, { key: an.header.obj.x5c[0] })).state, 'ok', `${n} bare base64 DER certificate accepted`);
  }

  /* ---------- JWT structure & warnings ---------- */
  const N = JD.analyzeJWT(b64u({ alg: 'none' }) + '.' + b64u({ sub: 'x' }) + '.');
  ok(N.issues[0].lv === 'bad' && /none/.test(N.issues[0].msg), 'alg none flagged bad');
  eq((await JD.verify(subtle, N, {})).state, 'na', 'alg none: nothing to verify');
  const noAlg = JD.analyzeJWT(b64u({ typ: 'JWT' }) + '.' + b64u({}) + '.abc');
  ok(noAlg.issues.some(i => i.lv === 'bad' && /沒有 alg/.test(i.msg)), 'missing alg flagged');
  const two = JD.detect('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0');
  ok(two.kind === 'unknown' || (two.kind === 'jwt' && JD.analyzeJWT(two.token).error), 'two-part token not mistaken for a JWT');
  const four = JD.analyzeJWT('eyJhbGciOiJIUzI1NiJ9.a.b.c'); ok(/4 段/.test(four.error), 'four parts explained');
  const badHead = JD.analyzeJWT('eyJhbGciOiJIUzI1NiJ.eyJzdWIiOiIxIn0.abc'); ok(badHead.error && badHead.errorPart === 0, 'broken header explained: ' + badHead.error);
  const badJson = JD.analyzeJWT(b64u('{"alg":"HS256",}') + '.e30.abc'); ok(/不是合法的 JSON：第 16 個字元/.test(badJson.error), 'header JSON error position: ' + badJson.error);
  const badSig = JD.analyzeJWT(b64u({ alg: 'HS256' }) + '.e30.a*c'); ok(!badSig.error && badSig.payload && badSig.issues.some(i => i.lv === 'bad' && /簽章（第 3 段）.*「\*」/.test(i.msg)), 'invalid signature chars explained, payload still shown');
  eq((await JD.verify(subtle, badSig, { secret: 'x' })).state, 'error', 'invalid signature cannot be verified');
  const dup = JD.analyzeJWT(b64u({ alg: 'HS256' }) + '.' + b64u('{"sub":"a","sub":"b"}') + '.abc');
  ok(dup.issues.some(i => /重複的鍵：sub/.test(i.msg)) && dup.claims.find(c => c.key === 'sub').value === 'b', 'duplicate keys warned, last value shown');
  const txt = JD.analyzeJWT(b64u({ alg: 'HS256', cty: 'JWT' }) + '.' + b64u(FX.hs[0].token) + '.abc');
  eq(txt.payload.nested, FX.hs[0].token, 'nested JWT inside payload found');
  const bin = JD.analyzeJWT(b64u({ alg: 'HS256' }) + '.' + Buffer.from([0xff, 0xfe, 0x00]).toString('base64url') + '.abc');
  eq([bin.payload.kind, bin.payload.text], ['hex', 'fffe00'], 'binary payload shown as hex');
  const std = JD.analyzeJWT(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT', x: '>>>' })).toString('base64') + '.e30.abc');
  ok(!std.error && std.issues.some(i => /標準 Base64/.test(i.msg)) && std.issues.some(i => /「=」補位/.test(i.msg)), 'standard base64 + padding decoded with warnings');
  const crit = JD.analyzeJWT(b64u({ alg: 'RS256', crit: ['exp'], jku: 'https://evil.example/jwks', jwk: { kty: 'RSA' } }) + '.e30.abc');
  ok(crit.issues.some(i => /crit/.test(i.msg)) && crit.issues.some(i => /jku/.test(i.msg)) && crit.issues.some(i => /內嵌了公鑰/.test(i.msg)), 'crit / jku / embedded jwk noted');
  const k256 = JD.analyzeJWT(b64u({ alg: 'ES256K' }) + '.e30.abc'); eq((await JD.verify(subtle, k256, { key: 'x' })).state, 'na', 'ES256K explained as unsupported');
  // JWE
  const jwe = [b64u({ alg: 'RSA-OAEP-256', enc: 'A256GCM' }), nc.randomBytes(256).toString('base64url'), nc.randomBytes(12).toString('base64url'), nc.randomBytes(40).toString('base64url'), nc.randomBytes(16).toString('base64url')].join('.');
  const J5 = JD.analyzeJWT(JD.detect(jwe).token);
  ok(J5.kind === 'jwe' && J5.jwe[1].bytes === 256 && J5.jwe[2].bytes === 12 && J5.jwe[4].bytes === 16 && J5.header.obj.enc === 'A256GCM', 'JWE: 5 parts with byte sizes');
  const dir = JD.analyzeJWT([b64u({ alg: 'dir', enc: 'A128GCM' }), '', 'aaaa', 'bbbb', 'cccc'].join('.')); ok(!dir.error && dir.jwe[1].bytes === 0, 'JWE dir with empty key part');

  /* ---------- detection ---------- */
  const T = FX.hs[0].token;
  const det = s => { const d = JD.detect(s); return d.kind === 'jwt' ? d.token : d.kind; };
  eq(det('Bearer ' + T), T, 'Bearer prefix'); eq(det('authorization: bearer ' + T), T, 'Authorization header line');
  eq(det('  "' + T + '",  '), T, 'quotes, comma and outer spaces');
  eq(det(T.slice(0, 40) + '\n' + T.slice(40, 90) + '\r\n  ' + T.slice(90)), T, 'line breaks inside the token');
  eq(det(T.replace('.', '.​')), T, 'zero-width space inside the token');
  eq(det('{"access_token":"' + T + '","token_type":"Bearer","expires_in":3600}'), T, 'token found inside a JSON response');
  eq(det('HTTP/1.1 200 OK\nSet-Cookie: session=' + T + '; Path=/; HttpOnly'), T, 'token found inside HTTP headers');
  const jp = T.split('.');
  eq(det(JSON.stringify({ payload: jp[1], protected: jp[0], signature: jp[2] })), T, 'flattened JWS JSON');
  eq(det(JSON.stringify({ payload: jp[1], signatures: [{ protected: jp[0], header: { kid: 1 }, signature: jp[2] }] })), T, 'general JWS JSON');
  eq(['https://example.com/a?b=1', 'example.com/x', 'www.例子.tw', 'localhost:3000/api', '192.168.1.1:8080', 'mailto:a@b.co?subject=hi', '?a=1&b=2', 'a=1&b=%E4%B8%AD', '/path/only?x=1', 'ftp://files.example.org/'].map(s => JD.detect(s).kind),
    Array(10).fill('url'), 'URL-like inputs detected');
  eq(['', '   \n ', 'hello world', '3.14', 'user@example.com', '中文'].map(s => JD.detect(s).kind), ['empty', 'empty', 'unknown', 'unknown', 'unknown', 'unknown'], 'non-JWT non-URL inputs');
  eq(JD.detect('https://x.tw/cb#id_token=' + T).kind, 'url', 'URL containing a JWT stays a URL');

  /* ---------- time ---------- */
  for (const [t, tw, utc] of FX.tw) { eq(JD.fmtTW(t), tw, `Taiwan time ${t}`); eq(JD.fmtUTC(t), utc, `UTC ${t}`); }
  eq(JD.fmtTW(1700000000.25), '2023/11/15（三）06:13:20.250', 'fractional seconds kept');
  eq(JD.fmtTW(1e16), null, 'out-of-range date returns null');
  eq([0, 59, 60, 3599, 3600, 3660, 86399, 86400, 90000, 59 * 86400, 61 * 86400, 400 * 86400, 1000 * 86400].map(JD.fmtDur),
    ['0 秒', '59 秒', '1 分鐘', '59 分鐘', '1 小時', '1 小時 1 分鐘', '23 小時 59 分鐘', '1 天', '1 天 1 小時', '59 天', '約 2 個月', '約 13 個月', '約 2.7 年'], 'durations');
  eq(JD.rel('exp', 1000 + 3 * 3600, 1000), { text: '還有 3 小時過期', tone: 'ok' }, 'exp 3 hours ahead');
  eq(JD.rel('exp', 1000 + 120, 1000), { text: '還有 2 分鐘過期', tone: 'warn' }, 'exp soon is a warning');
  eq(JD.rel('exp', 1000, 1000), { text: '剛剛過期', tone: 'bad' }, 'exp == now is expired');
  eq(JD.rel('exp', 1000, 1000 + 2 * 86400 + 5), { text: '已過期 2 天', tone: 'bad' }, 'expired 2 days');
  eq(JD.rel('nbf', 1600, 1000), { text: '10 分鐘後才生效', tone: 'warn' }, 'nbf in future');
  eq(JD.rel('iat', 1000, 1000 + 1500), { text: '25 分鐘前', tone: 'dim' }, 'iat ago');
  eq(JD.rel('iat', 1000 + 7200, 1000).tone, 'warn', 'iat in the future warns');
  const mk = p => JD.analyzeJWT(b64u({ alg: 'HS256' }) + '.' + b64u(p) + '.abc');
  eq(JD.timeStatus(mk({ exp: 2000, iat: 1000 }), 1500).state, 'valid', 'state valid');
  eq(JD.timeStatus(mk({ exp: 2000, iat: 1000 }), 2000).state, 'expired', 'state expired at exp');
  eq(JD.timeStatus(mk({ exp: 2000, iat: 1000 }), 1500).life, '16 分鐘', 'lifetime exp-iat');
  eq(JD.timeStatus(mk({ exp: 3000, nbf: 2000 }), 1500).state, 'early', 'state not yet valid');
  ok(JD.timeStatus(mk({ sub: 'x' }), 1).issues.some(i => /沒有到期時間/.test(i.msg)), 'missing exp warned');
  ok(JD.timeStatus(mk({ exp: '1700000000' }), 1).issues.some(i => i.lv === 'bad' && /應該是數字/.test(i.msg)), 'string exp is an error');
  ok(JD.timeStatus(mk({ exp: 1700000000000 }), 1).issues.some(i => /毫秒/.test(i.msg)), 'milliseconds exp detected');
  ok(JD.timeStatus(mk({ exp: 1000, iat: 2000 }), 1).issues.some(i => /比簽發時間還早/.test(i.msg)), 'exp before iat flagged');
  eq(JD.analyzeJWT(b64u({ alg: 'HS256' }) + '.' + b64u({ expires_in: 3600 }) + '.a').claims[0].dur, '1 小時', 'expires_in shown as duration');

  /* ---------- percent-encoding (vs Python urllib) ---------- */
  for (const [s, u, up] of FX.unq) { eq(JD.pctOnce(s, false).text, u, `unquote ${s}`); eq(JD.pctOnce(s, true).text, up, `unquote_plus ${s}`); }
  eq(JD.decodePct('%2541', false).layers, ['%41', 'A'], 'double encoding gives layers');
  eq(JD.decodePct('%25252525E4%25252525B8%25252525AD', false).layers.pop(), '中', 'five-times encoded 中 unwrapped');
  eq(JD.decodePct('100%25', false).layers, ['100%'], 'literal percent sign is not over-decoded');
  const b5 = JD.pctOnce('%A4%A4%A4%E5%A6r%C5%E9', false); ok(b5.big5 && b5.text === FX.big5, `Big5 bytes decoded as ${b5.text} (Python: ${FX.big5})`);
  const zz = JD.pctOnce('a%ZZb%E4%B8', false); ok(zz.errs.length === 2 && /第 2 個字元的「%ZZ」/.test(zz.errs[0].msg) && /不是完整的 UTF-8/.test(zz.errs[1].msg), 'bad escapes reported: ' + zz.errs.map(x => x.msg).join(' / '));

  /* ---------- query parsing (vs Python parse_qsl) ---------- */
  for (const [q, want] of FX.qs) {
    const rows = JD.parseParams(q, 0, true).filter(r => !r.empty).map(r => [r.k, r.v]);
    eq(rows, want, `parse_qsl ${q}`);
    const u = JD.parseURL('https://a.tw/p?' + q + '#f');
    eq(JD.rebuild(u, u.params.map(p => ({ ...p })), null), u.raw, `untouched rebuild is byte-identical: ${q}`);
  }
  { // edits re-encode; deletes keep the rest; empty table drops "?"
    const u = JD.parseURL('https://shop.tw/s?q=%E5%A5%B6%E8%8C%B6&page=2#top');
    const rows = u.params.map(p => ({ ...p })); rows[0].v = '珍珠 奶茶&鮮奶'; rows[0].edited = true;
    const s = JD.rebuild(u, rows, null); eq(s, 'https://shop.tw/s?q=%E7%8F%8D%E7%8F%A0%20%E5%A5%B6%E8%8C%B6%26%E9%AE%AE%E5%A5%B6&page=2#top', 'edited value encoded');
    eq(new URL(s).searchParams.get('q'), '珍珠 奶茶&鮮奶', 'WHATWG URL reads the edited value back');
    eq(JD.rebuild(u, [rows[1]], null), 'https://shop.tw/s?page=2#top', 'delete a parameter');
    eq(JD.rebuild(u, [], null), 'https://shop.tw/s#top', 'delete all drops ?');
    const u2 = JD.parseURL('https://a.tw/x#frag'); eq(JD.rebuild(u2, [{ k: '名', v: '值', edited: true, eq: true }], null), 'https://a.tw/x?%E5%90%8D=%E5%80%BC#frag', 'add param to URL without ?');
    const u3 = JD.parseURL('https://a.tw/?q=a+b'); const r3 = u3.params.map(p => ({ ...p })); r3[0].v = 'c d'; r3[0].edited = true;
    eq(JD.rebuild(u3, r3, null), 'https://a.tw/?q=c+d', 'plus style kept when the URL used +');
    const u4 = JD.parseURL('a=1&b=2', true); const r4 = u4.params.map(p => ({ ...p })); r4[1].v = '三'; r4[1].edited = true;
    eq(JD.rebuild(u4, r4, null), 'a=1&b=%E4%B8%89', 'query-only string rebuilt without ?');
    const u5 = JD.parseURL('https://a.tw/cb#access_token=x&state=y'); const r5 = u5.fragParams.map(p => ({ ...p })); r5[1].v = '狀態'; r5[1].edited = true;
    eq(JD.rebuild(u5, null, r5), 'https://a.tw/cb#access_token=x&state=%E7%8B%80%E6%85%8B', 'fragment params editable');
  }

  /* ---------- URL structure (vs WHATWG URL / node:url) ---------- */
  const urls = ['https://user:pa%20ss@例子.測試:8443/a/%E8%B7%AF/b?x=1&y=%E4%B8%AD#frag%20x', 'http://[2001:db8::1]:8080/p?q', 'https://EXAMPLE.com/', 'https://xn--fiq228c.xn--kpry57d/搜尋?q=1', 'wss://chat.example.org:443/ws', 'https://münchen.de/straße', 'ftp://files.example.org/pub/file.txt'];
  for (const s of urls) {
    const r = JD.parseURL(s), w = new URL(s);
    eq(r.scheme + ':', w.protocol, `scheme ${s}`);
    eq((r.hostASCII || '').toLowerCase().replace(/^\[|\]$/g, ''), w.hostname.replace(/^\[|\]$/g, ''), `host to ASCII ${s}`);
    eq((r.port || '') === w.port || (r.port === '443' && w.port === ''), true, `port ${s}`);
    eq(r.query == null ? '' : '?' + r.query, w.search === '?' ? '?' : w.search.replace(/%E4%B8%AD/, '%E4%B8%AD'), `query ${s}`);
    eq(r.fragment == null ? '' : '#' + r.fragment, w.hash, `fragment ${s}`);
  }
  const ru = JD.parseURL('https://user:pa%20ss@例子.測試:8443/a/%E8%B7%AF/b?x=1#f');
  eq([ru.user, ru.pass, ru.port, ru.pathDecoded], ['user', 'pa ss', '8443', '/a/路/b'], 'userinfo, port, decoded path');
  ok(ru.issues.some(i => /密碼/.test(i.msg)), 'password in URL warned');
  for (const h of ['例子.測試', 'münchen.de', '中文.台灣', 'bücher.example', 'xn--fiq228c.tw', '☃.net', '日本語.jp']) {
    eq(JD.toASCII(h), nurl.domainToASCII(h), `punycode toASCII ${h}`);
    eq(JD.toUnicode(nurl.domainToASCII(h)), nurl.domainToUnicode(nurl.domainToASCII(h)), `punycode toUnicode ${h}`);
  }
  ok(JD.parseURL('https://аpple.com/').issues.some(i => i.lv === 'bad' && /同形字/.test(i.msg)), 'Cyrillic look-alike host flagged');
  ok(JD.parseURL('https://a.tw:99999/').issues.some(i => /65535/.test(i.msg)), 'port over 65535 flagged');
  ok(JD.parseURL('https://a.tw:443/').issues.some(i => /預設值/.test(i.msg)), 'default port noted');
  ok(JD.parseURL('http://a.tw/').issues.some(i => /未加密/.test(i.msg)), 'http noted');
  ok(JD.parseURL('javascript:alert(1)').issues.some(i => i.lv === 'bad'), 'javascript: URL flagged');
  ok(JD.parseURL('https://a.tw/?access_token=abc').issues.some(i => /敏感參數/.test(i.msg)), 'sensitive params warned');
  const ex = JD.parseURL('example.com/a?b=1'); eq([ex.assumed, ex.host, ex.path], ['https', 'example.com', '/a'], 'scheme-less URL assumes https');
  const lh = JD.parseURL('localhost:3000/api'); eq([lh.assumed, lh.host, lh.port, lh.path], ['http', 'localhost', '3000', '/api'], 'localhost:port assumes http');
  const mt = JD.parseURL('mailto:a@b.co?subject=%E4%BD%A0%E5%A5%BD&body=hi'); eq([mt.scheme, mt.host, mt.path, mt.params[0].v], ['mailto', null, 'a@b.co', '你好'], 'mailto parsed');
  eq(JD.readable(JD.parseURL('https://xn--fiq228c.tw/%E8%B7%AF?q=%E4%B8%AD+%E6%96%87#%E7%89%87')), 'https://中文.tw/路?q=中 文#片', 'readable version');
  const big = 'https://a.tw/?' + Array.from({ length: 1000 }, (_, i) => `k${i}=%E5%80%BC${i}`).join('&');
  const t0 = Date.now(); const bu = JD.parseURL(big); const dt = Date.now() - t0;
  ok(bu.params.length === 1000 && bu.params[999].v === '值999' && dt < 500, `1000 parameters parsed in ${dt} ms`);
  const bigTok = b64u({ alg: 'HS256' }) + '.' + b64u({ data: 'x'.repeat(300000), list: Array.from({ length: 5000 }, (_, i) => i) }) + '.abc';
  const t1 = Date.now(); const ba = JD.analyzeJWT(JD.detect(bigTok).token); const dt1 = Date.now() - t1;
  ok(!ba.error && ba.payload.obj.list.length === 5000 && dt1 < 1500, `400 KB token decoded in ${dt1} ms`);


  /* ---------- review fixes (2026-10-24) ---------- */
  { // 1. private key text is recognised even when it cannot be parsed
    const ed = nc.generateKeyPairSync('ed25519');
    const priv = [
      '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQ\n-----END OPENSSH PRIVATE KEY-----',
      nc.generateKeyPairSync('ec', { namedCurve: 'P-256', privateKeyEncoding: { type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'x' }, publicKeyEncoding: { type: 'spki', format: 'pem' } }).privateKey,
      '-----BEGIN RSA PRIVATE KEY-----\nProc-Type: 4,ENCRYPTED\nDEK-Info: AES-128-CBC,00\n\nabc\n-----END RSA PRIVATE KEY-----',
      ed.privateKey.export({ type: 'pkcs8', format: 'pem' }), JSON.stringify(ed.privateKey.export({ format: 'jwk' })),
      JSON.stringify({ keys: [ed.publicKey.export({ format: 'jwk' }), ed.privateKey.export({ format: 'jwk' })] }),
      '{"kty":"RSA","n":"abc","e":"AQAB","d":"xyz"', '{"kty":"oct","k":"c2VjcmV0"}', 'PuTTY-User-Key-File-3: ssh-ed25519',
    ];
    priv.forEach((k, i) => ok(JD.isPrivateText(k), `private key text #${i + 1} recognised (never stored)`));
    const pub = [ed.publicKey.export({ type: 'spki', format: 'pem' }), JSON.stringify(ed.publicKey.export({ format: 'jwk' })), JSON.stringify({ keys: [ed.publicKey.export({ format: 'jwk' })] }), CERTS.rsa.cert, ''];
    pub.forEach((k, i) => ok(!JD.isPrivateText(k), `public key text #${i + 1} may be stored`));
  }
  { // 2. millisecond timestamps read one way everywhere
    const an = mk({ iat: 1700000000000, exp: 1700003600000 }), now = 1792800000;
    const ts = JD.timeStatus(an, now), exp = an.claims.find(c => c.key === 'exp');
    eq([exp.ms, exp.ts], [true, 1700003600], 'ms exp interpreted as 1700003600 s');
    ok(ts.state === 'expired' && /已過期 約 2\.9 年/.test(ts.exp.text), 'state and row agree: expired about 2.9 years ago (' + ts.exp.text + ')');
    ok(!ts.issues.some(i => /未來/.test(i.msg)), 'no "iat in the future" warning for ms iat');
    ok(ts.issues.some(i => /毫秒.*2023\/11\/15.*約西元 55840 年/.test(i.msg)), 'ms warning names both readings: ' + ts.issues.map(i => i.msg).join(' | '));
    eq(ts.life, '1 小時', 'lifetime uses the same reading');
    for (const raw of ['1e400', '-1e400', '1e20', '9e15']) {
      const a = JD.analyzeJWT(b64u({ alg: 'HS256' }) + '.' + b64u(`{"exp":${raw}}`) + '.abc'), r = a.claims[0], s = JD.timeStatus(a, now);
      ok(r.badTime && r.badWhy === 'range' && s.state === 'none' && s.issues.some(i => i.lv === 'bad' && /超出合理的日期範圍/.test(i.msg)) && !/Infinity|null|NaN/.test(s.issues.map(i => i.msg).join()) && !s.issues.some(i => /沒有到期時間/.test(i.msg)), `exp ${raw} reported as out of range, no Infinity/null text`);
    }
  }
  { // 3. blank rows never leak into the URL
    const u = JD.parseURL('https://e.com/?a=1&b=2'); const rows = u.params.map(p => ({ ...p }));
    rows.push({ k: '', v: '', eq: true, edited: true }); rows[0].v = '9'; rows[0].edited = true;
    eq(JD.rebuild(u, rows, null), 'https://e.com/?a=9&b=2', 'blank added row is skipped');
    rows.push({ k: '', v: '', eq: true, edited: true }); eq(JD.rebuild(u, rows, null), 'https://e.com/?a=9&b=2', 'two blank rows skipped');
    const r2 = [{ ...u.params[0], k: '', v: '', edited: true }, u.params[1]]; eq(JD.rebuild(u, r2, null), 'https://e.com/?b=2', 'row emptied by the user disappears');
    eq(JD.rebuild(u, [{ k: 'x', v: '', eq: true, edited: true }], null), 'https://e.com/?x=', 'name with empty value kept as x=');
    eq(JD.rebuild(u, [{ k: '', v: 'v', eq: true, edited: true }], null), 'https://e.com/?=v', 'value without name kept');
    eq(JD.rebuild(JD.parseURL('https://e.com/?a=1&&b=2'), null, null), 'https://e.com/?a=1&&b=2', 'original empty pieces still byte-identical');
  }
  { // 5. URLs inside surrounding text
    const d1 = JD.detect('請看 https://e.com/?a=1 謝謝');
    ok(d1.kind === 'url' && '請看 https://e.com/?a=1 謝謝'.slice(d1.start, d1.end) === 'https://e.com/?a=1' && /找到網址/.test(d1.notes[0]), 'URL extracted from a sentence');
    const t2 = 'https://a.tw/x?q=1\nhttps://b.tw/y'; const d2 = JD.detect(t2);
    ok(d2.kind === 'url' && t2.slice(d2.start, d2.end) === 'https://a.tw/x?q=1' && /共 2 個/.test(d2.notes[0]), 'two URL lines: first one, and says there are 2');
    const t3 = '連結：https://shop.tw/訂單?id=7。'; const d3 = JD.detect(t3); eq(t3.slice(d3.start, d3.end), 'https://shop.tw/訂單?id=7', 'full-width punctuation not swallowed');
    const t4 = '登入後導向（https://e.com/cb?x=1）'; const d4 = JD.detect(t4); eq(t4.slice(d4.start, d4.end), 'https://e.com/cb?x=1', 'URL inside full-width parentheses');
    const t5 = 'see https://e.com/a.'; const d5 = JD.detect(t5); eq(t5.slice(d5.start, d5.end), 'https://e.com/a', 'trailing period trimmed');
    const t6 = 'token ' + FX.hs[0].token + ' from https://auth.tw/login'; eq(JD.detect(t6).kind, 'jwt', 'a standalone JWT before a URL still wins');
    const t7 = '回呼 https://x.tw/cb#id_token=' + FX.hs[0].token + ' 收到'; eq(JD.detect(t7).kind, 'url', 'JWT inside an extracted URL keeps the URL');
    const u = JD.parseURL(t2.slice(d2.start, d2.end)); eq(JD.rebuild(u, null, null), 'https://a.tw/x?q=1', 'extracted URL rebuilds');
  }

  { // 6. round 3: spaced dots decode again, no false positives, and detection is linear on long pastes
    const [h, pl, sg] = T.split('.');
    eq(det(h + ' . ' + pl + ' . ' + sg), T, 'spaces around the dots are removed');
    eq(det(h + '\n.\n' + pl + '\n.\n' + sg), T, 'line breaks around the dots are removed');
    eq(det('Bearer ' + h + ' . ' + pl + ' . ' + sg), T, 'Bearer + spaced dots');
    eq(det('eyJhbGciOiJIUzI1NiJ9 . eyJhIjoxfQ . abc'), 'eyJhbGciOiJIUzI1NiJ9.eyJhIjoxfQ.abc', 'reviewer case: spaced 3-part token');
    eq(det('token ' + T + ' from server'), T, 'short words around a token are not glued into it');
    eq(det('got ' + T + ' ok'), T, 'short trailing word not glued into the signature');
    eq(det('eyJhbGcieyJhbGci\n' + T), T, 'a broken eyJ… line before a real token: the real token wins');
    eq(['this is a test . really', 'version 1.2.3 is out now', 'a . b . c'].map(x => JD.detect(x).kind), ['unknown', 'unknown', 'unknown'], 'prose with dots stays unknown');
    // bare-host rule matches the old (backtracking) regex
    const OLD = /^[^\s/?#@:]*[^\s/?#@:.\d][^\s/?#@:]*\.[^\s/?#@:.\d]{2,}(:\d+)?([/?#]\S*)?$/;
    const hosts = ['example.com/x', 'www.例子.tw', 'a.b.c.tw:8080/p?q=1#f', '1.2.3.4', '3.14', 'x.1a', 'x.ab1', '.com', 'a.', 'a..bc', 'e.com:abc', 'e.com:80x', 'e.com/a b', 'e.com?x', 'e.com#', 'ab.cd/ x', '1a.bc', '12.bc', 'a1.b'];
    eq(hosts.map(x => JD.bareHost(x)), hosts.map(x => OLD.test(x)), 'bare-host rule unchanged');
    const time = f => { const t = Date.now(); f(); return Date.now() - t; };
    const hex = nc.randomBytes(450000).toString('hex'); // 900 KB: longer pastes go through the page's window search (verify.js)
    let d; const th = time(() => { d = JD.detect(hex + '\n' + T); });
    ok(d.kind === 'jwt' && d.token === T && th < 1500, `900 KB hex dump + JWT found in ${th} ms`);
    const tl = time(() => { d = JD.detect('2026-10-24T10:00:00Z INFO auth ok token=' + T.replace(/\./, '.' + 'A'.repeat(0)) + ' ' + hex.slice(0, 30000)); });
    ok(d.kind === 'jwt' && tl < 1500, `log line + token + 30 KB unbroken run in ${tl} ms`);
    const tx = time(() => { d = JD.detect('x'.repeat(3000000)); });
    ok(d.kind === 'unknown' && tx < 2000, `3 MB of one word: ${tx} ms`);
    const tu = time(() => { d = JD.detect('a'.repeat(1500000) + '://b ' + 'c://'.repeat(100000)); });
    ok(tu < 2000, `long scheme-like runs and many "://": ${tu} ms`);
    const tf = time(() => { d = JD.detect('x'.repeat(1200000) + '\n' + T); });
    ok(d.kind === 'unknown' && d.scanCut && /只在前 100 萬字/.test(d.notes.join()) && tf < 2000, `search capped at 1,000,000 characters, with a note (${tf} ms)`);
    const big = 'https://e.com/?' + 'a=b&'.repeat(80000);
    d = JD.detect(big); ok(d.kind === 'url' && d.urlCut && d.end - d.start === 200000 && /只解析前 20 萬字/.test(d.notes.join()), 'very long URL parsed up to 200,000 characters, with a note');
    const tp = time(() => { const u = JD.parseURL(big.slice(d.start, d.end)); ok(u.params.length === 50000 - 3, 'params of the capped URL'); });
    ok(tp < 3000, `50,000 parameters parsed in ${tp} ms`);
    const tq = time(() => JD.parseURL('https://e.com/?a=' + '%'.repeat(200000)));
    ok(tq < 1500, `200,000 broken %XX in ${tq} ms`);
    const pu = JD.parseURL('https://e.com/?a=' + '%'.repeat(1500)); ok(/有 1,500 處百分比編碼不正確/.test(pu.issues.map(x => x.msg).join()), 'error count stays exact when the detail list is capped');
    eq(JD.parseURL('https://e.com/?a=1&b=2&a=3&c=4&b=5').issues.filter(x => /出現不只一次/.test(x.msg)).map(x => x.msg), ['參數「a、b」出現不只一次，伺服器可能當成陣列或只取其中一個。'], 'duplicate keys still listed in order');
  }

  /* ---------- JSON printer ---------- */
  for (const v of [{}, [], { a: [1, { b: null }], c: 'x"y\\z\n\u0001', d: -0.5e-7, e: true }, ['中文', '😀', ''], { nested: { deep: { deeper: [[[]]] } } }]) {
    const s = JSON.stringify(v); eq(JD.pretty(JD.parseJSON(s).node), JSON.stringify(JSON.parse(s), null, 2), 'pretty matches JSON.stringify for ' + s.slice(0, 30));
  }
  ok(!/<script/.test(JD.prettyHTML(JD.parseJSON('{"x":"<script>alert(1)</script>"}').node)), 'HTML output escapes strings');

  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(err => { console.log('FAIL crashed:', err && err.stack); process.exit(1); });
