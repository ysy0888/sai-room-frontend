# SAI ROOM 운영 배포

프론트와 FastAPI를 같은 Render Web Service에 배포합니다. 별도의 프론트 주소나 CORS 예외가 필요하지 않습니다. 회원·예약·글·공 이미지는 `/var/data/sai.db`에 저장하며, 테스트 DB는 업로드하지 않습니다.

## 구성

- 저장소: `ysy0888/sai-room-frontend`, 브랜치 `feature/auth-frontend`
- Blueprint: `render.yaml`
- 리전: Singapore, 서버: Starter, 영구 디스크: 1GB
- 상태 확인: `/healthz` (DB 연결 확인, 회원 데이터 비노출)
- 시작: `python scripts/start_server.py` (`0.0.0.0:$PORT`, worker 1개)
- 업데이트: GitHub 검사를 통과한 커밋을 자동 배포
- 시작 시 가상 회원·글·예약을 생성하지 않음

## 처음 배포

1. Render에서 이 비공개 저장소만 연결하고 Blueprint로 `render.yaml`을 선택합니다. 비용을 확인한 뒤 생성합니다.
2. 배포 완료 후 발급된 HTTPS 주소에서 로그인 화면과 `/healthz` 응답을 확인합니다.
3. Render 서비스의 Shell에서 `python sai-room-backend/create_admin.py`를 실행합니다. 실제 관리자가 이름·학번·이메일·비밀번호를 직접 입력합니다. 비밀번호는 화면에 표시되지 않습니다. 이미 관리자가 있다면 새 관리자를 만들지 않습니다.
4. 같은 Shell에서 초기 운영진 코드 파일 `/var/data/sai.db.initial-operator-code`를 확인합니다. 외부에 공개하지 않고 운영진에게만 전달합니다. 이후 앱 설정에서 코드를 변경할 수 있습니다.
5. 관리자로 로그인해 가입 신청을 승인합니다. 일반 멤버와 운영진 모두 승인 전에는 보호된 화면을 사용할 수 없습니다.
6. 동아리원에게 HTTPS 주소를 공유합니다. 회원가입 → 관리자 승인 → 로그인 순서입니다.

## 환경변수

`SAI_ENV=production`, `SAI_DB_PATH=/var/data/sai.db`, `SAI_BACKUP_DIR=/var/data/backups`는 Blueprint에서 설정합니다. 공개 출처는 Render의 `RENDER_EXTERNAL_URL`을 사용합니다. 사용자 도메인을 연결할 때만 `SAI_PUBLIC_ORIGIN=https://실제-도메인`으로 바꾸고 재배포합니다. 운영 쿠키는 HTTPS에서만 동작합니다.

무료 Web Service의 임시 파일 시스템에 SQLite를 두면 재배포 후 데이터가 사라질 수 있으므로 이 구성은 영구 디스크가 필요합니다. 인스턴스는 1개만 운영합니다. 디스크가 연결된 서비스는 배포 중 짧은 중단이 발생할 수 있습니다.

## 백업과 복구

서버는 시작 시와 매시간 일별 백업 여부를 확인합니다. SQLite 백업 API로 일관된 사본을 만들고 검사한 뒤 `/var/data/backups/sai-YYYY-MM-DD.sqlite3`에 저장합니다. 최근 7개 일별 백업을 보관합니다. 파일은 공개 경로 밖에 있으며 소유자만 읽을 수 있습니다. 첫 실행에서 DB가 없으면 다음 정기 작업부터 백업됩니다.

서버 전체 또는 디스크 손실에 대비하려면 운영자가 이 백업을 주기적으로 별도 보관소에 내려받아야 합니다. 같은 디스크의 일별 백업만으로 디스크 전체 손실을 복구할 수는 없습니다.

복구 시 서비스를 중단하고 현재 DB를 별도로 보관한 뒤 확인한 백업을 `SAI_DB_PATH`로 복사합니다. 운영 DB를 실행 중인 상태에서 덮어쓰지 않습니다. 복구 후 로그인·예약·문의함을 확인합니다.

## 운영 범위

- 인원은 직접 입퇴실 기록으로 집계하며 30초마다 갱신합니다. 입실은 4시간 뒤 만료됩니다.
- 이메일 인증, 비밀번호 재설정, 비콘 자동 감지는 현재 포함하지 않습니다.
- 휴대폰 흔들림은 HTTPS와 사용자의 센서 권한이 필요하며 기기별 실물 확인이 필요합니다.
- 계정·세션·비밀 코드·DB·백업 파일을 GitHub에 올리지 않습니다.

공식 참고: [Render 디스크](https://render.com/docs/disks), [FastAPI 배포](https://render.com/docs/deploy-fastapi), [요금](https://render.com/pricing).
