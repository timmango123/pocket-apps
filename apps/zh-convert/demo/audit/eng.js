const fs=require('fs');const html=fs.readFileSync(''+require('path').resolve(__dirname,'../../index.html')+'','utf8');
const ZC=new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1]+';return ZC;')();
module.exports={ZC,s2t:(t,o)=>ZC.join(ZC.convert(t,Object.assign({dir:'s2t'},o||{}))),t2s:(t,o)=>ZC.join(ZC.convert(t,Object.assign({dir:'t2s'},o||{})))};
