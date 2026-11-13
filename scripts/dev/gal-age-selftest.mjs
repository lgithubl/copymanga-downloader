import{test}from'node:test'
import assert from'node:assert/strict'
import{readFile,readdir}from'node:fs/promises'
import{createHash}from'node:crypto'
import{existsSync}from'node:fs'
import{readAgeIndex,decodeAgeScript,decodeAgeImage,ageControlFlow,ageLiteralInitializer,traceAgeProgram}from'../../web/library/gal/age.mjs'
import{createAgeGraphics}from'../../web/library/gal/age-graphics.mjs'
const old='.cache/new-games-043952/extracted/g05',extra='.cache/new-games-052443/extracted/g05/__verify/age'
test('received AGE1.57 dependency batch is complete; remaining prologue blocker is unsupported semantics, not a missing SN0000 file',{skip:!existsSync('.cache/age-072229/extracted/g01/__verify/index.json')},async()=>{
 const root='.cache/age-072229/extracted/g01/',report=JSON.parse(await readFile(root+'__verify/index.json'));assert.equal(report.files.length,25);let bytes=0,scripts=0,images=0
 for(const r of report.files){const b=await readFile(root+r.artifact);assert.equal(b.length,r.bytes);assert.equal(createHash('sha256').update(b).digest('hex'),r.sha256);bytes+=b.length;if(r.logicalName.endsWith('.BIN')){ageControlFlow(decodeAgeScript(b));scripts++}if(r.logicalName.endsWith('.AGF')){const image=decodeAgeImage(b);assert.ok(image.width>0&&image.height>0);images++}}
 assert.equal(bytes,11329945);assert.equal(scripts,17);assert.equal(images,6)
 const sn=decodeAgeScript(await readFile(root+'__verify/age/SN0000.BIN')),state=traceAgeProgram(sn);assert.equal(sn.instructions.length,4335);assert.equal(state.status,'unsupported');assert.equal(state.stopped.opcode,0x1f4)
 console.log('AGE received/verified:25files,17scripts,6images,2audio; next implementation blocker SN0000 opcode0x1f4')
})
test('two-way branches retain both targets; fallthrough and dynamic calls stay explicit',()=>{const a=value=>({type:0,value}),r=ageControlFlow({instructions:[{offset:0,opcode:0xa0,args:[a(1),a(10),a(0xffffffff)]},{offset:7,opcode:0x8f,args:[{type:3,value:12}]},{offset:10,opcode:5,args:[]}]});assert.deepEqual([r.nodes[0].yes,r.nodes[0].no],[10,7]);assert.equal(r.nodes[1].call.operand.type,3);assert.equal(r.unresolved.length,1);assert.equal(r.nodes[2].end,'return');assert.throws(()=>ageControlFlow({instructions:[{offset:0,opcode:0x8c,args:[a(1)]}]}),/boundary/)})
test('unknown initializer operations fail closed',()=>{assert.throws(()=>ageLiteralInitializer({instructions:[{offset:0,opcode:0x2ff,args:[]}]}),/semantics/);const s=ageLiteralInitializer({instructions:[{offset:0,opcode:0x55,args:[{type:3,value:7},{type:0,value:0xffffffff}]},{offset:5,opcode:2,args:[]}]});assert.equal(s.integers[7],-1)})
test('native index ordinals and stage settings, all captured direct branch targets, pure initialization globals',{skip:!existsSync(old)},async()=>{const index=readAgeIndex(await readFile(old+'/SYS4INI.BIN'));assert.equal(index.entries[77].ordinal,77);assert.equal(index.entries[77].name,'BG054AA.AGF');assert.equal(index.entries[140].name,'CF002AAO.AGF');assert.equal(index.trailingBytes,19);assert.equal(index.metadata.numbers.length,61);assert.ok(index.metadata.settings.some(x=>x.name==='SCREENY'&&x.value==='900'));
 let targets=0,images=0;for(const dir of[old,extra])for(const name of(await readdir(dir)).filter(x=>x.endsWith('.BIN')&&!['SYS4INI.BIN'].includes(x))){const bytes=await readFile(dir+'/'+name);if(!bytes.toString('ascii',0,4).startsWith('SYS4'))continue;const program=decodeAgeScript(bytes),flow=ageControlFlow(program);targets+=flow.nodes.filter(x=>x.yes!==undefined||x.call!==undefined||x.opcode===0x8c).length;for(const i of program.instructions)if(i.opcode===0x55&&i.args[0].type===3&&i.args[0].value===970711&&i.args[1].type===0){assert.ok(index.entries[i.args[1].value]?.name.endsWith('.AGF'),name+': image ordinal '+i.args[1].value);images++}}
 assert.ok(targets>20000);assert.equal(images,1613);const globals=ageLiteralInitializer(decodeAgeScript(await readFile(extra+'/SCINIT.BIN')));assert.equal(globals.integers[983750],138);assert.equal(index.entries[138].name,'SC0000.BIN');const names=ageLiteralInitializer(decodeAgeScript(await readFile(extra+'/CVINIT.BIN')));assert.ok(Object.values(names.strings).includes('ナレーション'));console.log('native branch/call nodes',targets,'texture ordinal references',images,'literal globals',Object.keys(globals.integers).length)
})

test('bounded scalar trace follows one branch, restores calls and stops before unknown instructions',async()=>{
 const{traceAgeProgram}=await import('../../web/library/gal/age.mjs'),a=value=>({type:0,value}),g=value=>({type:3,value}),i=(offset,opcode,args=[])=>({offset,opcode,args});const program={instructions:[i(0,0x5a,[g(1),g(2),a(1)]),i(7,0xa0,[g(1),a(19),a(14)]),i(14,0x55,[g(3),a(10)]),i(19,0x8f,[a(23)]),i(22,2),i(23,0x50,[g(4),g(3),a(2)]),i(30,5)]};const yes=traceAgeProgram(program,{integers:{2:1}}),no=traceAgeProgram(program,{integers:{2:0}});assert.equal(yes.integers[4],2);assert.equal(no.integers[4],12);assert.equal(yes.status,'exited');assert.equal(no.status,'exited');assert.equal(traceAgeProgram({instructions:[i(0,0x2ff,[])]}).status,'unsupported');assert.equal(traceAgeProgram({instructions:[i(0,0x8c,[a(0)])]},{maxSteps:3}).status,'limit')
})
test('native SCJUMP chooses different sections and prologue dispatcher identifies the exact companion file',{skip:!existsSync(extra+'/SCJUMP.BIN')},async()=>{
 const{traceAgeProgram}=await import('../../web/library/gal/age.mjs'),jump=decodeAgeScript(await readFile(extra+'/SCJUMP.BIN')),fresh=traceAgeProgram(jump,{integers:{15152:1,970849:1000000}}),finished=traceAgeProgram(jump,{integers:{15152:1,970849:1000000,4040:1}});assert.equal(fresh.status,'exited');assert.equal(finished.status,'exited');assert.equal(fresh.integers[15151],0);assert.equal(finished.integers[15151],1);assert.equal(fresh.integers[970849],10);
 const script=decodeAgeScript(await readFile(old+'/SC0000.BIN')),dispatch=traceAgeProgram(script,{entry:3596,integers:{15151:0,0:1}}),index=readAgeIndex(await readFile(old+'/SYS4INI.BIN'));assert.equal(dispatch.status,'returned');assert.equal(dispatch.integers[4012],139);assert.equal(index.entries[dispatch.integers[4012]].name,'SN0000.BIN');assert.equal(index.entries[139].size,100668);assert.equal(dispatch.strings[3000],'序章');assert.equal(traceAgeProgram(script).status,'unsupported')
})

test('string array pointers keep text storage and writes, including a pointer base',()=>{
 const a=(type,value)=>({type,value}),i=(offset,opcode,...args)=>({offset,opcode,args})
 const program={instructions:[i(0,0x61,a(14,0),a(5,100),a(0,2)),i(7,0x192,a(5,200),a(14,0)),i(12,0x61,a(14,1),a(14,0),a(0,1)),i(19,0x192,a(14,1),{type:2,text:'フィア'}),i(24,2)]}
 const result=traceAgeProgram(program,{strings:{102:'アヴァロ'}})
 assert.equal(result.status,'exited');assert.equal(result.strings[200],'アヴァロ');assert.equal(result.strings[103],'フィア')
 assert.throws(()=>traceAgeProgram({instructions:[i(0,0x192,a(5,200),a(14,0))]}),/not initialized/)
 assert.equal(traceAgeProgram({instructions:[i(0,0x61,a(12,0),a(5,100),a(0,0))]}).status,'unsupported')
})

test('linked BIN calls share globals, preserve caller locals and return after callee script exit',()=>{
 const a=(type,value)=>({type,value}),i=(offset,opcode,...args)=>({offset,opcode,args})
 const caller={instructions:[i(0,0x55,a(9,0),a(0,7)),i(5,3,a(0,10)),i(8,0x55,a(3,50),a(9,0)),i(13,2)]}
 const callee={instructions:[i(0,0x55,a(9,0),a(0,99)),i(5,0x8f,a(0,9)),i(8,2),i(9,0x55,a(3,51),a(9,0)),i(14,2)]}
 const result=traceAgeProgram(caller,{programName:'caller',resolveScript:n=>n===10?{program:callee,name:'callee'}:null})
 assert.equal(result.status,'exited');assert.equal(result.integers[50],7);assert.equal(result.integers[51],99)
 assert.ok(result.trace.some(x=>x.script==='callee'&&x.offset===14))
 const missing=traceAgeProgram(caller);assert.equal(missing.status,'missing-script');assert.equal(missing.missingScript,10)
 assert.throws(()=>traceAgeProgram({instructions:[i(0,3,a(0,1))]},{resolveScript:()=>({program:{instructions:[i(0,3,a(0,1))]}}),maxStack:3}),/call stack limit/)
})

test('native caller actually executes CSINIT and preserves exact body/patch mapping',{skip:!existsSync(old)},async()=>{
 const index=readAgeIndex(await readFile(old+'/SYS4INI.BIN')),entry=index.entries.find(x=>x.name==='CSINIT.BIN'),mapping=decodeAgeScript(await readFile('.cache/age-072229/extracted/g01/__verify/age/CSINIT.BIN'))
 const a=(type,value)=>({type,value}),caller={instructions:[{offset:0,opcode:3,args:[a(0,entry.ordinal)]},{offset:3,opcode:2,args:[]}]}
 const result=traceAgeProgram(caller,{integers:{970711:16971},resolveScript:n=>n===entry.ordinal?{program:mapping,name:entry.name}:null})
 assert.equal(result.status,'exited');assert.equal(result.integers[1044299],16970);assert.equal(result.integers[1044300],16971)
 assert.deepEqual([result.integers[1044301],result.integers[1044302]],[600,280])
 assert.ok(index.entries.find(x=>x.ordinal===16970)?.name.endsWith('.AGF'))
 assert.ok(result.trace.some(x=>x.script==='CSINIT.BIN'))
})

test('native placement helper uses source dimensions and keeps the bottom anchor when a texture changes',{skip:!existsSync(old)},async()=>{
 const script=decodeAgeScript(await readFile(old+'/SC0000.BIN')),system=decodeAgeScript(await readFile(extra+'/SYSTEM4.BIN'))
 const ids=traceAgeProgram(system,{entry:2040});assert.equal(ids.status,'returned')
 const root='.cache/age-072229/extracted/g01/__verify/age/',index=readAgeIndex(await readFile(old+'/SYS4INI.BIN')),images=new Map()
 for(const name of ['BG054AA.AGF','CS001AAA.AGF','CS002AAA.AGF']){const row=index.entries.find(x=>x.name===name);images.set(row.ordinal,decodeAgeImage(await readFile(root+name)))}
 const gpu=createAgeGraphics({loadImage:n=>images.get(n)}),globals={...ids.integers,970752:101000,970753:101020,970754:101040}
 const draw=(slot,ordinal)=>traceAgeProgram(script,{entry:155991,integers:{...globals,970746:slot,970711:ordinal},onInstruction:gpu.instruction})
 const bg=draw(0,77);assert.equal(bg.status,'unsupported');assert.equal(bg.stopped.opcode,0x242)
 assert.deepEqual([gpu.objects.get(101000).x,gpu.objects.get(101000).y],[0,0])
 const first=draw(2,16485);assert.equal(first.stopped.opcode,0x242)
 assert.deepEqual([gpu.objects.get(101040).x,gpu.objects.get(101040).y],[128,-28])
 const second=draw(2,index.entries.find(x=>x.name==='CS002AAA.AGF').ordinal);assert.equal(second.stopped.opcode,0x242)
 assert.deepEqual([gpu.objects.get(101040).x,gpu.objects.get(101040).y],[224,36])
 const rect=gpu.objects.get(101040);assert.equal(rect.x+rect.crop[2]/2,800);assert.equal(rect.y+rect.crop[3],900)
 assert.equal(gpu.instruction({opcode:0x242,args:[]},{read:()=>0,write:()=>{}}),false)
 const limited=createAgeGraphics({maxBytes:16,loadImage:n=>images.get(n)});assert.throws(()=>traceAgeProgram(script,{entry:155991,integers:{...globals,970746:0,970711:77},onInstruction:limited.instruction}),/memory limit/)
})
