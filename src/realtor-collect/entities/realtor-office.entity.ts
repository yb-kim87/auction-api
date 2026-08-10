import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

/** 한방(카한방, karhanbang.com) 부동산 중개업소 수집 결과(사용자 요청,
 * 2026-08-10: 기존 PySide6 데스크톱 수집기 hanbang.py를 관리자 페이지
 * 기능으로 이식). 같은 지역을 다시 수집해도 중개업소가 중복 쌓이지
 * 않도록 원본 사이트의 mem_no를 고유키로 upsert한다. */
@Entity("realtor_offices")
export class RealtorOffice {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  /** 원본 사이트(karhanbang.com)의 회원번호 — 중복 방지용 고유키. */
  @Index({ unique: true })
  @Column()
  memNo!: string;

  @Index()
  @Column()
  sidoCode!: string;

  @Column()
  sidoName!: string;

  @Index()
  @Column()
  gugunCode!: string;

  @Column()
  gugunName!: string;

  @Index()
  @Column({ default: "" })
  dongCode!: string;

  @Column({ default: "" })
  dongName!: string;

  @Column()
  name!: string;

  @Column({ default: "" })
  managerName!: string;

  @Column({ default: "" })
  address!: string;

  @Column({ default: "" })
  landline!: string;

  @Column({ default: "" })
  mobilePrimary!: string;

  @Column({ default: "" })
  mobileAll!: string;

  @Column()
  detailUrl!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
