# SAI ROOM 무료 배포

프론트엔드와 FastAPI를 Vercel 서울(icn1) FastAPI 함수 한 개에서 제공하고, 데이터는 Supabase Free 서울(ap-northeast-2) PostgreSQL에 저장한다. 재배포·서버 절전으로 회원·예약·문의·입실 상태가 사라지지 않는다. 유료 인스턴스와 영구 디스크는 생성하지 않는다.

## 제한

Vercel Hobby 무료 사용량 범위에서 운영한다. 오랫동안 요청이 없었던 함수의 첫 응답은 느릴 수 있다. 무료 사용량을 넘으면 서비스가 제한될 수 있다. Supabase 무료 프로젝트도 장기간 비활성 시 일시 중지될 수 있다. 이 구성은 동아리 초기 사용용이며 상시 응답·가용성을 보장하지 않는다. 결제나 유료 플랜 전환은 별도 승인한다.

## PostgreSQL 준비

1. SAI 전용 Free 조직/프로젝트를 생성한다. 다른 프로젝트의 데이터를 재사용하지 않는다.
2. 관리자 연결로 `sai-room-backend/schema.postgres.sql`을 적용한다.
3. 임의의 긴 암호를 가진 `sai_runtime` LOGIN 역할을 생성한다. SUPERUSER, CREATEDB, CREATEROLE, REPLICATION, BYPASSRLS 권한은 주지 않는다.
4. `sai-room-backend/grants.postgres.sql`을 적용한다. 앱 역할에는 `sai_private`의 데이터 읽기·쓰기 권한만 부여한다. 이 스키마는 Data API에 노출하지 않는다.
5. Supabase Connect에서 실제 Transaction pooler 호스트(포트 6543)를 복사한다. 호스트는 지역명으로 추측하지 않는다. 접속 사용자명은 `sai_runtime.<project-ref>`이다.

## Vercel 생성

`vercel.json`은 FastAPI 엔트리 `app.py`와 서울 `icn1` 단일 리전을 지정한다. 저장소 브랜치는 `feature/auth-frontend`이다. Git 연동 권한이 없는 경우에도 검사한 커밋의 공개 앱 파일과 서버 코드를 배포할 수 있다. 로컬 DB, 테스트 데이터, 비밀 파일은 업로드하지 않는다.

- `SAI_DATABASE_URL`: 위 전용 역할의 PostgreSQL 연결 문자열. Vercel 서버 비밀 환경 변수에만 저장한다.
- `SAI_DATABASE_SSL_ROOT_CERT`: 백엔드 디렉터리 기준 CA 인증서 경로. Supabase Database Settings에서 받은 공개 루트 인증서 `certs/supabase-prod-ca-2021.crt`를 사용한다. 비밀 키가 아니며 저장소에 포함한다. 다른 데이터베이스 공급자를 사용하면 해당 공급자의 CA로 교체한다.
- `SAI_ENV=production`: HTTPS 전용 세션과 호스트 검증을 켠다.
- `SAI_PUBLIC_ORIGIN`: 최종 HTTPS 앱 주소. 생략하면 Vercel이 제공하는 프로젝트 운영 주소를 사용한다.
- `SAI_INITIAL_OPERATOR_CODE`: 안전한 난수로 생성하여 서버 비밀 환경 변수로만 제공한다. 최초 DB 초기화에만 사용하며 앱에서 변경한 코드를 덮어쓰지 않는다.

서버는 인증서를 검증하는 TLS로 DB에 연결한다. GitHub Actions 통과 후 운영 배포한다. `/healthz`가 DB 조회까지 성공해야 배포를 완료한다.

## 첫 관리자

최초 관리자는 공개 가입 순서로 자동 부여하지 않는다. 소유자가 실제 앱에서 가입한 뒤, 본인 이메일을 확인하여 해당 한 계정만 관리자·승인 상태로 설정한다. 임의 테스트 계정은 운영 DB에 넣지 않는다. 이후 회원 승인은 앱 내부 관리자 메뉴에서 처리한다. 최초 운영진 가입 코드는 Vercel 서버 비밀 환경 변수에서 소유자가 확인하거나, 관리자가 앱에서 새 코드로 교체한다.

## 점검 및 백업

- 로그인하지 않은 사용자의 보호 API는 401, 일반 회원의 운영진 기능은 403이어야 한다.
- 예약 중복, 문의 비공개, 입퇴실 인원 증분 반영을 확인한다.
- DB 암호·운영진 코드·사용자 DB는 GitHub나 프론트 파일에 포함하지 않는다.
- Supabase Free의 자동 백업을 보장하지 않는다. 운영자는 정기적으로 `pg_dump` 등으로 암호화된 별도 보관소에 백업해야 한다.
- 기존 SQLite 로컬 실행은 계속 지원한다. SQLite 일별 백업 코드는 로컬/유료 영구 디스크 구성에서만 사용한다.

## 검증

GitHub CI는 프론트 빌드·타입·단위 검사, SQLite API, 제한된 앱 역할의 PostgreSQL API·동시 쓰기·스키마 권한, 브라우저 기능 검사를 수행한다. PostgreSQL 테스트 데이터베이스는 localhost의 `sai_test`만 초기화할 수 있도록 제한한다.

공식 문서: https://vercel.com/docs/frameworks/backend/fastapi · https://vercel.com/docs/functions/configuring-functions/region · https://supabase.com/docs/guides/database/connecting-to-postgres
