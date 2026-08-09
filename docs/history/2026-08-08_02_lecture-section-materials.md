# 주차(섹션)별 강의자료 파일 업로드/다운로드

## 배경

사용자 요청(2026-08-08): "강의실에서 해당 주차에 대한 강의자료 올릴
수 있는 기능을 넣어줘. 강의 하단 부분에 탭을 추가해서 만들어주면
될꺼같아".

기존 "강의자료"(`/admin/lecture-materials`, `lecture_slides` 테이블)는
이름과 달리 웨비나/랜딩 슬라이드 덱 편집기이지 학생이 다운로드하는
자료가 아니었다 — 이번에 만든 기능은 완전히 별개의 새 개념(주차별
PPT/PDF 등 첨부파일)이라 기존 테이블을 재사용하지 않고 새 테이블
`lecture_section_materials`를 만들었다.

## 저장 방식 결정 (1차: bytea → 2차: OneDrive 링크로 전환, 2026-08-08 같은 날)

**1차 결정(폐기됨)**: 백엔드(Railway)와 프론트(Vercel)가 분리 배포되어
있어, 기존 `lecture-materials` 이미지 업로드처럼 로컬 파일시스템
(`auction/public/...`)에 저장하면 재배포 시 사라지고 애초에 프론트
서버 파일시스템에 반영되지도 않는다. 이 프로젝트에는 S3/Cloudinary/
Bunny Storage 같은 별도 파일 스토리지 계정이 구성돼 있지 않다(Bunny
Stream은 영상 전용). 그래서 처음엔 파일 바이트를 Postgres `bytea`
컬럼에 직접 저장하는 방식을 택했다(업로드 30MB 제한).

**2차 결정(현재 채택)**: 위 방식을 배포/검증까지 마친 뒤, 사용자가
"강의자료 올리면 서버에 부하가 심해지나?? 다운받을떄"라고 질문했다.
bytea 저장 + 백엔드 스트리밍 다운로드 구조는 다운로드 1건마다 Railway
Node 프로세스가 파일 전체를 메모리로 읽어 스트리밍해야 하고, 이 과정이
경매 검색 등 사이트의 다른 API 트래픽과 같은 프로세스를 공유하므로
동시에 큰 파일을 많이 받으면 사이트 전체가 느려질 수 있다고 설명했다.
사용자가 "one드라이브에서 다운받게 하는건?"이라고 제안했고, (a) 관리자가
OneDrive에 수동으로 올려 공유 링크를 붙여넣는 "링크 등록 방식"과
(b) Microsoft Graph API로 자동 업로드하는 방식 중 사용자가 (a) "링크
등록 방식"을 선택했다. 이 방식은 실제 파일 전송을 Microsoft 서버가
전담하므로 우리 백엔드는 URL 문자열만 다루고, 파일 바이트를 전혀
저장/스트리밍하지 않는다 — 서버 부하 우려가 원천적으로 사라진다.

이미 배포되어 있던 `fileName`/`mimeType`/`fileData`/`fileSize` 컬럼은
새 마이그레이션(`1784290000000-ConvertLectureSectionMaterialsToUrl`)으로
제거하고 `url` 컬럼을 추가했다(최초 CREATE 마이그레이션은 이미 운영에서
실행됐으므로 수정하지 않고 별도 ALTER 마이그레이션으로 처리).

## 구현 (현재 = 링크 등록 방식)

- `lecture_section_materials(id, sectionId, title, url, sortOrder,
  createdAt, updatedAt)`.
- 관리자: `GET/POST/DELETE /lecture-replay/materials` — POST는 JSON
  바디로 `{ sectionId, title, url }`을 받아 등록(더 이상 파일 업로드
  아님, FileInterceptor 제거).
- 회원(수강생): `GET /courses/:courseId/sections/:sectionId/materials` —
  기존 `getAccessMode()`(수강권 검증)를 그대로 재사용하고, 섹션이
  실제로 그 강의(courseId)에 속하는지도 확인한다. 다운로드 스트리밍
  엔드포인트(`/materials/:id/download`)는 더 이상 필요 없어 제거.
- 프론트 관리자: `LectureReplayTab.tsx`의 `SectionBlock`(주차별 영상
  관리) 하단 `MaterialsBlock`을 파일 입력 대신 "자료 이름 + OneDrive
  링크 URL" 입력 + 등록 버튼으로 교체.
- 프론트 수강생: `MyCourseClient.tsx`의 강의 탭 목록 "강의자료" 탭에서
  `SectionMaterialsBlock`이 목록을 나열하고, 각 항목은 `<a href={m.url}
  target="_blank">`로 OneDrive를 새 탭에서 바로 연다(더 이상
  fetch→blob→객체URL 다운로드 방식 아님, 인증 쿠키/오리진 이슈 자체가
  사라짐).
