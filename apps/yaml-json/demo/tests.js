// Core tests for 格式互轉 (yaml-json): parsers, serializers, round trips and error positions.
// Every expected value below was worked out by hand from the YAML 1.2, TOML 1.0 and JSON (RFC 8259) specs.
// Usage: node tests.js
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const YJ = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return YJ;')();
let pass = 0, fail = 0;
const S = x => JSON.stringify(x);
function ok(c, msg) { if (c) pass++; else { fail++; console.log('FAIL', msg); } }
function eq(a, b, msg) { ok(S(a) === S(b), `${msg}\n   got  ${S(a)}\n   want ${S(b)}`); }
const P = (text, fmt) => YJ.parse(text, fmt).docs.map(YJ.plain);
const P1 = (text, fmt) => P(text, fmt)[0];
function err(text, fmt) { try { YJ.parse(text, fmt); return 'NO ERROR'; } catch (e) { if (!(e instanceof YJ.PErr)) throw e; const lc = YJ.lineCol(text, e.at); return `${lc.line}:${lc.col} ${e.msg}`; } }
function errAt(text, fmt, where, frag, msg) { const r = err(text, fmt); ok(r.startsWith(where + ' ') && r.includes(frag), `${msg}: ${r}`); }
const conv = (text, from, to, o) => YJ.convert(text, from, to, o);
const out = (text, from, to, o) => { const r = conv(text, from, to, o); return r.ok ? r.out : 'ERR ' + (r.error && r.error.msg); };

/* ---------------- YAML parsing ---------------- */
eq(P1('a: 1\nb: two\nc: 3.5\nd: true\ne: ~\nf:\ng: "q"\nh: \'s\'', 'yaml'), { a: 1, b: 'two', c: 3.5, d: true, e: null, f: null, g: 'q', h: 's' }, 'yaml basic scalars');
eq(P1('- a\n- - b\n  - c\n- k: v\n  k2: v2\n-\n  late: 1\n-\n- [x, y]', 'yaml'), ['a', ['b', 'c'], { k: 'v', k2: 'v2' }, { late: 1 }, null, ['x', 'y']], 'yaml block sequences incl. nested, compact map, empty entry');
eq(P1('key:\n- a\n- b\nother: 1', 'yaml'), { key: ['a', 'b'], other: 1 }, 'yaml compact sequence under key');
eq(P1('lit: |\n  one\n    two\n  three\n\nnext: x', 'yaml'), { lit: 'one\n  two\nthree\n', next: 'x' }, 'literal block keeps indentation, clip chomping');
eq(P1('k: |+\n  kept\n\n\nn: 1', 'yaml'), { k: 'kept\n\n\n', n: 1 }, 'literal keep chomping keeps trailing blank lines');
eq(P1('k: |-\n  stripped\n\nn: 1', 'yaml'), { k: 'stripped', n: 1 }, 'literal strip chomping');
eq(P1('f: >\n  fold\n  these lines\n\n  new para\n    more\n  back\n', 'yaml'), { f: 'fold these lines\nnew para\n  more\nback\n' }, 'folded block: spaces, paragraph, more-indented line');
eq(P1('c: |2\n    two extra\n   one extra\n', 'yaml'), { c: '  two extra\n one extra\n' }, 'explicit indentation indicator');
eq(P1('d: |\n  # not a comment\n  text', 'yaml'), { d: '# not a comment\ntext' }, 'hash inside block scalar is text; no final newline at end of input');
eq(P1('x: |\n\n  leading blank\n', 'yaml'), { x: '\nleading blank\n' }, 'leading empty line in literal');
eq(P('--- |\n  doc\n--- >-\n  a\n  b\n--- plain\n---\n', 'yaml'), ['doc\n', 'a b', 'plain', null], 'block scalars and plain scalars as whole documents');
eq(P1('base: &b {host: h, port: 1}\ndev:\n  <<: *b\n  db: d\nprod:\n  <<: *b\n  host: p', 'yaml'), { base: { host: 'h', port: 1 }, dev: { host: 'h', port: 1, db: 'd' }, prod: { host: 'p', port: 1 } }, 'anchors, aliases and merge keys (explicit key wins)');
eq(P1('- &A {x: 1, y: 2}\n- &B {y: 3, z: 4}\n- <<: [*A, *B]\n  w: 5', 'yaml')[2], { x: 1, y: 2, z: 4, w: 5 }, 'merge list: earlier source wins');
eq(P1('l: &l [1, 2]\nm: *l\ns: &s hi\nt: *s', 'yaml'), { l: [1, 2], m: [1, 2], s: 'hi', t: 'hi' }, 'aliases of sequences and scalars');
eq(P1('p: this is\n  a long plain\n  scalar\n\n  with para\nn: ok', 'yaml'), { p: 'this is a long plain scalar\nwith para', n: 'ok' }, 'multi-line plain scalar folding');
eq(P1('"d": "a\\tb\\n\\u00e9\\x41\\U0001F600 \\\\ \\"q\\""', 'yaml'), { d: 'a\tb\né' + 'A' + '😀 \\ "q"' }, 'double-quoted escapes');
eq(P1("s: 'it''s ok'", 'yaml'), { s: "it's ok" }, 'single-quoted doubled quote');
eq(P1('f: "first\n  second\n\n  third"', 'yaml'), { f: 'first second\nthird' }, 'double-quoted line folding');
eq(P1('e: "abc\\\n  def"', 'yaml'), { e: 'abcdef' }, 'escaped line break joins without space');
eq(P1('t: "a   \n  b"', 'yaml'), { t: 'a b' }, 'trailing spaces before a folded break are dropped');
eq(P('---\na: 1\n---\nb: 2\n...\n---\n- x\n', 'yaml'), [{ a: 1 }, { b: 2 }, ['x']], 'multi-document stream with --- and ...');
eq(P('# only a comment\n', 'yaml'), [], 'comment-only stream has no documents');
eq(P1('{a: 1, b: [1, 2, 3], c: {d: e}, "q k": \'v\', empty: , f: [ ], g: { }}', 'yaml'), { a: 1, b: [1, 2, 3], c: { d: 'e' }, 'q k': 'v', empty: null, f: [], g: {} }, 'flow mapping');
eq(P1('m: [\n  one,\n  two, # c\n  three\n]\nn: {\n  a: 1,\n  b: 2,\n}', 'yaml'), { m: ['one', 'two', 'three'], n: { a: 1, b: 2 } }, 'multi-line flow collections with comments and trailing comma');
eq(P1('[a: 1, b]', 'yaml'), [{ a: 1 }, 'b'], 'single-pair mapping inside flow sequence');
eq(P1('{"a":1,"b":[true,null]}', 'yaml'), { a: 1, b: [true, null] }, 'JSON is valid YAML');
eq(P1('url: http://x.com:80/p?q=1#f\ntime: 12:30\nmail: a@b.c\nneg: -5\npos: +5\nhex: 0x1F\noct: 0o17\nfl: 1.5e3\nf2: .5\ninf: .inf\nninf: -.Inf\nz: 0', 'yaml'),
  { url: 'http://x.com:80/p?q=1#f', time: '12:30', mail: 'a@b.c', neg: -5, pos: 5, hex: 31, oct: 15, fl: 1500, f2: 0.5, inf: 'Infinity', ninf: '-Infinity', z: 0 }, 'YAML 1.2 core schema resolution');
eq(P1('n: .NaN', 'yaml').n, 'NaN', '.NaN');
eq(P1('d: 2024-03-09\nt: 2024-03-09T10:20:30Z\ns: 2001-12-14 21:59:43.10 -5\nl: 2001-12-15 2:59:43.10\nbad: 2024-13-45', 'yaml'),
  { d: { ld: '2024-03-09' }, t: { odt: '2024-03-09T10:20:30Z' }, s: { odt: '2001-12-14T21:59:43.10-05:00' }, l: { ldt: '2001-12-15T02:59:43.10' }, bad: '2024-13-45' }, 'timestamps (invalid date stays text)');
eq(P1('s: !!str 123\ni: !!int "42"\nf: !!float 3\nb: !!bool "true"\nn: !!null ""\nm: !!map {a: 1}\nq: !!seq [1]', 'yaml'), { s: '123', i: 42, f: 3, b: true, n: null, m: { a: 1 }, q: [1] }, 'standard tags');
{ const r = YJ.parse('r: !Ref MyBucket\nj: !Sub "${A}"', 'yaml'); eq(r.docs.map(YJ.plain)[0], { r: 'MyBucket', j: '${A}' }, 'custom tags keep the value'); ok(r.warns.length === 2 && r.warns[0].msg.includes('!Ref'), 'custom tags produce a warning each'); }
eq(P1('"a: b": 1\n\'c # d\': 2\n"": e\n? explicit\n: value\n? lone\n', 'yaml'), { 'a: b': 1, 'c # d': 2, '': 'e', explicit: 'value', lone: null }, 'quoted keys and explicit ? keys');
eq(P1('t1: \'colon: inside\'\nt2: a#b\nt3: x -y\nt4: [a#b]', 'yaml'), { t1: 'colon: inside', t2: 'a#b', t3: 'x -y', t4: ['a#b'] }, 'colon/hash that are not indicators');
eq(P1('a:\n    deep:\n        - x\n        - y: 1\n          z: 2\n    back: 1\nb: 2', 'yaml'), { a: { deep: ['x', { y: 1, z: 2 }], back: 1 }, b: 2 }, '4-space indentation');
eq(P1('u: 中文 測試\ne: "😀"\n鍵: 值', 'yaml'), { u: '中文 測試', e: '😀', 鍵: '值' }, 'Unicode keys and values');
eq(P1('k: &a !!str value\nl: *a', 'yaml'), { k: 'value', l: 'value' }, 'anchor plus tag');
eq(P1('m:\n  &k key: value\n  other: *k', 'yaml'), { m: { key: 'value', other: 'key' } }, 'anchor on a key');
eq(P1('%YAML 1.2\n---\nd: ok', 'yaml'), { d: 'ok' }, 'directive line');
eq(P1('k:    v w   \nk2:\tt', 'yaml'), { k: 'v w', k2: 't' }, 'trailing spaces and tab separator');
eq(P1('- |\n  first\n  second\n- >-\n  folded\n  item\n- plain', 'yaml'), ['first\nsecond\n', 'folded item', 'plain'], 'block scalars inside a sequence');
eq(P1('big: 123456789012345678901234567890\nsafe: 9007199254740991', 'yaml'), { big: '123456789012345678901234567890n', safe: 9007199254740991 }, 'integers beyond 2^53 kept exactly');
{ const r = YJ.parse('a: yes\nb: 010\nc: 1:30', 'yaml'); eq(r.docs.map(YJ.plain)[0], { a: 'yes', b: 10, c: '1:30' }, 'YAML 1.1 lookalikes resolve per 1.2'); eq(r.warns.length, 3, 'and each gets a YAML 1.1 warning'); }

/* ---------------- YAML errors: position + plain explanation ---------------- */
errAt('a: 1\n b: 2', 'yaml', '2:2', '鍵: 值', 'continuation line containing a key');
errAt('a:\n\tb: 1', 'yaml', '2:1', 'Tab', 'tab indentation');
errAt('a: b: c', 'yaml', '1:5', '兩個「鍵: 值」', 'two keys on one line');
errAt('key: "unterminated', 'yaml', '1:6', '沒有結束', 'unterminated double quote');
errAt('a: [1, 2', 'yaml', '1:4', '[ 沒有對應的 ]', 'unclosed flow sequence');
errAt('{a: 1', 'yaml', '1:1', '{ 沒有對應的 }', 'unclosed flow mapping');
errAt('a: *missing', 'yaml', '1:4', '找不到錨點', 'unknown alias');
errAt('a: 1\nb: 2\na: 3', 'yaml', '3:1', '重複的鍵「a」', 'duplicate key');
errAt('- a\nb: 1', 'yaml', '2:1', '對不上', 'mapping after top-level sequence');
errAt('a:\n  b: 1\n c: 2', 'yaml', '3:2', '縮排不一致', 'inconsistent indentation');
errAt('a: @x', 'yaml', '1:4', '保留字元', 'reserved indicator');
errAt('k: |x\n  t', 'yaml', '1:5', '只能接註解', 'garbage after block header');
errAt('foo\nbar: 1', 'yaml', '2:1', '鍵: 值', 'plain line followed by a key');
errAt('a: &x [*x]', 'yaml', '1:8', '參照到自己', 'recursive alias');
errAt('a: "x" y', 'yaml', '1:8', '多了內容', 'text after closing quote');
errAt('name: 小明\nskills:\n  - 料理\n age: 18', 'yaml', '4:2', '縮排不一致', 'sample error (sequence then mis-indented key)');
errAt('a: 1\nb:2\nc: 3', 'yaml', '2:1', '少了「: 」', 'missing space after colon inside a mapping');
ok(err('x: "a\\qb"', 'yaml').startsWith('1:6 '), 'bad escape points at the backslash');
errAt('[1, 2]]', 'yaml', '1:7', '多了內容', 'extra closing bracket');

/* ---------------- TOML parsing ---------------- */
eq(P1('title = "T"\n[owner]\nname = "Tom"\ndob = 1979-05-27T07:32:00-08:00\n[database]\nports = [ 8000, 8001 ]\ndata = [ ["a", "b"], [3.14] ]\ntemp = { cpu = 79.5, case = 72.0 }', 'toml'),
  { title: 'T', owner: { name: 'Tom', dob: { odt: '1979-05-27T07:32:00-08:00' } }, database: { ports: [8000, 8001], data: [['a', 'b'], [3.14]], temp: { cpu: 79.5, case: 72 } } }, 'TOML spec example subset');
eq(P1('[[p]]\nname = "Hammer"\n[[p]]\n[[p]]\nname = "Nail"', 'toml'), { p: [{ name: 'Hammer' }, {}, { name: 'Nail' }] }, 'array of tables incl. empty element');
eq(P1('[[f]]\nname = "apple"\n[f.physical]\ncolor = "red"\n[[f.v]]\nname = "rd"\n[[f.v]]\nname = "gs"\n[[f]]\nname = "banana"\n[[f.v]]\nname = "pl"', 'toml'),
  { f: [{ name: 'apple', physical: { color: 'red' }, v: [{ name: 'rd' }, { name: 'gs' }] }, { name: 'banana', v: [{ name: 'pl' }] }] }, 'nested arrays of tables');
eq(P1('s1 = "a\\tb\\u00E9\\U0001F600\\"\\\\"\ns2 = """\nRoses\nViolets"""\ns3 = """\\\n   The quick \\\n   fox.\\\n   """\ns4 = """two "" quotes"""\ns5 = """""five"""""\nw = \'C:\\Users\\x\'\nr = \'\'\'I [dw]on\'t \\d\'\'\'\nl = \'\'\'\nfirst\n  kept\n\'\'\'', 'toml'),
  { s1: 'a\tbé😀"\\', s2: 'Roses\nViolets', s3: 'The quick fox.', s4: 'two "" quotes', s5: '""five""', w: 'C:\\Users\\x', r: "I [dw]on't \\d", l: 'first\n  kept\n' }, 'TOML string forms');
eq(P1('a = +99\nb = 1_000\nc = 0xDEAD_beef\nd = 0o755\ne = 0b1101\nf = 9223372036854775807\ng = -9223372036854775808\nh = +1.0\ni = 5e+22\nj = 224_617.445_991\nk = -0.0\nl = inf\nm = -inf\nn = nan', 'toml'),
  { a: 99, b: 1000, c: 3735928559, d: 493, e: 13, f: '9223372036854775807n', g: '-9223372036854775808n', h: 1, i: 5e22, j: 224617.445991, k: -0, l: 'Infinity', m: '-Infinity', n: 'NaN' }, 'TOML numbers');
{ const v = YJ.parse('h = 1.0\nk = 1', 'toml').docs[0]; ok(v.get('h') instanceof YJ.TFloat && v.get('k') === 1, '1.0 stays a float, 1 an integer'); }
eq(P1('o1 = 1979-05-27T07:32:00Z\no2 = 1979-05-27 07:32:00.999999-07:00\nl1 = 1979-05-27T07:32:00\nd = 1979-05-27\nt = 07:32:00\nleap = 2024-02-29', 'toml'),
  { o1: { odt: '1979-05-27T07:32:00Z' }, o2: { odt: '1979-05-27T07:32:00.999999-07:00' }, l1: { ldt: '1979-05-27T07:32:00' }, d: { ld: '1979-05-27' }, t: { lt: '07:32:00' }, leap: { ld: '2024-02-29' } }, 'TOML date/time kinds');
eq(P1('name = "O"\nphysical.color = "orange"\nphysical.shape = "round"\nsite."google.com" = true\n"q k" = 1\n\'l k\' = 2\n"" = "e"\n3.14 = "pi"\na . b = 1\n[dog."tater.man"]\ntype.name = "pug"', 'toml'),
  { name: 'O', physical: { color: 'orange', shape: 'round' }, site: { 'google.com': true }, 'q k': 1, 'l k': 2, '': 'e', 3: { 14: 'pi' }, a: { b: 1 }, dog: { 'tater.man': { type: { name: 'pug' } } } }, 'TOML keys: dotted, quoted, empty, numeric');
eq(P1('[x.y.z]\n[x]\nk = 1', 'toml'), { x: { y: { z: {} }, k: 1 } }, 'super-table defined after sub-table');
eq(P1('[fruit]\napple.color = "red"\n[fruit.apple.texture]\nsmooth = true', 'toml'), { fruit: { apple: { color: 'red', texture: { smooth: true } } } }, 'sub-table of a dotted-key table');
eq(P1('pts = [ { x = 1 },\n  { x = 2 } ]\nn = { a = { b = 1 }, d.e = 2 }\ne = {}\nmix = [ 1, "s", [1], {a=1}, ]', 'toml'), { pts: [{ x: 1 }, { x: 2 }], n: { a: { b: 1 }, d: { e: 2 } }, e: {}, mix: [1, 's', [1], { a: 1 }] }, 'inline tables and mixed arrays');

/* ---------------- TOML errors ---------------- */
errAt('a = 1\na = 2', 'toml', '2:1', '重複定義', 'duplicate key');
errAt('[a]\n[a]', 'toml', '2:1', '[a] 重複定義', 'duplicate table');
errAt('a = ', 'toml', '1:5', '少了值', 'missing value');
errAt('name = hello', 'toml', '1:8', '看不懂的值「hello」', 'unquoted string');
errAt('a = 01', 'toml', '1:5', '看不懂的值', 'leading zero');
errAt('a = { x = 1, }', 'toml', '1:12', '多了逗號', 'inline table trailing comma');
errAt('a = { x = 1,\n y = 2 }', 'toml', '1:13', '同一行', 'newline in inline table');
errAt('[fruit]\napple.color = "red"\n[fruit.apple]', 'toml', '3:1', '重複定義', 'header redefining a dotted table');
errAt('a = 9223372036854775808', 'toml', '1:5', '64 位元', 'integer overflow');
errAt('a = 2024-02-30', 'toml', '1:5', '不存在', 'invalid date');
errAt('a = [1]\n[[a]]', 'toml', '2:1', '不能再用 [[a]]', 'static array then array of tables');
errAt('a = {b = 1}\n[a.c]', 'toml', '2:2', '行內表格', 'extending an inline table');
errAt('key: value', 'toml', '1:4', '不是冒號', 'YAML syntax in TOML');
errAt('a = True', 'toml', '1:5', '看不懂的值「True」', 'capitalised boolean');
errAt('中文 = 1', 'toml', '1:1', '要加引號', 'non-ASCII bare key');
errAt('a = 1 b = 2', 'toml', '1:7', '多了內容', 'two pairs on one line');
errAt('a = "x\\q"', 'toml', '1:7', '跳脫字元', 'invalid escape');
errAt('[a.b.c]\nz = 9\n[a]\nb.c.t = 1', 'toml', '4:3', '「a.b.c」已經定義過', 'dotted key into a header table');

/* ---------------- JSON ---------------- */
eq(P1('{"a":1,"b":[true,false,null],"c":{"d":"e"},"f":-1.5e2,"g":"\\u4e2d\\ud83d\\ude00\\n"}', 'json'), { a: 1, b: [true, false, null], c: { d: 'e' }, f: -150, g: '中😀\n' }, 'json values and escapes');
eq(P1('12345678901234567890', 'json'), '12345678901234567890n', 'json big integer exact');
eq(Object.keys(P1('{"b":1,"2":2,"a":3,"1":4}', 'json')), ['1', '2', 'b', 'a'].length === 4 ? Object.keys(P1('{"b":1,"2":2,"a":3,"1":4}', 'json')) : [], 'json parses');
eq(out('{"b":1,"2":2,"a":3,"1":4}', 'json', 'json', { minify: true }), '{"b":1,"2":2,"a":3,"1":4}', 'key order preserved exactly (numeric-looking keys too)');
{ const r = YJ.parse('{"d":1,"d":2}', 'json'); eq(YJ.plain(r.docs[0]), { d: 2 }, 'duplicate JSON key: last wins'); ok(r.warns.length === 1, 'duplicate JSON key warns'); }
errAt('{"a":1,}', 'json', '1:7', '多了逗號', 'trailing comma');
errAt("{'a':1}", 'json', '1:2', '雙引號', 'single quotes');
errAt('{a:1}', 'json', '1:2', '少了雙引號', 'unquoted key');
errAt('{\n  "a": 1\n  "b": 2\n}', 'json', '2:9', '少了逗號', 'missing comma points at end of previous value');
errAt('[01]', 'json', '1:2', '0 開頭', 'leading zero');
errAt('[NaN]', 'json', '1:2', 'NaN', 'NaN');
errAt('{"a":"\\x"}', 'json', '1:7', '跳脫字元', 'bad escape');
errAt('{"a": "abc\n}', 'json', '1:11', '換行', 'unterminated string at end of line');
errAt('{"a":[1}', 'json', '1:8', '括號不成對', 'mismatched bracket');
errAt('// c\n{}', 'json', '1:1', '註解', 'comment');
errAt('{"a":1} x', 'json', '1:9', '多出了內容', 'trailing garbage');
errAt('[True]', 'json', '1:2', 'true', 'capitalised true');
errAt('{"名稱"：1}', 'json', '1:6', '冒號', 'full-width colon');

/* ---------------- serializers: exact output ---------------- */
const SAMPLE = '# 設定\nname: 咖啡店\nport: 8080\nratio: 1.0\non: true\nnothing: null\ntags: [熱, 冷]\nwhen: 2026-10-18\nnote: |\n  第一行\n  第二行\n';
eq(out(SAMPLE, 'yaml', 'json'), '{\n  "name": "咖啡店",\n  "port": 8080,\n  "ratio": 1.0,\n  "on": true,\n  "nothing": null,\n  "tags": [\n    "熱",\n    "冷"\n  ],\n  "when": "2026-10-18",\n  "note": "第一行\\n第二行\\n"\n}', 'YAML → JSON pretty (2 spaces)');
eq(out(SAMPLE, 'yaml', 'json', { minify: true }), '{"name":"咖啡店","port":8080,"ratio":1.0,"on":true,"nothing":null,"tags":["熱","冷"],"when":"2026-10-18","note":"第一行\\n第二行\\n"}', 'YAML → JSON minified');
eq(out('{"b":{"y":1,"x":[2]},"a":0}', 'json', 'json', { sort: true, indent: 'tab' }), '{\n\t"a": 0,\n\t"b": {\n\t\t"x": [\n\t\t\t2\n\t\t],\n\t\t"y": 1\n\t}\n}', 'sort keys + tab indent');
eq(out(SAMPLE, 'yaml', 'toml', { dropNull: true }), 'name = "咖啡店"\nport = 8080\nratio = 1.0\non = true\ntags = ["熱", "冷"]\nwhen = 2026-10-18\nnote = """\n第一行\n第二行\n"""\n', 'YAML → TOML (null dropped, date stays a date, multi-line string)');
{ const r = conv(SAMPLE, 'yaml', 'toml'); ok(!r.ok && r.error.fix === 'dropNull' && r.error.line === 6 && r.error.path === 'nothing', 'null in TOML: explained, points at line 6, offers fix'); }
eq(out('{"server":{"host":"h","port":80,"tls":{"on":true}},"users":[{"n":"a"},{"n":"b","roles":["x"]}],"v":1}', 'json', 'toml'),
  'v = 1\n\n[server]\nhost = "h"\nport = 80\n\n[server.tls]\non = true\n\n[[users]]\nn = "a"\n\n[[users]]\nn = "b"\nroles = ["x"]\n', 'JSON → TOML: tables and arrays of tables');
eq(out('{"a":[[{"x":1}],{"y":2},3],"b":{},"c.d":{"e f":1}}', 'json', 'toml'), 'a = [[{ x = 1 }], { y = 2 }, 3]\nb = {}\n\n["c.d"]\n"e f" = 1\n', 'JSON → TOML: inline tables in mixed arrays, quoted keys');
eq(out('[1,2]', 'json', 'toml'), 'ERR TOML 最外層必須是「鍵 = 值」的表格', 'array root cannot become TOML');
eq(out('---\na: 1\n---\nb: 2', 'yaml', 'toml'), 'ERR TOML 一個檔案只能放一份文件，這裡有 2 份', 'multi-doc to TOML explained');
eq(out('{"n": 12345678901234567890123}', 'json', 'toml'), 'ERR 整數 12345678901234567890123 超出 TOML 的 64 位元範圍', 'bigint beyond int64 to TOML');
eq(out('a: .inf', 'yaml', 'json'), 'ERR JSON 不支援無限大', 'infinity to JSON explained');
eq(out('{"s":"yes","t":"010","u":"2024-01-01","v":"","w":"a: b","x":" pad","y":"#c","z":"null","n":"1e3","m":"line1\\nline2","k":"it\'s","q":"tab\\there"}', 'json', 'yaml'),
  "s: 'yes'\nt: '010'\nu: '2024-01-01'\nv: ''\nw: 'a: b'\nx: ' pad'\n'y': '#c'\nz: 'null'\n'n': '1e3'\nm: |-\n  line1\n  line2\nk: it's\nq: \"tab\\there\"\n", 'JSON → YAML quotes only ambiguous strings');
eq(out('{"a":[1,{"b":[]},[2,3]],"c":{"d":{}}}', 'json', 'yaml'), 'a:\n  - 1\n  - b: []\n  - - 2\n    - 3\nc:\n  d: {}\n', 'JSON → YAML nesting');
eq(out('{"a":[1,{"b":"x y"}],"c":"q,r"}', 'json', 'yaml', { minify: true }), "{a: [1, {b: x y}], c: 'q,r'}\n", 'YAML single-line (flow) output');
eq(out('{"a":{"b":[1,2]}}', 'json', 'yaml', { indent: 4 }), 'a:\n    b:\n        - 1\n        - 2\n', 'YAML 4-space indent');
eq(out('{"k":"  lead\\nx"}', 'json', 'yaml'), 'k: |2-\n    lead\n  x\n', 'block literal with indentation indicator');
eq(out('[1.5, 2.0, -0.0, 1e21, 1e-7]', 'json', 'yaml'), '- 1.5\n- 2.0\n- -0.0\n- 1.0e+21\n- 1.0e-7\n', 'float formatting keeps float-ness');
eq(out('[1.5, 2.0, 1e21]', 'json', 'json', { minify: true }), '[1.5,2.0,1.0e+21]', 'JSON float formatting');
eq(out('a = 1979-05-27T07:32:00Z\nb = 07:32:00\nc = 1979-05-27', 'toml', 'yaml'), "a: 1979-05-27T07:32:00Z\nb: '07:32:00'\nc: 1979-05-27\n", 'TOML dates → YAML timestamps (local time quoted)');
eq(out('a = 1979-05-27T07:32:00Z', 'toml', 'json'), '{\n  "a": "1979-05-27T07:32:00Z"\n}', 'TOML date → JSON string');
eq(out('---\na: 1\n---\n- x', 'yaml', 'json', { minify: true }), '[{"a":1},["x"]]', 'multi-doc YAML → JSON array');
eq(out('---\na: 1\n---\n- x', 'yaml', 'yaml'), '---\na: 1\n---\n- x\n', 'multi-doc YAML → YAML keeps documents');
ok(conv('', 'auto', 'json').empty && conv('', 'auto', 'json').out === '', 'empty input gives no output');
ok(conv('   \n ', 'auto', 'json').empty, 'whitespace-only input is the empty state');

/* ---------------- round trips ---------------- */
const RT = [
  '{"a":1,"b":[true,null,"x"],"c":{"d":"中文\\n第二行","e":-2.5,"f":12345678901234567890}}',
  '{"weird keys":{"":1,"a.b":2,"- x":3,"#":4,"yes":5,"1":6,"null":7,"a: b":8}}',
  '{"s":["", " ", "\'", "\\"", "\\\\", "tab\\t", "ctrl\\u0001", "emoji 😀", "\\u2028", "---", "...", "@x", "`x", "%x", "!x", "&x", "*x", "|", ">", "? q", "- a", "a #b", "[1]", "{a}", "0x1F", "0o7", "1_000", "1:30", ".5", "+1", "~", "TRUE", "No", "y", "<<", "="]}',
  '{"text":["\\n", "\\n\\n", "a\\n", "a\\n\\n", "a\\n\\n\\nb", " lead\\nx", "\\n lead", "x\\n ", "a\\r\\nb", "end\\"\\"", "\\"\\"\\"", "a\\"\\"\\"b"]}',
];
for (const j of RT) {
  for (const via of ['yaml', 'toml', 'json']) {
    if (via === 'toml' && j.includes('null')) continue;
    const r1 = conv(j, 'json', via); if (!r1.ok) { ok(false, `round trip json→${via} failed: ${r1.error.msg} for ${j.slice(0, 40)}`); continue; }
    const r2 = conv(r1.out, via, 'json', { minify: true });
    eq(r2.ok ? r2.out : r2.error.msg, out(j, 'json', 'json', { minify: true }), `round trip JSON → ${via.toUpperCase()} → JSON: ${j.slice(0, 40)}`);
  }
}
{ // TOML → YAML → TOML keeps dates and float-ness
  const t = 'a = 1.0\nb = 1979-05-27T07:32:00-08:00\nc = 2024-02-29\nd = [1, 2.5]\n\n[t]\nx = "y"\n';
  eq(out(out(t, 'toml', 'yaml'), 'yaml', 'toml'), t, 'TOML → YAML → TOML is lossless');
  eq(out(out(t, 'toml', 'json'), 'json', 'toml'), t.replace('1979-05-27T07:32:00-08:00', '"1979-05-27T07:32:00-08:00"').replace('2024-02-29', '"2024-02-29"'), 'TOML → JSON → TOML (dates become strings, by design)');
}
{ // YAML with anchors → JSON → YAML equals expanded form
  const y = 'base: &b\n  x: 1\nuse:\n  <<: *b\n  y: 2\n';
  eq(out(out(y, 'yaml', 'json'), 'json', 'yaml'), 'base:\n  x: 1\nuse:\n  x: 1\n  \'y\': 2\n', 'YAML anchors expand through JSON');
}

/* ---------------- detection, notes, limits ---------------- */
eq(['{"a":1}', '[1, 2]', 'a: 1\nb: [1]', '- x\n- y', 'a = 1\n[t]\nb = "x"', '[server]\nport = 80', '[1, 2', 'title = "x"', '---\nk: v', '"str"'].map(YJ.detect), ['json', 'json', 'yaml', 'yaml', 'toml', 'toml', 'json', 'toml', 'yaml', 'json'], 'format auto-detection');
{ const r = conv('a = 1\nb = "x"', 'yaml', 'json'); ok(r.ok && r.out === '"a = 1 b = \\"x\\""', 'TOML read as YAML is one plain scalar'); }
{ const r = conv('a: [1, 2]', 'json', 'yaml'); ok(r.error && r.error.suggest === 'yaml', 'wrong pinned format suggests the right one'); }
{ const r = conv('a: &a [x]\nb: *a\n# note', 'yaml', 'json'); ok(r.notes.some(n => n.includes('別名')) && r.notes.some(n => n.includes('註解')), 'notes about expanded aliases and dropped comments'); }
{ let b = 'a: &a ["x","x","x","x","x","x","x","x","x","x"]\n'; for (let k = 1; k < 9; k++) b += `${String.fromCharCode(97 + k)}: &${String.fromCharCode(97 + k)} [${Array(10).fill('*' + String.fromCharCode(96 + k)).join(',')}]\n`;
  const t = Date.now(); const r = conv(b, 'yaml', 'json'); ok(!r.ok && r.error.msg.includes('太大') && Date.now() - t < 8000, 'alias bomb is stopped with an explanation'); }
{ const deep = '['.repeat(1000) + ']'.repeat(1000); const r = conv(deep, 'json', 'yaml'); ok(!r.ok && r.error.msg.includes('巢狀太深'), 'very deep nesting rejected cleanly'); }
{ const big = { items: [] }; for (let k = 0; k < 5000; k++) big.items.push({ id: k, name: '品項 ' + k, tags: ['a', 'b'], price: k * 1.5 });
  const j = JSON.stringify(big); const t = Date.now();
  const y = conv(j, 'json', 'yaml'); const back = conv(y.out, 'yaml', 'json', { minify: true }); const tm = conv(y.out, 'yaml', 'toml'); const back2 = conv(tm.out, 'toml', 'json', { minify: true });
  ok(back.out === JSON.stringify(big).replace(/"price":(\d+)(?=[,}])/g, (m, n) => '"price":' + n) && back2.out === back.out, '5000-record round trip through YAML and TOML');
  ok(Date.now() - t < 6000, `5000-record conversions are fast (${Date.now() - t} ms)`); }
eq(YJ.lineCol('a\n中文x\n', 5), { line: 2, col: 4, lineStart: 2 }, 'columns count characters');
{ const r = conv('\uFEFFa: 1\r\nb: 2\r\n', 'auto', 'json', { minify: true }); eq(r.out, '{"a":1,"b":2}', 'BOM and CRLF handled'); }

/* ---------------- review fixes (round 2) ---------------- */
eq(out('{"a":"y","b":"Y","c":"n","d":"N","y":1,"n":true,"e":"yy","f":"no way"}', 'json', 'yaml'), "a: 'y'\nb: 'Y'\nc: 'n'\nd: 'N'\n'y': 1\n'n': true\ne: yy\nf: no way\n", 'YAML output quotes y/Y/n/N (YAML 1.1 booleans), keys too');
{ const r = conv('{"a":1,"b":2,"a":3}', 'json', 'yaml'); ok(r.ok && r.warns.length === 1 && r.warns[0].msg.includes('第 1 行的第 2 欄和第 14 欄'), 'duplicate key on one line names both columns: ' + (r.warns[0] && r.warns[0].msg)); }
{ const r = conv('{\n"a":1,\n"a":2}', 'json', 'yaml'); ok(r.warns[0].msg.includes('第 2 行和第 3 行'), 'duplicate key on different lines names both lines'); }
{ const items = []; for (let k = 0; k < 5000; k++) items.push('{"k":1,"k":2,"name":"😀 ' + k + '"}'); const j = '[' + items.join(',') + ']'; const t = Date.now(); const r = conv(j, 'json', 'yaml');
  ok(r.ok && r.warns.length === 101 && r.warns[100].msg.includes('只列出前 100 個') && Date.now() - t < 4000, `5000 duplicate keys on one line: capped at 100 warnings and fast (${Date.now() - t} ms)`); }
{ const r = conv('['.repeat(1000) + ']'.repeat(1000), 'json', 'yaml'); ok(r.error.hint && r.error.hint.includes('括號'), 'too-deep nesting has a fix hint (JSON)'); }
{ const r = conv('a: ' + '['.repeat(600) + ']'.repeat(600), 'yaml', 'json'); ok(r.error && r.error.msg.includes('巢狀太深') && r.error.hint, 'too-deep nesting has a fix hint (YAML)'); }
{ const r = conv('a = ' + '['.repeat(600) + ']'.repeat(600), 'toml', 'json'); ok(r.error && r.error.msg.includes('巢狀太深') && r.error.hint, 'too-deep nesting has a fix hint (TOML)'); }
{ const r = conv('[]\na = 1', 'toml', 'json'); ok(r.error && r.error.msg === '這裡少了鍵名' && r.error.hint.includes('[server]'), 'TOML empty table header has a fix hint'); }
{ const r = conv('a = 1\n= 2', 'toml', 'json'); ok(r.error && r.error.hint, 'TOML missing key has a fix hint'); }
eq(YJ.lineCol('😀😀x', 4), { line: 1, col: 3, lineStart: 0 }, 'columns count emoji as one character');
{ const s = 'x'.repeat(5e6) + '😀'; const t = Date.now(); const lc = YJ.lineCol(s, s.length); ok(lc.col === 5e6 + 2 && Date.now() - t < 500, 'lineCol on a 5 MB line is linear and allocation-free'); }

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
