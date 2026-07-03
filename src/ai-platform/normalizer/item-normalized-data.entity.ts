import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";

@Entity("item_normalized_data")
export class ItemNormalizedData {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Index({ unique: true })
  @Column()
  itemId!: string;

  @Column({ type: "text" })
  normalizedData!: string;

  @Column({ type: "text" })
  normalizedSources!: string;

  @Column({ type: "integer", default: 1 })
  version!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
