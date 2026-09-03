import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

/** 대법원 작업창의 저장된 검색조건("관심조건"에 대응, 탱크/나이스와 동일 패턴). */
@Entity("courtauction_saved_search")
export class CourtAuctionSavedSearchRow {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "text" })
  name!: string;

  /** CourtAuctionSearchConfig JSON. */
  @Column({ type: "text" })
  search!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
