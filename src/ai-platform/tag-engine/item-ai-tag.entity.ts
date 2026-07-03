import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";

@Entity("item_ai_tags")
export class ItemAiTag {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Index({ unique: true })
  @Column()
  itemId!: string;

  @Column({ type: "text" })
  autoTags!: string;

  @Column({ type: "text", nullable: true })
  manualTags!: string | null;

  @Column({ type: "text" })
  finalTags!: string;

  @Column({ type: "text" })
  tagSources!: string;

  @Column({ type: "integer", default: 100 })
  confidence!: number;

  @Column({ type: "integer", default: 1 })
  version!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
