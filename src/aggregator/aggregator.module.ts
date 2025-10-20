import { Module } from '@nestjs/common';
import { AggregatorController } from './aggregator.controller';
import { AggregatorService } from './aggregator.service';

@Module({
  imports: [],
  controllers: [AggregatorController],
  providers: [AggregatorService],
  exports: [],
})
export class AggregatorModule {}
