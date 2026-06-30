import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";

export type KnowledgeDraftStatus =
  | "raw"
  | "structured"
  | "approved"
  | "rejected"
  | "skipped";

@Entity("knowledge_drafts")
export class KnowledgeDraft {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Index({ unique: true })
  @Column({ type: "text" })
  sourceArticleId!: string;

  @Column({ type: "text" })
  sourceUrl!: string;

  @Column({ type: "text", default: "" })
  sourceTitle!: string;

  @Column({ type: "text", default: "" })
  sourceBoard!: string;

  @Column({ type: "text", default: "" })
  cafeUrl!: string;

  @Column({ type: "text" })
  rawContent!: string;

  @Column({ type: "text", default: "" })
  title!: string;

  @Column({ type: "text", default: "" })
  category!: string;

  @Column({ type: "text", default: "" })
  tags!: string;

  @Column({ type: "text", default: "" })
  content!: string;

  @Column({ type: "text", default: "" })
  aiNote!: string;

  @Column({ type: "text", default: "raw" })
  status!: KnowledgeDraftStatus;

  @Column({ type: "text", nullable: true })
  errorMessage!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
