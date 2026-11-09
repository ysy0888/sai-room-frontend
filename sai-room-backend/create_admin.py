"""One-time local bootstrap. No default administrator or shared password."""
from getpass import getpass
from time import time
from uuid import uuid4
import re
import sqlite3
from database import get_connection, init_db, DB_PATH
from auth import hash_password
from security import normalize_email, initial_operator_code

if __name__=='__main__':
    init_db();initial_operator_code()
    with get_connection() as conn:
        if conn.execute("SELECT 1 FROM users WHERE role='admin' AND status='approved'").fetchone():
            raise SystemExit('기존 관리자 계정을 사용해주세요. 기존 계정과 비밀번호는 유지됩니다.')
    print('SAI 최초 관리자 설정 — 서버에서 한 번만 실행합니다.')
    name=input('이름: ').strip();student_id=input('학번: ').strip();email=normalize_email(input('이메일: '))
    password=getpass('비밀번호 (8–128자): ');confirm=getpass('비밀번호 확인: ')
    if not 1<=len(name)<=40 or not re.fullmatch(r'[A-Za-z0-9-]{4,20}',student_id) or not 8<=len(password)<=128 or password!=confirm:
        raise SystemExit('입력값을 확인해주세요. 계정이 생성되지 않았습니다.')
    with get_connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        if conn.execute("SELECT 1 FROM users WHERE role='admin' AND status='approved'").fetchone(): raise SystemExit('관리자 계정이 이미 생성되었습니다.')
        try:
            conn.execute("INSERT INTO users(id,name,student_id,username,email,password_hash,role,status,created_at) VALUES(?,?,?,?,?,?,'admin','approved',?)",(str(uuid4()),name,student_id,email,email,hash_password(password),int(time())))
        except sqlite3.IntegrityError: raise SystemExit('이미 사용 중인 이메일 또는 학번입니다. 기존 계정을 확인해주세요.')
    print('관리자 계정을 생성했습니다. 앱에 로그인해 회원을 승인할 수 있습니다.')
    print('초기 운영진 코드는 서버의 '+str(DB_PATH)+'.initial-operator-code 파일에서 확인하세요.')
