# 실제 서버 API — v11

기본 경로 `/api/v1`, 세션 쿠키 포함, `Cache-Control: no-store`. 프론트와 API는 같은 출처에서 제공합니다. 모든 변경 요청에 `X-CSRF-Token`, 인증·코드 변경을 제외한 저장 요청에 `Idempotency-Key`를 사용합니다. JSON 오류: `{"error":{"code":"..."}}`.

| 메서드·경로 | 입력 → 결과 |
| --- | --- |
| GET `/auth/csrf` | `{csrfToken}` + 사전 쿠키 |
| POST `/auth/signup` | `{displayName,studentId,email,password,operatorCode?}` → 204, pending 신청 |
| POST `/auth/login` | `{email,password}` → 204 + 새 쿠키. email 필드에 기존 아이디도 허용 |
| POST `/auth/logout` | 204, 서버 세션 제거 |
| GET `/bootstrap?roomId=sai-room` | `{user,csrfToken,bookings,posts,preferences,ball,checkedIn}` |
| GET `/admin/membership-applications` | 관리자만. `[{id,displayName,email,studentId,role,membershipStatus,createdAt}]` |
| PATCH `/admin/membership-applications/{id}` | 관리자만. `{membershipStatus:"approved"|"rejected"}` → 204 |
| GET `/staff/operator-code` | 승인된 운영진·관리자만. `{configured:true,version,updatedAt,updatedBy}`. 코드 원문 없음 |
| PUT `/staff/operator-code` | `{newCode,currentPassword,version}` → 새 메타데이터 |
| POST `/bookings` | `{roomId?,date,start,end,purpose,name,people}` → 예약, 201 |
| PATCH `/bookings/{id}` | 본인 예약만. 위 입력 → 예약 |
| DELETE `/bookings/{id}` | 본인 예약만. 204 |
| POST `/posts` | `{roomId?,kind,category,title,body}` → 글, 201 |
| PATCH `/posts/{id}` | 본인 글만. 위 입력 → 글. kind 변경 금지 |
| DELETE `/posts/{id}` | 본인 글만. 204 |
| POST `/posts/{id}/comments` | `{body}` → 댓글, 201. 비공개 문의는 작성자만 추가 메시지 |
| POST `/posts/{id}/reply` | 승인된 운영진·관리자만. `{body}` → 답변, 201 |
| PATCH `/me/preferences` | `{theme,gauge}` → 저장된 설정 |
| POST `/me/ball-image` | `{imageData:"data:image/png;base64,..."}` → `{imageId,imageUrl}`, 201 |
| PATCH `/me/ball` | `{anonymous,color,imageId}` → BallStyle |
| POST/DELETE `/me/presence` | 본인 입실/퇴실 → `{checkedIn}` |
| GET `/rooms/sai-room/beacon-config` | 승인 회원. `{enabled,configured,uuid,major,minor,enterRssi,exitRssi,reportIntervalSeconds,exitGraceSeconds,referenceCapacity,version,updatedAt,usingTestDefaults,simulatorAllowed}` |
| PUT `/rooms/sai-room/beacon-config` | 운영진·관리자만. 위 값 + `version` → 새 설정. 버전 불일치 409 |
| POST `/me/beacon-presence` | 승인 회원 본인. `{state:"inside"|"outside",rssi?,uuid?,major?,minor?,deviceId?,source?:"native"|"simulator"}` → `{accepted,present,observedAt}` |
| GET `/rooms/sai-room/occupancy` | `{count,referenceCapacity,sequence,observedAt,checkedIn,lastDetectionAt,beacon:{enabled,configured}}` |
| GET `/rooms/sai-room/occupants` | 위 값 + `{hiddenCount:0,members:[{id,displayName,isSelf,ball}]}` |

`user={id,displayName,role,membershipStatus}`. role: member/operator/admin, membershipStatus: pending/approved/rejected. pending/rejected의 bootstrap은 bookings/posts 빈 배열이며 다른 보호 API는 403입니다.

예약: `{id,date,start,end,purpose,name,people,owner}`. start/end는 자정부터 분, 09:00–23:00 안의 30분 단위, 사람 수 1–15. 과거 시간·중복 예약을 서버가 차단합니다. owner는 요청자 기준 me/other입니다.

글: `{id,kind,category,title,body,createdAt,status,owner,comments,authorName?}`. public은 자유/스터디/공용물품, inquiry는 문의/건의. 문의는 작성자 또는 운영진만 반환합니다. 공개 게시판은 이름을 보내지 않습니다. 댓글: `{id,body,createdAt,owner}`. 운영진 답변은 owner=admin, 문의 상태 answered; 작성자 추가 메시지는 received로 돌아갑니다.

BallStyle: `{anonymous:boolean,color:"#rrggbb",imageId:null|string,imageUrl:null|string}`. 이미지는 클라이언트에서 256px PNG로 변환하고 서버에서 픽셀·파일 형식을 다시 검사해 재인코딩합니다. 자기 이미지 ID만 연결 가능하며 `/media/balls/{id}.png`도 승인 회원에게만 제공합니다.

인원은 직접 입·퇴실 기록과 비콘 감지 기록을 승인 회원당 1명으로 합쳐 집계합니다. 직접 기록은 4시간 경과 시, 비콘 기록은 서버 수신 시각 기준 `exitGraceSeconds` 동안 갱신이 없으면 제외합니다. 승인 취소 기록도 제외합니다. `referenceCapacity`는 비콘 설정의 기준 인원입니다.

비콘 감지: 사용자는 세션으로만 식별합니다. 본문에 `userId`·`count` 같은 추가 필드를 넣으면 422입니다. `inside`는 등록된 UUID(와 지정된 Major·Minor)가 일치해야 합니다. 새로 입실하려면 `rssi ≥ enterRssi`, 이미 입실한 기기는 `rssi ≥ exitRssi`면 갱신됩니다(히스테리시스). 기준 미달이면 `accepted:false`입니다. 기록은 (회원, 기기)별로 저장하며, 한 회원은 기기가 몇 대여도 1명입니다. 회원당 최근 기기 5대까지만 유지하고, 1분 40회로 제한합니다. `source:"simulator"`는 `SAI_ENV=production`에서 403입니다. 로그아웃하면 해당 회원의 비콘 기록을 즉시 지웁니다. 식별값을 바꾸거나 자동 감지를 끄면 기존 비콘 기록 전체를 지웁니다. 두 현황 API의 sequence가 다른 경우 프론트는 이름을 섞지 않고 다시 조회합니다. SSE는 제공하지 않으며 30초 polling을 사용합니다.

주요 오류: 401 AUTH_REQUIRED/INVALID_CREDENTIALS, 403 FORBIDDEN/MEMBERSHIP_REQUIRED/CSRF_FAILED, 404 NOT_FOUND, 409 ACCOUNT_UNAVAILABLE/BOOKING_CONFLICT/APPLICATION_CHANGED/CODE_VERSION_CONFLICT/BEACON_CONFIG_CONFLICT/BEACON_DISABLED/BEACON_NOT_CONFIGURED, 403 SIMULATOR_DISABLED, 422 INVALID_BEACON_UUID/BEACON_UUID_REQUIRED/MAJOR_REQUIRED_FOR_MINOR/INVALID_THRESHOLDS/GRACE_TOO_SHORT/BEACON_MISMATCH/RSSI_REQUIRED, 422 INVALID_OPERATOR_CODE/PASSWORD_MISMATCH/WEAK_OPERATOR_CODE/CODE_UNCHANGED/INVALID_INPUT, 429 RATE_LIMITED. 코드 오류는 입력을 보존하며 성공한 코드 변경만 완료로 표시합니다.
