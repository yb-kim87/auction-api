import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from "typeorm";

/** 자동 추출이 실패한 이유를 구분하는 코드.
 *
 * 2026-08-06에 은평구 위치도 17장을 전수 검사하며 실제로 관측된 실패 유형을
 * 그대로 코드로 만들었다 — 어떤 유형인지만 알면 고치는 방법이 정해진다.
 * - NO_RED: 빨간 픽셀이 거의 없다. 경계가 빨강이 아니거나(파랑·검정 점선),
 *   위성사진 위라 색이 죽은 경우. → 색 임계값을 조정하거나 손으로 그린다.
 * - NOT_ENCLOSED: 빨간 선은 있는데 아무 반경에서도 닫히지 않았다.
 *   점선 간격이 너무 넓거나 선이 도면 밖으로 잘린 경우.
 * - TOO_SMALL / TOO_LARGE: 영역은 찾았지만 크기 기준을 벗어났다.
 *   기준을 손볼 수 있는지 판단하려면 실제 비율이 필요해 detail에 남긴다.
 */
export type TraceFailureReason = "NO_RED" | "NOT_ENCLOSED" | "TOO_SMALL" | "TOO_LARGE";

/** 구역도 이미지에서 경계 자동 추출이 실패한 기록.
 *
 * 실패는 조용히 넘어가면 안 된다 — 어떤 도면이 왜 실패했는지 쌓아 두어야
 * 유형을 보고 알고리즘을 고칠 수 있다(사용자 요청, 2026-08-06: "추출
 * 실패하는 부분이 발생하면 저장되는 로그를 만들고 이유를 보고해달라").
 * 실제로 이번 개선도 17장을 전수 검사해 실패 유형을 셋으로 나눈 뒤에야
 * 고칠 수 있었다.
 */
@Entity("redevelopment_trace_failures")
export class RedevelopmentTraceFailure {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  /** 어떤 구역을 작업하다 실패했는지(구역 없이 이미지만 올린 경우 null). */
  @Column({ type: "text", nullable: true })
  zoneId!: string | null;

  @Column({ type: "text", default: "" })
  zoneName!: string;

  /** 실패한 이미지. 같은 이미지가 반복 실패하면 한 행을 갱신한다. */
  @Column({ type: "text", default: "" })
  imageUrl!: string;

  @Column({ type: "int", default: 0 })
  imageWidth!: number;

  @Column({ type: "int", default: 0 })
  imageHeight!: number;

  @Column({ type: "text" })
  reason!: TraceFailureReason;

  /** 사람이 읽을 수 있는 요약(관리자 화면과 보고에 그대로 쓴다). */
  @Column({ type: "text", default: "" })
  summary!: string;

  /** 진단 수치 — 빨간 픽셀 수, 반경별 후보 넓이 등. 알고리즘을 고칠 때
   * 이미지를 다시 받지 않고도 원인을 좁힐 수 있게 남긴다. */
  @Column({ type: "simple-json", nullable: true })
  detail!: Record<string, unknown> | null;

  /** 같은 이미지가 몇 번 실패했는지. */
  @Column({ type: "int", default: 1 })
  occurrences!: number;

  /** 처리 완료 표시 — 손으로 그렸거나 알고리즘을 고쳤을 때. */
  @Column({ type: Date, nullable: true })
  resolvedAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @Column({ type: Date, nullable: true })
  lastSeenAt!: Date | null;
}
