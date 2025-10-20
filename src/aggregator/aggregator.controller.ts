import {
  Controller,
  Get,
  Logger,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { CircuitBreaker } from 'src/circute.breaker';
import { AggregatorService } from './aggregator.service';
import { SearchTripDto } from './dto/search-trip-dto';
import { CheapestRouteDto } from './dto/cheapest-route-dto';
import { SearchContextualDto } from './dto/search-contextual-dto';

@Controller()
export class AggregatorController {
  private readonly logger = new Logger(AggregatorController.name);
  private weatherCircuitBreaker: CircuitBreaker;

  private metrics = {
    v1: 0,
    v2: 0,
  };

  constructor(private readonly aggregatorService: AggregatorService) {
    this.weatherCircuitBreaker = new CircuitBreaker({
      failureThreshold: 0.5,
      windowSize: 10,
      cooldownMs: 3000,
      halfOpenProbes: 5,
    });
  }

  @Get('/v1/trips/search')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async searchTripsV1(@Query() searchTripDto: SearchTripDto) {
    this.metrics.v1++;
    return this.aggregatorService.searchTripsV1(
      searchTripDto.from,
      searchTripDto.to,
      searchTripDto.date,
    );
  }

  @Get('/v1/trips/cheapest-route')
  async cheapestRoute(@Query() cheapestRouteDto: CheapestRouteDto) {
    return this.aggregatorService.cheapestRoute(
      cheapestRouteDto.from,
      cheapestRouteDto.to,
      cheapestRouteDto.date,
    );
  }

  // ==================== BRANCHING ====================
  @Get('/v1/trips/contextual')
  async contextualSearch(@Query() searchContextualDto: SearchContextualDto) {
    return this.aggregatorService.contextualSearch(
      searchContextualDto.from,
      searchContextualDto.to,
      searchContextualDto.date,
    );
  }

  // ==================== V2 WITH WEATHER ====================
  @Get('/v2/trips/search')
  async searchTripsV2(@Query() searchTripDto: SearchTripDto) {
    this.metrics.v2++;
    return this.aggregatorService.searchTripsV2(
      searchTripDto.from,
      searchTripDto.to,
      searchTripDto.date,
    );
  }

  // ==================== METRICS ENDPOINT ====================
  @Get('/metrics')
  getMetrics() {
    const total = this.metrics.v1 + this.metrics.v2;
    this.logger.log('Metrics requested');

    const v1Percentage = total > 0 ? (this.metrics.v1 / total) * 100 : 0;
    const v2Percentage = total > 0 ? (this.metrics.v2 / total) * 100 : 0;

    // after v2 useage exceeds 75%, consider v1 deprecated
    let isV1Deprecated = false;
    if (this.metrics.v2 > 0 && v2Percentage > 75) {
      isV1Deprecated = true;
      this.logger.warn('V1 API deprecated');
    }

    return {
      apiVersionUsage: this.metrics,
      v1Percentage: total > 0 ? v1Percentage.toFixed(2) + '%' : '0%',
      v2Percentage: total > 0 ? v2Percentage.toFixed(2) + '%' : '0%',
      isV1Deprecated,
      totalRequests: total,
      circuitBreaker: this.weatherCircuitBreaker.getStats(),
    };
  }

  // private async fetchWeatherWithBreaker(destination: string) {
  //   return this.weatherCircuitBreaker.execute(
  //     () => this.fetchWeather(destination),
  //     // () => this.callWithTimeout(this.fetchWeather(destination), 1000),
  //     () => {
  //       this.logger.warn('Using weather fallback due to circuit breaker');
  //       return {
  //         summary: 'unavailable',
  //         degraded: true,
  //         destination,
  //         forecast: [],
  //         message: 'Weather service temporarily unavailable',
  //       };
  //     },
  //   );
  // }

  // private async fetchEvents(destination: string, date: string) {
  //   try {
  //     this.logger.debug(`Calling Events Service: ${destination}`);
  //     const response = await firstValueFrom(
  //       this.httpService.get(
  //         `http://localhost:3004/events/search?destination=${destination}&date=${date}`,
  //       ),
  //     );
  //     this.logger.debug(
  //       `Events Service returned ${response.data.events.length} events`,
  //     );
  //     return response.data;
  //   } catch (error) {
  //     this.logger.error(`Events service error: ${error.message}`);
  //     throw error;
  //   }
  // }

  // private async fetchFlights(from: string, to: string, date: string) {
  //   try {
  //     this.logger.debug(`Calling Flight Service: ${from} -> ${to}`);
  //     const response = await firstValueFrom(
  //       this.httpService.get(
  //         `http://localhost:3001/flights/search?from=${from}&to=${to}&date=${date}`,
  //       ),
  //     );
  //     this.logger.debug(
  //       `Flight Service returned ${response.data.flights.length} flights`,
  //     );
  //     return response.data;
  //   } catch (error) {
  //     this.logger.error(`Flight service error: ${error.message}`);
  //     throw error;
  //   }
  // }

  // private async fetchWeather(destination: string) {
  //   try {
  //     this.logger.debug(`Calling Weather Service: ${destination}`);
  //     const response = await firstValueFrom(
  //       this.httpService.get(
  //         `http://localhost:3003/weather/forecast?destination=${destination}`,
  //       ),
  //     );
  //     this.logger.debug(
  //       `Weather Service returned ${response.data.forecast.length} days`,
  //     );
  //     return response.data;
  //   } catch (error) {
  //     this.logger.error(`Weather service error: ${error.message}`);
  //     throw error;
  //   }
  // }

  // private async fetchHotels(
  //   destination: string,
  //   date: string,
  //   lateCheckIn?: boolean,
  // ) {
  //   try {
  //     this.logger.debug(`Calling Hotel Service: ${destination}`);
  //     const url = `http://localhost:3002/hotels/search?destination=${destination}&date=${date}${lateCheckIn !== undefined ? '&lateCheckIn=' + lateCheckIn : ''}`;
  //     const response = await firstValueFrom(this.httpService.get(url));
  //     this.logger.debug(
  //       `Hotel Service returned ${response.data.hotels.length} hotels`,
  //     );
  //     return response.data;
  //   } catch (error) {
  //     this.logger.error(`Hotel service error: ${error.message}`);
  //     throw error;
  //   }
  // }

  // private async callWithTimeout<T>(
  //   promise: Promise<T>,
  //   timeoutMs: number,
  // ): Promise<T> {
  //   return Promise.race([
  //     promise,
  //     new Promise<T>((_, reject) =>
  //       setTimeout(() => reject(new Error('Request timeout')), timeoutMs),
  //     ),
  //   ]);
  // }
}
