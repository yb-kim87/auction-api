import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

@Entity("lecture_questions")
export class LectureQuestion {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Index() @Column() username!: string;
  @Index() @Column() courseId!: string;
  @Index() @Column() videoId!: string;
  @Column({ type: "integer", default: 0 }) chapterStartSeconds!: number;
  @Column({ type: "integer", default: 0 }) positionSeconds!: number;
  @Column({ type: "text" }) question!: string;
  @Column({ type: "text", nullable: true }) answer!: string | null;
  @Column({ type: Date, nullable: true }) answeredAt!: Date | null;
  @CreateDateColumn() createdAt!: Date;
  @UpdateDateColumn() updatedAt!: Date;
}
