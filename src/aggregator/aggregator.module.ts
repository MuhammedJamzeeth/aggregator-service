import { Module } from "@nestjs/common";
import { AggregatorController } from "./aggregator.controller";

@Module({
    imports: [],
    controllers: [AggregatorController],
    providers: [],
    exports: [],
})

export class AggregatorModule {}
