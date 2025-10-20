import { Controller, Get, Logger, Query } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { HttpService } from '@nestjs/axios';
import { CircuitBreaker } from 'src/circute.breaker';

@Controller()
export class AggregatorController {
  private readonly logger = new Logger(AggregatorController.name);
  private readonly httpService = new HttpService();
  private coastalDestinations = ['HKT', 'UTP', 'GOA', 'MLE'];
  private weatherCircuitBreaker: CircuitBreaker;

  private metrics = {
    v1: 0,
    v2: 0,
  };

  constructor() {
    this.weatherCircuitBreaker = new CircuitBreaker({
      failureThreshold: 0.5,
      windowSize: 10,
      cooldownMs: 3000,
      halfOpenProbes: 5,
    });
  }

  @Get('/v1/trips/search')
  async searchTripsV1(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('date') date: string,
  ) {
    this.metrics.v1++;

    const startTime = Date.now();
    const timeout = 1000; // 1000ms budget
    let degraded = false;

    // Parallel fan-out
    this.logger.log('Starting parallel requests to Flight and Hotel services');
    const flightPromise = this.callWithTimeout(
      this.fetchFlights(from, to, date),
      timeout,
    );
    const hotelPromise = this.callWithTimeout(
      this.fetchHotels(to, date),
      timeout,
    );

    const [flightResult, hotelResult] = await Promise.allSettled([
      flightPromise,
      hotelPromise,
    ]);

    const flights =
      flightResult.status === 'fulfilled' ? flightResult.value : null;
    const hotels =
      hotelResult.status === 'fulfilled' ? hotelResult.value : null;

    if (!flights || !hotels) {
      degraded = true;
      this.logger.warn(
        'Partial failure detected - returning degraded response',
      );
    }

    const elapsed = Date.now() - startTime;
    this.logger.log(`Request completed in ${elapsed}ms (budget: ${timeout}ms)`);

    return {
      version: 'v1',
      flights: flights || { flights: [], error: 'Service unavailable' },
      hotels: hotels || { hotels: [], error: 'Service unavailable' },
      degraded,
      responseTimeMs: elapsed,
    };
  }

  @Get('/v1/trips/cheapest-route')
  async cheapestRoute(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('date') date: string,
  ) {
    // Get cheapest flight by querying the Flight service's /search endpoint
    this.logger.log('Step 1: Fetching flights and selecting cheapest');
    let cheapestFlight: any = null;
    try {
      const flightsData = await this.fetchFlights(from, to, date);
      const flightsArray = flightsData?.flights || [];

      if (flightsArray.length === 0) {
        return { error: 'No flights available' };
      }

      cheapestFlight = flightsArray.reduce(
        (min, f) =>
          f.price !== undefined &&
          (min.price === undefined || Number(f.price) < Number(min.price))
            ? f
            : min,
        flightsArray[0],
      );

      this.logger.log(
        `Cheapest flight: ${cheapestFlight.airline} arriving at ${cheapestFlight.arriveTime}`,
      );
    } catch (err: any) {
      const status = err?.response?.status ?? err?.code ?? 'unknown';
      this.logger.error(
        `Error fetching flights (status=${status}): ${err?.message}`,
      );
      return { error: 'Flight service unavailable' };
    }

    const arriveHour = parseInt(cheapestFlight.arriveTime.split(':')[0]);
    const needsLateCheckIn = arriveHour >= 18; // After 6 PM

    this.logger.log(
      `Step 2: Fetching hotels (late check-in: ${needsLateCheckIn})`,
    );
    let hotels = [];
    try {
      const hotelResponse = await firstValueFrom(
        this.httpService.get(
          `http://localhost:3002/hotels/search?destination=${to}&date=${date}&lateCheckIn=${needsLateCheckIn}`,
        ),
      );
      hotels = hotelResponse.data?.hotels || [];
      this.logger.log(`Found ${hotels.length} suitable hotels`);
    } catch (err: any) {
      const status = err?.response?.status ?? err?.code ?? 'unknown';
      this.logger.error(
        `Error fetching hotels (status=${status}): ${err?.message}`,
      );
      hotels = [];
    }

    return {
      version: 'v1',
      selectedFlight: cheapestFlight,
      arrivalTime: cheapestFlight.arriveTime,
      needsLateCheckIn,
      hotels: hotels,
    };
  }

  // ==================== BRANCHING ====================
  @Get('/v1/trips/contextual')
  async contextualSearch(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('date') date: string,
  ) {
    // Always fetch flights and hotels
    const flightPromise = this.fetchFlights(from, to, date);
    const hotelPromise = this.fetchHotels(to, date);

    // Conditional branching: fetch events only for coastal destinations
    const isCoastal = this.coastalDestinations.includes(to);

    let eventsPromise = Promise.resolve(null);
    if (isCoastal) {
      this.logger.log(
        'Branching: Fetching beach events for coastal destination',
      );
      eventsPromise = this.fetchEvents(to, date);
    } else {
      this.logger.log('Branching: Skipping events for inland destination');
    }

    const [flights, hotels, events] = await Promise.all([
      flightPromise,
      hotelPromise,
      eventsPromise,
    ]);

    return {
      version: 'v1',
      destination: to,
      destinationType: isCoastal ? 'coastal' : 'inland',
      flights,
      hotels,
      events: events || null,
    };
  }

  // ==================== V2 WITH WEATHER ====================
  @Get('/v2/trips/search')
  async searchTripsV2(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('date') date: string,
  ) {
    this.metrics.v2++;
    this.logger.log(`Search with weather: ${from} -> ${to} on ${date}`);

    const startTime = Date.now();
    const timeout = 1000;
    let degraded = false;

    // Parallel fan-out including weather (with circuit breaker)
    this.logger.log(
      'Starting parallel requests to Flight, Hotel, and Weather services',
    );
    const flightPromise = this.callWithTimeout(
      this.fetchFlights(from, to, date),
      timeout,
    );
    const hotelPromise = this.callWithTimeout(
      this.fetchHotels(to, date),
      timeout,
    );
    const weatherPromise = this.fetchWeatherWithBreaker(to);

    const [flightResult, hotelResult, weatherResult] = await Promise.allSettled(
      [flightPromise, hotelPromise, weatherPromise],
    );

    const flights =
      flightResult.status === 'fulfilled' ? flightResult.value : null;
    const hotels =
      hotelResult.status === 'fulfilled' ? hotelResult.value : null;
    const weather =
      weatherResult.status === 'fulfilled' ? weatherResult.value : null;

    if (!flights || !hotels || !weather || weather.degraded) {
      degraded = true;
      this.logger.warn('Partial failure or degraded weather data');
    }

    const elapsed = Date.now() - startTime;
    this.logger.log(`Request completed in ${elapsed}ms`);

    return {
      version: 'v2',
      flights: flights || { flights: [], error: 'Service unavailable' },
      hotels: hotels || { hotels: [], error: 'Service unavailable' },
      weather: weather || { summary: 'unavailable', degraded: true },
      degraded,
      responseTimeMs: elapsed,
      circuitBreakerStats: this.weatherCircuitBreaker.getStats(),
    };
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

  private async fetchWeatherWithBreaker(destination: string) {
    return this.weatherCircuitBreaker.execute(
      () => this.fetchWeather(destination),
      // () => this.callWithTimeout(this.fetchWeather(destination), 1000),
      () => {
        this.logger.warn('Using weather fallback due to circuit breaker');
        return {
          summary: 'unavailable',
          degraded: true,
          destination,
          forecast: [],
          message: 'Weather service temporarily unavailable',
        };
      },
    );
  }

  private async fetchEvents(destination: string, date: string) {
    try {
      this.logger.debug(`Calling Events Service: ${destination}`);
      const response = await firstValueFrom(
        this.httpService.get(
          `http://localhost:3004/events/search?destination=${destination}&date=${date}`,
        ),
      );
      this.logger.debug(
        `Events Service returned ${response.data.events.length} events`,
      );
      return response.data;
    } catch (error) {
      this.logger.error(`Events service error: ${error.message}`);
      throw error;
    }
  }

  private async fetchFlights(from: string, to: string, date: string) {
    try {
      this.logger.debug(`Calling Flight Service: ${from} -> ${to}`);
      const response = await firstValueFrom(
        this.httpService.get(
          `http://localhost:3001/flights/search?from=${from}&to=${to}&date=${date}`,
        ),
      );
      this.logger.debug(
        `Flight Service returned ${response.data.flights.length} flights`,
      );
      return response.data;
    } catch (error) {
      this.logger.error(`Flight service error: ${error.message}`);
      throw error;
    }
  }

  private async fetchWeather(destination: string) {
    try {
      this.logger.debug(`Calling Weather Service: ${destination}`);
      const response = await firstValueFrom(
        this.httpService.get(
          `http://localhost:3003/weather/forecast?destination=${destination}`,
        ),
      );
      this.logger.debug(
        `Weather Service returned ${response.data.forecast.length} days`,
      );
      return response.data;
    } catch (error) {
      this.logger.error(`Weather service error: ${error.message}`);
      throw error;
    }
  }

  private async fetchHotels(
    destination: string,
    date: string,
    lateCheckIn?: boolean,
  ) {
    try {
      this.logger.debug(`Calling Hotel Service: ${destination}`);
      const url = `http://localhost:3002/hotels/search?destination=${destination}&date=${date}${lateCheckIn !== undefined ? '&lateCheckIn=' + lateCheckIn : ''}`;
      const response = await firstValueFrom(this.httpService.get(url));
      this.logger.debug(
        `Hotel Service returned ${response.data.hotels.length} hotels`,
      );
      return response.data;
    } catch (error) {
      this.logger.error(`Hotel service error: ${error.message}`);
      throw error;
    }
  }

  private async callWithTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
  ): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error('Request timeout')), timeoutMs),
      ),
    ]);
  }
}
