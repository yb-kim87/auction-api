import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

@Entity("lecture_notes")
export class LectureNote {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Index() @Column() username!: string;
  @Index() @Column() courseId!: string;
  @Index() @Column() videoId!: string;
  @Column({ type: "integer", default: 0 }) chapterStartSeconds!: number;
  @Column({ type: "integer", default: 0 }) positionSeconds!: number;
  @Column({ type: "text" }) content!: string;
  @CreateDateColumn() createdAt!: Date;
  @UpdateDateColumn() updatedAt!: Date;
}
