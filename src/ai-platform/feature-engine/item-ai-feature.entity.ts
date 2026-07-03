import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";

@Entity("item_ai_features")
export class ItemAiFeature {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Index({ unique: true })
  @Column()
  itemId!: string;

  @Column({ type: "text" })
  features!: string;

  @Column({ type: "text" })
  featureSources!: string;

  @Column({ type: "integer", default: 1 })
  version!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
