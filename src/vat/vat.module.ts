import { Module } from "@nestjs/common";
import { VatController } from "./vat.controller";

@Module({
  controllers: [VatController],
})
export class VatModule {}
