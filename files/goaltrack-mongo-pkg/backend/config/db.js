// config/db.js — Mongoose connection with optional in-memory fallback for local dev

const mongoose = require('mongoose');
require('dotenv').config();

let memoryServer = null;

/**
 * Connect to MongoDB. Uses MONGO_URI from .env when available.
 * If connection fails in development, starts an embedded MongoDB (mongodb-memory-server).
 */
async function connectDB() {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  const preferMemory =
    process.env.USE_MEMORY_DB === 'true' || process.env.USE_MEMORY_DB === '1';

  let uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/goaltrack';

  if (preferMemory) {
    uri = await startMemoryServer();
  }

  try {
    const conn = await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 10000,
    });
    logConnected(conn);
    return conn;
  } catch (err) {
    if (preferMemory || process.env.NODE_ENV === 'production') {
      console.error(`[DB] Connection failed: ${err.message}`);
      process.exit(1);
    }

    console.warn(`[DB] Could not reach ${uri}`);
    console.warn('[DB] Starting in-memory MongoDB for local development...');
    uri = await startMemoryServer();
    const conn = await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
    logConnected(conn);
    return conn;
  }
}

async function startMemoryServer() {
  const { MongoMemoryServer } = require('mongodb-memory-server');
  if (!memoryServer) {
    memoryServer = await MongoMemoryServer.create();
  }
  const uri = memoryServer.getUri('goaltrack');
  console.log('[DB] In-memory MongoDB URI ready');
  return uri;
}

function logConnected(conn) {
  console.log(`[DB] MongoDB connected → ${conn.connection.host}`);
  console.log(`[DB] Database: ${conn.connection.name}`);
}

async function disconnectDB() {
  await mongoose.connection.close();
  if (memoryServer) {
    await memoryServer.stop();
    memoryServer = null;
  }
}

process.on('SIGINT', async () => {
  await disconnectDB();
  console.log('[DB] MongoDB disconnected (app shutdown)');
  process.exit(0);
});

module.exports = connectDB;
module.exports.disconnectDB = disconnectDB;
