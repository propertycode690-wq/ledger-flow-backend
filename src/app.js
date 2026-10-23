import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import healthRoutes from './routes/health.routes.js';
import authRoutes from './routes/auth.routes.js';
import customerRoutes from './routes/customer.routes.js';
import productRoutes from './routes/product.routes.js';
import vanRoutes from './routes/van.routes.js';
import invoiceRoutes from './routes/invoice.routes.js';
import paymentRoutes from './routes/payment.routes.js';
import orderRoutes from './routes/order.routes.js';
import mileageRoutes from './routes/mileage.routes.js';
import purchaseRoutes from './routes/purchase.routes.js';
import settingsRoutes from './routes/settings.routes.js';
import transactionRoutes from './routes/transaction.routes.js';

dotenv.config();

const app = express();

// Middleware
const configuredOrigins = (process.env.FRONTEND_URL || '')
  .split(',')
  .map((o) => o.trim().replace(/\/+$/, ''))
  .filter(Boolean);

const defaultDevOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
];

const allowedOrigins = Array.from(new Set([...configuredOrigins, ...defaultDevOrigins]));

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (such as mobile apps, curl, or server-to-server)
      if (!origin) {
        return callback(null, true);
      }
      const cleanOrigin = origin.trim().replace(/\/+$/, '');
      if (allowedOrigins.includes(cleanOrigin)) {
        return callback(null, true);
      }
      if (process.env.NODE_ENV !== 'production') {
        return callback(null, true); // Permissive in development
      }
      return callback(new Error(`Origin '${origin}' not permitted by CORS policy.`));
    },
    credentials: true,
  })
);

app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging in development
if (process.env.NODE_ENV !== 'production') {
  app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
    next();
  });
}

// Routes
app.use('/api', healthRoutes);
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/customers', customerRoutes);
app.use('/api/v1/products', productRoutes);
app.use('/api/v1/vans', vanRoutes);
app.use('/api/v1/invoices', invoiceRoutes);
app.use('/api/v1/payments', paymentRoutes);
app.use('/api/v1/orders', orderRoutes);
app.use('/api/v1/mileage', mileageRoutes);
app.use('/api/v1/purchases', purchaseRoutes);
app.use('/api/v1/settings', settingsRoutes);
app.use('/api/v1/transactions', transactionRoutes);

// Root informational endpoint
app.get('/', (req, res) => {
  res.status(200).json({
    name: 'LedgerFlow Backend API',
    version: '1.4.0',
    phase: 'Phase 5 - Daily Operations & Van Procurement APIs',
    modules: {
      health: ['GET /api/health', 'GET /api/db-health'],
      auth: ['POST /api/v1/auth/login', 'GET /api/v1/auth/me', 'POST /api/v1/auth/logout'],
      customers: [
        'GET /api/v1/customers',
        'GET /api/v1/customers/:id',
        'GET /api/v1/customers/:id/statement',
        'POST /api/v1/customers',
        'PUT /api/v1/customers/:id',
        'DELETE /api/v1/customers/:id',
      ],
      products: ['GET /api/v1/products', 'GET /api/v1/products/:id', 'POST /api/v1/products', 'PUT /api/v1/products/:id', 'DELETE /api/v1/products/:id'],
      vans: ['GET /api/v1/vans', 'GET /api/v1/vans/:id', 'POST /api/v1/vans', 'PUT /api/v1/vans/:id', 'DELETE /api/v1/vans/:id'],
      invoices: [
        'GET /api/v1/invoices',
        'GET /api/v1/invoices/:id',
        'POST /api/v1/invoices',
        'PUT /api/v1/invoices/:id',
        'POST /api/v1/invoices/:id/finalize',
        'POST /api/v1/invoices/:id/void',
        'DELETE /api/v1/invoices/:id',
      ],
      payments: [
        'GET /api/v1/payments',
        'GET /api/v1/payments/:id',
        'POST /api/v1/payments',
        'POST /api/v1/payments/:id/void',
      ],
      orders: [
        'GET /api/v1/orders',
        'GET /api/v1/orders/procurement/aggregation',
        'GET /api/v1/orders/:id',
        'POST /api/v1/orders',
        'PUT /api/v1/orders/:id',
        'POST /api/v1/orders/:id/cancel',
        'DELETE /api/v1/orders/:id',
      ],
      mileage: [
        'GET /api/v1/mileage',
        'GET /api/v1/mileage/:id',
        'POST /api/v1/mileage',
        'PUT /api/v1/mileage/:id',
        'POST /api/v1/mileage/:id/post-expense',
        'DELETE /api/v1/mileage/:id',
        'GET /api/v1/mileage/expenses',
        'POST /api/v1/mileage/expenses',
        'POST /api/v1/mileage/expenses/:id/void',
      ],
    },
  });
});

// 404 Handler
app.use((req, res) => {
  res.status(404).json({
    status: 'error',
    code: 'ROUTE_NOT_FOUND',
    message: `Cannot ${req.method} ${req.originalUrl}`,
  });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(err.status || 500).json({
    status: 'error',
    code: err.code || 'INTERNAL_ERROR',
    message: err.message || 'Internal Server Error',
  });
});

export default app;
