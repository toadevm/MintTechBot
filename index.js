require('dotenv').config();
const { Telegraf } = require('telegraf');
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const logger = require('./src/services/logger');
const Database = require('./src/database/db');
const OpenSeaService = require('./src/blockchain/opensea');
const MagicEdenService = require('./src/blockchain/magiceden');
const HeliusService = require('./src/blockchain/helius');
const BotCommands = require('./src/bot/commands');
const WebhookHandlers = require('./src/webhooks/handlers');
const TokenTracker = require('./src/services/tokenTracker');
const TrendingService = require('./src/services/trendingService');
const SecureTrendingService = require('./src/services/secureTrendingService');
const ChannelService = require('./src/services/channelService');
const ChainManager = require('./src/services/chainManager');

class MintyRushBot {
  constructor() {
    this.bot = null;
    this.app = express();
    this.server = null;
    this.services = {};
    this.isShuttingDown = false;

    this.validateEnvironment();
  }

  validateEnvironment() {
    const required = ['TELEGRAM_BOT_TOKEN', 'OPENSEA_API_KEY'];
    const missing = required.filter(key => !process.env[key]);
    if (missing.length > 0) {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }
  }

  async initialize() {
    try {
      logger.info('Starting MintyRushBot initialization...');

      this.bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

      const botInfo = await this.bot.telegram.getMe();
      logger.info(`Bot initialized: @${botInfo.username} (${botInfo.first_name})`);


      this.services.db = new Database();
      await this.services.db.initialize();
      logger.info('Database initialized');

      // Initialize ChainManager for multi-chain support
      this.services.chainManager = new ChainManager(this.services.db);
      await this.services.chainManager.initialize();
      logger.info('ChainManager initialized with multi-chain support');

      // Initialize OpenSea service (required for contract validation and streaming)
      this.services.openSea = new OpenSeaService();
      await this.services.openSea.initialize();
      logger.info('🌊 OpenSea streaming service initialized');

      // Initialize Magic Eden service (for Solana NFT validation)
      try {
        this.services.magicEden = new MagicEdenService();
        await this.services.magicEden.initialize();
        logger.info('🪄 Magic Eden service initialized');
      } catch (error) {
        logger.warn('Magic Eden service not available:', error.message);
        this.services.magicEden = null;
      }

      // Initialize Helius service (for Solana webhook management)
      try {
        this.services.helius = new HeliusService();
        await this.services.helius.initialize();
        logger.info('🌟 Helius webhook service initialized');
      } catch (error) {
        logger.warn('Helius service not available:', error.message);
        this.services.helius = null;
      }


      try {
        this.services.trending = new TrendingService(this.services.db);
        await this.services.trending.initialize();
        logger.info('Trending service initialized');
      } catch (error) {
        logger.warn('Trending service initialized with limited functionality:', error.message);
        this.services.trending = { 
          isConnected: false,
          getTrendingTokens: () => Promise.resolve([]),
          getTrendingOptions: () => Promise.resolve([]),
          calculateTrendingFee: () => Promise.resolve('0'),
          generatePaymentInstructions: () => Promise.resolve({ 
            contractAddress: 'N/A',
            tokenName: 'N/A',
            fee: '0',
            feeEth: '0.0',
            instructions: ['Service temporarily unavailable']
          })
        };
      }

      // Initialize secure trending service (no private keys)
      try {
        this.services.secureTrending = new SecureTrendingService(this.services.db);
        await this.services.secureTrending.initialize();
        logger.info('🔒 Secure trending service initialized (no private keys)');
      } catch (error) {
        logger.warn('Secure trending service not available:', error.message);
        this.services.secureTrending = null;
      }

      this.services.tokenTracker = new TokenTracker(
        this.services.db,
        this.services.openSea,
        null, // webhookHandlers will be set later
        this.services.chainManager,
        this.services.magicEden,
        this.services.helius
      );
      await this.services.tokenTracker.initialize();
      logger.info('Token tracker initialized with OpenSea + Magic Eden support');

      this.services.channelService = new ChannelService(
        this.services.db,
        this.bot,
        this.services.trending,
        this.services.secureTrending
      );
      await this.services.channelService.initialize();
      logger.info('Channel service initialized');


      this.setupExpressMiddleware();


      this.setupWebhookRoutes();


      const botCommands = new BotCommands(
        this.services.db,
        this.services.tokenTracker,
        this.services.trending,
        this.services.channelService,
        this.services.secureTrending,
        this.services.chainManager
      );
      await botCommands.setupCommands(this.bot);
      logger.info('Bot commands setup completed');


      this.setupErrorHandlers();


      await this.startServer();


      await this.bot.launch();
      logger.info('Telegram bot launched successfully');


      this.setupGracefulShutdown();

      logger.info('🚀 MintyRushBot fully initialized and running!');

      await this.logSystemStatus();

    } catch (error) {
      logger.error('Failed to initialize bot:', error);
      await this.cleanup();
      process.exit(1);
    }
  }

  setupExpressMiddleware() {

    this.app.use((req, res, next) => {
      const start = Date.now();
      res.on('finish', () => {
        const duration = Date.now() - start;
        logger.info(`${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
      });
      next();
    });


    this.app.use((req, res, next) => {
      res.header('X-Content-Type-Options', 'nosniff');
      res.header('X-Frame-Options', 'DENY');
      res.header('X-XSS-Protection', '1; mode=block');
      next();
    });


    this.app.use(cors({
      origin: process.env.ALLOWED_ORIGINS?.split(',') || false,
      credentials: false
    }));
    this.app.use(bodyParser.json({ 
      limit: '10mb',
      verify: (req, res, buf) => {
        req.rawBody = buf;
      }
    }));
    this.app.use(bodyParser.urlencoded({ 
      extended: true, 
      limit: '10mb' 
    }));


    const requestCounts = new Map();
    this.app.use((req, res, next) => {
      const ip = req.ip || req.connection.remoteAddress;
      const now = Date.now();
      const windowMs = 60000;
      const maxRequests = 100;

      if (!requestCounts.has(ip)) {
        requestCounts.set(ip, []);
      }

      const requests = requestCounts.get(ip);
      const recentRequests = requests.filter(time => now - time < windowMs);
      if (recentRequests.length >= maxRequests) {
        return res.status(429).json({ 
          error: 'Too many requests',
          retryAfter: Math.ceil(windowMs / 1000)
        });
      }

      recentRequests.push(now);
      requestCounts.set(ip, recentRequests);
      next();
    });
  }

  setupWebhookRoutes() {
    const webhookHandlers = new WebhookHandlers(
      this.services.db,
      this.bot,
      this.services.trending,
      this.services.secureTrending,
      this.services.openSea,
      this.services.chainManager,
      this.services.magicEden,
      this.services.helius
    );

    // Connect webhook handlers to token tracker for OpenSea notifications
    if (this.services.tokenTracker && this.services.tokenTracker.setWebhookHandlers) {
      this.services.tokenTracker.setWebhookHandlers(webhookHandlers);
    }

    this.app.post('/webhook/alchemy', webhookHandlers.handleAlchemyWebhook.bind(webhookHandlers));
    this.app.post('/webhook/helius', webhookHandlers.handleHeliusWebhook.bind(webhookHandlers));

    this.app.get('/health', webhookHandlers.handleHealthCheck.bind(webhookHandlers));

    this.app.get('/status', async (req, res) => {
      try {
        const status = await this.getSystemStatus();
        res.json(status);
      } catch (error) {
        logger.error('Error in status endpoint:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });


    this.app.get('/metrics', async (req, res) => {
      try {
        const metrics = await this.getMetrics();
        res.json(metrics);
      } catch (error) {
        logger.error('Error in metrics endpoint:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });


    this.app.use((req, res) => {
      res.status(404).json({ error: 'Endpoint not found' });
    });
  }

  setupErrorHandlers() {

    this.app.use((err, req, res, next) => {
      logger.error('Express error:', err);
      if (res.headersSent) {
        return next(err);
      }
      res.status(500).json({ 
        error: 'Internal server error',
        timestamp: new Date().toISOString()
      });
    });


    this.bot.catch((err, ctx) => {
      logger.error('Bot error:', err);
      try {
        ctx.reply('❌ An error occurred. Please try again later.');
      } catch (replyError) {
        logger.error('Failed to send error message to user:', replyError);
      }
    });


    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
    });


    process.on('uncaughtException', (error) => {
      logger.error('Uncaught Exception:', error);
      this.gracefulShutdown('UNCAUGHT_EXCEPTION');
    });
  }

  async startServer() {
    return new Promise((resolve, reject) => {
      const port = process.env.PORT || 3000;
      this.server = this.app.listen(port, (err) => {
        if (err) {
          reject(err);
        } else {
          logger.info(`Server running on port ${port}`);
          resolve();
        }
      });

      this.server.on('error', (error) => {
        logger.error('Server error:', error);
        reject(error);
      });
    });
  }

  setupGracefulShutdown() {
    const signals = ['SIGTERM', 'SIGINT', 'SIGUSR2'];
    signals.forEach(signal => {
      process.once(signal, () => {
        logger.info(`Received ${signal}, starting graceful shutdown...`);
        this.gracefulShutdown(signal);
      });
    });
  }

  async gracefulShutdown(signal) {
    if (this.isShuttingDown) {
      logger.warn('Shutdown already in progress...');
      return;
    }

    this.isShuttingDown = true;
    logger.info('Starting graceful shutdown...');

    try {

      if (this.server) {
        this.server.close(() => {
          logger.info('HTTP server closed');
        });
      }


      if (this.bot) {
        this.bot.stop(signal);
        logger.info('Telegram bot stopped');
      }


      await this.cleanup();

      logger.info('Graceful shutdown completed');
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown:', error);
      process.exit(1);
    }
  }

  async cleanup() {
    try {
      // Clean up token tracker (includes OpenSea subscriptions)
      if (this.services.tokenTracker) {
        await this.services.tokenTracker.cleanup();
      }

      // Clean up OpenSea service
      if (this.services.openSea) {
        await this.services.openSea.disconnect();
      }

      // Clean up Helius service
      if (this.services.helius) {
        await this.services.helius.disconnect();
      }

      // Clean up Magic Eden service
      if (this.services.magicEden) {
        await this.services.magicEden.disconnect();
      }

      // Close database connection
      if (this.services.db) {
        await this.services.db.close();
      }

      logger.info('Cleanup completed');
    } catch (error) {
      logger.error('Error during cleanup:', error);
    }
  }

  async logSystemStatus() {
    try {
      const status = await this.getSystemStatus();
      logger.info('System Status:', JSON.stringify(status, null, 2));
    } catch (error) {
      logger.error('Error logging system status:', error);
    }
  }

  async getSystemStatus() {
    try {
      const [
        dbStatus,
        botStatus,
        channelsCount,
        tokensCount,
        trendingCount
      ] = await Promise.allSettled([
        this.checkDatabaseStatus(),
        this.checkBotStatus(),
        this.getChannelsCount(),
        this.getTokensCount(),
        this.getTrendingCount()
      ]);

      return {
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        database: dbStatus.status === 'fulfilled' ? dbStatus.value : 'error',
        bot: botStatus.status === 'fulfilled' ? botStatus.value : 'error',
        stats: {
          channels: channelsCount.status === 'fulfilled' ? channelsCount.value : 0,
          tokens: tokensCount.status === 'fulfilled' ? tokensCount.value : 0,
          trending: trendingCount.status === 'fulfilled' ? trendingCount.value : 0
        }
      };
    } catch (error) {
      logger.error('Error getting system status:', error);
      throw error;
    }
  }

  async checkDatabaseStatus() {
    try {
      await this.services.db.get('SELECT 1');
      return 'connected';
    } catch (error) {
      return 'disconnected';
    }
  }

  async checkBotStatus() {
    try {
      await this.bot.telegram.getMe();
      return 'connected';
    } catch (error) {
      return 'disconnected';
    }
  }

  async getChannelsCount() {
    const result = await this.services.db.get(
      'SELECT COUNT(*) as count FROM channels WHERE is_active = 1'
    );
    return result ? result.count : 0;
  }

  async getTokensCount() {
    const result = await this.services.db.get(
      'SELECT COUNT(*) as count FROM tracked_tokens WHERE is_active = 1'
    );
    return result ? result.count : 0;
  }

  async getTrendingCount() {
    const trending = await this.services.trending.getTrendingTokens();
    return trending.length;
  }

  async getMetrics() {
    return {
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      stats: await this.getSystemStatus()
    };
  }
}


if (require.main === module) {
  const mintyRushBot = new MintyRushBot();
  mintyRushBot.initialize().catch(error => {
    console.error('Failed to start bot:', error);
    process.exit(1);
  });
}

module.exports = MintyRushBot;