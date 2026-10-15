// Rule tests for 中國象棋 core (extracts engine between CORE markers of index.html, or a given file).
const fs=require('fs'),path=require('path');
const file=process.argv[2]||path.resolve(__dirname,'..','index.html');
const src=fs.readFileSync(file,'utf8').match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const XQ=new Function(src+';return XQ;')();
let pass=0,fail=0;
function ok(c,msg){if(c){pass++;}else{fail++;console.log('FAIL',msg);}}
const mv=(p,s)=>XQ.parseIccs(s);
const has=(fen,m)=>{const p=XQ.fromFen(fen);return XQ.legalMoves(p).indexOf(XQ.parseIccs(m))>=0;};
// perft
const p0=XQ.fromFen(XQ.START);
[44,1920,79666].forEach((v,i)=>{const r=XQ.perft(p0,i+1);ok(r===v,'perft '+(i+1)+' = '+r);console.log('perft depth',i+1,'=',r,'(expected',v+')');});
// 蹩馬腿: horse at b0 with leg b1 blocked cannot go to a2/c2
ok(has('3k5/9/9/9/9/9/9/9/9/1N2K4 w','b0c2'),'horse free move');
ok(!has('4k4/9/9/9/9/9/9/9/1P7/1N2K4 w','b0c2')&&!has('4k4/9/9/9/9/9/9/9/1P7/1N2K4 w','b0a2'),'horse leg blocked (蹩馬腿)');
ok(has('3k5/9/9/9/9/9/9/9/1P7/1N2K4 w','b0d1'),'horse sideways still ok');
// 塞象眼
ok(has('4k4/9/9/9/9/9/9/9/9/2B1K4 w','c0e2'),'elephant free');
ok(!has('4k4/9/9/9/9/9/9/9/3P5/2B1K4 w','c0e2'),'elephant eye blocked (塞象眼)');
ok(!has('4k4/9/9/9/2B6/9/9/9/9/4K4 w','c5e7')&&!has('4k4/9/9/9/9/2B6/9/9/9/4K4 w','c4e6'),'elephant cannot cross river');
// 炮架
ok(!has('4k4/9/9/9/9/9/9/1r7/9/1C2K4 w','b0b2'),'cannon cannot capture without screen');
ok(has('3k5/9/9/9/1r7/9/9/1P7/9/1C2K4 w','b0b5'),'cannon captures over screen (炮架)');
ok(!has('4k4/9/9/9/1r7/1n7/9/1P7/9/1C2K4 w','b0b5'),'cannon cannot jump two screens');
// 將帥照面
ok(!has('3k5/9/9/9/9/9/9/9/9/4K4 w','e0d0'),'kings may not face each other');
ok(!has('4k4/9/9/9/9/9/9/9/4R4/4K4 w','e1d1'),'moving the only blocker exposes flying general');
{const p=XQ.fromFen('4k4/9/9/9/9/9/9/9/9/4K4 w');ok(XQ.validate(p).length>0,'facing kings position flagged invalid');}
// pawn
ok(!has('4k4/9/9/9/9/9/4P4/9/9/3K5 w','e3d3'),'pawn cannot move sideways before river');
ok(has('4k4/9/9/9/4P4/9/9/9/9/3K5 w','e5d5'),'pawn sideways after river');
ok(!has('4k4/9/9/9/4P4/9/9/9/9/3K5 w','e5e4'),'pawn cannot retreat');
// 困斃 (stalemate = loss for side to move): black king has no legal move but is not in check
{const p=XQ.fromFen('3k5/9/4P4/9/9/9/9/9/9/5K3 b');/* placeholder */}
{const p=XQ.fromFen('5k3/3P5/5P3/9/9/9/9/9/9/4K4 b');const L=XQ.legalMoves(p);ok(!XQ.inCheck(p,1)&&L.length===0,'stalemate detected: no legal moves, not in check');}
// checkmate
{const p=XQ.fromFen('3k5/3R5/3R5/9/9/9/9/9/9/4K4 b');ok(XQ.inCheck(p,1)&&XQ.legalMoves(p).length===0,'checkmate detected');}
// 長將: red repeats checks while black repeats evasions -> red loses at third repetition
{const p=XQ.fromFen('4k4/9/9/9/9/9/9/9/9/R2K5 w');const chs=new Uint8Array(4097);let res=null;
 const seq=['a0a9','e9e8','a9a8','e8e9','a8a9','e9e8','a9a8','e8e9','a8a9','e9e8'];
 for(const s of seq){XQ.makeMove(p,XQ.parseIccs(s));p.chk[p.n]=XQ.inCheck(p,p.side)?1:0;chs[p.n]=XQ.chases(p)?1:0;res=XQ.adjudicate(p,chs);if(res)break;}
 ok(res&&res.result==='blackwin','perpetual check loses: '+JSON.stringify(res));}
// both sides just shuffling -> draw
{const p=XQ.fromFen('3k5/9/9/9/9/9/9/9/9/4K4 w');const chs=new Uint8Array(4097);let res=null;
 const seq=['e0f0','d9e9','f0e0','e9d9','e0f0','d9e9','f0e0','e9d9'];
 for(const s of seq){XQ.makeMove(p,XQ.parseIccs(s));p.chk[p.n]=XQ.inCheck(p,p.side)?1:0;chs[p.n]=XQ.chases(p)?1:0;res=XQ.adjudicate(p,chs);if(res)break;}
 ok(res&&res.result==='draw','idle repetition is a draw: '+JSON.stringify(res));}
// 長捉: red rook keeps chasing an unprotected black horse -> red loses at third repetition
{const p=XQ.fromFen('4k4/9/n7R/9/9/9/9/9/9/3K5 b');const chs=new Uint8Array(4097);let res=null;
 for(const s of ['a7b9','i7b7','b9a7','b7i7','a7b9','i7b7','b9a7','b7i7']){XQ.makeMove(p,XQ.parseIccs(s));p.chk[p.n]=XQ.inCheck(p,p.side)?1:0;chs[p.n]=XQ.chases(p)?1:0;res=XQ.adjudicate(p,chs);if(res)break;}
 ok(res&&res.result==='blackwin','perpetual chase loses: '+JSON.stringify(res));}
// notation
ok(XQ.moveName(p0,XQ.parseIccs('h2e2'))==='炮二平五','notation 炮二平五');
ok(XQ.moveName(p0,XQ.parseIccs('h0g2'))==='傌二進三','notation 傌二進三');
{const q=XQ.fromFen(XQ.START.replace(' w',' b'));ok(XQ.moveName(q,XQ.parseIccs('h7e7'))==='砲８平５','notation 砲８平５');}
console.log('rule tests:',pass,'passed,',fail,'failed');
process.exitCode=fail?1:0;
