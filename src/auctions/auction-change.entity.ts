import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from "typeorm";

export type AuctionFieldChange = {
  field: string;
  label: string;
  oldValue: string;
  newValue: string;
};

@Entity("auction_change_logs")
export class AuctionChangeLog {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Index()
  @Column()
  auctionId!: string;

  @CreateDateColumn()
  changedAt!: Date;

  @Column({ default: "" })
  changedBy!: string;

  @Column({ default: "excel" })
  source!: string;

  @Column({ type: "simple-json" })
  changes!: AuctionFieldChange[];
}
