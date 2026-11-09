import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const python=process.env.SAI_PYTHON||resolve(root,process.platform==='win32'?'.venv/Scripts/python.exe':'.venv/bin/python');
if(!existsSync(python)){
  console.error('먼저 Python 가상환경과 서버 패키지를 설치해주세요. README.md의 실행 방법을 확인하세요.');process.exit(1);
}
const server=spawn(python,['-m','uvicorn','main:app','--app-dir',resolve(root,'sai-room-backend'),'--host','127.0.0.1','--port',process.env.PORT||'5317'],{cwd:root,stdio:'inherit',env:process.env});
server.on('error',error=>{console.error(error.message);process.exitCode=1;});
server.on('exit',code=>{process.exitCode=code||0;});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.kill(signal));
