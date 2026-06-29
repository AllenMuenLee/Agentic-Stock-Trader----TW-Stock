import { Router, Request, Response, NextFunction } from 'express';
import { YFinanceService } from '../services/yfinance.service';

const router = Router();
const yfinance = new YFinanceService();

// GET /api/stocks/quote/:symbol
router.get('/quote/:symbol', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const quote = await yfinance.getQuote(req.params.symbol);
    if (!quote) {
      res.status(404).json({ error: 'Symbol not found' });
      return;
    }
    res.json(quote);
  } catch (err) {
    next(err);
  }
});

// GET /api/stocks/history/:symbol?days=30
router.get('/history/:symbol', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const days = Number(req.query.days) || 30;
    const bars = await yfinance.getHistoricalBars(req.params.symbol, days);
    res.json(bars);
  } catch (err) {
    next(err);
  }
});

export default router;
