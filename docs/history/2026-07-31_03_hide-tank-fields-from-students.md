# 수강생 오픈 전: 탱크옥션 출처 필드(link/미납관리비) 숨김

## 배경
사용자 요청(2026-07-31): "이제 코치픽을 수강생들한테 오픈하려고 하는데
혹시나 탱크옥션에서 크롤링했다는 데이터가 남으면 문제가 될꺼같은데
이걸 일반 수강생이 로그인하고 확인할 수 있을 만한 요소가 있을까?" →
전수조사(서브에이전트) 후 이어서 "미납관리비같은경우는 탱크옥션이
조사한 데이터같자나 이런건 숨겨야겠지? 관리자만 볼 수 있게?".

## 조사 결과 요약
전수조사(텍스트 흔적/URL/API 응답/HTML메타)에서 실제로 수강생 화면에
노출되는 것은 사실상 두 가지로 좁혀졌다:

1. **`Auction.link`** — 크롤러가 저장한 탱크옥션 원본 상세페이지 URL
   (`crawl-item-validation.util.ts`의 `isValidTankAuctionLink`가
   `tankauction.com` 포함 여부로 검증하는 그 필드)이 `GET /auctions`
   응답에 DTO 필터링 없이 그대로 포함되어, 검색 목록의 "링크" 컬럼과
   상세 모달의 "경매지정보" 버튼에 그대로 노출됨. 클릭하지 않아도
   개발자도구 Network 탭에서 `tankauction.com` 도메인이 그대로 보임 —
   텍스트 마스킹보다 더 결정적인 노출 경로.
2. **미납관리비(`unpaidFeeAmount`/`unpaidFeeNote`/`unpaidFeeCheckedAt`)**
   — 탱크옥션이 관리사무소에 직접 전화 확인해 조사한 값으로, 대법원
   등 공식 소스에는 없는 탱크옥션 고유 데이터. 상세 모달에 빨간
   경고박스로 이미 노출되고 있었음.

그 외 admin 전용 화면(`/admin/*`)의 "탱크옥션 로그인" 등 텍스트,
크롤러 백엔드 코드의 JSDoc 주석, 파이썬 스크립트/문서 등은 수강생이
접근할 수 없는 범위라 문제 없음(조사에서 확인).

## 변경 내용
- `auctions.service.ts`: `findApproved(isStaff: boolean)`로 변경.
  `isStaff`가 아니면 `stripStaffOnlyFields()`로 `link`/
  `unpaidFeeAmount`/`unpaidFeeNote`/`unpaidFeeCheckedAt` 4개 필드를
  응답에서 제거.
- `auctions.controller.ts`: `GET /auctions`가 인증 컨텍스트를 읽어
  `role === ADMIN || CONSULTANT`일 때만 `isStaff: true`로 전달(수강생/
  비로그인은 항상 필터링된 응답).
- 프론트는 필드 부재를 이미 옵셔널 체크로 처리하고 있어 별도 수정
  불필요(`AuctionDetailModal.tsx`의 `preview.link &&`, `unpaidFeeAmount
  ?? 0` 등). `search/page.tsx`의 "링크" 컬럼 아이콘만 `r.link`가 없을 때
  빈 링크 렌더링되던 것을 `null`로 명시적으로 숨기도록 보완.
- `types/auction.ts`: `AuctionItem.link`를 옵셔널로 변경(수강생
  응답에는 없을 수 있음을 타입에도 반영).

## 검증
- 양쪽 저장소 `npx tsc --noEmit`, `npm run build` 통과.

## 追記 (2026-07-31) — 재검증 후 누락 발견: GET /recommendations

사용자가 "개발자모드 네트워크 탭으로 알아낼 요소가 더 없는지"
재확인을 요청해 서브에이전트로 더 넓은 범위(STUDENT 권한이 호출 가능한
전체 엔드포인트)를 재조사한 결과, **`GET /recommendations`(추천 물건
목록, 관심물건 모드 포함)가 `stripStaffOnlyFields`를 거치지 않고
`Auction` 엔티티를 그대로 응답에 실어보내는 것을 발견**했다
(`recommendation-engine.service.ts`가 `AuctionsService.findApproved()`가
아니라 `auctionRepo.find()`를 직접 호출하는 별도 경로였기 때문).

- 필드 제거 로직을 `auctions.service.ts` 안의 private 메서드에서
  `src/auctions/auction-staff-fields.util.ts`의 공용 함수
  `stripStaffOnlyAuctionFields()`로 분리.
- `recommendation.controller.ts`의 `GET /recommendations`도 동일하게
  `ctx.role`이 ADMIN/CONSULTANT가 아니면 응답 items를 이 함수로
  걸러서 반환하도록 수정.
- 교훈: Auction 엔티티를 반환하는 경로가 여러 개(검색 목록, 추천 목록
  등)일 수 있으므로, 앞으로 Auction을 새로 노출하는 엔드포인트를
  추가할 때는 항상 `stripStaffOnlyAuctionFields`를 거치는지 확인해야
  한다.
- 재검증 결과 그 외(AI 분석/즐겨찾기/resale-match/lecture-materials
  등)는 전부 admin 전용이거나 엔티티를 직접 노출하지 않아 문제없음을
  확인.
