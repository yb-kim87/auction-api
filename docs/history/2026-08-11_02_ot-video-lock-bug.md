# 2026-08-11_02 관리자가 공개한 영상이 학생 화면에서 계속 "준비중"으로 잠기는 버그 수정

## 배경

사용자 신고(프롬프트 요약): "현재 수강생 아이디로 들어갔는데 왜 1강이 비활성화 돼서
나오지?? 관리자에서는 공개로 해놨는데 이거 한번 확인해줘" — 스크린샷 기준 "OT・학습
가이드" 섹션의 OT 영상은 재생 가능한데, 그 아래 "1강_아파트시세조사" 섹션의 영상은
관리자가 공개(`isPublished: true`) 처리했음에도 자물쇠 아이콘 + "준비중"으로 표시됨.

## 원인

`LectureReplayService.getAccessMode()`가 접근 모드를 계산할 때, OT 콘텐츠 접근
가능 role(`student`/`ot_student`/`consulting_student`)인 사용자는 실제 개별
수강권(enrollment)을 확인하기도 전에 먼저 `canAccessOtContent(role)` 분기로
빠졌다. 이 강의가 `isOtCourse`는 아니지만 OT영상(`isOtVideo: true`)이 하나라도
있으면 `courseHasOtVideo()`가 true가 되어 접근 모드가 무조건 `"ot-videos-only"`로
확정되고, 그 아래에 있던 실제 enrollment 조회/판정 코드는 아예 실행되지 않았다.

`"ot-videos-only"` 모드에서는 `buildSectionsWithVideos()`가
`isPublished: v.isPublished && v.isOtVideo`로 덮어써서, `isOtVideo`로 지정되지
않은 영상은 실제 공개 여부와 무관하게 무조건 잠긴 것으로 보인다.

즉 유료 수강권(ACTIVE enrollment)이 있는 학생이라도, 강의에 OT영상이 하나라도
섞여 있으면 나머지 정규 영상이 전부 "준비중"으로 잠겨버리는 버그였다.

## 수정

`getAccessMode()`에서 enrollment을 OT 분기보다 먼저 조회하고, 상태가 `ACTIVE`면
OT 여부와 무관하게 즉시 `"full"`을 반환하도록 순서를 변경
(`src/lecture-replay/lecture-replay.service.ts`). OT 전용 분기(`ot-videos-only`)는
ACTIVE enrollment가 없는 경우에만 폴백으로 적용된다. 기존 에러 메시지(수강권
없음/시작전/만료/종료)는 그대로 유지.

## 결과

- 타입체크(`npx tsc --noEmit`) 통과.
- Railway 배포 후 헬스체크로 정상 기동 확인.
- 실제 재현 테스트(로그인해서 화면 확인)는 사용자가 직접 재확인하기로 함 —
  민감한 대량 테스트가 필요한 기능이 아니므로 별도 제약 없음.
