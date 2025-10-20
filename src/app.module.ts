import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { AggregatorController } from './aggregator/aggregator.controller';
import { AggregatorModule } from './aggregator/aggregator.module';

@Module({
  imports: [HttpModule, AggregatorModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
