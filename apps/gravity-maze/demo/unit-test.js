// Unit tests for the gravity / multi-ball / element rules, run against the core code embedded in ../index.html
const fs=require('fs');const src=fs.readFileSync(process.argv[2]||require('path').join(__dirname,'..','index.html'),'utf8').match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const C=new Function(src+'\nreturn {parseLevel,initState,fall,rotate,solve,stateKey,isWin};')();
let pass=0,fail=0;const ok=(c,m)=>{if(c)pass++;else{fail++;console.log('FAIL',m);}};
// gravity slide: ball falls down to wall
let L=C.parseLevel('....../..a.../....../....../..#.../......');let S=C.initState(L);
let r=C.fall(L,S,2);ok(r.S.b[0]===3*6+2,'stop on wall');
r=C.fall(L,S,1);ok(r.S.b[0]===6+5,'edge stop');
// rotate CW from g=2 -> g=1 (right)
r=C.rotate(L,S,1);ok(r.S.g===1&&r.S.b[0]===11,'cw = right');
r=C.rotate(L,S,-1);ok(r.S.g===3&&r.S.b[0]===6,'ccw = left');
// multi ball sync front-first
L=C.parseLevel('a...../b...../....../....../....../......');S=C.initState(L);r=C.fall(L,S,2);ok(r.S.b[0]===24&&r.S.b[1]===30,'stack');
// exit sink, wrong-color exit as wall
L=C.parseLevel('a.B.A./....../....../....../....../......');S=C.initState(L);r=C.fall(L,S,1);ok(r.S.b[0]===1,'wrong exit wall');
L=C.parseLevel('a...A./....../....../....../....../......');S=C.initState(L);r=C.fall(L,S,1);ok(r.S.b[0]===-1&&C.isWin(r.S),'sink');
// spike death
L=C.parseLevel('a...x#/....../....../....../....../......');S=C.initState(L);r=C.fall(L,S,1);ok(r.dead.length===1,'spike');
L=C.parseLevel('a.x...#/......./......./......./......./......./.......');S=C.initState(L);r=C.fall(L,S,1);ok(r.dead.length===0&&r.S.b[0]===5,'pass spike');
// one-way door
L=C.parseLevel('a.<.../....../....../....../....../......');S=C.initState(L);r=C.fall(L,S,1);ok(r.S.b[0]===1,'door blocks');
L=C.parseLevel('a.>.../....../....../....../....../......');S=C.initState(L);r=C.fall(L,S,1);ok(r.S.b[0]===5,'door passes');
// glue
L=C.parseLevel('a..g../....../....../....../....../......');S=C.initState(L);r=C.fall(L,S,1);ok(r.S.b[0]===3,'glue stop');
r=C.fall(L,r.S,1);ok(r.S.b[0]===5,'leave glue');
// box pushed / slides
L=C.parseLevel('aO..../....../....../....../....../......');S=C.initState(L);r=C.fall(L,S,1);ok(r.S.x[0]===5&&r.S.b[0]===4,'box');
L=C.parseLevel('a.A.../....../....../....../....../......'.replace('a','O'));S=C.initState(L);r=C.fall(L,S,1);ok(r.S.x[0]===1,'box blocked by exit');
// portal
L=C.parseLevel('a1..../....../....../...1../....../......');S=C.initState(L);r=C.fall(L,S,1);ok(r.S.b[0]===23,'portal'+r.S.b[0]);
L=C.parseLevel('a1..1#/....../....../....../....../......');S=C.initState(L);r=C.fall(L,S,1);ok(r.S.b[0]===4,'portal loopfree '+r.S.b[0]);
// solver
L=C.parseLevel('#....#/.a..#./....../.#..../....../.A....');let s=C.solve(L,C.initState(L),1e5,true);ok(s&&s.len>0,'solve');
console.log('unit tests',pass,'passed',fail,'failed');if(fail)process.exit(1);
