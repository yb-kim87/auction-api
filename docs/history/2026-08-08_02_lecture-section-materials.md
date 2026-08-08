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

## 저장 방식 결정

백엔드(Railway)와 프론트(Vercel)가 분리 배포되어 있어, 기존
`lecture-materials` 이미지 업로드처럼 로컬 파일시스템(`auction/public/...`)
에 저장하면 재배포 시 사라지고 애초에 프론트 서버 파일시스템에
반영되지도 않는다. 이 프로젝트에는 S3/Cloudinary/Bunny Storage 같은
별도 파일 스토리지 계정이 구성돼 있지 않다(Bunny Stream은 영상 전용).
따라서 파일 바이트를 Postgres `bytea` 컬럼에 직접 저장하는 방식을
택했다 — 확실히 영속되고 새 인프라가 필요 없다. 업로드 용량은 30MB로
제한(PPT/PDF 위주라 충분).

## 구현

- `lecture_section_materials(id, sectionId, title, fileName, mimeType,
  fileData bytea, fileSize, sortOrder, createdAt, updatedAt)`.
- 목록 조회는 항상 `fileData`를 제외하고 메타데이터만 반환(payload
  경량화).
- 관리자: `GET/POST/DELETE /lecture-replay/materials`(FileInterceptor),
  `GET /lecture-replay/materials/:id/download`(관리자 미리보기용).
- 회원(수강생): `GET /courses/:courseId/sections/:sectionId/materials`,
  `GET /courses/:courseId/materials/:materialId/download` — 둘 다
  기존 `getAccessMode()`(수강권 검증)를 그대로 재사용하고, 섹션이
  실제로 그 강의(courseId)에 속하는지도 확인한다.
- 프론트 관리자: `LectureReplayTab.tsx`의 `SectionBlock`(주차별 영상
  관리) 하단에 `MaterialsBlock` 추가 — 업로드/목록/삭제.
- 프론트 수강생: `MyCourseClient.tsx`의 강의 탭 목록에 "강의자료" 탭
  추가, 주차별로 자료를 나열하고 클릭하면 다운로드. 다운로드는 다른
  오리진(Vercel↔Railway) 인증 쿠키 문제를 피하기 위해 `<a href>` 직접
  연결 대신 `fetch(credentials:"include")` → blob → 임시 객체 URL
  클릭 방식을 사용한다.
