import { Column, Entity, PrimaryColumn } from "typeorm";

/** 재개발닷컴 구역도 업데이트 알림을 마지막으로 보낸 시각(단일 행). */
@Entity("zone_update_reminders")
export class ZoneUpdateReminder {
  @PrimaryColumn({ type: "varchar" }) id!: string;
  @Column({ type: Date, nullable: true }) lastSentAt!: Date | null;
}
