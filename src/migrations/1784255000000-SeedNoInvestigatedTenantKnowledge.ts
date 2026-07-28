import type { MigrationInterface, QueryRunner } from "typeorm";

const TITLE = "조사된 임차내역 없음 판정 규칙";
const CONTENT = `적용 조건
- 법원 현황조사서 또는 임차인·점유 현황에 "조사된 임차내역 없음"이 명시되어 있다.
- 별도의 임차인 성명, 전입일, 보증금, 임차권등기 등 서로 충돌하는 임차 자료가 없다.

판정 규칙
1. 법원 조사 기준으로 확인된 임차인이 없는 물건으로 처리한다.
2. 선순위 임차인 상태는 "없음", 임차인의 대항력은 "없음"으로 판정한다.
3. 임차보증금과 관련해 낙찰자가 인수할 권리 및 금액은 "없음(0원)"으로 판정한다.
4. "임차인 자료 필요", "대항력 미확인", "임차보증금 확인 필요"를 미확인 자료나 위험요소로 표시하지 않는다.
5. 실제 점유자를 만나지 못했다는 문구만으로 소유자의 실제 점유를 확정하지는 않는다. 점유·명도 상태는 임차인의 대항력 및 보증금 인수 여부와 분리한다.

예외
- 별도의 임차인 정보, 전입일, 보증금, 임차권등기 또는 매각물건명세서상 임차인이 함께 확인되면 자료 충돌로 보고 이 규칙을 적용하지 않는다.
- 유치권, 법정지상권 등 임차인 외의 인수 가능 권리는 별도로 판단한다.`;

export class SeedNoInvestigatedTenantKnowledge1784255000000
  implements MigrationInterface
{
  name = "SeedNoInvestigatedTenantKnowledge1784255000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "auction_knowledge"
        ("id", "title", "category", "tags", "content", "grade", "active", "createdAt", "updatedAt")
       SELECT
         gen_random_uuid(), $1, '권리분석',
         '조사된임차내역없음,현황조사서,임차인없음,대항력없음,인수권리없음,세대열람',
         $2, 2, true, NOW(), NOW()
       WHERE NOT EXISTS (
         SELECT 1 FROM "auction_knowledge" WHERE "title" = $1
       )`,
      [TITLE, CONTENT],
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "auction_knowledge" WHERE "title" = $1`,
      [TITLE],
    );
  }
}
