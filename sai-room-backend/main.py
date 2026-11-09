
from contextlib import asynccontextmanager
from datetime import date
from uuid import uuid4
from time import time
from secrets import token_urlsafe
from hashlib import sha256
from hmac import compare_digest

from fastapi import FastAPI, HTTPException, Header
from pydantic import BaseModel, Field
from fastapi.middleware.cors import CORSMiddleware

from database import get_connection, init_db
from auth import router as auth_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(
    title="SAI 동아리방 API",
    lifespan=lifespan
)

# 프론트엔드와 백엔드 간 통신 허용
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5500",
        "http://localhost:5500"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(auth_router)

# 예약 생성 시 전달받을 데이터 형식
class ReservationCreate(BaseModel):
    date: date
    start: int
    end: int
    purpose: str = Field(min_length=1)
    name: str = Field(min_length=1)
    people: int = Field(ge=1, le=15)


@app.get("/")
def home():
    return {"message": "SAI 백엔드 서버 실행 성공!"}


# 전체 예약 조회
@app.get("/reservations")
def get_reservations():
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM reservations ORDER BY date, start"
        ).fetchall()

        return {
            "reservations": [dict(row) for row in rows]
        }


# 새로운 예약 생성
@app.post("/reservations", status_code=201)
def create_reservation(data: ReservationCreate):

    # 예약 시간 검사
    if (
        data.start < 540
        or data.end > 1380
        or data.start >= data.end
        or data.start % 30 != 0
        or data.end % 30 != 0
    ):
        raise HTTPException(
            status_code=400,
            detail="예약 시간은 09:00~23:00 사이의 30분 단위여야 합니다."
        )

    reservation_id = str(uuid4())

    with get_connection() as conn:

        # 동일 날짜에 시간이 겹치는 예약 확인
        existing = conn.execute(
            """
            SELECT id FROM reservations
            WHERE date = ?
              AND start < ?
              AND end > ?
            """,
            (str(data.date), data.end, data.start)
        ).fetchone()

        if existing:
            raise HTTPException(
                status_code=409,
                detail="이미 예약된 시간입니다."
            )

        # 예약 정보 저장
        conn.execute(
            """
            INSERT INTO reservations
            (id, date, start, end, purpose, name, people, owner)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                reservation_id,
                str(data.date),
                data.start,
                data.end,
                data.purpose,
                data.name,
                data.people,
                "demo"
            )
        )

        conn.commit()

    return {
        "message": "예약이 완료되었습니다.",
        "id": reservation_id
    }



# 예약 취소 API
@app.delete("/reservations/{reservation_id}")
def delete_reservation(reservation_id: str):

    with get_connection() as conn:

        # 해당 예약이 존재하는지 확인
        reservation = conn.execute(
            "SELECT id FROM reservations WHERE id = ?",
            (reservation_id,)
        ).fetchone()

        if not reservation:
            raise HTTPException(
                status_code=404,
                detail="해당 예약을 찾을 수 없습니다."
            )

        # 예약 삭제
        conn.execute(
            "DELETE FROM reservations WHERE id = ?",
            (reservation_id,)
        )

        conn.commit()

    return {"message": "예약이 취소되었습니다."}

# 예약 수정 API
class ReservationUpdate(BaseModel):
    date: str
    start: int
    end: int
    purpose: str
    name: str
    people: int


@app.put("/reservations/{reservation_id}")
def update_reservation(reservation_id: str, data: ReservationUpdate):

    if data.start >= data.end:
        raise HTTPException(
            status_code=400,
            detail="종료 시간은 시작 시간보다 늦어야 합니다."
        )

    if data.people < 1:
        raise HTTPException(
            status_code=400,
            detail="예약 인원은 1명 이상이어야 합니다."
        )

    with get_connection() as conn:

        # 수정할 예약이 존재하는지 확인
        existing = conn.execute(
            "SELECT id FROM reservations WHERE id = ?",
            (reservation_id,)
        ).fetchone()

        if existing is None:
            raise HTTPException(
                status_code=404,
                detail="예약을 찾을 수 없습니다."
            )

        # 다른 예약과 시간이 겹치는지 확인
        conflict = conn.execute(
            """
            SELECT id FROM reservations
            WHERE date = ?
              AND start < ?
              AND end > ?
              AND id != ?
            """,
            (data.date, data.end, data.start, reservation_id)
        ).fetchone()

        if conflict:
            raise HTTPException(
                status_code=409,
                detail="이미 예약된 시간입니다."
            )

        # 예약 정보 수정
        conn.execute(
            """
            UPDATE reservations
            SET date = ?, start = ?, end = ?,
                purpose = ?, name = ?, people = ?
            WHERE id = ?
            """,
            (
                data.date,
                data.start,
                data.end,
                data.purpose,
                data.name,
                data.people,
                reservation_id
            )
        )

        conn.commit()

    return {"message": "예약이 수정되었습니다."}

# 자유게시판 API (로그인 전 개발용)
class PostInput(BaseModel):
    category: str = Field(min_length=1, max_length=20)
    title: str = Field(min_length=1, max_length=60)
    body: str = Field(min_length=1, max_length=2000)

class CommentInput(BaseModel):
    body: str = Field(min_length=1, max_length=500)

def post_to_dict(conn, row):
    comments = conn.execute(
        "SELECT id, body, created_at FROM comments WHERE post_id = ? ORDER BY created_at, rowid",
        (row["id"],)
    ).fetchall()
    return {
        "id": row["id"], "kind": "public", "category": row["category"],
        "title": row["title"], "body": row["body"],
        "createdAt": row["created_at"], "status": "received",
        "comments": [
            {"id": c["id"], "body": c["body"], "createdAt": c["created_at"]}
            for c in comments
        ]
    }

def require_post_token(row, token):
    if not token or not compare_digest(row["edit_token_hash"], sha256(token.encode()).hexdigest()):
        raise HTTPException(status_code=403, detail="이 글을 수정하거나 삭제할 권한이 없습니다.")

@app.get("/posts")
def get_posts():
    with get_connection() as conn:
        rows = conn.execute("SELECT * FROM posts ORDER BY created_at DESC, rowid DESC").fetchall()
        return {"posts": [post_to_dict(conn, r) for r in rows]}

@app.post("/posts", status_code=201)
def create_post(data: PostInput):
    if data.category not in ("자유", "스터디", "공용물품"):
        raise HTTPException(status_code=400, detail="올바른 게시판 분류를 선택해주세요.")
    token = token_urlsafe(32)
    post_id = str(uuid4())
    now = int(time() * 1000)
    with get_connection() as conn:
        conn.execute("INSERT INTO posts VALUES (?, ?, ?, ?, ?, ?)",
                     (post_id, data.category, data.title.strip(), data.body.strip(), now,
                      sha256(token.encode()).hexdigest()))
        conn.commit()
    return {"id": post_id, "edit_token": token}

@app.put("/posts/{post_id}")
def update_post(post_id: str, data: PostInput, x_post_token: str | None = Header(default=None)):
    if data.category not in ("자유", "스터디", "공용물품"):
        raise HTTPException(status_code=400, detail="올바른 게시판 분류를 선택해주세요.")
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM posts WHERE id = ?", (post_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="글을 찾을 수 없습니다.")
        require_post_token(row, x_post_token)
        conn.execute("UPDATE posts SET category = ?, title = ?, body = ? WHERE id = ?",
                     (data.category, data.title.strip(), data.body.strip(), post_id))
        conn.commit()
    return {"message": "글을 수정했습니다."}

@app.delete("/posts/{post_id}")
def delete_post(post_id: str, x_post_token: str | None = Header(default=None)):
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM posts WHERE id = ?", (post_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="글을 찾을 수 없습니다.")
        require_post_token(row, x_post_token)
        conn.execute("DELETE FROM comments WHERE post_id = ?", (post_id,))
        conn.execute("DELETE FROM posts WHERE id = ?", (post_id,))
        conn.commit()
    return {"message": "글을 삭제했습니다."}

@app.post("/posts/{post_id}/comments", status_code=201)
def create_comment(post_id: str, data: CommentInput):
    comment_id = str(uuid4())
    now = int(time() * 1000)
    with get_connection() as conn:
        if not conn.execute("SELECT 1 FROM posts WHERE id = ?", (post_id,)).fetchone():
            raise HTTPException(status_code=404, detail="글을 찾을 수 없습니다.")
        conn.execute("INSERT INTO comments VALUES (?, ?, ?, ?)",
                     (comment_id, post_id, data.body.strip(), now))
        conn.commit()
    return {"id": comment_id}
