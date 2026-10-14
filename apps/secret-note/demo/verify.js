// 文字加密便條驗證：node verify.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs'), { execFileSync } = require('child_process');
const SRC = path.resolve(__dirname, '../index.html'), WRAP = path.join(__dirname, 'preview.html'), OUT = __dirname;
fs.writeFileSync(WRAP, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(SRC, 'utf8') + '</body></html>');
const URL_ = 'file://' + WRAP;
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

// Python cryptography 交叉驗證（獨立實作同一格式）
const PY = String.raw`
import sys, zlib, base64, struct, json, os, unicodedata
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
IT=600000
def key(pw,salt,it): return PBKDF2HMAC(algorithm=hashes.SHA256(),length=32,salt=salt,iterations=it).derive(unicodedata.normalize('NFC',pw).encode())
def b64d(s): return base64.urlsafe_b64decode(s+'='*(-len(s)%4))
def enc(pt,pw,compact):
    data=pt.encode(); c=zlib.compressobj(9,zlib.DEFLATED,-15); z=c.compress(data)+c.flush(); comp=len(z)<len(data)
    flags=(1 if comp else 0)|(2 if compact else 0); salt=os.urandom(16); iv=os.urandom(12)
    hdr=bytes([1,flags])+(b'' if compact else struct.pack('>I',IT))+salt+iv
    return 'SN1.'+base64.urlsafe_b64encode(hdr+AESGCM(key(pw,salt,IT)).encrypt(iv,z if comp else data,hdr)).decode().rstrip('=')
def dec(s,pw):
    s=s.strip().split('#')[-1]; b=b64d(s[4:]); f=b[1]; o=2 if f&2 else 6; it=IT if f&2 else struct.unpack('>I',b[2:6])[0]
    hdr=b[:o+28]; pt=AESGCM(key(pw,b[o:o+16],it)).decrypt(b[o+16:o+28],b[o+28:],hdr)
    return (zlib.decompress(pt,-15) if f&1 else pt).decode()
r=json.load(sys.stdin)
print(json.dumps({'text':dec(r['cipher'],r['pw'])} if r['op']=='dec' else {'cipher':enc(r['text'],r['pw'],r.get('compact',False))},ensure_ascii=False))
`;
const py = req => JSON.parse(execFileSync('python3', ['-I', '-c', PY], { input: JSON.stringify(req) }).toString());

async function open(browser, opt) {
  const ctx = await browser.newContext(opt);
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  const page = await ctx.newPage(); const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(URL_); await page.waitForTimeout(300);
  return { ctx, page, errors };
}
(async () => {
  const browser = await chromium.launch();
  const mob = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
  const { ctx, page, errors } = await open(browser, mob);
  ok(await page.evaluate(() => innerWidth) === 390, 'innerWidth = 390');
  ok(await page.evaluate(() => secure), 'crypto.subtle 可用（安全情境）');

  const MSG = '帳號 alice@example.com／密碼 Tr0ub4dor&3／地址：台北市中正區重慶南路一段 122 號 🔐👍🏽 é';
  // 1. 頁內加密 → Python 解密
  const c1 = await page.evaluate(m => encryptText(m, '正確馬電池釘書針', false), MSG);
  const c2 = await page.evaluate(m => encryptText(m, '正確馬電池釘書針', false), MSG);
  ok(c1.startsWith('SN1.') && c1 !== c2, `同明文同密碼兩次密文不同（${c1.slice(0, 20)}… vs ${c2.slice(0, 20)}…）`);
  ok(py({ op: 'dec', cipher: c1, pw: '正確馬電池釘書針' }).text === MSG, 'Python cryptography 解開頁內密文（中文密碼、中文與 emoji 內容）');
  const long = '重要會議紀錄。'.repeat(300);
  const c3 = await page.evaluate(m => encryptText(m, 'pw-long-123', true), long);
  const p3 = await page.evaluate(c => parseCipher(c), c3);
  ok((p3.flags & 3) === 3 && py({ op: 'dec', cipher: c3, pw: 'pw-long-123' }).text === long, `緊湊模式 + deflate 壓縮（${long.length} 字 → 密文 ${c3.length} 字元），Python 可解`);
  // 2. Python 加密 → 頁內解密
  for (const compact of [false, true]) {
    const pc = py({ op: 'enc', text: MSG, pw: 'demo1234', compact }).cipher;
    const back = await page.evaluate(([c]) => decryptText(c, 'demo1234'), [pc]);
    ok(back === MSG, `Python 加密（compact=${compact}）→ 頁內解密一致`);
  }
  const pcLong = py({ op: 'enc', text: long, pw: 'x', compact: false }).cipher;
  ok(await page.evaluate(([c, m]) => decryptText(c, 'x').then(t => t === m), [pcLong, long]), 'Python 壓縮密文 → 頁內 DecompressionStream 還原');
  // 3. 錯誤處理
  const errs = await page.evaluate(async ([c]) => {
    const r = {};
    const t = async (fn) => { try { await fn(); return 'OK'; } catch (e) { return e.code; } };
    r.wrong = await t(() => decryptText(c, 'wrong'));
    const i = 40, flip = c.slice(0, i) + (c[i] === 'A' ? 'B' : 'A') + c.slice(i + 1);
    r.tamper = await t(() => decryptText(flip, '正確馬電池釘書針'));
    const hdr = c.slice(0, 6) + (c[6] === 'A' ? 'B' : 'A') + c.slice(7);
    r.header = await t(() => decryptText(hdr, '正確馬電池釘書針'));
    r.garbage = await t(() => decryptText('hello world', 'x'));
    r.short = await t(() => decryptText('SN1.AQAACSfA', 'x'));
    r.link = await t(() => decryptText('https://x.test/a#' + c + '\n', '正確馬電池釘書針'));
    return r;
  }, [c1]);
  ok(errs.wrong === 'WRONG', '錯誤密碼 → 密碼錯誤或密文已損壞');
  ok(errs.tamper === 'WRONG', '改動密文中段一個字元 → 密碼錯誤或密文已損壞');
  ok(errs.header === 'WRONG' || errs.header === 'INVALID', `改動標頭（AAD 保護）→ ${errs.header}`);
  ok(errs.garbage === 'INVALID' && errs.short === 'INVALID', '非密文與過短字串 → 這不是有效的密文');
  ok(errs.link === 'OK', '貼上完整連結（含 # 與換行）可解密');

  // 4. UI 流程：範例密文解密
  await page.screenshot({ path: path.join(OUT, '390x844.png') });
  await page.click('#tab-dec');
  await page.fill('#pw-dec', 'demo1234');
  await page.click('#btn-dec');
  await page.waitForSelector('#dec-out-wrap:not([hidden])', { timeout: 8000 });
  const txt = await page.textContent('#plain-out-text');
  ok(txt.includes('4827#') && txt.includes('🔑'), 'UI：範例密文 + demo1234 解密成功（Python 產生）');
  ok(await page.evaluate(() => $('plain-out').classList.contains('blurred')), '明文預設模糊遮罩');
  await page.click('#plain-out');
  ok(!(await page.evaluate(() => $('plain-out').classList.contains('blurred'))), '點擊顯示明文');
  await page.fill('#pw-dec', 'nope'); await page.click('#btn-dec');
  await page.waitForSelector('#dec-err:not([hidden])');
  ok((await page.textContent('#dec-err')) === '密碼錯誤或密文已損壞。', 'UI：錯誤密碼顯示統一訊息');

  // 5. UI 加密 → 存入便條本
  await page.click('#tab-enc');
  ok(await page.isDisabled('#btn-enc'), '未設密碼時加密鈕停用');
  await page.fill('#pw1', 'sunny-rice-42!Q'); await page.fill('#pw2', 'sunny-rice-4');
  ok(await page.isVisible('#pw-mismatch') && await page.isDisabled('#btn-enc'), '兩次密碼不一致 → 紅字且停用');
  await page.fill('#pw2', 'sunny-rice-42!Q');
  await page.check('#fmt-link');
  await page.click('#btn-enc');
  await page.waitForSelector('#out-wrap:not([hidden])', { timeout: 8000 });
  const link = await page.inputValue('#cipher-out');
  ok(/#SN1\./.test(link), '分享連結格式：密文在 # 之後');
  ok(py({ op: 'dec', cipher: link, pw: 'sunny-rice-42!Q' }).text.startsWith('範例：家裡 Wi-Fi'), 'UI 產生的連結經 Python 解密正確');
  await page.click('#btn-show-qr');
  ok(await page.isVisible('#qr-img') && (await page.evaluate(() => $('qr-img').naturalWidth)) > 100, `QR 碼產生（版本 ${await page.evaluate(() => $('qr-img').dataset.version)}）`);
  await page.fill('#note-title', '測試便條'); await page.click('#btn-save-note');
  const ls = await page.evaluate(() => JSON.stringify(Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)]))));
  ok(!ls.includes('sunny-rice-42') && !ls.includes('Wi-Fi') && !ls.includes('demo1234!') && ls.includes('測試便條'), 'localStorage 只有標題與密文，無明文、無密碼');
  await page.click('#btn-copy-cipher');
  ok((await page.evaluate(() => navigator.clipboard.readText())) === link, '複製密文到剪貼簿');
  await page.click('#toast-act');
  await page.waitForTimeout(100);
  ok((await page.evaluate(() => navigator.clipboard.readText())) === '', '「清除剪貼簿」寫入空字串');
  // 便條本：開啟 + 刪除確認
  if (!(await page.evaluate(() => $('nb').open))) await page.click('summary');
  await page.click('.note-open >> nth=0');
  ok((await page.inputValue('#cipher-in')).startsWith('SN1.') && await page.evaluate(() => $('cols').dataset.mode) === 'dec', '點便條 → 載入到解密');
  await page.fill('#pw-dec', 'sunny-rice-42!Q'); await page.click('#btn-dec');
  await page.waitForSelector('#dec-out-wrap:not([hidden])', { timeout: 8000 });
  ok((await page.textContent('#plain-out-text')).includes('Home-5G'), '便條本密文解開正確');
  const before = await page.locator('.notes li').count();
  await page.click('.notes li >> nth=0 >> .btn.danger');
  ok(await page.isVisible('#confirm-del'), '刪除需頁內確認');
  await page.click('#confirm-del');
  ok(await page.locator('.notes li').count() === before - 1, '確認後刪除');
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '390 無水平捲動');
  ok(errors.length === 0, 'console/pageerror 無錯誤 ' + errors.join(' | '));
  await page.screenshot({ path: path.join(OUT, '390x844-check.png'), fullPage: true });
  await ctx.close();

  // 6. hash 自動帶入 + replaceState
  {
    const ctx2 = await browser.newContext(mob); const p = await ctx2.newPage(); const e2 = [];
    p.on('pageerror', e => e2.push(String(e)));
    await p.goto(URL_ + '#' + c1); await p.waitForTimeout(300);
    ok(await p.evaluate(() => $('cols').dataset.mode) === 'dec' && (await p.inputValue('#cipher-in')) === c1, '開啟時網址 hash 有密文 → 自動切到解密並填入');
    await p.fill('#pw-dec', '正確馬電池釘書針'); await p.click('#btn-dec');
    await p.waitForSelector('#dec-out-wrap:not([hidden])', { timeout: 8000 });
    ok((await p.evaluate(() => location.hash)) === '' && (await p.textContent('#plain-out-text')) === MSG, '解密成功後 hash 被 replaceState 清除');
    ok(e2.length === 0, 'hash 情境無錯誤');
    await ctx2.close();
  }

  // 7. 各尺寸截圖
  const shots = [
    ['360x780.png', { viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }],
    ['844x390.png', { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }],
    ['390x844-dark.png', { ...mob, colorScheme: 'dark' }],
    ['1100x800-desktop.png', { viewport: { width: 1100, height: 800 } }],
  ];
  for (const [name, opt] of shots) {
    const { ctx: c, page: p, errors: e } = await open(browser, opt);
    ok(await p.evaluate(w => innerWidth === w, opt.viewport.width), `${name} innerWidth = ${opt.viewport.width}`);
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} 無水平捲動`);
    const small = await p.evaluate(() => [...document.querySelectorAll('button, select, input[type=text], input[type=password], summary, .radios label')].filter(b => b.offsetParent && b.getBoundingClientRect().height < 38).map(b => b.id || b.textContent.trim()).slice(0, 5));
    ok(small.length === 0, `${name} 可點元件高度足夠 ${small.join(',')}`);
    await p.screenshot({ path: path.join(OUT, name) });
    ok(e.length === 0, `${name} 無錯誤`);
    await c.close();
  }
  await browser.close();
  fs.unlinkSync(WRAP);
  console.log(fails ? `\n${fails} 項失敗` : '\n全部通過');
  process.exit(fails ? 1 : 0);
})();
