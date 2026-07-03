import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from "typeorm";
import type { AiPlatformActionType, AiPlatformEngineType } from "../types/common.types";

@Entity("ai_platform_histories")
@Index(["itemId", "engineType"])
export class AiPlatformHistory {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column()
  itemId!: string;

  @Column()
  engineType!: AiPlatformEngineType;

  @Column()
  actionType!: AiPlatformActionType;

  @Column({ type: "text", nullable: true })
  beforeData!: string | null;

  @Column({ type: "text" })
  afterData!: string;

  @Column()
  changedBy!: string;

  @CreateDateColumn()
  createdAt!: Date;
}
