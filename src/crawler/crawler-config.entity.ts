import { Entity, PrimaryColumn, Column } from "typeorm";

/** 크롤러 설정(검색조건 기본값·알고리즘·예약·관심조건 등) 전체를 JSON
 * 문자열로 저장하는 단일 행 저장소. 예전엔 컨테이너 로컬 파일(config.json)에
 * 저장했는데, Railway는 재배포마다 파일시스템이 초기화되어 관심조건/매일
 * 작업 설정이 배포할 때마다 사라지는 문제가 있었다(실측, 2026-07-19).
 * DB에 저장해 재배포와 무관하게 유지되도록 한다. */
@Entity("crawler_config")
export class CrawlerConfigRow {
  @PrimaryColumn()
  key!: string;

  @Column({ type: "text" })
  value!: string;
}
