#!/usr/bin/env bash
# Gal 采集启动器 2.0：默认常驻，每180秒检查远端脚本；仅成功采集并上传后推进本地offset。
# 用法：bash gal-collect.sh /游戏库目录（或GAL_ROOT）；同目录保留gh/github_pat。
# GAL_COLLECT_CACHE_DIR          默认 <启动脚本目录>/cache/gal-collect；offset/日志/失败分卷均持久保存
# GAL_COLLECT_POLL_SECONDS       默认180，每轮完成后的间隔（秒）
# GAL_COLLECT_FETCH_TIMEOUT      默认120，获取/校验脚本超时（秒）
# GAL_COLLECT_RUN_TIMEOUT        默认3600，单次采集含上传/重传的总超时（秒）
# GAL_COLLECT_UPLOAD_TIMEOUT     默认600，单次上传超时（秒）
# GAL_COLLECT_STOP_GRACE_SECONDS 默认15，TERM后等待KILL的时间（秒）
# GAL_COLLECT_ONCE=1             只检查/执行一轮；仍读取和更新offset
# GAL_COLLECT_FORCE=1            强制再执行一次已完成版本；成功后恢复正常检查
# GH_TOKEN_FILE                 默认 <启动脚本目录>/github_pat，每轮重新读取，不写入offset或日志
# GAL_COLLECT_SRC_REPO/REF/PATH  默认 lgithubl/copymanga-downloader / vibe-test-20261008 / scripts/dev/gal-collect-run.sh
# GAL_COLLECT_SHA256             可选固定内容SHA256；不匹配不执行
# 其余GAL_COLLECT_*参数照旧传入；改变有效采集参数使用独立offset。Ctrl+C停止并终止子进程。
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PY="$(command -v python3 || true)"
[ -n "$PY" ] || { echo '需要现有python3；不会自动下载运行时' >&2; exit 1; }
exec "$PY" - "$DIR" "$@" <<'PY_BOOTSTRAP'
import datetime, fcntl, gzip, hashlib, json, math, os, pathlib, re, signal, subprocess, sys, threading, time, uuid

class Stopped(Exception): pass
class Failure(Exception): pass
stop = threading.Event()
for sig in (signal.SIGINT, signal.SIGTERM):
    signal.signal(sig, lambda _sig, _frame: stop.set())
dir = pathlib.Path(sys.argv[1]).resolve()
args = sys.argv[2:]
root_arg = args[0] if args else os.environ.get('GAL_ROOT', '')
if not root_arg:
    print('用法：bash gal-collect.sh /游戏库目录，或设置GAL_ROOT', file=sys.stderr); sys.exit(2)
root = os.path.realpath(root_arg)
args = [root] + args[1:]

def seconds(name, default):
    try: value = float(os.environ.get(name, default))
    except ValueError: raise Failure(name + '需要正数秒数')
    if not math.isfinite(value) or value <= 0: raise Failure(name + '需要正数秒数')
    return value
try:
    poll_seconds = seconds('GAL_COLLECT_POLL_SECONDS', 180)
    fetch_timeout = seconds('GAL_COLLECT_FETCH_TIMEOUT', 120)
    run_timeout = seconds('GAL_COLLECT_RUN_TIMEOUT', 3600)
    upload_timeout = seconds('GAL_COLLECT_UPLOAD_TIMEOUT', 600)
    grace_seconds = seconds('GAL_COLLECT_STOP_GRACE_SECONDS', 15)
except Failure as error:
    print(str(error), file=sys.stderr); sys.exit(2)
once = os.environ.get('GAL_COLLECT_ONCE') == '1'
force = os.environ.get('GAL_COLLECT_FORCE') == '1'
cache = pathlib.Path(os.environ.get('GAL_COLLECT_CACHE_DIR', str(dir/'cache/gal-collect'))).expanduser().resolve()
cache.mkdir(parents=True, exist_ok=True)
source = {'repo': os.environ.get('GAL_COLLECT_SRC_REPO', 'lgithubl/copymanga-downloader'),
          'ref': os.environ.get('GAL_COLLECT_SRC_REF', 'vibe-test-20261008'),
          'path': os.environ.get('GAL_COLLECT_SRC_PATH', 'scripts/dev/gal-collect-run.sh')}
operational = {'GAL_COLLECT_CACHE_DIR','GAL_COLLECT_POLL_SECONDS','GAL_COLLECT_FETCH_TIMEOUT','GAL_COLLECT_RUN_TIMEOUT',
               'GAL_COLLECT_UPLOAD_TIMEOUT','GAL_COLLECT_STOP_GRACE_SECONDS','GAL_COLLECT_ONCE','GAL_COLLECT_FORCE','GAL_COLLECT_OUT',
               'GAL_COLLECT_TS','GAL_COLLECT_ARCHIVE_DIR','GAL_COLLECT_GH','GAL_COLLECT_VERSION'}
config = {k:v for k,v in os.environ.items() if (k.startswith('GAL_COLLECT_') or k.startswith('GAL_') and k != 'GAL_ROOT') and k not in operational}
# Keep secrets/parameter values out of the persisted state; only their digest is stored.
config_digest = hashlib.sha256(json.dumps({'env':config,'args':args[1:]}, sort_keys=True).encode()).hexdigest()
identity = dict(source=source, root=root, config_sha256=config_digest)
key = hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()[:24]
lock_key = hashlib.sha256(json.dumps(dict(source=source,root=root),sort_keys=True).encode()).hexdigest()[:24]
control = cache/'tasks'/key
control.mkdir(parents=True, exist_ok=True)
lock_file = open(cache/('task-'+lock_key+'.lock'), 'a+')
try: fcntl.flock(lock_file, fcntl.LOCK_EX | fcntl.LOCK_NB)
except BlockingIOError:
    print('同一来源/游戏根目录的采集循环已运行；锁文件：'+str(lock_file.name), file=sys.stderr); sys.exit(3)

def stamp(): return datetime.datetime.now().strftime('%Y%m%d-%H%M%S')+'-'+uuid.uuid4().hex[:8]
def utc(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
def atomic_json(path, value):
    temporary = path.with_name(path.name+'.'+uuid.uuid4().hex+'.part')
    with open(temporary,'w',encoding='utf-8') as f:
        json.dump(value,f,ensure_ascii=False,indent=2); f.flush(); os.fsync(f.fileno())
    os.replace(temporary,path)
def load_json(path):
    if not path.exists(): return {}
    value = json.loads(path.read_text())
    if not isinstance(value,dict): raise Failure('本地状态不是JSON对象：'+str(path))
    return value

log_dir = cache/'logs'; log_dir.mkdir(exist_ok=True)
main_log = log_dir/('bootstrap-'+stamp()+'.log')
secrets = set()
log_lock = threading.Lock()
attempt_log = None

def log(message):
    line = str(message).rstrip('\r\n')
    for secret in secrets:
        if secret: line = line.replace(secret,'***')
    line = '['+datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')+'] '+line+'\n'
    with log_lock:
        for target in (main_log,attempt_log):
            if target:
                try:
                    with open(target,'a',encoding='utf-8') as f: f.write(line)
                except OSError:
                    print('日志暂时无法写入：'+str(target),file=sys.stderr,flush=True)
        try: print(line,end='',flush=True)
        except BrokenPipeError: pass

def kill_group(proc):
    try: os.killpg(proc.pid,signal.SIGTERM)
    except ProcessLookupError: return
    deadline = time.monotonic()+grace_seconds
    while time.monotonic()<deadline:
        proc.poll()
        try: os.killpg(proc.pid,0)
        except ProcessLookupError: return
        time.sleep(.05)
    try: os.killpg(proc.pid,signal.SIGKILL)
    except ProcessLookupError: pass

def run(command, timeout, env, output=None):
    if stop.is_set(): raise Stopped()
    proc = subprocess.Popen(command, env=env, start_new_session=True,
                            stdout=output if output is not None else subprocess.PIPE,
                            stderr=subprocess.PIPE if output is not None else subprocess.STDOUT)
    stream = proc.stderr if output is not None else proc.stdout
    def drain():
        for line in iter(stream.readline,b''):
            log(line.decode('utf-8','replace'))
    reader = threading.Thread(target=drain,daemon=True); reader.start()
    deadline = time.monotonic()+timeout
    try:
        while proc.poll() is None or reader.is_alive():
            if stop.is_set(): raise Stopped()
            if time.monotonic()>=deadline:
                log('命令超时（上限%s秒），终止整组子进程'%timeout)
                kill_group(proc); proc.wait(); reader.join(timeout=1); return 124
            time.sleep(.05)
        return proc.returncode
    finally:
        # Also reap descendants when the leader exits early; a timed-out upload must not outlive its task.
        kill_group(proc)
        proc.wait()
        reader.join(timeout=1)
        stream.close()

gh = dir/'gh'
token_file = pathlib.Path(os.environ.get('GH_TOKEN_FILE',str(dir/'github_pat')))
tag = os.environ.get('GAL_COLLECT_TAG','31')
repo = os.environ.get('GAL_COLLECT_REPO','lgithubl/private-scripts')
offset_file = control/'offset.json'
pending_file = control/'pending.json'
last_file = control/'last-attempt.json'

# An existing CLI archive is sufficient; no tool or runtime is fetched here.
if not os.access(gh,os.X_OK) and (dir/'gh-linux-amd64.tar.gz').is_file():
    try:
        import tarfile
        with tarfile.open(dir/'gh-linux-amd64.tar.gz') as archive:
            member=archive.getmember('gh')
            if not member.isfile() or member.size>128*1024*1024: raise Failure('gh归档条目无效')
            with archive.extractfile(member) as src, open(gh,'wb') as dst:
                import shutil
                shutil.copyfileobj(src,dst)
        gh.chmod(0o755)
    except Exception as error: log('解开本地gh归档失败：'+str(error))

def environment():
    token = ''.join(token_file.read_text().split())
    if not token: raise Failure('令牌文件为空：'+str(token_file))
    secrets.add(token)
    if not os.access(gh,os.X_OK): raise Failure('缺少可执行gh：'+str(gh))
    env = dict(os.environ, GH_TOKEN=token, GH_PROMPT_DISABLED='1', GH_NO_UPDATE_NOTIFIER='1', GH_NO_EXTENSION_AUTO_INSTALL='1')
    return env

def complete(version, digest, run_dir, resumed=False):
    global force
    atomic_json(offset_file,dict(**identity,version=version,sha256=digest,completed_at=utc(),run_dir=str(run_dir),resumed_uploads=resumed))
    atomic_json(pending_file,{})
    force=False
    log('成功：本地offset已更新至v%s；%s'%(version,offset_file))

def resume_uploads(pending, env):
    paths = pending.get('files',[])
    run_dir = pathlib.Path(pending['run_dir']).resolve()
    if not run_dir.is_relative_to(control/'runs'): raise Failure('重传目录不在本地任务cache内')
    deadline = time.monotonic()+run_timeout
    log('仅重传%d个失败文件，不重新扫描；目录：%s'%(len(paths),run_dir))
    for filename in list(paths):
        file = pathlib.Path(filename).resolve()
        if not file.is_relative_to(run_dir) or not file.is_file():
            atomic_json(pending_file,{})
            raise Failure('失败分卷已不在原cache位置，下轮重新采集：'+str(file))
        remaining = deadline-time.monotonic()
        if remaining<=0: raise Failure('重传总时间超限；保留待上传记录')
        rc=run([str(gh),'release','upload',tag,str(file),'--repo',repo,'--clobber'],min(upload_timeout,remaining),env)
        if rc: raise Failure('分卷重传失败，退出码'+str(rc)+'：'+file.name)
        pending['files'].remove(filename); atomic_json(pending_file,pending)
        log('分卷重传成功：'+file.name)
    complete(pending['version'],pending['sha256'],run_dir,resumed=True)

log('gal-collect启动器v2.0；默认轮询%s秒；cache=%s'%(poll_seconds,cache))
log('offset=%s；日志=%s'%(offset_file,main_log))
exit_code = 0
while not stop.is_set():
    env = None; attempt_log = None; run_dir = None; started = time.monotonic()
    try:
        env = environment()
        if not os.path.isdir(root): raise Failure('游戏库目录不存在：'+root)
        candidate = control/'fetch.part'
        log('检查远端脚本：%(repo)s@%(ref)s:%(path)s'%source)
        with open(candidate,'wb') as f:
            rc=run([str(gh),'api','-H','Accept: application/vnd.github.raw','repos/%s/contents/%s?ref=%s'%(source['repo'],source['path'],source['ref'])],fetch_timeout,env,output=f)
        if rc: raise Failure('获取脚本失败，退出码'+str(rc))
        if not 0<candidate.stat().st_size<=8*1024*1024: raise Failure('下载脚本为空或超过8MiB')
        body = candidate.read_bytes()
        if not re.match(br'^#![^\r\n]*\bbash\b',body): raise Failure('下载内容不是bash脚本')
        versions=re.findall(br'^VERSION="([0-9]+(?:\.[0-9]+)*)"\s*$',body,re.M)
        if len(versions)!=1: raise Failure('脚本必须有且仅有一个有效VERSION')
        version=versions[0].decode('ascii'); digest=hashlib.sha256(body).hexdigest()
        pinned=os.environ.get('GAL_COLLECT_SHA256')
        if pinned and pinned!=digest: raise Failure('脚本SHA256与固定配置不符，不执行')
        if run(['bash','-n',str(candidate)],fetch_timeout,env): raise Failure('下载脚本bash语法校验失败')
        cached_script=control/'last-fetch.sh'; os.replace(candidate,cached_script)
        previous=load_json(offset_file)
        if previous.get('sha256')==digest and not force:
            log('无更新：v%s，已成功完成；本轮跳过'%version)
        else:
            pending=load_json(pending_file)
            if pending.get('sha256')==digest:
                run_dir=pathlib.Path(pending['run_dir']).resolve()
                if not run_dir.is_relative_to(control/'runs'): raise Failure('重传目录不在本地任务cache内')
                attempt_log=run_dir/'bootstrap.log'
                resume_uploads(pending,env)
            else:
                run_dir=control/'runs'/stamp(); run_dir.mkdir(parents=True)
                attempt_log=run_dir/'bootstrap.log'
                script=run_dir/'run.sh'; script.write_bytes(body)
                if previous.get('version')==version: log('VERSION相同但内容SHA改变，执行更新后的脚本')
                log('执行v%s，SHA256=%s；单轮超时%s秒；日志=%s'%(version,digest,run_timeout,attempt_log))
                run_env=dict(env,GAL_COLLECT_TS=run_dir.name,GAL_COLLECT_TAG=tag,GAL_COLLECT_REPO=repo,
                             GAL_COLLECT_GH=str(gh),GAL_COLLECT_OUT=str(run_dir/'output'),
                             GAL_COLLECT_CACHE_DIR=str(cache),
                             GAL_COLLECT_ARCHIVE_DIR=str(run_dir/'archive'),GAL_COLLECT_UPLOAD_TIMEOUT=str(upload_timeout),
                             GAL_COLLECT_STOP_GRACE_SECONDS=str(grace_seconds))
                rc=run(['bash',str(script),*args],run_timeout,run_env)
                if rc==0: complete(version,digest,run_dir)
                else:
                    if rc==2:
                        failed=run_dir/'output/.failed'
                        paths=[line[5:] for line in failed.read_text().splitlines() if line.startswith('FAIL ')] if failed.is_file() else []
                        if paths: atomic_json(pending_file,dict(version=version,sha256=digest,run_dir=str(run_dir),files=list(dict.fromkeys(paths))))
                    raise Failure('采集%s（退出码%d），offset未更新；保留：%s'%('超时' if rc==124 else '失败',rc,run_dir))
        atomic_json(last_file,dict(status='ok',checked_at=utc(),version=version,sha256=digest,elapsed_seconds=round(time.monotonic()-started,3)))
        exit_code=0
    except Stopped:
        log('收到停止信号，子进程已终止；offset保留'); exit_code=130; break
    except Exception as error:
        exit_code=1; log('本轮失败：'+str(error)+'；继续下一轮')
        message=str(error)
        for secret in secrets: message=message.replace(secret,'***')
        try: atomic_json(last_file,dict(status='failed',checked_at=utc(),error=message,elapsed_seconds=round(time.monotonic()-started,3)))
        except OSError as state_error: log('本轮状态暂时无法写入：'+str(state_error))
        if env and os.environ.get('GAL_COLLECT_DRYRUN')!='1':
            try:
                errors=control/'errors'; errors.mkdir(exist_ok=True)
                error_file=errors/('gal-collect-bootstrap-'+stamp()+'-ERROR.log.gz')
                with gzip.open(error_file,'wb') as f: f.write((attempt_log or main_log).read_bytes())
                rc=run([str(gh),'release','upload',tag,str(error_file),'--repo',repo,'--clobber'],min(upload_timeout,60),env)
                log('错误日志%s：%s'%('已上传' if rc==0 else '上传失败，保留本地',error_file))
            except Stopped:
                exit_code=130; break
            except Exception as upload_error: log('错误日志保留本地：'+str(upload_error))
    finally:
        attempt_log=None
    if once: break
    log('休息%s秒后再次检查'%poll_seconds)
    stop.wait(poll_seconds)
if stop.is_set(): exit_code=130
log('采集循环已停止；offset与所有日志保留在'+str(control))
sys.exit(exit_code)
PY_BOOTSTRAP
