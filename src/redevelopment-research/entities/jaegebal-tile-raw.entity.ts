import { Column, Entity, PrimaryColumn } from "typeorm";

/** 재개발닷컴 21개 타일(/api/develops) 수동 수집 원본 — 타일 번호당 1행(다시 받으면 덮어씀). 사용자 요청, 2026-11-07. */
@Entity("jaegebal_tile_raw")
export class JaegebalTileRaw {
  @PrimaryColumn({ type: "integer", name: "tile_no" })
  tileNo!: number;

  @Column({ type: "text", name: "device_id", nullable: true })
  deviceId!: string | null;

  @Column({ type: Date, name: "fetched_at" })
  fetchedAt!: Date;

  @Column({ type: "integer", nullable: true })
  status!: number | null;

  @Column({ type: "integer", name: "item_count", nullable: true })
  itemCount!: number | null;

  /** 복호화한 응답(구역 배열) 원본. */
  @Column({ type: "simple-json", nullable: true })
  raw!: unknown[] | null;
}
