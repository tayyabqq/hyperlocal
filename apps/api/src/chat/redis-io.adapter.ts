import type { INestApplicationContext } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import type { Server, ServerOptions } from 'socket.io';

/**
 * socket.io adapter that (a) applies the same CORS allow-list as the HTTP
 * server and (b) fans events out across API instances through Redis pub/sub.
 *
 * Cross-instance fan-out is what lets the chat module scale horizontally
 * without code changes — the scalability roadmap's "chat module split; Redis
 * cluster" step becomes an infrastructure change, not a rewrite. If Redis is
 * unreachable at boot the server still starts single-node so a Redis blip
 * cannot take chat fully offline.
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private adapterConstructor: ReturnType<typeof createAdapter> | null = null;
  private readonly origins: string[];
  private clients: Redis[] = [];

  constructor(
    app: INestApplicationContext,
    private readonly config: ConfigService,
  ) {
    super(app);
    this.origins = (config.get<string>('CORS_ORIGINS') ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);
  }

  async connectToRedis(): Promise<void> {
    try {
      const url = this.config.getOrThrow<string>('REDIS_URL');
      const pubClient = new Redis(url, { lazyConnect: true });
      const subClient = pubClient.duplicate();
      await Promise.all([pubClient.connect(), subClient.connect()]);
      this.clients = [pubClient, subClient];
      this.adapterConstructor = createAdapter(pubClient, subClient);
      this.logger.log('Chat scale-out adapter connected to Redis.');
    } catch (error) {
      this.logger.warn(
        `Chat running single-node — Redis adapter unavailable: ${String(error)}`,
      );
    }
  }

  async close(): Promise<void> {
    await Promise.allSettled(this.clients.map((c) => c.quit()));
  }

  createIOServer(port: number, options?: ServerOptions): Server {
    const server: Server = super.createIOServer(port, {
      ...options,
      cors: {
        origin: this.origins.length > 0 ? this.origins : false,
        credentials: true,
      },
    });
    if (this.adapterConstructor) server.adapter(this.adapterConstructor);
    return server;
  }
}
