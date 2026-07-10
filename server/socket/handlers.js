import crypto from 'crypto';
import { GameEngine } from '../game/GameEngine.js';
import { GameValidator } from '../game/GameValidator.js';

/**
 * Map to store active games by room code.
 * @type {Map<string, GameEngine>}
 */
const activeGames = new Map();

/**
 * Map to store session data for reconnections.
 * @type {Map<string, {roomCode: string, playerId: string}>}
 */
const sessionMap = new Map();

/**
 * Map to store rate limiting data per socket.
 * @type {Map<string, Object>}
 */
const rateLimits = new Map();

/**
 * Check if a socket is rate limited for a specific action.
 * Max 5 requests per 2 seconds.
 * @param {string} socketId
 * @param {string} action
 * @returns {boolean}
 */
function isRateLimited(socketId, action) {
  if (!rateLimits.has(socketId)) rateLimits.set(socketId, {});
  const limits = rateLimits.get(socketId);
  const now = Date.now();
  
  if (!limits[action]) limits[action] = [];
  limits[action] = limits[action].filter(time => now - time < 2000);
  
  if (limits[action].length >= 5) return true;
  
  limits[action].push(now);
  return false;
}

/**
 * Generate a unique 6-digit numeric room code.
 * @returns {string}
 */
function generateRoomCode() {
  let code;
  do {
    code = '';
    for (let i = 0; i < 6; i++) {
      code += Math.floor(Math.random() * 10);
    }
  } while (activeGames.has(code));
  return code;
}

/**
 * Generate a unique player ID.
 * @returns {string}
 */
function generatePlayerId() {
  return crypto.randomUUID();
}

/**
 * Check if a player name is already taken in a game.
 * @param {GameEngine} engine
 * @param {string} name
 * @param {string} [excludeId]
 * @returns {boolean}
 */
function isNameTaken(engine, name, excludeId) {
  const normalized = name.trim().toLowerCase();
  for (const player of engine.store.players.values()) {
    if (player.id === excludeId) continue;
    if (player.name.trim().toLowerCase() === normalized) {
      return true;
    }
  }
  return false;
}

/**
 * Register all socket event handlers.
 * @param {import('socket.io').Server} io
 */
export function registerHandlers(io) {
  io.on('connection', (socket) => {
    console.log(`[Socket] Connected: ${socket.id}`);

    const sessionId = socket.handshake.auth.sessionId;
    let currentRoom = null;
    let currentPlayerId = null;

    if (sessionId && sessionMap.has(sessionId)) {
      const session = sessionMap.get(sessionId);
      const engine = activeGames.get(session.roomCode);
      
      if (engine && engine.store.players.has(session.playerId)) {
        currentRoom = session.roomCode;
        currentPlayerId = session.playerId;
        socket.join(currentRoom);
        
        const player = engine.store.players.get(currentPlayerId);
        player.socketId = socket.id;
        player.status = 'online';
        
        console.log(`[Socket] Reconnected session: ${sessionId} to room ${currentRoom}`);
        
        // Resend current state based on phase
        if (engine.store.state === 'lobby') {
          socket.emit('lobby:joined', {
            roomCode: currentRoom,
            playerId: currentPlayerId,
            players: engine.store.getPublicPlayers(),
            hostId: engine.store.hostId,
            playerCount: engine.store.players.size,
          });
          io.to(currentRoom).emit('lobby:playerUpdate', {
            players: engine.store.getPublicPlayers(),
            hostId: engine.store.hostId,
            playerCount: engine.store.players.size,
          });
        } else {
          // Rejoin ongoing game
          socket.emit('game:started', { gameState: engine.store.getPublicState(currentPlayerId) });
          // If we are in night phase, we might need to resend their night action
          if (engine.store.state === 'night') {
             // Resend night action state for reconnecting player
             engine.sendNightActionToPlayer(currentPlayerId);
          } else if (engine.store.state === 'voting') {
             socket.emit('phase:voting', {
               players: engine.store.getPublicPlayers(),
               phase: engine.store.getPhaseState(engine.phases.duration),
               votableTargets: engine.store.votableTargets
             });
             socket.emit('vote:update', {
               votes: engine.phaseManager.getVoteSummary(),
               totalVoters: engine.phaseManager.getTotalVoters()
             });
          }
          
          io.to(currentRoom).emit('lobby:notification', {
            type: 'join',
            message: `${player.name} reconnected.`,
            playerName: player.name,
          });
        }
      }
    }

    /**
     * Get the engine for the current room.
     * @returns {GameEngine|null}
     */
    const getEngine = () => {
      if (!currentRoom) return null;
      return activeGames.get(currentRoom) || null;
    };

    // ── Lobby Events ─────────────────────────────────────────────

    /**
     * Create a new game room.
     * Payload: { playerName: string }
     */
    socket.on('lobby:create', ({ playerName } = {}) => {
      const name = (playerName || '').trim();
      const nameVal = GameValidator.validateName(name);
      if (!nameVal.valid) {
        socket.emit('error', { message: nameVal.error });
        return;
      }

      const roomCode = generateRoomCode();
      const engine = new GameEngine(roomCode, io);
      activeGames.set(roomCode, engine);

      const playerId = generatePlayerId();
      currentPlayerId = playerId;
      currentRoom = roomCode;
      if (sessionId) {
        sessionMap.set(sessionId, { roomCode, playerId });
      }

      socket.join(roomCode);

      const result = engine.addPlayer(playerId, name, socket.id);
      if (!result.success) {
        socket.emit('error', { message: result.error });
        activeGames.delete(roomCode);
        return;
      }

      console.log(`[Room] Created: ${roomCode} by ${name}`);

      socket.emit('lobby:joined', {
        roomCode,
        playerId,
        players: engine.store.getPublicPlayers(),
        hostId: engine.store.hostId,
        playerCount: engine.store.players.size,
      });
    });

    /**
     * Join an existing game room.
     * Payload: { roomCode: string, playerName: string }
     */
    socket.on('lobby:join', ({ roomCode, playerName } = {}) => {
      const codeVal = GameValidator.validateRoomCode(roomCode);
      if (!codeVal.valid) {
        socket.emit('error', { message: codeVal.error });
        return;
      }

      const name = (playerName || '').trim();
      const nameVal = GameValidator.validateName(name);
      if (!nameVal.valid) {
        socket.emit('error', { message: nameVal.error });
        return;
      }

      const code = codeVal.clean;
      const engine = activeGames.get(code);

      if (!engine) {
        socket.emit('error', { message: 'Room not found. Check your code and try again.' });
        return;
      }

      if (engine.store.state !== 'lobby') {
        socket.emit('error', { message: 'Game is already in progress.' });
        return;
      }

      if (engine.store.players.size >= 12) {
        socket.emit('error', { message: 'Game is full (max 12 players).' });
        return;
      }

      // Prevent duplicate names
      if (isNameTaken(engine, name)) {
        socket.emit('error', { message: 'That name is already taken. Please choose another.' });
        return;
      }

      const playerId = generatePlayerId();
      currentPlayerId = playerId;
      currentRoom = code;
      if (sessionId) {
        sessionMap.set(sessionId, { roomCode: code, playerId });
      }

      socket.join(code);

      const result = engine.addPlayer(playerId, name, socket.id);
      if (!result.success) {
        socket.emit('error', { message: result.error });
        return;
      }

      console.log(`[Room] Joined: ${code} by ${name}`);

      socket.emit('lobby:joined', {
        roomCode: code,
        playerId,
        players: engine.store.getPublicPlayers(),
        hostId: engine.store.hostId,
        playerCount: engine.store.players.size,
      });

      // Broadcast updated player list and join notification
      io.to(code).emit('lobby:playerUpdate', {
        players: engine.store.getPublicPlayers(),
        hostId: engine.store.hostId,
        playerCount: engine.store.players.size,
      });

      socket.to(code).emit('lobby:notification', {
        type: 'join',
        message: `${name} joined the room.`,
        playerName: name,
      });
    });

    /**
     * Kick a player from the lobby (host only).
     * Payload: { targetId: string }
     */
    socket.on('lobby:kick', ({ targetId } = {}) => {
      const engine = getEngine();
      if (!engine) {
        socket.emit('error', { message: 'Not in a game room.' });
        return;
      }

      const hostVal = GameValidator.validateHost(engine.store, socket.id);
      if (!hostVal.valid) {
        socket.emit('error', { message: hostVal.error });
        return;
      }

      if (targetId === engine.store.hostId) {
        socket.emit('error', { message: 'You cannot kick yourself.' });
        return;
      }

      const target = engine.store.players.get(targetId);
      if (!target) {
        socket.emit('error', { message: 'Player not found.' });
        return;
      }

      const targetName = target.name;
      engine.removePlayer(targetId);

      const targetSocket = io.sockets.sockets.get(target.socketId);
      if (targetSocket) {
        targetSocket.emit('lobby:kicked', {
          message: 'You were removed from the room by the host.',
        });
        targetSocket.leave(currentRoom);
      }

      console.log(`[Room] Kicked: ${targetName} from ${currentRoom}`);

      io.to(currentRoom).emit('lobby:playerUpdate', {
        players: engine.store.getPublicPlayers(),
        hostId: engine.store.hostId,
        playerCount: engine.store.players.size,
      });

      io.to(currentRoom).emit('lobby:notification', {
        type: 'kick',
        message: `${targetName} was removed from the room.`,
        playerName: targetName,
      });
    });

    // ── Game Events ─────────────────────────────────────────────

    /**
     * Start the game (host only).
     */
    socket.on('game:start', () => {
      const engine = getEngine();
      if (!engine) {
        socket.emit('error', { message: 'Not in a game room.' });
        return;
      }

      const result = engine.startGame(socket.id);
      if (!result.success) {
        socket.emit('error', { message: result.error });
      }
    });

    /**
     * Player performs a night action.
     * Payload: { actionType: string, targetId: string }
     */
    socket.on('game:action', async ({ actionType, targetId } = {}) => {
      if (isRateLimited(socket.id, 'action')) return;
      
      const engine = getEngine();
      if (!engine) return;

      const result = await engine.handleNightAction(socket.id, actionType, targetId);
      socket.emit('action:result', result);
    });

    /**
     * Player sends a chat message during the day phase.
     * Payload: { message: string }
     */
    socket.on('chat:send', async ({ message } = {}) => {
      if (isRateLimited(socket.id, 'chat')) {
        socket.emit('error', { message: 'You are sending messages too fast.' });
        return;
      }
      if (!message || message.trim().length === 0) return;

      const engine = getEngine();
      if (!engine) return;

      engine.handleChat(socket.id, message.trim());
    });

    /**
     * Player typing status.
     */
    socket.on('chat:typing', ({ isTyping } = {}) => {
      if (isRateLimited(socket.id, 'typing')) return;
      const engine = getEngine();
      if (!engine) return;
      
      engine.handleTyping(socket.id, !!isTyping);
    });

    socket.on('chat:reaction', ({ emoji } = {}) => {
      if (isRateLimited(socket.id, 'reaction')) return;
      const engine = getEngine();
      if (!engine) return;
      
      const player = engine.store.getPlayerBySocket(socket.id);
      if (player && player.isAlive) {
        io.to(engine.store.roomCode).emit('chat:reaction', { playerId: player.id, emoji });
      }
    });

    socket.on('action:raise_hand', ({ active } = {}) => {
      if (isRateLimited(socket.id, 'reaction')) return;
      const engine = getEngine();
      if (!engine) return;
      
      const player = engine.store.getPlayerBySocket(socket.id);
      if (player && player.isAlive) {
        io.to(engine.store.roomCode).emit('action:raise_hand', { playerId: player.id, active: !!active });
      }
    });

    /**
     * Player votes during the voting phase.
     * Payload: { targetId: string }
     */
    socket.on('vote:cast', async ({ targetId } = {}) => {
      if (isRateLimited(socket.id, 'action')) return;
      const engine = getEngine();
      if (!engine) return;

      const result = await engine.handleVote(socket.id, targetId);
      socket.emit('action:result', result);
    });

    /**
     * Host restarts the game with the same players (play again).
     */
    socket.on('game:playAgain', () => {
      const engine = getEngine();
      if (!engine) {
        socket.emit('error', { message: 'Not in a game room.' });
        return;
      }

      const result = engine.playAgain(socket.id);
      if (!result.success) {
        socket.emit('error', { message: result.error });
      }
    });

    // ── WebRTC Voice Signaling ──────────────────────────────────
    //
    // All voice events use Socket.IO ONLY for signaling (offer, answer,
    // ICE candidate). Audio streams flow peer-to-peer via WebRTC.
    //
    // Signaling flow:
    //   1. Player A emits 'voice:offer' → Server → Player B
    //   2. Player B emits 'voice:answer' → Server → Player A
    //   3. Both exchange 'voice:ice-candidate' bidirectionally
    //
    // Phase-based permission broadcasts are sent via 'voice:permissions'
    // which the GameEngine emits on each phase transition.

    /**
     * Player requests to join the voice room.
     * Server responds with the current voice participants.
     */
    socket.on('voice:join', () => {
      const engine = getEngine();
      if (!engine || !currentRoom) return;

      const player = engine.store.getPlayerBySocket(socket.id);
      if (!player) return;

      // Collect all other players in the room
      const otherPlayers = [];
      for (const p of engine.store.players.values()) {
        if (p.id !== player.id && p.socketId) {
          otherPlayers.push({
            id: p.id,
            name: p.name,
          });
        }
      }

      // Confirm join with list of other participants
      socket.emit('voice:joined', {
        participantId: player.id,
        participants: otherPlayers,
      });

      // Notify all other players that a new voice participant joined
      socket.to(currentRoom).emit('voice:player-joined', {
        id: player.id,
        name: player.name,
      });

      console.log(`[Voice] ${player.name} joined voice in ${currentRoom}`);

      // Always send current voice permissions so new participants can be heard
      // and they can know who is allowed to speak.
      engine.broadcastVoicePermissions();
    });

    /**
     * Forward a WebRTC offer to a specific player.
     * Payload: { targetId: string, offer: RTCSessionDescription }
     */
    socket.on('voice:offer', ({ targetId, offer } = {}) => {
      if (!targetId || !offer) return;
      const engine = getEngine();
      if (!engine) return;

      const target = engine.store.players.get(targetId);
      if (!target || !target.socketId) return;

      const targetSocket = io.sockets.sockets.get(target.socketId);
      if (!targetSocket) return;

      // Find who sent this offer
      const sender = engine.store.getPlayerBySocket(socket.id);
      if (!sender) return;

      targetSocket.emit('voice:offer', {
        fromId: sender.id,
        fromName: sender.name,
        offer,
      });
    });

    /**
     * Forward a WebRTC answer to a specific player.
     * Payload: { targetId: string, answer: RTCSessionDescription }
     */
    socket.on('voice:answer', ({ targetId, answer } = {}) => {
      if (!targetId || !answer) return;
      const engine = getEngine();
      if (!engine) return;

      const target = engine.store.players.get(targetId);
      if (!target || !target.socketId) return;

      const targetSocket = io.sockets.sockets.get(target.socketId);
      if (!targetSocket) return;

      targetSocket.emit('voice:answer', {
        fromId: engine.store.getPlayerBySocket(socket.id)?.id,
        answer,
      });
    });

    /**
     * Forward an ICE candidate to a specific player.
     * Payload: { targetId: string, candidate: RTCIceCandidate }
     */
    socket.on('voice:ice-candidate', ({ targetId, candidate } = {}) => {
      if (!targetId || !candidate) return;
      const engine = getEngine();
      if (!engine) return;

      const target = engine.store.players.get(targetId);
      if (!target || !target.socketId) return;

      const targetSocket = io.sockets.sockets.get(target.socketId);
      if (!targetSocket) return;

      targetSocket.emit('voice:ice-candidate', {
        fromId: engine.store.getPlayerBySocket(socket.id)?.id,
        candidate,
      });
    });

    /**
     * Player's speaking status changed (voice activity detection).
     * Broadcast to all other players in the room.
     * Payload: { speaking: boolean }
     */
    socket.on('voice:speaking', ({ speaking } = {}) => {
      const engine = getEngine();
      if (!engine || !currentRoom) return;

      const player = engine.store.getPlayerBySocket(socket.id);
      if (!player) return;

      socket.to(currentRoom).emit('voice:speaking', {
        playerId: player.id,
        speaking: !!speaking,
      });
    });

    /**
     * Player's mute status changed.
     * Broadcast to all other players in the room.
     * Payload: { muted: boolean }
     */
    socket.on('voice:mute', ({ muted } = {}) => {
      const engine = getEngine();
      if (!engine || !currentRoom) return;

      const player = engine.store.getPlayerBySocket(socket.id);
      if (!player) return;

      socket.to(currentRoom).emit('voice:muted', {
        playerId: player.id,
        muted: !!muted,
      });
    });

    // ── Disconnect & Cleanup ────────────────────────────────────

    /**
     * Handle player disconnect.
     */
    socket.on('disconnect', () => {
      console.log(`[Socket] Disconnected: ${socket.id}`);
      rateLimits.delete(socket.id);

      if (currentRoom) {
        const engine = activeGames.get(currentRoom);
        if (engine && currentPlayerId) {
          const player = engine.store.players.get(currentPlayerId);
          if (player && player.socketId === socket.id) {
            const playerName = player.name;

            if (engine.store.state === 'lobby') {
              engine.removePlayer(currentPlayerId);
              if (sessionId) sessionMap.delete(sessionId);

              io.to(currentRoom).emit('lobby:playerUpdate', {
                players: engine.store.getPublicPlayers(),
                hostId: engine.store.hostId,
                playerCount: engine.store.players.size,
              });

              if (engine.store.players.size > 0) {
                io.to(currentRoom).emit('lobby:notification', {
                  type: 'leave',
                  message: `${playerName} left the room.`,
                  playerName,
                });
              }

              if (engine.store.players.size === 0) {
                engine.destroy();
                activeGames.delete(currentRoom);
                console.log(`[Room] Removed empty game: ${currentRoom}`);
              }
            } else {
              player.status = 'offline';
              console.log(`[Room] Player disconnected during game: ${playerName} in ${currentRoom}`);
              io.to(currentRoom).emit('lobby:notification', {
                type: 'disconnect',
                message: `${playerName} disconnected.`,
                playerName,
              });
              io.to(currentRoom).emit('lobby:playerUpdate', {
                players: engine.store.getPublicPlayers(),
                hostId: engine.store.hostId,
                playerCount: engine.store.players.size,
              });
            }
          }
        }
      }
    });
  });
}
