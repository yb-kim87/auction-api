import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { UsersModule } from "../users/users.module";
import { UserItemAction } from "./user-item-action.entity";
import { UserActionsController } from "./user-actions.controller";
import { UserActionsService } from "./user-actions.service";

@Module({
  imports: [TypeOrmModule.forFeature([UserItemAction]), UsersModule],
  controllers: [UserActionsController],
  providers: [UserActionsService],
})
export class UserActionsModule {}
