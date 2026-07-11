import { RedisService } from './services/redis.service';
import { YFinanceService } from './services/yfinance.service';
import { FugleService } from './services/fugle.service';

export const redis = new RedisService();
export const yfinance = new YFinanceService();
export const fugle = new FugleService(process.env.FUGLE_API_KEY || '');
