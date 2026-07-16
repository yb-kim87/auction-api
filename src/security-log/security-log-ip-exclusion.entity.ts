import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from "typeorm";

/**
 * 보안 로그 이상행위 분석에서 제외할 IP. 관리자가 화면에서 직접 추가/삭제한다.
 * 정상적인 외부 연동(예: 구글 서비스 계정 Sheets API 콜백)에서 반복적으로
 * 오탐 알림이 발생할 때, 대역 전체가 아니라 실제 IP 단위로 등록해 감지
 * 범위를 최소한으로만 좁힌다.
 */
@Entity("security_log_ip_exclusions")
export class SecurityLogIpExclusion {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Index({ unique: true })
  @Column()
  ip!: string;

  @Column({ default: "" })
  note!: string;

  @CreateDateColumn()
  createdAt!: Date;
}
