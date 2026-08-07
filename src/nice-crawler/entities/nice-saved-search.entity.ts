import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

/** 나이스 작업창의 저장된 검색조건("관심조건"에 대응). 탱크옥션과 달리
 * 나이스는 로그인이 없어 "나이스 즐겨쓰는 검색"(사이트 자체 계정
 * 즐겨찾기) 개념이 없다 — 대신 탱크옥션 즐겨찾기를 불러와 나이스 필터로
 * 변환해 저장하는 경로를 프론트에서 제공한다(사용자 요청, 2026-08-07). */
@Entity("nice_saved_search")
export class NiceSavedSearchRow {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "text" })
  name!: string;

  /** NiceSearchConfig JSON. */
  @Column({ type: "text" })
  search!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
