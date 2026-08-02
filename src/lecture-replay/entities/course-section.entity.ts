import { Column, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

@Entity("course_sections")
export class CourseSection {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Index()
  @Column()
  courseId!: string;

  @Column()
  title!: string;

  @Column({ type: "integer", default: 0 })
  sortOrder!: number;
}
