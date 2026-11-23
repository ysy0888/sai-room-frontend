"""Serve the SAI frontend and authenticated API from one origin."""
from contextlib import asynccontextmanager
import asyncio
from contextlib import suppress
import os
from pathlib import Path
from urllib.parse import urlsplit
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware
from database import get_connection, init_db, postgres_enabled
from security import PRODUCTION, PUBLIC_ORIGIN, TRUSTED_ORIGINS, current_user, initial_operator_code
from api_v1 import router
from beacon import router as beacon_router
from maintenance import daily_backup

ROOT=Path(__file__).resolve().parent.parent

@asynccontextmanager
async def lifespan(app):
    if os.environ.get('VERCEL') == '1' and not postgres_enabled():
        raise RuntimeError('Vercel requires SAI_DATABASE_URL; local SQLite is not persistent')
    if PRODUCTION and not postgres_enabled() and not os.environ.get('SAI_DB_PATH'):
        raise RuntimeError('Production requires SAI_DATABASE_URL or SAI_DB_PATH on persistent storage')
    backups = not postgres_enabled() and bool(os.environ.get('SAI_BACKUP_DIR'))
    if backups:
        await asyncio.to_thread(daily_backup)
    init_db()
    initial_operator_code()
    async def maintain():
        while True:
            await asyncio.sleep(3600)
            try:
                await asyncio.to_thread(daily_backup)
            except Exception:
                import logging
                logging.getLogger('sai.backup').exception('Daily database backup failed')
    task = asyncio.create_task(maintain()) if backups else None
    try:
        yield
    finally:
        if task:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task
        if postgres_enabled():
            from postgres import close_pool
            close_pool()

app=FastAPI(title='SAI ROOM',lifespan=lifespan,docs_url=None if PRODUCTION else '/api/docs',redoc_url=None,openapi_url=None if PRODUCTION else '/api/openapi.json')
# Production trusts only deployment domains (TRUSTED_ORIGINS). Development also accepts the host in
# SAI_PUBLIC_ORIGIN, e.g. a PC's LAN address for testing on a real phone.
allowed_hosts=[urlsplit(origin).hostname for origin in TRUSTED_ORIGINS] if PRODUCTION else sorted({'localhost','127.0.0.1','testserver',urlsplit(PUBLIC_ORIGIN).hostname})
app.add_middleware(TrustedHostMiddleware,allowed_hosts=allowed_hosts)

@app.middleware('http')
async def headers_and_size(request,call_next):
    if request.method in ('POST','PUT','PATCH'):
        parts=[];size=0
        async for chunk in request.stream():
            size+=len(chunk)
            if size>2_000_000:
                return JSONResponse({'error':{'code':'BODY_TOO_LARGE'}},status_code=413)
            parts.append(chunk)
        request._body=b''.join(parts)
    response=await call_next(request)
    response.headers['Cache-Control']='no-store'
    response.headers['X-Content-Type-Options']='nosniff'
    response.headers['Referrer-Policy']='same-origin'
    response.headers['X-Frame-Options']='DENY'
    response.headers['Content-Security-Policy']="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
    if PRODUCTION: response.headers['Strict-Transport-Security']='max-age=31536000'
    return response

@app.exception_handler(HTTPException)
async def http_error(request,error):
    detail=error.detail if isinstance(error.detail,dict) else {'code':'REQUEST_FAILED'}
    return JSONResponse({'error':detail},status_code=error.status_code)

@app.exception_handler(RequestValidationError)
async def validation_error(request,error):
    # Never echo request bodies containing passwords or invitation codes.
    return JSONResponse({'error':{'code':'INVALID_INPUT'}},status_code=422)

app.include_router(router)
app.include_router(beacon_router)

@app.get('/healthz')
def health():
    try:
        with get_connection() as conn:
            conn.execute('SELECT sequence FROM room_state WHERE id=1').fetchone()
    except Exception:
        return JSONResponse({'status':'unavailable'}, status_code=503)
    result = {'status':'ok'}
    if os.environ.get('VERCEL_REGION'):
        result['region'] = os.environ['VERCEL_REGION']
    return result

@app.get('/media/balls/{image_id}.png')
def ball_image(image_id:str,request:Request):
    user=current_user(request)
    with get_connection() as conn:
        row=conn.execute("SELECT * FROM ball_images WHERE id=? AND (owner_id=? OR id IN (SELECT ball_image_id FROM users WHERE status='approved'))",(image_id,user['id'])).fetchone()
    if not row: raise HTTPException(404,{'code':'NOT_FOUND'})
    return Response(row['png'],media_type='image/png')

@app.get('/')
@app.get('/index.html')
def home(): return FileResponse(ROOT/'index.html',media_type='text/html')

# Whitelist public directories. Database, server code and initial code are never served.
for directory in ('assets','css','js'):
    app.mount('/'+directory,StaticFiles(directory=ROOT/directory),name=directory)
