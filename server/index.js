/**
 * Rey de la Chelada — Express Server Entry Point
 * 
 * RESTAURANT profile — Windows Self-Hosted
 * Offline-first PWA with KDS, QR payments, thermal printing
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3001;

// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', app: 'Rey de la Chelada', version: '1.0.0' });
});

// API routes will be registered here
// app.use('/api/salon', salonRoutes);
// app.use('/api/orders', orderRoutes);
// app.use('/api/menu', menuRoutes);
// app.use('/api/payments', paymentRoutes);
// app.use('/api/inventory', inventoryRoutes);
// app.use('/api/staff', staffRoutes);
// app.use('/api/reports', reportRoutes);
// app.use('/api/sync', syncRoutes);

// WebSocket for KDS real-time updates
wss.on('connection', (ws) => {
  console.log('KDS client connected');
  ws.on('message', (message) => {
    // Broadcast to all KDS clients
    wss.clients.forEach((client) => {
      if (client !== ws && client.readyState === 1) {
        client.send(message);
      }
    });
  });
});

server.listen(PORT, () => {
  console.log(`👑 Rey de la Chelada running on http://localhost:${PORT}`);
  console.log(`🍺 Donde las mejores historias comienzan con una chelada.`);
});
