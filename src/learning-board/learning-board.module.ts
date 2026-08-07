import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuctionAssignment, ServiceReport } from "./learning-board.entity";
import { LearningBoardController } from "./learning-board.controller";
import { LearningBoardService } from "./learning-board.service";
@Module({ imports: [TypeOrmModule.forFeature([AuctionAssignment, ServiceReport])], controllers: [LearningBoardController], providers: [LearningBoardService] })
export class LearningBoardModule {}
