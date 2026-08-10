import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { RealtorOffice } from "./entities/realtor-office.entity";
import { RealtorCollectController } from "./realtor-collect.controller";
import { RealtorCollectService } from "./realtor-collect.service";

@Module({
  imports: [TypeOrmModule.forFeature([RealtorOffice])],
  controllers: [RealtorCollectController],
  providers: [RealtorCollectService],
})
export class RealtorCollectModule {}
