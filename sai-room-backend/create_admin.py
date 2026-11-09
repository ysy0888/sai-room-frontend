"""Run locally once: python create_admin.py"""
from getpass import getpass
from uuid import uuid4
from time import time
import sqlite3
from database import get_connection, init_db
from auth import hash_password

if __name__ == '__main__':
    init_db()
    print('SAI ROOM 최초 운영진 계정 생성 (로컬에서만 실행)')
    name = input('운영진 이름: ').strip()
    student_id = input('학번: ').strip()
    username = input('로그인 아이디 (영문/숫자/밑줄, 4자 이상): ').strip().lower()
    password = getpass('비밀번호 (8자 이상): ')
    confirm = getpass('비밀번호 다시 입력: ')
    if not name or not student_id or len(username) < 4 or not username.replace('_', '').isalnum() or len(password) < 8 or password != confirm:
        raise SystemExit('입력값을 확인해주세요. 계정이 생성되지 않았습니다.')
    with get_connection() as conn:
        if conn.execute("SELECT 1 FROM users WHERE role='admin'").fetchone():
            raise SystemExit('운영진 계정이 이미 존재합니다. 추가 운영진은 별도 관리 기능으로 생성하세요.')
        try:
            conn.execute("INSERT INTO users (id,name,student_id,username,password_hash,role,status,created_at) VALUES (?,?,?,?,?,'admin','approved',?)",
                         (str(uuid4()), name, student_id, username, hash_password(password), int(time())))
            conn.commit()
        except sqlite3.IntegrityError:
            raise SystemExit('이미 사용 중인 아이디 또는 학번입니다.')
    print('운영진 계정이 생성되었습니다. 로그인할 수 있습니다.')
