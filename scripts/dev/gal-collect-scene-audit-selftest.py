"""Four-game routing, complete event projections, native audio/DLC paths, bounds."""
import pathlib,tempfile,re,json,zlib,base64,hashlib,struct,subprocess,os,tarfile
src=pathlib.Path('scripts/dev/gal-collect-run.sh').read_text();base=pathlib.Path(tempfile.mkdtemp(prefix='collect-scene-audit-'));root=base/'gal';root.mkdir();before={}
def put(game,rel,b):
 p=root/game/rel;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b);before[p]=b;return p
def js(game,rel,value):return put(game,rel,json.dumps(value,ensure_ascii=False).encode())
def xp3(entries):
 def chunk(tag,b):return tag+struct.pack('<Q',len(b))+b
 payload=b'';index=b''
 for name,b in entries:
  info=struct.pack('<IQQH',0,len(b),len(b),len(name))+name.encode('utf-16le')
  seg=struct.pack('<IQQQ',0,19+len(payload),len(b),len(b));payload+=b
  index+=chunk(b'File',chunk(b'info',info)+chunk(b'segm',seg)+chunk(b'adlr',struct.pack('<I',zlib.adler32(b))))
 return b'XP3\r\n \n\x1a\x8b\x67\x01'+struct.pack('<Q',19+len(payload))+payload+b'\0'+struct.pack('<Q',len(index))+index
twi='ツヴァイトリガー'
for n in ['data','patch','evimage']:put(twi,n+'.xp3',xp3([('setup.tjs',b'native script'),('large.bin',b'X'*8192)]))
put(twi,'video.xp3',xp3([('native.l2d',b'PK\x03\x04'+b'M'*4096),('huge.mpg',b'V'*4096)]))
for game,prefix in [('RJ01271506',''),('RJ328940','www/')]:
 js(game,prefix+'data/System.json',{});js(game,prefix+'data/MapInfos.json',[None,{'id':1,'name':'story'}]);put(game,prefix+'js/plugins.js',('var $plugins='+json.dumps([{'name':'triacontane/TemplateEvent','status':True,'parameters':{'TemplateMapIdList':'[\"93\",\"252\"]','TemplateMapId':'93'}}]if game=='RJ01271506'else[])+';').encode())
 commands=[{'code':101,'parameters':['',0,0,2,'actor']},{'code':401,'parameters':['\\TRN[12354]native text']},{'code':117,'parameters':[1]},{'code':231,'parameters':[2,'still/bisty/h/H001_00']},{'code':250,'parameters':[{'name':'_lize_sample','volume':90}]}]
 js(game,prefix+'data/CommonEvents.json',[None,{'id':1,'name':'replay','list':commands[:2]}])
 for n in [62,93,252]:js(game,prefix+'data/Map%03d.json'%n,{'data':[9]*300,'width':10,'height':10,'events':[None,{'id':1,'name':'event','note':'<TE:story>','pages':[{'conditions':{},'list':commands}]}]})
 put(game,prefix+'img/pictures/still/bisty/h/H001_00.png_',b'encrypted-picture')
 if game=='RJ01271506':
  js(game,'audio/voice/voice_list.json',{'uniqueIds':[12354]});js(game,'dlc/dlc_10000/list.json',{'list':['audio/voice/unique/12354.ogg']});put(game,'dlc/dlc_10000/audio/voice/unique/12354.ogg_',b'encrypted-voice')
 else:put(game,prefix+'js/plugins/SimpleVoice.js',b'se.name.includes("_lize")');put(game,prefix+'audio/se/_lize_sample.rpgmvo',b'encrypted-se-voice')
put('Remastered','source.arc',b'HEADpayload');put('天結いラビリンスマイスター','AGE.EXE',b'not requested');put('AI','game.exe',b'not requested');put(twi,'game.exe',b'never collect runtime')
plan={'Remastered':{'guards':[dict(source='source.arc',offset=0,bytes=4,sha256=hashlib.sha256(b'HEAD').hexdigest())],'ranges':[dict(source='source.arc',sourceBytes=11,offset=4,bytes=7,logicalName='img/ev/ev056aa.bytes',artifact='__scene-audit/remastered/ev056aa.bytes')]}}
def constant(s,name,value):return re.sub(r"(?m)^"+name+r" = '[^']*'$",name+" = '"+base64.b64encode(zlib.compress(json.dumps(value).encode())).decode()+"'",s)
src=constant(src,'SCENE_AUDIT_PLAN',plan);src=constant(src,'SCENE_AUDIT_REUSED',{'RJ01271506':{'js/plugins.js':hashlib.sha256(before[root/'RJ01271506/js/plugins.js']).hexdigest()}});script=base/'collector.sh';script.write_text(src)
env={k:v for k,v in os.environ.items()if not k.startswith('GAL_COLLECT_')};out=base/'out';env.update(GAL_COLLECT_RULES='^new-games:scene-audit$',GAL_COLLECT_DRYRUN='1',GAL_COLLECT_OUT=str(out));r=subprocess.run(['bash',str(script),str(root)],env=env,capture_output=True,text=True);assert r.returncode==0,r.stdout+r.stderr
parts=list(out.glob('*.part-*'));assert len(parts)==4,(len(parts),r.stdout);reports={}
for part in parts:
 with tarfile.open(part)as t:
  names=t.getnames();assert not any(n.lower().endswith(('.exe','.dll','.xp3'))for n in names)
  report=json.load(t.extractfile(next(n for n in names if n.endswith('__scene-audit/index.json'))));reports[report['game']]=report;assert report['sourceReadOnly']
  for row in report['files']:
   b=t.extractfile(next(n for n in names if n.endswith('/'+row['artifact']))).read();assert len(b)==row['bytes']and hashlib.sha256(b).hexdigest()==row['sha256']
  if report['game'].startswith('RJ'):
   assert report['sceneCoverage']['maps']==3
   rows=[x for x in report['files']if x.get('projection')];assert len(rows)==3
   for row in rows:
    d=json.load(t.extractfile(next(n for n in names if n.endswith('/'+row['artifact']))));assert'data'not in d;assert d['events'][1]['pages'][0]['list']==commands;assert row['sourceSha256']==hashlib.sha256((root/report['game']/row['source']).read_bytes()).hexdigest()
   if report['game']=='RJ01271506':
    assert report['templateMapIds']==[93,252];assert report['sceneCoverage']['declaredTrnVoiceIds']==1;assert any('dlc_10000/audio/voice/unique/12354.ogg_'in n for n in names);assert any(x['source']=='js/plugins.js'for x in report['reused']);assert not any(n.endswith('/js/plugins.js')for n in names)
   else:assert any(n.endswith('audio/se/_lize_sample.rpgmvo')for n in names);assert report['sceneCoverage']['nativeSeVoiceHints']==['_lize']
  if report['game']==twi:
   assert any(n.endswith('/video.xp3/entries.json')for n in names);assert any(x.get('fullSegment')is False for x in report['files']);assert any(isinstance(n,dict)and n.get('completeModelPackages')==1 for n in report['notes'])
assert set(reports)=={twi,'RJ01271506','RJ328940','Remastered'};assert all(p.read_bytes()==b for p,b in before.items())
env['GAL_COLLECT_ONLY']='RJ328940|Remastered|ツヴァイトリガー';env['GAL_COLLECT_OUT']=str(base/'remaining-three');r=subprocess.run(['bash',str(script),str(root)],env=env,capture_output=True,text=True);assert r.returncode==0,r.stdout+r.stderr
remaining=set()
for part in (base/'remaining-three').glob('*.part-*'):
 with tarfile.open(part)as t:remaining.add(json.load(t.extractfile(next(n for n in t.getnames()if n.endswith('__scene-audit/index.json'))))['game'])
assert remaining=={twi,'RJ328940','Remastered'},remaining;env.pop('GAL_COLLECT_ONLY')
p=root/'Remastered/source.arc';p.write_bytes(b'BAD!payload');env['GAL_COLLECT_OUT']=str(base/'reject-stale');r=subprocess.run(['bash',str(script),str(root)],env=env,capture_output=True,text=True);assert r.returncode!=0 and'refusing stale'in r.stdout+r.stderr;p.write_bytes(before[p])
p=root/twi/'video.xp3';p.write_bytes(b'not an archive');env['GAL_COLLECT_OUT']=str(base/'reject-index');r=subprocess.run(['bash',str(script),str(root)],env=env,capture_output=True,text=True);assert r.returncode!=0 and'XP3 signature'in r.stdout+r.stderr;p.write_bytes(before[p])
assert all(p.read_bytes()==b for p,b in before.items())
print('PASS four games only, all event commands retained without tile cells, TRN/DLC and SE voices, exact reused sources, dynamic-CG indexes/model/prefix distinction, stale/corrupt rejection, source unchanged; retained:',base)
