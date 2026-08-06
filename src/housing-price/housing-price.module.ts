import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { HousingOfficialPrice } from "./entities/housing-official-price.entity";
import { HousingPriceController } from "./housing-price.controller";
import { HousingPriceService } from "./housing-price.service";

@Module({
  imports: [TypeOrmModule.forFeature([HousingOfficialPrice])],
  controllers: [HousingPriceController],
  providers: [HousingPriceService],
  exports: [HousingPriceService],
})
export class HousingPriceModule {}
