import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    });
  }

  async onModuleInit(): Promise<void> {
    // Retry up to 5 times with exponential back-off so a slow-starting
    // database (or brief network blip) does not immediately crash the app.
    const maxRetries = 5;
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.$connect();
        this.logger.log('Database connected');
        return;
      } catch (err) {
        lastError = err;
        const delay = attempt * 2000; // 2s, 4s, 6s, 8s, 10s
        this.logger.warn(
          `DB connect attempt ${attempt}/${maxRetries} failed: ${(err as Error)?.message ?? err}. ` +
          `Retrying in ${delay / 1000}s…`,
        );
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }
    throw lastError;
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  async executeTransaction<T>(fn: (prisma: PrismaService) => Promise<T>): Promise<T> {
    return this.$transaction(async (tx) => fn(tx as unknown as PrismaService));
  }
}
