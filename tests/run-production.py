"""Launch an isolated real SQLite/API instance for browser tests; never modifies the app DB."""
import os
import sys
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path
root=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root/'sai-room-backend'))
with tempfile.TemporaryDirectory(prefix='sai-integration-') as tmp:
    os.environ['SAI_DB_PATH']=str(Path(tmp)/'test.db')
    os.environ['SAI_INITIAL_OPERATOR_CODE']='Test-Browser-Initial-83942'
    os.environ['SAI_PUBLIC_ORIGIN']='http://127.0.0.1:5320'
    os.environ.pop('SAI_ENV',None)
    import database
    from auth import hash_password
    database.init_db()
    with database.get_connection() as conn:
        for id,name,email,role in [('admin','관리자','admin@example.test','admin'),('operator','운영진','operator@example.test','operator'),('member','회원','member@example.test','member')]:
            conn.execute('INSERT INTO users (id,name,student_id,username,email,password_hash,role,status,created_at) VALUES (?,?,?,?,?,?,?,\'approved\',?)',(id,name,'test-'+id,email,email,hash_password('Browser-test-1234'),role,int(time.time())))
    log=open(Path(tmp)/'server.log','w+')
    proc=subprocess.Popen([sys.executable,'-m','uvicorn','main:app','--app-dir',str(root/'sai-room-backend'),'--host','127.0.0.1','--port','5320'],env=os.environ,stdout=log,stderr=log)
    try:
        for _ in range(60):
            try:
                urllib.request.urlopen('http://127.0.0.1:5320',timeout=1);break
            except Exception: time.sleep(.1)
        result=subprocess.run(['node',str(root/'tests/production-browser.cjs')],cwd=root,env={**os.environ,'TEST_URL':'http://127.0.0.1:5320'})
        if result.returncode:
            log.seek(0);print(log.read()[-12000:]);sys.exit(result.returncode)
    finally:
        proc.terminate();proc.wait(timeout=10);log.close()
