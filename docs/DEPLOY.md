# SAI ROOM 무료 배포

프론트엔드와 FastAPI를 Render Free 웹 서비스 한 개에서 제공하고, 데이터는 Supabase Free PostgreSQL에 저장한다. 재배포·서버 절전으로 회원·예약·문의·입실 상태가 사라지지 않는다. 유료 인스턴스와 영구 디스크는 생성하지 않는다.

## 제한

Render 무료 서버는 약 15분간 접속이 없으면 잠들며, 다음 접속 시 기동에 약 1분이 걸릴 수 있다. 무료 사용량을 넘으면 서비스가 제한될 수 있다. Supabase 무료 프로젝트도 장기간 비활성 시 일시 중지될 수 있다. 이 구성은 동아리 초기 사용용이며 상시 응답·가용성을 보장하지 않는다. 결제나 유료 플랜 전환은 별도 승인한다.

## PostgreSQL 준비

1. SAI 전용 Free 조직/프로젝트를 생성한다. 다른 프로젝트의 데이터를 재사용하지 않는다.
2. 관리자 연결로 `sai-room-backend/schema.postgres.sql`을 적용한다.
3. 임의의 긴 암호를 가진 `sai_runtime` LOGIN 역할을 생성한다. SUPERUSER, CREATEDB, CREATEROLE, REPLICATION, BYPASSRLS 권한은 주지 않는다.
4. `sai-room-backend/grants.postgres.sql`을 적용한다. 앱 역할에는 `sai_private`의 데이터 읽기·쓰기 권한만 부여한다. 이 스키마는 Data API에 노출하지 않는다.
5. Supabase Connect에서 실제 Session pooler 호스트를 복사한다. 호스트는 지역명으로 추측하지 않는다. 접속 사용자명은 `sai_runtime.<project-ref>`이다.

## Render 생성

`render.yaml` Blueprint를 적용한다. 브랜치는 `feature/auth-frontend`, 요금은 Free, 디스크는 없음이다.

- `SAI_DATABASE_URL`: 위 전용 역할의 PostgreSQL 연결 문자열. Render 비밀 환경 변수에만 저장한다.
- `SAI_ENV=production`: HTTPS 전용 세션과 호스트 검증을 켠다.
- `RENDER_EXTERNAL_URL`: Render가 자동으로 주는 앱 주소를 사용한다.
- `SAI_INITIAL_OPERATOR_CODE`: Render가 자동 생성한다. 최초 DB 초기화에만 사용하며 앱에서 변경한 코드를 덮어쓰지 않는다.

서버는 인증서를 검증하는 TLS로 DB에 연결한다. GitHub Actions가 통과해야 자동 배포된다. `/healthz`가 DB 조회까지 성공해야 배포를 완료한다.

## 첫 관리자

최초 관리자는 공개 가입 순서로 자동 부여하지 않는다. 소유자가 실제 앱에서 가입한 뒤, 본인 이메일을 확인하여 해당 한 계정만 관리자·승인 상태로 설정한다. 임의 테스트 계정은 운영 DB에 넣지 않는다. 이후 회원 승인은 앱 내부 관리자 메뉴에서 처리한다. 최초 운영진 가입 코드는 Render 비밀 환경 변수에서 소유자가 확인하거나, 관리자가 앱에서 새 코드로 교체한다.

## 점검 및 백업

- 로그인하지 않은 사용자의 보호 API는 401, 일반 회원의 운영진 기능은 403이어야 한다.
- 예약 중복, 문의 비공개, 입퇴실 인원 증분 반영을 확인한다.
- DB 암호·운영진 코드·사용자 DB는 GitHub나 프론트 파일에 포함하지 않는다.
- Supabase Free의 자동 백업을 보장하지 않는다. 운영자는 정기적으로 `pg_dump` 등으로 암호화된 별도 보관소에 백업해야 한다.
- 기존 SQLite 로컬 실행은 계속 지원한다. SQLite 일별 백업 코드는 로컬/유료 영구 디스크 구성에서만 사용한다.

## 검증

GitHub CI는 프론트 빌드·타입·단위 검사, SQLite API, PostgreSQL API와 동시 쓰기, 브라우저 기능 검사를 수행한다. PostgreSQL 테스트 데이터베이스는 localhost의 `sai_test`만 초기화할 수 있도록 제한한다.

공식 문서: https://render.com/docs/free · https://supabase.com/docs/guides/database/connecting-to-postgres
