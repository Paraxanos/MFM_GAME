const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Serve static files from public directory
app.use(express.static('public'));

// In-memory store for games
const games = new Map();

// Handle Socket.IO connections
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  // Join a game
  socket.on('joinGame', ({ gameId, playerName, socketId }) => {
    try {
      // Initialize game if it doesn't exist
      if (!games.has(gameId)) {
        games.set(gameId, {
          id: gameId,
          players: [],
          gameState: 'lobby',
          currentPhase: '',
          nightActions: {},
          votes: {},
          gameLog: [`Game created! Share ID: ${gameId}`],
          winner: null
        });
      }

      const game = games.get(gameId);
      
      // Check if player already exists
      const existingPlayer = game.players.find(p => p.socketId === socketId);
      if (existingPlayer) {
        // Update existing player
        existingPlayer.name = playerName;
        socket.join(gameId);
        io.to(gameId).emit('gameUpdate', game);
        return;
      }

      // Add new player
      const player = {
        id: socket.id,
        name: playerName,
        socketId: socketId,
        alive: true,
        ready: false,
        role: null,
        isMayor: false
      };

      game.players.push(player);
      socket.join(gameId);
      
      // Add join message
      game.gameLog.push(`${playerName} joined the game`);
      
      // Emit updated game state to all players in the game
      io.to(gameId).emit('gameUpdate', game);
      
      console.log(`Player ${playerName} joined game ${gameId}`);
    } catch (error) {
      console.error('Error in joinGame:', error);
    }
  });

  // Start the game
  socket.on('startGame', (gameId) => {
    try {
      const game = games.get(gameId);
      if (game && game.players.length >= 4 && game.gameState === 'lobby') {
        // Assign roles
        const rolePool = ['Mafia', 'Sheriff', 'Doctor', 'Mayor'];
        const civilianCount = Math.max(0, game.players.length - 4);
        const civilians = Array(civilianCount).fill('Civilian');
        const allRoles = [...rolePool, ...civilians].sort(() => Math.random() - 0.5);
        
        // Assign roles to players
        game.players.forEach((player, index) => {
          player.role = allRoles[index];
          player.isMayor = player.role === 'Mayor';
        });

        // Initialize game state
        game.gameState = 'night';
        game.currentPhase = 'mafia';
        game.nightActions = {};
        game.votes = {};
        game.gameLog.push('Game started! Night phase begins...');
        game.winner = null;
        
        // Notify all players
        io.to(gameId).emit('gameUpdate', game);
        
        console.log(`Game ${gameId} started with ${game.players.length} players`);
      }
    } catch (error) {
      console.error('Error in startGame:', error);
    }
  });

  // Mafia action
  socket.on('mafiaAction', ({ gameId, targetId }) => {
    try {
      const game = games.get(gameId);
      if (game && game.currentPhase === 'mafia') {
        game.nightActions.mafiaTarget = targetId;
        game.currentPhase = 'sheriff';
        const target = game.players.find(p => p.id === targetId);
        game.gameLog.push(`Mafia has chosen to eliminate ${target?.name}`);
        
        io.to(gameId).emit('gameUpdate', game);
      }
    } catch (error) {
      console.error('Error in mafiaAction:', error);
    }
  });

  // Sheriff action
  socket.on('sheriffAction', ({ gameId, targetId, shoot }) => {
    try {
      const game = games.get(gameId);
      if (game && game.currentPhase === 'sheriff') {
        game.nightActions.sheriffTarget = targetId;
        game.nightActions.sheriffShoot = shoot;
        game.currentPhase = 'doctor';
        const target = game.players.find(p => p.id === targetId);
        game.gameLog.push(`${shoot ? 'Sheriff will shoot' : 'Sheriff investigated'} ${target?.name}`);
        
        io.to(gameId).emit('gameUpdate', game);
      }
    } catch (error) {
      console.error('Error in sheriffAction:', error);
    }
  });

  // Doctor action
  socket.on('doctorAction', ({ gameId, targetId }) => {
    try {
      const game = games.get(gameId);
      if (game && game.currentPhase === 'doctor') {
        game.nightActions.doctorTarget = targetId;
        game.currentPhase = 'results';
        const target = game.players.find(p => p.id === targetId);
        game.gameLog.push(`Doctor will heal ${target?.name}`);
        
        io.to(gameId).emit('gameUpdate', game);
      }
    } catch (error) {
      console.error('Error in doctorAction:', error);
    }
  });

  // Voting
  socket.on('vote', ({ gameId, voterId, targetId }) => {
    try {
      const game = games.get(gameId);
      if (game && game.gameState === 'voting') {
        game.votes[voterId] = targetId;
        
        const voter = game.players.find(p => p.socketId === voterId);
        const target = game.players.find(p => p.id === targetId);
        game.gameLog.push(`${voter?.name} voted for ${target?.name}`);
        
        io.to(gameId).emit('gameUpdate', game);
      }
    } catch (error) {
      console.error('Error in vote:', error);
    }
  });

  // Process voting
  socket.on('processVoting', (gameId) => {
    try {
      const game = games.get(gameId);
      if (game && game.gameState === 'discussion') {
        game.gameState = 'voting';
        game.gameLog.push('Voting phase begins!');
        io.to(gameId).emit('gameUpdate', game);
      }
    } catch (error) {
      console.error('Error in processVoting:', error);
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    
    // Remove player from games
    for (const [gameId, game] of games.entries()) {
      const playerIndex = game.players.findIndex(p => p.id === socket.id);
      if (playerIndex !== -1) {
        const playerName = game.players[playerIndex].name;
        game.players.splice(playerIndex, 1);
        game.gameLog.push(`${playerName} disconnected`);
        io.to(gameId).emit('gameUpdate', game);
        
        // Remove game if empty
        if (game.players.length === 0) {
          games.delete(gameId);
        }
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});