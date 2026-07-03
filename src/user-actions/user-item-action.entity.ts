import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from "typeorm";

@Entity("user_item_actions")
@Index(["userId", "itemId"])
@Index(["actionType"])
export class UserItemAction {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column()
  userId!: string;

  @Column()
  itemId!: string;

  @Column()
  actionType!: string;

  @Column({ type: "int", nullable: true })
  durationSeconds!: number | null;

  @Column({ type: "text", nullable: true })
  metadata!: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}
