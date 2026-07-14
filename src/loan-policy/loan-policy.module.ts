import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { LoanPolicy } from "./loan-policy.entity";
import { LoanSettings } from "./loan-settings.entity";
import { LoanPolicyService } from "./loan-policy.service";
import { LoanPolicyController } from "./loan-policy.controller";
import { RegulatedRegion } from "./regulated-region.entity";
import { RegulatedRegionService } from "./regulated-region.service";
import { RegulatedRegionController } from "./regulated-region.controller";

@Module({
  imports: [TypeOrmModule.forFeature([LoanPolicy, LoanSettings, RegulatedRegion])],
  providers: [LoanPolicyService, RegulatedRegionService],
  controllers: [LoanPolicyController, RegulatedRegionController],
  exports: [LoanPolicyService, RegulatedRegionService],
})
export class LoanPolicyModule {}
