import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity("courses")
export class Course {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column()
  title!: string;

  @Column({ type: "text", nullable: true })
  description!: string | null;

  @Column({ default: false })
  isPublished!: boolean;

  @CreateDateColumn()
  createdAt!: Date;
}
