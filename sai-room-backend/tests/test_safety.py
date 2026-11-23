import time
from uuid import uuid4
import database
from test_api import client, account, signin, write, PASSWORD


def post(c,body='스터디 모집합니다'):
    response=write(c,'/posts',{'kind':'public','category':'스터디','title':'함께 공부해요','body':body})
    assert response.status_code==201,response.text
    return response.json()


def test_rules_filter_and_private_inquiries(client):
    uid,email=account('member');signin(client,email)
    with database.get_connection() as conn: conn.execute('DELETE FROM policy_acceptance WHERE user_id=?',(uid,))
    payload={'kind':'public','category':'자유','title':'제목','body':'내용'}
    assert write(client,'/posts',payload).json()['error']['code']=='COMMUNITY_CONSENT_REQUIRED'
    assert write(client,'/me/community-consent',{'version':'wrong'}).status_code==422
    assert write(client,'/me/community-consent',{'version':'2026-11-23'}).status_code==204
    payload['body']='죽 여 버 린 다'
    assert write(client,'/posts',payload).json()['error']['code']=='CONTENT_NOT_ALLOWED'
    payload.update(kind='inquiry',category='문의')
    # Members must be able to privately report abusive wording to staff.
    assert write(client,'/posts',payload).status_code==201


def test_report_block_boundaries_and_moderation(client):
    author,email=account('member');signin(client,email);p=post(client)
    comment=write(client,f"/posts/{p['id']}/comments",{'body':'설명입니다'}).json()
    other,reader=account('member');signin(client,reader)
    assert client.get('/api/v1/staff/reports').status_code==403
    body={'targetKind':'post','targetId':p['id'],'reason':'스팸','detail':'반복 게시물입니다'}
    r=write(client,'/reports',body);assert r.status_code==201
    assert write(client,'/reports',body).json()==r.json()
    assert write(client,'/staff/reports/'+r.json()['id'],{'action':'remove'},'PATCH').status_code==403
    assert write(client,'/me/blocks',{'targetKind':'post','targetId':p['id']}).status_code==201
    data=client.get('/api/v1/bootstrap').json();assert not data['posts']
    assert write(client,f"/posts/{p['id']}/comments",{'body':'숨겨진 글 쓰기'}).status_code==404
    blocks=client.get('/api/v1/me/blocks').json();assert author not in str(blocks) and email not in str(blocks)
    assert write(client,'/me/blocks/'+blocks[0]['id'],method='DELETE').status_code==204
    assert len(client.get('/api/v1/bootstrap').json()['posts'])==1
    _,staff=account('operator');signin(client,staff)
    reports=client.get('/api/v1/staff/reports').json();assert len(reports)==1 and reader not in str(reports)
    assert write(client,'/staff/reports/'+r.json()['id'],{'action':'remove'},'PATCH').status_code==204
    signin(client,email)
    assert client.get('/api/v1/bootstrap').json()['posts']==[]
    assert write(client,'/posts/'+p['id'],{'kind':'public','category':'자유','title':'재노출','body':'수정'},'PATCH').status_code==404


def test_inquiry_cannot_be_reported_or_blocked_by_other_member(client):
    _,email=account('member');signin(client,email)
    p=write(client,'/posts',{'kind':'inquiry','category':'문의','title':'비공개','body':'내용'}).json()
    _,other=account('member');signin(client,other)
    for path,payload in [('/reports',{'targetKind':'post','targetId':p['id'],'reason':'기타'}),('/me/blocks',{'targetKind':'post','targetId':p['id']})]:
        assert write(client,path,payload).status_code==404


def test_delete_account_revokes_every_credential_and_personal_content(client):
    uid,email=account('member');signin(client,email);post(client)
    with database.get_connection() as conn:
        conn.execute('INSERT INTO beacon_devices VALUES (?,?,?,?,?,0,\'\',0,0)',(uid,'test-device-digest','ios',int(time.time()),int(time.time())+300))
    cookie=client.cookies.get('sai_session')
    assert write(client,'/me/account',{'currentPassword':'wrong'},'DELETE').status_code==422
    assert write(client,'/me/account',{'currentPassword':PASSWORD},'DELETE').status_code==204
    assert client.get('/api/v1/bootstrap').status_code==401
    with database.get_connection() as conn:
        for table,column in [('users','id'),('web_sessions','user_id'),('beacon_devices','user_id'),('posts','author_id'),('comments','author_id'),('policy_acceptance','user_id')]:
            assert not conn.execute(f'SELECT 1 FROM {table} WHERE {column}=?',(uid,)).fetchone()


def test_last_admin_transfer_and_pending_self_deletion(client):
    admin,email=account();target,member=account('member');signin(client,email)
    assert write(client,'/me/account',{'currentPassword':PASSWORD},'DELETE').json()['error']['code']=='LAST_ADMIN_TRANSFER_REQUIRED'
    assert write(client,'/admin/transfer',{'userId':target,'currentPassword':'wrong'}).status_code==422
    assert write(client,'/admin/transfer',{'userId':target,'currentPassword':PASSWORD}).status_code==204
    assert client.get('/api/v1/admin/membership-applications').status_code==403
    assert write(client,'/me/account',{'currentPassword':PASSWORD},'DELETE').status_code==204
    signin(client,member);assert client.get('/api/v1/admin/membership-applications').status_code==200
    _,pending=account('member','pending');signin(client,pending)
    assert write(client,'/me/account',{'currentPassword':PASSWORD},'DELETE').status_code==204


def test_native_stop_revokes_only_the_scoped_device(client,monkeypatch):
    monkeypatch.setenv('SAI_BEACON_ENABLED','true')
    monkeypatch.setenv('SAI_BEACON_UUID','550e8400-e29b-41d4-a716-446655440000')
    monkeypatch.setenv('SAI_BEACON_MAJOR','1');monkeypatch.setenv('SAI_BEACON_MINOR','1')
    uid,email=account('member');signin(client,email)
    token=write(client,'/beacon/devices',{'platform':'ios','consent':True}).json()['deviceToken']
    with database.get_connection() as conn:
        conn.execute('INSERT INTO presence VALUES (?,?,?)',(uid,int(time.time()),int(time.time())+300))
        conn.execute('UPDATE beacon_devices SET owns_presence=1 WHERE user_id=?',(uid,))
    client.cookies.clear()
    assert client.delete('/api/v1/beacon/connection').status_code==401
    assert client.delete('/api/v1/beacon/connection',headers={'Authorization':'Bearer '+token}).status_code==204
    with database.get_connection() as conn:
        assert not conn.execute('SELECT 1 FROM presence WHERE user_id=?',(uid,)).fetchone()
        assert not conn.execute('SELECT 1 FROM beacon_devices WHERE user_id=?',(uid,)).fetchone()
        assert conn.execute('SELECT 1 FROM users WHERE id=?',(uid,)).fetchone()
