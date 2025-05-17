import 'dotenv/config';
import http from 'http';
import app from './app.js';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import projectModel from './models/project.model.js';
import { generateResult } from './services/ai.service.js';

const port = process.env.PORT || 3000;

console.log('[1] Creating HTTP server');
const server = http.createServer(app);

console.log('[2] Setting up Socket.IO');
const io = new Server(server, {
  cors: {
    origin: '*',
  },
});

console.log('[3] Attaching Socket.IO middleware');
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token || socket.handshake.headers.authorization?.split(' ')[1];
    const projectId = socket.handshake.query.projectId;

    console.log('[4] Handshake received - projectId:', projectId);

    if (!mongoose.Types.ObjectId.isValid(projectId)) {
      console.log('[5] Invalid project ID');
      return next(new Error('Invalid projectId'));
    }

    console.log('[6] Fetching project from DB...');
    socket.project = await projectModel.findById(projectId);
    console.log('[7] Project loaded:', socket.project ? socket.project._id : null);

    if (!token) {
      console.log('[8] No token provided');
      return next(new Error('Authentication error'));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!decoded) {
      console.log('[9] Token verification failed');
      return next(new Error('Authentication error'));
    }

    socket.user = decoded;

    console.log('[10] Socket authenticated');
    next();

  } catch (error) {
    console.error('[!] Socket.IO middleware error:', error);
    next(error);
  }
});

console.log('[11] Setting up connection handler');
io.on('connection', (socket) => {
  console.log('[12] New socket connected, room:', socket.project?._id.toString());

  socket.roomId = socket.project._id.toString();
  socket.join(socket.roomId);

  socket.on('project-message', async (data) => {
    const message = data.message;
    const aiIsPresentInMessage = message.includes('@ai');

    socket.broadcast.to(socket.roomId).emit('project-message', data);

    if (aiIsPresentInMessage) {
      const prompt = message.replace('@ai', '').trim();
      console.log('[13] AI prompt detected:', prompt);

      try {
        const result = await generateResult(prompt);

        io.to(socket.roomId).emit('project-message', {
          message: result,
          sender: { _id: 'ai', email: 'AI' },
        });

        console.log('[14] AI response sent');
      } catch (err) {
        console.error('[!] AI generateResult error:', err);
        io.to(socket.roomId).emit('project-message', {
          message: '⚠️ AI failed to respond.',
          sender: { _id: 'ai', email: 'AI' },
        });
      }
    }
  });

  socket.on('disconnect', () => {
    console.log('[15] User disconnected from room:', socket.roomId);
    socket.leave(socket.roomId);
  });
});

console.log('[16] About to start server...');
server.listen(port, () => {
  console.log(`🚀 Server is running on port ${port}`);
});

// Global error handlers for debugging
process.on('unhandledRejection', (err) => {
  console.error('UNHANDLED REJECTION 🔥', err);
});

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION 🔥', err);
});
