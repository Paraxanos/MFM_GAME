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
        phase: 'Lobby',
        messages: [`Game ${gameId} created!`],
        nightActions: {},
        votes: {}
      });
    }

    const game = games.get(gameId);
    
    // Remove player if already in game
    game.players = game.players.filter(p => p.id !== socket.id);
    
    // Add player
    const player = { 
      id: socket.id, 
      name, 
      connected: true,
      alive: true,
      role: null,
      isMayor: false
    };
    game.players.push(player);
    socket.join(gameId);
    
    // Update game messages
    game.messages.push(`${name} joined the game`);
    
    // Send game state to all players
    io.to(gameId).emit('update', game);
  });

  // Start game
  socket.on('startGame', (gameId) => {
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

  // Start voting
  socket.on('startVoting', (gameId) => {
    const game = games.get(gameId);
    if (game && game.phase === 'Day - Discussion') {
      game.phase = 'Day - Voting';
      game.messages.push('Discussion ended. Voting begins!');
      io.to(gameId).emit('update', game);
    }
  });

  // Mafia action
  socket.on('mafiaAction', ({ gameId, targetId }) => {
    const game = games.get(gameId);
    if (game && game.phase === 'Night - Mafia') {
      game.nightActions.mafiaTarget = targetId;
      game.phase = 'Night - Sheriff';
      const target = game.players.find(p => p.id === targetId);
      game.messages.push(`Mafia has chosen to eliminate ${target?.name}`);
      io.to(gameId).emit('update', game);
    }
  });

  // Sheriff action
  socket.on('sheriffAction', ({ gameId, targetId, shoot }) => {
    const game = games.get(gameId);
    if (game && game.phase === 'Night - Sheriff') {
      game.nightActions.sheriffTarget = targetId;
      game.nightActions.sheriffShoot = shoot;
      game.phase = 'Night - Doctor';
      const target = game.players.find(p => p.id === targetId);
      game.messages.push(`${shoot ? 'Sheriff will shoot' : 'Sheriff investigated'} ${target?.name}`);
      io.to(gameId).emit('update', game);
    }
  });

  // Doctor action
  socket.on('doctorAction', ({ gameId, targetId }) => {
    const game = games.get(gameId);
    if (game && game.phase === 'Night - Doctor') {
      game.nightActions.doctorTarget = targetId;
      game.phase = 'Day - Discussion';
      const target = game.players.find(p => p.id === targetId);
      game.messages.push(`Doctor will heal ${target?.name}`);
      game.messages.push('Night ends. Day begins!');
      io.to(gameId).emit('update', game);
    }
  });

  // Voting
  socket.on('vote', ({ gameId, targetId }) => {
    const game = games.get(gameId);
    if (game && game.phase === 'Day - Voting') {
      // Find the voter
      const voter = game.players.find(p => p.id === socket.id);
      if (voter && voter.alive) {
        game.votes[voter.id] = targetId;
        const target = game.players.find(p => p.id === targetId);
        game.messages.push(`${voter.name} voted for ${target?.name}`);
        io.to(gameId).emit('update', game);
      }
    }
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