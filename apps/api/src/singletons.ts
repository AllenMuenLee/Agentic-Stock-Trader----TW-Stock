import { RedisService } from './services/redis.service';
import { YFinanceService } from './services/yfinance.service';

export const redis = new RedisService();
export const yfinance = new YFinanceService();
