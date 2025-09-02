const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Serve static files
app.use(express.static('public'));

// In-memory store for games
const games = new Map();

// Handle Socket.IO connections
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  // Join a game
  socket.on('joinGame', ({ gameId, playerName }) => {
    try {
      // Initialize game if it doesn't exist
      if (!games.has(gameId)) {
        games.set(gameId, {
          id: gameId,
          players: [],
          gameState: 'lobby',
          currentPhase: 'lobby',
          nightActions: {},
          votes: {},
          gameLog: [`Game created! ID: ${gameId}`],
          winner: null,
          nightResults: []
        });
      }

      const game = games.get(gameId);
      
      // Remove player if already in game
      game.players = game.players.filter(p => p.socketId !== socket.id);
      
      // Add player to game
      const player = {
        id: socket.id,
        socketId: socket.id,
        name: playerName,
        alive: true,
        role: null,
        isMayor: false,
        ready: false
      };

      game.players.push(player);
      socket.join(gameId);
      
      // Add join message
      game.gameLog.push(`${playerName} joined the game`);
      
      // Emit updated game state to all players in the game
      io.to(gameId).emit('gameUpdate', game);
      
    } catch (error) {
      console.error('Error in joinGame:', error);
    }
  });

  // Start the game
  socket.on('startGame', (gameId) => {
    try {
      const game = games.get(gameId);
      if (game && game.players.length >= 5 && game.gameState === 'lobby') {
        // Assign roles - 2 Mafias, 1 Sheriff, 1 Doctor, 1 Mayor, rest Civilians
        const rolePool = ['Mafia', 'Mafia', 'Sheriff', 'Doctor', 'Mayor'];
        const civilianCount = Math.max(0, game.players.length - 5);
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
        game.nightActions = {
          mafiaTargets: [],
          sheriffTarget: null,
          sheriffShoot: false,
          doctorTarget: null
        };
        game.votes = {};
        game.nightResults = [];
        game.gameLog = [...game.gameLog, 'Game started! Night phase begins...'];
        game.winner = null;
        
        // Notify all players
        io.to(gameId).emit('gameUpdate', game);
        
        // Send role info to each player
        game.players.forEach(player => {
          io.to(player.socketId).emit('roleUpdate', {
            role: player.role,
            isMayor: player.isMayor
          });
        });
        
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
        // Add target to mafia targets
        if (targetId && !game.nightActions.mafiaTargets.includes(targetId)) {
          game.nightActions.mafiaTargets.push(targetId);
        }
        
        // Check if both mafias have acted
        const mafiaPlayers = game.players.filter(p => p.role === 'Mafia' && p.alive);
        const actingMafias = new Set();
        game.nightActions.mafiaTargets.forEach(targetId => {
          const voter = game.players.find(p => p.id === targetId);
          if (voter && voter.role === 'Mafia') {
            actingMafias.add(voter.id);
          }
        });
        
        // If all mafias have acted, move to next phase
        if (actingMafias.size >= mafiaPlayers.length) {
          game.currentPhase = 'sheriff';
        }
        
        // Update game state
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
        
        io.to(gameId).emit('gameUpdate', game);
      }
    } catch (error) {
      console.error('Error in doctorAction:', error);
    }
  });

  // Skip to voting
  socket.on('skipToVoting', (gameId) => {
    try {
      const game = games.get(gameId);
      if (game && game.gameState === 'night') {
        // Clear any previous night results
        game.nightResults = [];
        
        // Add a message about skipping
        game.nightResults.push('🌙 Night actions were skipped.');
        
        game.currentPhase = 'voting';
        game.gameLog.push('Night actions skipped. Voting begins!');
        io.to(gameId).emit('gameUpdate', game);
      }
    } catch (error) {
      console.error('Error in skipToVoting:', error);
    }
  });

  // Skip voting
  socket.on('skipVoting', (gameId) => {
    try {
      const game = games.get(gameId);
      if (game && game.currentPhase === 'voting') {
        // Process votes even if skipped
        processVoting(gameId);
      }
    } catch (error) {
      console.error('Error in skipVoting:', error);
    }
  });

  // Voting
  socket.on('vote', ({ gameId, voterId, targetId }) => {
    try {
      const game = games.get(gameId);
      if (game && game.currentPhase === 'voting') {
        game.votes[voterId] = targetId;
        
        // Check if all alive players have voted
        const alivePlayers = game.players.filter(p => p.alive);
        const votesReceived = Object.keys(game.votes).length;
        
        if (votesReceived === alivePlayers.length) {
          processVoting(gameId);
        } else {
          io.to(gameId).emit('gameUpdate', game);
        }
      }
    } catch (error) {
      console.error('Error in vote:', error);
    }
  });

  // Process voting results
  function processVoting(gameId) {
    const game = games.get(gameId);
    if (!game || game.currentPhase !== 'voting') return;

    // Count votes (mayor's vote counts as 2)
    const voteCounts = {};
    Object.entries(game.votes).forEach(([voterId, targetId]) => {
      const voter = game.players.find(p => p.socketId === voterId);
      if (voter && voter.alive) {
        const voteWeight = voter.isMayor ? 2 : 1;
        voteCounts[targetId] = (voteCounts[targetId] || 0) + voteWeight;
      }
    });

    // Find player with most votes
    let maxVotes = 0;
    let eliminatedId = null;
    
    Object.entries(voteCounts).forEach(([playerId, voteCount]) => {
      if (voteCount > maxVotes) {
        maxVotes = voteCount;
        eliminatedId = parseInt(playerId);
      }
    });

    let eliminationMessage = '';
    if (eliminatedId !== null) {
      const eliminatedPlayer = game.players.find(p => p.id === eliminatedId);
      if (eliminatedPlayer && eliminatedPlayer.alive) {
        eliminatedPlayer.alive = false;
        eliminationMessage = `🗳️ ${eliminatedPlayer.name} was eliminated by vote!`;
      }
    } else {
      eliminationMessage = '🗳️ No one was eliminated - tied vote!';
    }

    // Update game log
    game.gameLog.push(eliminationMessage);
    
    // Check win conditions
    const alivePlayers = game.players.filter(p => p.alive);
    const aliveMafias = alivePlayers.filter(p => p.role === 'Mafia').length;
    const aliveInnocents = alivePlayers.length - aliveMafias;

    if (aliveMafias === 0) {
      game.winner = 'Civilians';
      game.gameState = 'gameOver';
      game.gameLog.push('🎉 Civilians win! All mafias have been eliminated!');
    } else if (aliveMafias >= aliveInnocents) {
      game.winner = 'Mafia';
      game.gameState = 'gameOver';
      game.gameLog.push('💀 Mafia wins! They now equal or outnumber the innocents!');
    } else {
      // Continue to next night
      game.gameState = 'night';
      game.currentPhase = 'mafia';
      game.nightActions = {
        mafiaTargets: [],
        sheriffTarget: null,
        sheriffShoot: false,
        doctorTarget: null
      };
      game.votes = {};
      game.nightResults = [];
      game.gameLog.push('🌙 Night phase begins...');
    }

    // Update all players
    io.to(gameId).emit('gameUpdate', game);
  }

  // Process night actions and reveal results
  socket.on('processNight', (gameId) => {
    try {
      const game = games.get(gameId);
      if (game && game.currentPhase === 'results') {
        // Clear previous night results
        game.nightResults = [];
        let anyAction = false;

        // Apply night actions and build results
        const updatedPlayers = [...game.players];
        
        // Mafia kills - handle multiple mafias
        if (game.nightActions.mafiaTargets && game.nightActions.mafiaTargets.length > 0) {
          // Get unique targets (in case multiple mafias target the same person)
          const uniqueTargets = [...new Set(game.nightActions.mafiaTargets)];
          
          uniqueTargets.forEach(targetId => {
            const target = updatedPlayers.find(p => p.id === targetId);
            if (target && target.alive) {
              game.nightResults.push(`🔪 Mafia attempted to kill ${target.name}`);
              anyAction = true;
            }
          });
        }

        // Sheriff shoot
        if (game.nightActions.sheriffShoot && game.nightActions.sheriffTarget !== null && game.nightActions.sheriffTarget !== undefined) {
          const target = updatedPlayers.find(p => p.id === game.nightActions.sheriffTarget);
          const sheriff = updatedPlayers.find(p => p.role === 'Sheriff' && p.alive);
          
          if (target && target.alive) {
            if (target.role === 'Mafia') {
              game.nightResults.push(`🎯 Sheriff shot ${target.name} - Correct!`);
              anyAction = true;
            } else {
              // Sheriff dies for shooting innocent
              if (sheriff) sheriff.alive = false;
              target.alive = false; // Target also dies
              game.nightResults.push(`💥 Sheriff shot ${target.name} - Wrong! Sheriff dies too!`);
              anyAction = true;
            }
          }
        }

        // Doctor revive
        if (game.nightActions.doctorTarget !== null && game.nightActions.doctorTarget !== undefined) {
          const target = updatedPlayers.find(p => p.id === game.nightActions.doctorTarget);
          if (target && !target.alive) {
            target.alive = true;
            game.nightResults.push(`🏥 Doctor revived ${target.name}`);
            anyAction = true;
          }
        }

        // If no actions were performed, add a message
        if (!anyAction) {
          game.nightResults.push('🌙 No actions were performed during the night.');
        }

        // Update players
        game.players = updatedPlayers;
        
        // Check win conditions
        const alivePlayers = game.players.filter(p => p.alive);
        const aliveMafias = alivePlayers.filter(p => p.role === 'Mafia').length;
        const aliveInnocents = alivePlayers.length - aliveMafias;

        if (aliveMafias === 0) {
          game.winner = 'Civilians';
          game.gameState = 'gameOver';
          game.gameLog.push('🎉 Civilians win! All mafias have been eliminated!');
        } else if (aliveMafias >= aliveInnocents) {
          game.winner = 'Mafia';
          game.gameState = 'gameOver';
          game.gameLog.push('💀 Mafia wins! They now equal or outnumber the innocents!');
        } else {
          // Move to voting phase
          game.gameState = 'discussion';
          game.currentPhase = 'voting';
          game.votes = {};
          game.gameLog.push('☀️ Day phase begins! Discussion time!');
        }

        // Update all players
        io.to(gameId).emit('gameUpdate', game);
      }
    } catch (error) {
      console.error('Error in processNight:', error);
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    
    // Remove player from all games
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