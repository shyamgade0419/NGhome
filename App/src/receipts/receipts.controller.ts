import { Controller, Get, Param, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { randomBytes } from 'node:crypto';
import type { Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { ReceiptsService } from './receipts.service';
import { renderNotFoundHtml, renderReceiptHtml } from './receipt-page';

/**
 * The page a "payment received" WhatsApp message links to. No login: the signed link is the key. It sends a finished HTML
 * page rather than the app's usual JSON, and tells search engines, caches and other sites to leave it alone.
 */
@ApiExcludeController()
@Controller('public/receipts')
export class ReceiptsController {
  constructor(private readonly receipts: ReceiptsService) {}

  @Public()
  // A wrong guess costs the guesser a request; a few a second is plenty for a person opening their own link.
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get(':token')
  async show(@Param('token') token: string, @Res() res: Response): Promise<void> {
    const receipt = await this.receipts.forToken(token);
    const nonce = randomBytes(16).toString('base64');
    res.set({
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      // Nothing from outside, and only the one inline script that carries this page's nonce.
      'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    });
    if (!receipt) {
      res.status(404).send(renderNotFoundHtml());
      return;
    }
    res.status(200).send(renderReceiptHtml(receipt, nonce));
  }
}
