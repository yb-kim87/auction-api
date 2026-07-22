import { Entity, PrimaryGeneratedColumn, Column, Index } from "typeorm";

/**
 * 모든 API 요청 로그. 이전에는 파일(logs/requests.log)에 JSON Lines로
 * 남겼으나, Railway 재배포 시 컨테이너 파일시스템이 초기화되어 로그가
 * 사라지는 문제와, 파일이 계속 커지면 분석이 느려질 수 있다는 우려로
 * DB 테이블로 전환했다(사용자 요청, 2026-07-22). ts에 인덱스를 걸어
 * "최근 N분" 조회와 보관기간 정리(오래된 행 삭제)를 빠르게 한다.
 */
@Entity("request_logs")
export class RequestLog {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Index()
  @Column()
  ts!: Date;

  @Column()
  ip!: string;

  @Column()
  method!: string;

  @Column()
  path!: string;

  @Column({ default: "" })
  username!: string;

  @Column()
  status!: number;

  @Column()
  durationMs!: number;

  @Column({ default: "" })
  userAgent!: string;
}
