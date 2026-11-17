import { Injectable, Logger, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { OnlinePaymentsService } from './online-payments.service';
import { OnlinePaymentsController, OnlinePaymentsReturnController } from './online-payments.controller';

/**
 * Reads Razorpay for payments whose answer never reached us (the person paid in their UPI app and never came back), and
 * retries ones that were paid but not yet recorded. Every two minutes; running it twice, or on two servers, is harmless
 * because a payment can only be applied once.
 */
@Injectable()
export class OnlinePaymentsJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OnlinePaymentsJob.name);
  private timer?: NodeJS.Timeout;
  private busy = false;

  constructor(private readonly online: OnlinePaymentsService) {}

  onModuleInit() {
    // Tests drive it directly; a timer would only keep them from exiting.
    if (process.env.NODE_ENV === 'test' || process.env.ONLINE_PAYMENTS_JOB === 'off') return;
    this.timer = setInterval(() => {
      if (this.busy) return;
      this.busy = true;
      this.online
        .reconcile()
        .catch((e) => this.logger.error(`Online payments pass failed: ${e instanceof Error ? e.message : e}`))
        .finally(() => { this.busy = false; });
    }, 2 * 60_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}

@Module({
  imports: [PaymentsModule],
  providers: [OnlinePaymentsService, OnlinePaymentsJob],
  controllers: [OnlinePaymentsController, OnlinePaymentsReturnController],
  exports: [OnlinePaymentsService],
})
export class OnlinePaymentsModule {}
