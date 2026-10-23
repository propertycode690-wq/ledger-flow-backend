    import app from './app.js';
    import prisma, { testDatabaseConnection } from './config/db.js';

    const PORT = process.env.PORT || 5000;

    const server = app.listen(PORT, async () => {
      console.log('====================================================');
      console.log(`🚀 LedgerFlow Backend running on http://localhost:${PORT}`);
      console.log(`📡 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🩺 Health check: http://localhost:${PORT}/api/health`);
      console.log(`🗄️  DB Health check: http://localhost:${PORT}/api/db-health`);
      console.log('====================================================');

      // Verify database connection at startup
      console.log('Testing connection to XAMPP MySQL (ledgerflow_db)...');
      const dbStatus = await testDatabaseConnection();
      if (dbStatus.connected) {
        console.log(`✅ MySQL connected successfully (${dbStatus.latencyMs}ms)`);
      } else {
        console.warn(`⚠️ MySQL connection check failed: ${dbStatus.error}`);
        console.warn('Please ensure Apache & MySQL are running in your XAMPP Control Panel.');
      }
    });

    // Graceful Shutdown
    const handleShutdown = async (signal) => {
      console.log(`\nReceived ${signal}. Gracefully shutting down LedgerFlow backend...`);
      server.close(async () => {
        try {
          await prisma.$disconnect();
          console.log('Disconnected Prisma from MySQL.');
        } catch (err) {
          console.error('Error disconnecting Prisma:', err);
        }
        process.exit(0);
      });
    };

    process.on('SIGINT', () => handleShutdown('SIGINT'));
    process.on('SIGTERM', () => handleShutdown('SIGTERM'));
