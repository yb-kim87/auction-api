import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity("auction_knowledge")
export class AuctionKnowledge {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column()
  title!: string;

  /** 권리분석 | 대출 | 가격분석 | 투자전략 등 */
  @Column({ type: "text", default: "" })
  category!: string;

  /** 쉼표 구분 태그 — 추후 RAG 검색용 */
  @Column({ type: "text", default: "" })
  tags!: string;

  @Column({ type: "text" })
  content!: string;

  /** 기존 숫자값을 유지하는 RAG 적용 정책:
   * 1=항상 적용, 2=관련 물건에 조건부 적용, 3=참고 자료. */
  @Column({ type: "integer", default: 3 })
  grade!: number;

  @Column({ default: true })
  active!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
