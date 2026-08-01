import type { Auction } from "./auction.entity";

/**
 * 일반 수강생/비로그인 사용자에게는 크롤링 출처(탱크옥션)가 드러나는
 * link 필드와, 탱크옥션이 자체 조사한 미납관리비 정보를 감춘다
 * (관리자/컨설턴트만 열람, 사용자 요청 2026-07-31). Auction 엔티티를
 * 응답에 실어보내는 모든 곳(검색 목록, 추천 목록 등)에서 공통으로
 * 써야 한다 — 엔드포인트 하나만 막고 다른 경로를 빠뜨리면 그대로
 * 노출된다(실측: GET /recommendations 누락 발견, 2026-07-31).
 */
export function stripStaffOnlyAuctionFields(item: Auction): Record<string, unknown> {
  const {
    link: _link,
    unpaidFeeAmount: _unpaidFeeAmount,
    unpaidFeeNote: _unpaidFeeNote,
    unpaidFeeCheckedAt: _unpaidFeeCheckedAt,
    ...rest
  } = item;
  return rest;
}

/**
 * 매도분석(재판매 매칭) 결과는 아직 내부 검증 중인 신호라 관리자
 * 전용으로만 노출한다 — 컨설턴트도 제외(사용자 요청, 2026-08-01:
 * "해당 정보는 관리자만 볼 수 있게 해줘"). link/미납관리비와 달리
 * ADMIN이 아니면(컨설턴트 포함) 항상 걸러낸다.
 */
export function stripResaleMatchFields(
  item: Auction | Record<string, unknown>,
): Record<string, unknown> {
  const {
    resaleMatchTier: _tier,
    resaleMatchScore: _score,
    resaleMatchedTradeId: _tradeId,
    ...rest
  } = item as Record<string, unknown>;
  return rest;
}
