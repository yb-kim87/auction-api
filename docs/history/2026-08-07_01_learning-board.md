# 과제·서비스 제보 게시판

## 범위

- 수강생(STUDENT) 이상 등급만 과제 게시판과 서비스 버그·개선 제보를 이용한다.
- 물건 찾기 과제는 사건번호/주소, 주변 시세 조사, 전화 시세 조사 결과, 최종 시세, 입찰가, 필요자금, 메모를 저장한다.
- 입찰계획의 수치와 연결할 수 있도록 `auctionId`, `requiredEquity`를 저장한다.
- 서비스 제보는 버그/개선 제안 유형, 제목, 상세 내용, 상태와 관리자 답변 필드를 가진다.

## API

- `GET/POST /learning-board/assignments`
- `PATCH /learning-board/assignments/:id`
- `GET/POST /learning-board/reports`

모든 API는 기존 `requireSearchAccess`를 사용해 수강생 이상을 서버에서 검증한다. 데이터는 `auction_assignments`, `service_reports` 테이블에 저장한다.

## 화면

- `/assignments`: 과제 입력 및 본인 과제 목록
- `/reports`: 서비스 버그·개선 제보 및 본인 제보 목록

후속 작업으로 입찰계획 목록의 각 행에서 과제 작성 화면으로 이동하는 링크와 관리자 답변 화면을 추가할 수 있다.
