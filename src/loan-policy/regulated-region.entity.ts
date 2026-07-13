import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Unique } from "typeorm";

/**
 * 관리자가 지정하는 대출 규제지역 목록(구/시 단위, 예: "기흥구", "서울시").
 * 물건의 city/district에 이 이름이 포함되면 규제지역으로 판정한다.
 */
@Entity("regulated_regions")
@Unique("UQ_regulated_regions_name", ["name"])
export class RegulatedRegion {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "text" })
  name!: string;

  @CreateDateColumn()
  createdAt!: Date;
}
