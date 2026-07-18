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

  /** 관리자가 매기는 중요도 등급. 1이 가장 중요, 숫자가 클수록 낮음.
   *  기본값 3. 현재는 저장만 하고 검색/필터 로직에서는 아직 사용하지
   *  않음(추후 1·2등급만 골라 쓰는 용도로 확장 예정). */
  @Column({ type: "integer", default: 3 })
  grade!: number;

  @Column({ default: true })
  active!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
