#!/usr/bin/env python3
# Development dependencies: pefile, capstone. These never enter the image.
import pathlib,re,json,struct,collections,hashlib
import pefile,capstone
from capstone.x86 import *
import argparse
cli=argparse.ArgumentParser(description='Development-only: lift the verified CellTalk build to data-only presentation graphs. Never execute the game binary.')
cli.add_argument('--work',default='.cache/six-games-20261115')
cli.add_argument('--isil',default='/tmp/gal-cpp2il-20261115/analysis-2022/IsilDump/Assembly-CSharp')
cli.add_argument('--output',required=True)
args=cli.parse_args()
B=pathlib.Path(args.work);P=pefile.PE(str(B/'code/extracted/g06/__pair_media/files/GameAssembly.dll'));BASE=P.OPTIONAL_HEADER.ImageBase;C=capstone.Cs(capstone.CS_ARCH_X86,capstone.CS_MODE_32);C.detail=True
META=next((B/'followup/extracted/g05').rglob('global-metadata.dat')).read_bytes();H=struct.unpack_from('<10I',META)
ROOT=pathlib.Path(args.isil);raw=P.__data__;methods={};calls={};literals={}
def lit(a):
 try:
  v=struct.unpack('<I',P.get_data(a-BASE,4))[0]
  if v>>29!=5 or v&1!=1:return None
  i=(v&0x1fffffff)>>1
  if i>=H[3]//8:return None
  n,o=struct.unpack_from('<II',META,H[2]+i*8);return META[H[4]+o:H[4]+o+n].decode()
 except:return None

def method(file,name='System.Boolean MoveNext()'):
 s=file.read_text().split('Method: '+name,1)[1].split('Method:',1)[0];d,il=s.split('ISIL:',1);lines=[l.strip()for l in d.split('Disassembly:',1)[1].splitlines()if l.strip()];flag=re.search(r'cmp byte ptr ds:\[([\dA-F]+)h\],0',d)
 if not flag:raise Exception('no class init flag '+file.name)
 sig=bytes.fromhex('803d')+struct.pack('<I',int(flag[1],16))+b'\0';positions=[m.start()for m in re.finditer(re.escape(sig),raw)]
 if len(positions)!=1:raise Exception('entry signature ambiguity '+str(positions))
 pos=raw.rfind(bytes.fromhex('558bec'),max(0,positions[0]-256),positions[0]+1)
 if pos<0:raise Exception('prologue not found')
 va=BASE+P.get_rva_from_offset(pos)
 jt=re.findall(r'jmp dword ptr \[.*?\+([\dA-F]+)h\]',d);end=min([int(v,16)for v in jt],default=va+100000)
 ins=list(C.disasm(P.get_data(va-BASE,min(100000,end-va)),va,count=len(lines)));ins=[i for i in ins if i.address<end]
 nativecalls=[i for i in ins if i.mnemonic=='call'];names=[re.match(r'\s*\d+ Call (.*?)(?:,|$)',l)[1].strip()for l in il.splitlines()if re.match(r'\s*\d+ Call ',l)];names=[n for n in names if n!='0']
 if len(nativecalls)!=len(names):raise Exception('call mapping mismatch '+file.name+str((len(nativecalls),len(names))))
 for i,n in zip(nativecalls,names):
  if i.operands[0].type==X86_OP_IMM:
   a=i.operands[0].imm
   if a in calls and calls[a]!=n:raise Exception('conflicting call '+hex(a))
   calls[a]=n
 for i in ins:
  for o in i.operands:
   if o.type==X86_OP_MEM and not o.mem.base and not o.mem.index:
    a=o.mem.disp;v=lit(a)
    if v is not None:literals[a]=v
 methods[file.stem]={'entry':va,'ins':ins,'type':file.stem.split('_NestedType_')[0]}
 return methods[file.stem]

layouts=json.loads((B/'cell-event-layouts.json').read_text());controllers=json.loads((B/'cell-controllers.json').read_text());replays={r['type']for r in controllers if layouts[r['type']]['base']=='ReplayScene'}
errors=[]
for t in sorted(replays):
 files=list(ROOT.glob(t+'_NestedType__Event_d__*.txt'))
 if len(files)!=1:errors.append([t,'event missing/ambiguous']);continue
 try:method(files[0])
 except Exception as e:errors.append([t,str(e)])
print('methods',len(methods),'errors',errors)
print('mnemonics',collections.Counter(i.mnemonic for m in methods.values()for i in m['ins']))
print('calls',collections.Counter(calls.values()))
(B/'cell-method-map.json').write_text(json.dumps({'calls':calls,'literals':literals,'methods':{k:{'entry':v['entry'],'type':v['type'],'ins':[[i.address,i.mnemonic,i.op_str]for i in v['ins']]}for k,v in methods.items()}},ensure_ascii=False))

# Static, bounded execution of the captured coroutine, never loading the PE.
# The output is a data-only scene call graph; the production reader has no x86 VM.
class Branch(Exception):
 def __init__(self,label,logs):self.label=label;self.logs=logs
class Unknown:
 def __init__(self,label):self.label=label
 def __repr__(self):return '?'+self.label

def simulate(m,controller,decisions):
 regs={k:0 for k in ['eax','ebx','ecx','edx','esi','edi','ebp','esp']};mem={};heap=0x20000000;logs=[];branch=0;flags=(0,0);fpu=0
 def alloc(label):
  nonlocal heap
  heap+=0x1000;mem[heap-4]={'opaque':label};return heap
 frame=alloc('coroutine');outer=alloc('controller');regs['esp']=0x70000000;mem[regs['esp']+4]=frame;mem[frame+8]=0;mem[frame+16]=outer
 def fields(t):return fields(layouts[t]['base'])+layouts[t]['fields']if t in layouts else[]
 for f in fields(controller['type']):
  v=controller['fields'].get(f['name']);mem[outer+f['offset']]=v if isinstance(v,(str,int,float,bool))else(alloc('field:'+f['name'])if v and str(v.get('m_PathID','0'))!='0'else 0)
 conditionValues={};prefs={}
 ip=m['entry'];imap={i.address:i for i in m['ins']};cmp=(0,0);last=''
 def reg(n):
  if n in ['al','bl','cl','dl','ah','bh','ch','dh','ax','bx','cx','dx']:
   r='e'+n[0]+'x';v=regs[r]
   if isinstance(v,Unknown):return v
   return(v>>8)&255 if n.endswith('h')else v&(65535 if n.endswith('x')else 255)
  return regs.get(n,0)
 def setreg(n,v):
  if n in ['al','bl','cl','dl','ah','bh','ch','dh','ax','bx','cx','dx']:
   r='e'+n[0]+'x';old=regs[r];mask=65535 if n.endswith('x')else 255
   if isinstance(old,int)and isinstance(v,int):regs[r]=(old&~mask)|(v&mask)
   else:regs[r]=v
  else:regs[n]=v
 def addr(o):
  b=reg(C.reg_name(o.mem.base))if o.mem.base else 0;idx=reg(C.reg_name(o.mem.index))if o.mem.index else 0
  if not isinstance(b,int)or not isinstance(idx,int):raise Exception('non-numeric indirect reference '+str(b))
  return(b+idx*o.mem.scale+o.mem.disp)&0xffffffff
 def rd(o):
  if o.type==X86_OP_IMM:return o.imm&0xffffffff
  if o.type==X86_OP_REG:return reg(C.reg_name(o.reg))
  a=addr(o)
  if a in mem:return mem[a]
  if a in literals:return literals[a]
  if BASE<=a<BASE+P.OPTIONAL_HEADER.SizeOfImage:
   if o.size==1:return 1
   try:return int.from_bytes(P.get_data(a-BASE,o.size),'little')
   except:return 0
  return 0
 def wr(o,v):
  if o.type==X86_OP_REG:setreg(C.reg_name(o.reg),v)
  elif o.type==X86_OP_MEM:mem[addr(o)]=v
  else:raise Exception('write operand')
 def val(v):
  if isinstance(v,Unknown):return{'unknown':v.label}
  if isinstance(v,int)and v>=0x20000000 and v-4 in mem:return mem[v-4]
  return v
 def compare(a,b,condition):
  nonlocal branch
  if isinstance(a,Unknown)or isinstance(b,Unknown):
   base,invert={'jne':('je',True),'jbe':('ja',True),'jae':('jb',True),'jle':('jg',True),'jge':('jl',True)}.get(condition,(condition,False))
   label=str(a)+' '+condition+' '+str(b);cachekey=str(a)+' '+base+' '+str(b)
   if cachekey in conditionValues:return conditionValues[cachekey]!=invert
   i=branch;branch+=1
   if i>=len(decisions):raise Branch(label,list(logs))
   conditionValues[cachekey]=decisions[i]!=invert;return decisions[i]
  if condition in ['je','jz']:return a==b
  if condition in ['jne','jnz']:return a!=b
  if not isinstance(a,(int,float))or not isinstance(b,(int,float)):raise Exception('unordered comparison '+str((a,b)))
  if condition in ['ja','jg']:return a>b
  if condition in ['jae','jge']:return a>=b
  if condition in ['jb','jl']:return a<b
  if condition in ['jbe','jle']:return a<=b
  if condition in ['jp']:return False
  if condition in ['jnp']:return True
  raise Exception('condition '+condition)
 for iteration in range(200000):
  ins=imap.get(ip)
  if not ins:raise Exception('instruction outside coroutine '+hex(ip))
  ip+=ins.size;op=ins.mnemonic;ops=ins.operands
  if op in['mov','movss','movsd','movq','movaps','movups','movd','movzx']:wr(ops[0],rd(ops[1]))
  elif op=='lea':wr(ops[0],addr(ops[1]))
  elif op=='push':regs['esp']-=4;mem[regs['esp']]=rd(ops[0])
  elif op=='pop':wr(ops[0],mem.get(regs['esp'],0));regs['esp']+=4
  elif op in['add','sub','xor','and','or','shl','shr','imul','addss','subss']:
   a,b=rd(ops[0]),rd(ops[1]);v=0
   if op=='xor'and ins.op_str.split(', ')[0]==ins.op_str.split(', ')[-1]:v=0
   elif isinstance(a,Unknown)or isinstance(b,Unknown):v=Unknown(str(a)+op+str(b))
   elif op in['add','addss']:v=a+b
   elif op in['sub','subss']:v=a-b
   elif op=='xor':v=a^b
   elif op=='and':v=a&b
   elif op=='or':v=a|b
   elif op=='shl':v=a<<b
   elif op=='shr':v=a>>b
   elif op=='imul':v=a*b
   if isinstance(v,int)and op not in['addss','subss']:v&=0xffffffff
   wr(ops[0],v)
  elif op in['inc','dec']:
   v=rd(ops[0]);wr(ops[0],Unknown(str(v)+op)if isinstance(v,Unknown)else v+(1 if op=='inc'else-1))
  elif op in['cmp','comiss','ucomiss']:cmp=(rd(ops[0]),rd(ops[1]))
  elif op=='test':
   a,b=rd(ops[0]),rd(ops[1]);cmp=(a if isinstance(a,Unknown)else b if isinstance(b,Unknown)else a&b,0)
  elif op=='jmp':ip=rd(ops[0])
  elif op.startswith('j'):
   if compare(*cmp,op):ip=rd(ops[0])
  elif op.startswith('set'):wr(ops[0],int(compare(*cmp,'j'+op[3:])))
  elif op.startswith('cmov'):
   if compare(*cmp,'j'+op[4:]):wr(ops[0],rd(ops[1]))
  elif op=='fstp':wr(ops[0],fpu)
  elif op in['nop','lahf','sahf']:pass
  elif op=='xorps':wr(ops[0],0)
  elif op in['unpcklps','cvtdq2ps','cvtdq2pd','cvttsd2si','mulsd']:wr(ops[0],Unknown(op+' at '+hex(ins.address)))
  elif op=='call':
   target=rd(ops[0]);name=calls.get(target,hex(target));args=[mem.get(regs['esp']+4*i,0)for i in range(12)];last=name
   if name=='0x101CEAA0':raise Exception('native null check reached')
   if 'initialize_runtime_metadata'in name or 'runtime_class_init'in name:continue
   logs.append({'method':name,'address':hex(ins.address),'args':[val(x)for x in args[:6]]})
   if name=='MyPrefs.SetFloat':prefs[str(args[0])]=args[1];regs['eax']=0
   elif name=='MyPrefs.GetFloat'and str(args[0])in prefs:regs['eax']=prefs[str(args[0])];fpu=regs['eax']
   elif name in['Player.HasChara','EventEngine.QuestHasProgress','EventEngine.QuestGetProgress','MyPrefs.GetFloat','MyPrefs.GetString','GameObject.get_activeSelf']:
    u=Unknown(name+'('+','.join(str(val(x))for x in args[:2])+')');regs['eax']=u;fpu=u
   elif name=='String.Concat':regs['eax']=''.join(a for a in args[:4]if isinstance(a,str))
   elif name=='String.op_Inequality':regs['eax']=int(args[0]!=args[1])
   elif name in['Object.op_Implicit']:regs['eax']=int(args[0]!=0)
   else:
    regs['eax']=alloc(name)
    if name=='ReplayScene.CGLoad':mem[outer+60]=regs['eax']
    if name=='ReplayScene.CGDestroy':mem[outer+60]=0
  elif op=='ret':
   if reg('al')==0:return{'calls':logs}
   regs={k:0 for k in regs};regs['esp']=0x70000000;mem[regs['esp']+4]=frame;ip=m['entry']
  else:raise Exception('unsupported x86 '+op+' '+ins.op_str)
 raise Exception('execution limit')

audit=[]
for t in sorted(replays):
 m=next((v for v in methods.values()if v['type']==t),None);r=next(r for r in controllers if r['type']==t)
 if not m:continue
 try:
  a=simulate(m,r,[False]*16);audit.append({'type':t,'calls':a['calls']})
 except Exception as e:audit.append({'type':t,'error':str(e)})
(B/'cell-simulation.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2))
print('simulation',len(audit),'success',sum('error'not in r for r in audit),[(r['type'],r.get('error'))for r in audit if'error'in r])

PRESENT={'EventEngine.Text','ReplayScene.CGLoad','CG.ChangePose','Music.Play','Music.Fadeout','EventEngine.Wait','ReplayScene.CGDestroy','EventEngine.TextCloseWindow','EventEngine.TextBackBG','EventEngine.TextFrontFG','EventEngine.FadeinNormal','EventEngine.FadeinSlow','EventEngine.FadeinWait','Sound.Play','Sound.StopVoice'}
def normalize(logs,r):
 out=[]
 for c in logs:
  n=c['method']
  if n not in PRESENT:
   if n.startswith(('EventEngine.Stand','EventEngine.Animation','EventEngine.Animator','EventEngine.MoveCamera','EventEngine.SetChara','MainCamera.Zoom'))or n.startswith(r['type']+'.'):out.append({'op':'unsupported','method':n,'address':c['address']})
   continue
  args=c['args']
  def v(a):
   if isinstance(a,dict)and a.get('opaque','').startswith('field:'):return{'field':a['opaque'][6:]}
   if isinstance(a,dict)and a.get('opaque')=='controller':return{'self':True}
   if isinstance(a,str)and a:
    matches=[k for k,x in r['fields'].items()if isinstance(x,str)and x==a]
    if len(matches)==1:return{'field':matches[0]}
   return a
  num={'EventEngine.Text':4 if isinstance(args[2],int)else 3,'ReplayScene.CGLoad':4,'CG.ChangePose':3,'Music.Play':1,'Music.Fadeout':1,'EventEngine.Wait':2,'ReplayScene.CGDestroy':3,'Sound.Play':3}.get(n,1)
  out.append({'op':'call','method':n,'address':c['address'],'args':[v(x)for x in args[:num]]})
 return out
profiles={};profileerrors=[]
for t in sorted(replays):
 m=next((v for v in methods.values()if v['type']==t),None);r=next(r for r in controllers if r['type']==t)
 if not m:continue
 count=[0]
 def build(ds,skip=0):
  count[0]+=1
  if count[0]>64:raise Exception('branch budget')
  try:result=simulate(m,r,ds);return{'commands':normalize(result['calls'][skip:],r)}
  except Branch as e:return{'commands':normalize(e.logs[skip:],r),'condition':e.label,'no':build(ds+[False],len(e.logs)),'yes':build(ds+[True],len(e.logs))}
 try:profiles[t]=build([])
 except Exception as e:profileerrors.append([t,str(e)])
pathlib.Path(args.output).write_text(json.dumps({'format':'celltalk-native-profile/1','binarySha256':hashlib.sha256(raw).hexdigest(),'metadataSha256':hashlib.sha256(META).hexdigest(),'fields':{k:v for k,v in layouts.items()if v['base']=='ReplayScene'or k in ['ReplayScene','EventEngine']},'scenes':profiles,'unavailable':errors+profileerrors},ensure_ascii=False,separators=(',',':')))
print('profiles',len(profiles),'errors',profileerrors)
