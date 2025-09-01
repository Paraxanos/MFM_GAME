const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Serve static files
app.use(express.static('public'));

// Simple in-memory game store
const games = new Map();

// Socket connection
io.on('connection', (socket) => {
  console.log('Connected:', socket.id);

  // Join game
  socket.on('join', ({ gameId, name }) => {
    // Create game if doesn't exist
    if (!games.has(gameId)) {
      games.set(gameId, {
        gameId,
        players: [],
        messages: [`Game ${gameId} created!`]
      });
    }

    const game = games.get(gameId);
    
    // Remove player if already in game
    game.players = game.players.filter(p => p.id !== socket.id);
    
    // Add player
    const player = { id: socket.id, name, connected: true };
    game.players.push(player);
    socket.join(gameId);
    
    // Update game messages
    game.messages.push(`${name} joined the game`);
    
    // Send game state to all players
    io.to(gameId).emit('update', game);
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    for (const [gameId, game] of games.entries()) {
      const playerIndex = game.players.findIndex(p => p.id === socket.id);
      if (playerIndex !== -1) {
        const playerName = game.players[playerIndex].name;
        game.players.splice(playerIndex, 1);
        game.messages.push(`${playerName} disconnected`);
        io.to(gameId).emit('update', game);
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});