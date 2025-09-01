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
  console.log('New connection:', socket.id);

  socket.on('join', (data) => {
    console.log('JOIN:', data);
    
    // Create game if doesn't exist
    if (!games.has(data.gameId)) {
      games.set(data.gameId, {
        gameId: data.gameId,
        players: [],
        phase: 'Lobby',
        messages: [`Game ${data.gameId} created!`],
        nightActions: {},
        votes: {}
      });
    }

    const game = games.get(data.gameId);
    
    // Remove player if already in game
    game.players = game.players.filter(p => p.id !== socket.id);
    
    // Add player
    const player = { 
      id: socket.id, 
      name: data.name,
      connected: true,
      alive: true,
      role: null,
      isMayor: false
    };
    game.players.push(player);
    socket.join(data.gameId);
    
    // Update game messages
    game.messages.push(`${data.name} joined the game`);
    
    // Send game state to all players
    io.to(data.gameId).emit('update', game);
  });

  // Start game
  socket.on('startGame', (gameId) => {
    console.log('START GAME:', gameId);
    const game = games.get(gameId);
    if (game && game.players.length >= 4 && game.phase === 'Lobby') {
      // Assign roles
      const roles = ['Mafia', 'Sheriff', 'Doctor', 'Mayor'];
      const civilians = Array(game.players.length - 4).fill('Civilian');
      const allRoles = [...roles, ...civilians].sort(() => Math.random() - 0.5);
      
      // Assign roles to players
      game.players.forEach((player, index) => {
        player.role = allRoles[index];
        player.isMayor = player.role === 'Mayor';
      });

      // Start night phase
      game.phase = 'Night - Mafia';
      game.messages.push('Game started! Night phase begins...');
      game.messages.push('Mafia, choose your victim...');
      
      // Send role info to each player
      game.players.forEach(player => {
        io.to(player.id).emit('role', {
          role: player.role,
          isMayor: player.isMayor
        });
      });
      
      // Update all players
      io.to(gameId).emit('update', game);
    }
  });

  // Mafia action
  socket.on('mafiaAction', ({ gameId, targetId }) => {
    console.log('MAFIA ACTION:', gameId, targetId);
    const game = games.get(gameId);
    if (game && game.phase === 'Night - Mafia') {
      const target = game.players.find(p => p.id === targetId);
      game.messages.push(`Mafia has chosen to eliminate ${target?.name}`);
      game.phase = 'Day - Voting';
      io.to(gameId).emit('update', game);
    }
  });

  // Voting
  socket.on('vote', ({ gameId, targetId }) => {
    console.log('VOTE:', gameId, targetId);
    const game = games.get(gameId);
    if (game && game.phase === 'Day - Voting') {
      const voter = game.players.find(p => p.id === socket.id);
      const target = game.players.find(p => p.id === targetId);
      game.messages.push(`${voter?.name} voted for ${target?.name}`);
      
      // Count votes
      if (!game.votes[targetId]) {
        game.votes[targetId] = 0;
      }
      game.votes[targetId]++;
      
      // Check if all players have voted
      const totalVotes = Object.values(game.votes).reduce((a, b) => a + b, 0);
      const requiredVotes = game.players.filter(p => p.alive).length;
      
      if (totalVotes === requiredVotes) {
        // Find player with most votes
        const maxVotes = Math.max(...Object.values(game.votes));
        const eliminatedPlayerId = Object.keys(game.votes).find(id => game.votes[id] === maxVotes);
        const eliminatedPlayer = game.players.find(p => p.id === eliminatedPlayerId);
        
        // Eliminate player
        eliminatedPlayer.alive = false;
        game.messages.push(`${eliminatedPlayer.name} was eliminated by vote!`);
        
        // Check win conditions
        const alivePlayers = game.players.filter(p => p.alive);
        const mafiaCount = alivePlayers.filter(p => p.role === 'Mafia').length;
        
        if (mafiaCount === 0) {
          game.messages.push('🎉 Civilians win! All mafias have been eliminated!');
          game.phase = 'GameOver';
        } else if (mafiaCount >= alivePlayers.length - mafiaCount) {
          game.messages.push('💀 Mafia wins! They now equal or outnumber the innocents!');
          game.phase = 'GameOver';
        } else {
          // Next night
          game.phase = 'Night - Mafia';
          game.messages.push('Night phase begins...');
          game.votes = {};
        }
        
        io.to(gameId).emit('update', game);
      } else {
        io.to(gameId).emit('update', game);
      }
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('DISCONNECT:', socket.id);
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