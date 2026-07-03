import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { LoanPolicy } from "./loan-policy.entity";
import { LoanPolicyService } from "./loan-policy.service";
import { LoanPolicyController } from "./loan-policy.controller";

@Module({
  imports: [TypeOrmModule.forFeature([LoanPolicy])],
  providers: [LoanPolicyService],
  controllers: [LoanPolicyController],
  exports: [LoanPolicyService],
})
export class LoanPolicyModule {}
