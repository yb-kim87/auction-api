import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique } from "typeorm";

@Entity("favorite_categories")
@Unique(["userId", "name"])
export class FavoriteCategory {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column()
  userId!: string;

  @Column()
  name!: string;

  @CreateDateColumn()
  createdAt!: Date;
}
