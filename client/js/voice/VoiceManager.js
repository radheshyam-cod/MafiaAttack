/**
 * Shadow Mafia — WebRTC Voice Communication Manager
 *
 * Handles all voice-related functionality:
 * - Microphone access via getUserMedia
 * - WebRTC peer connections (mesh topology)
 * - Voice Activity Detection (VAD) via AnalyserNode
 * - Mute/unmute controls
 * - Device enumeration and switching
 * - Phase-based voice permissions
 * - Speaking indicators
 * - Volume controls per remote player
 * - Auto-reconnection on network loss
 */

class VoiceManager {
  constructor(socket) {
    /** @type {import('socket.io-client').Socket} */
    this.socket = socket;

    /** @type {MediaStream|null} Local microphone stream */
    this.localStream = null;

    /** @type {Map<string, RTCPeerConnection>} playerId → RTCPeerConnection */
    this.peerConnections = new Map();

    /** @type {Map<string, MediaStream>} playerId → remote MediaStream */
    this.remoteStreams = new Map();

    /** @type {Map<string, HTMLAudioElement>} playerId → Audio element for playback */
    this.audioElements = new Map();

    /** @type {Map<string, number>} playerId → volume level (0-1) */
    this.volumes = new Map();

    /** @type {Map<string, string>} playerId → player name */
    this.playerNames = new Map();

    /** @type {boolean} Is local mic muted */
    this.muted = false;

    /** @type {boolean} Is local user speaking (VAD detected) */
    this.speaking = false;

    /** @type {boolean} Is voice system initialized and ready */
    this.initialized = false;

    /** @type {boolean} Can we speak in the current phase */
    this.voiceEnabled = false;

    /** @type {string[]} List of player IDs we can currently hear */
    this.allowedSpeakers = [];

    /** @type {string} Current room code */
    this.currentRoom = null;

    /** @type {string|null} Current audio input device ID */
    this.currentMicId = null;

    /** @type {string|null} Current audio output device ID */
    this.currentSpeakerId = null;

    // ── Push To Talk (PTT) ──
    this.isPTTEnabled = false;
    this.pttActive = false;

    // ── Voice Quality Monitoring ──
    this.qualityInterval = null;
    this.onVoiceQualityChange = null;

    // ── VAD State ──
    /** @type {AudioContext|null} */
    this.audioContext = null;
    /** @type {AnalyserNode|null} */
    this.analyserNode = null;
    /** @type {Uint8Array|null} */
    this.vadDataArray = null;
    /** @type {number|null} */
    this.vadInterval = null;
    /** @type {number} Threshold for VAD (0-1 normalized) */
    this.vadThreshold = 0.03;

    // ── Callbacks (set by UI) ──
    /** @param {boolean} speaking */
    this.onLocalSpeakingChange = null;
    /** @param {string} playerId */
    /** @param {boolean} speaking */
    this.onRemoteSpeakingChange = null;
    /** @param {string} playerId */
    /** @param {boolean} muted */
    this.onRemoteMuteChange = null;
    /** @param {boolean} available */
    this.onMicAvailable = null;

    // ── Reconnection ──
    this.reconnectAttempts = new Map();
    this.maxReconnectAttempts = 5;

    // ── ICE Servers ──
    this.iceServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
    ];
  }

  /**
   * Initialize the voice system: request mic permission, set up VAD.
   * @returns {Promise<boolean>} Whether initialization succeeded
   */
  async initialize() {
    try {
      // Request microphone access with echo cancellation, noise suppression, AGC
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: { ideal: true },
          noiseSuppression: { ideal: true },
          autoGainControl: { ideal: true },
        },
      });

      // Set up Voice Activity Detection
      this.setupVAD();

      // Enumerate available devices
      await this.enumerateDevices();

      this.initialized = true;
      console.log('[Voice] Initialized successfully');

      // Start voice quality monitoring loop
      this.startQualityMonitoring();

      if (this.onMicAvailable) {
        this.onMicAvailable(true);
      }

      return true;
    } catch (err) {
      console.error('[Voice] Initialization failed:', err.message);

      if (err.name === 'NotAllowedError') {
        console.warn('[Voice] Microphone permission denied');
      } else if (err.name === 'NotFoundError') {
        console.warn('[Voice] No microphone found');
      }

      if (this.onMicAvailable) {
        this.onMicAvailable(false);
      }

      return false;
    }
  }

  /**
   * Set up Voice Activity Detection using Web Audio API AnalyserNode.
   */
  setupVAD() {
    if (!this.localStream) return;

    // Close existing context if any
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
    }

    try {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const source = this.audioContext.createMediaStreamSource(this.localStream);
      this.analyserNode = this.audioContext.createAnalyser();
      this.analyserNode.fftSize = 256;
      source.connect(this.analyserNode);

      const bufferLength = this.analyserNode.frequencyBinCount;
      this.vadDataArray = new Uint8Array(bufferLength);

      // Clear existing VAD interval
      if (this.vadInterval) {
        clearInterval(this.vadInterval);
      }

      // Check for voice activity every 100ms
      this.vadInterval = setInterval(() => this.checkVAD(), 100);
    } catch (err) {
      console.warn('[Voice] VAD setup failed:', err.message);
    }
  }

  /**
   * Check for voice activity using the AnalyserNode.
   * Emits speaking status to server when state changes.
   */
  checkVAD() {
    if (!this.analyserNode || !this.vadDataArray || !this.initialized) return;

    this.analyserNode.getByteFrequencyData(this.vadDataArray);

    // Calculate average frequency magnitude
    let sum = 0;
    for (let i = 0; i < this.vadDataArray.length; i++) {
      sum += this.vadDataArray[i];
    }
    const average = sum / this.vadDataArray.length;
    const normalized = average / 255;

    const wasSpeaking = this.speaking;
    
    // Check if effectively muted due to PTT
    const pttMuted = this.isPTTEnabled && !this.pttActive;
    this.speaking = normalized > this.vadThreshold && !this.muted && !pttMuted && this.voiceEnabled;

    if (this.speaking !== wasSpeaking) {
      // Emit speaking status change to server
      this.socket.emit('voice:speaking', { speaking: this.speaking });

      if (this.onLocalSpeakingChange) {
        this.onLocalSpeakingChange(this.speaking);
      }
    }
  }

  /**
   * Join a voice room. Called after joining a game room.
   * @param {string} roomCode
   */
  joinVoiceRoom(roomCode) {
    if (!this.initialized || !this.socket) return;

    this.currentRoom = roomCode;
    this.socket.emit('voice:join');
  }

  /**
   * Leave the current voice room and clean up all connections.
   */
  leaveVoiceRoom() {
    this.currentRoom = null;
    this.disconnectAll();
    this.playerNames.clear();
    this.voiceEnabled = false;
    this.allowedSpeakers = [];
  }

  /**
   * Create a WebRTC peer connection to another player.
   * Initiates the connection by creating and sending an offer.
   * @param {string} playerId
   * @param {string} playerName
   */
  async connectToPeer(playerId, playerName) {
    if (this.peerConnections.has(playerId)) {
      // Already connected, skip
      return;
    }

    this.playerNames.set(playerId, playerName);
    this.volumes.set(playerId, 1.0);

    try {
      const pc = this.createPeerConnection(playerId);
      this.peerConnections.set(playerId, pc);

      // Add local audio tracks
      if (this.localStream) {
        for (const track of this.localStream.getAudioTracks()) {
          pc.addTrack(track, this.localStream);
        }
      }

      // Create and send offer
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
      });
      await pc.setLocalDescription(offer);

      this.socket.emit('voice:offer', {
        targetId: playerId,
        offer: pc.localDescription,
      });
    } catch (err) {
      console.error(`[Voice] Failed to connect to ${playerName}:`, err.message);
      this.scheduleReconnect(playerId);
    }
  }

  /**
   * Handle an incoming WebRTC offer from another player.
   * Creates a peer connection and sends back an answer.
   * @param {string} fromId
   * @param {RTCSessionDescription} offer
   */
  async handleOffer(fromId, offer) {
    if (this.peerConnections.has(fromId)) {
      // Connection already exists, ignore
      return;
    }

    try {
      const pc = this.createPeerConnection(fromId);
      this.peerConnections.set(fromId, pc);

      // Add local audio tracks
      if (this.localStream) {
        for (const track of this.localStream.getAudioTracks()) {
          pc.addTrack(track, this.localStream);
        }
      }

      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      this.socket.emit('voice:answer', {
        targetId: fromId,
        answer: pc.localDescription,
      });
    } catch (err) {
      console.error(`[Voice] Failed to handle offer from ${fromId}:`, err.message);
    }
  }

  /**
   * Handle an incoming WebRTC answer from another player.
   * @param {string} fromId
   * @param {RTCSessionDescription} answer
   */
  async handleAnswer(fromId, answer) {
    const pc = this.peerConnections.get(fromId);
    if (!pc) return;

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
    } catch (err) {
      console.error(`[Voice] Failed to handle answer from ${fromId}:`, err.message);
    }
  }

  /**
   * Handle an incoming ICE candidate from another player.
   * @param {string} fromId
   * @param {RTCIceCandidate} candidate
   */
  async handleIceCandidate(fromId, candidate) {
    const pc = this.peerConnections.get(fromId);
    if (!pc || !pc.remoteDescription) return;

    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.error(`[Voice] Failed to add ICE candidate from ${fromId}:`, err.message);
    }
  }

  /**
   * Create a new RTCPeerConnection with event handlers.
   * @param {string} peerId
   * @returns {RTCPeerConnection}
   */
  createPeerConnection(peerId) {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });

    // Handle incoming remote stream
    pc.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        const remoteStream = event.streams[0];
        this.remoteStreams.set(peerId, remoteStream);

        // Create audio element for this peer
        this.createAudioElement(peerId, remoteStream);
      }
    };

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit('voice:ice-candidate', {
          targetId: peerId,
          candidate: event.candidate,
        });
      }
    };

    // Handle connection state changes
    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      if (state === 'disconnected' || state === 'failed') {
        console.log(`[Voice] Connection to ${this.playerNames.get(peerId) || peerId} ${state}`);
        this.scheduleReconnect(peerId);
      } else if (state === 'connected') {
        console.log(`[Voice] Connected to ${this.playerNames.get(peerId) || peerId}`);
        this.reconnectAttempts.delete(peerId);
      }
    };

    // Handle negotiation needed
    pc.onnegotiationneeded = () => {
      console.log(`[Voice] Negotiation needed for ${this.playerNames.get(peerId) || peerId}`);
    };

    return pc;
  }

  createAudioElement(playerId, stream) {
    // Remove existing audio element if any
    const existing = this.audioElements.get(playerId);
    if (existing) {
      existing.pause();
      existing.srcObject = null;
      if (existing.parentNode) {
        existing.parentNode.removeChild(existing);
      }
    }

    const audio = new Audio();
    audio.id = `voice-audio-${playerId}`;
    audio.style.display = 'none';
    document.body.appendChild(audio);

    audio.srcObject = stream;
    audio.autoplay = true;
    audio.volume = this.volumes.get(playerId) || 1.0;

    // Set output device if supported
    if (this.currentSpeakerId && audio.setSinkId) {
      audio.setSinkId(this.currentSpeakerId).catch(() => {});
    }

    audio.play().catch((err) => {
      // Autoplay may be blocked - user interaction will resolve
      console.log('[Voice] Audio play blocked (waiting for user interaction):', err.message);
    });

    this.audioElements.set(playerId, audio);
  }

  /**
   * Schedule a reconnection attempt for a peer.
   * @param {string} playerId
   */
  scheduleReconnect(playerId) {
    const attempts = this.reconnectAttempts.get(playerId) || 0;
    if (attempts >= this.maxReconnectAttempts) {
      console.log(`[Voice] Max reconnection attempts reached for ${this.playerNames.get(playerId) || playerId}`);
      return;
    }

    this.reconnectAttempts.set(playerId, attempts + 1);

    // Exponential backoff: 1s, 2s, 4s, 8s, 16s
    const delay = Math.min(1000 * Math.pow(2, attempts), 16000);
    console.log(`[Voice] Reconnecting to ${this.playerNames.get(playerId) || playerId} in ${delay}ms (attempt ${attempts + 1})`);

    setTimeout(() => {
      // Clean up old connection
      this.disconnectPeer(playerId);
      // Reconnect
      const name = this.playerNames.get(playerId);
      if (name) {
        this.connectToPeer(playerId, name);
      }
    }, delay);
  }

  /**
   * Disconnect from a specific peer.
   * @param {string} playerId
   */
  disconnectPeer(playerId) {
    const pc = this.peerConnections.get(playerId);
    if (pc) {
      pc.close();
      this.peerConnections.delete(playerId);
    }

    const audio = this.audioElements.get(playerId);
    if (audio) {
      audio.pause();
      audio.srcObject = null;
      if (audio.parentNode) {
        audio.parentNode.removeChild(audio);
      }
      this.audioElements.delete(playerId);
    }

    this.remoteStreams.delete(playerId);
  }

  /**
   * Disconnect from all peers and clean up.
   */
  disconnectAll() {
    for (const playerId of this.peerConnections.keys()) {
      this.disconnectPeer(playerId);
    }
    this.reconnectAttempts.clear();
  }

  /**
   * Update voice permissions based on server broadcast.
   * Controls who can speak and whose audio to play.
   * @param {object} permissions
   * @param {string} permissions.phase
   * @param {string|null} permissions.nightStep
   * @param {string[]} permissions.speakingIds - Player IDs whose mics are enabled
   */
  updateVoicePermissions(permissions) {
    this.allowedSpeakers = permissions.speakingIds || [];

    // Mute/unmute local mic based on whether THIS player is in the allowed list
    const localId = this.localPlayerId || (typeof playerId !== 'undefined' ? playerId : null);
    
    let newlyEnabled = false;
    if (localId) {
      const canSpeak = this.allowedSpeakers.includes(localId);
      if (canSpeak && !this.voiceEnabled) {
        newlyEnabled = true;
      }
      this.voiceEnabled = canSpeak;
    } else {
      this.voiceEnabled = true; // Fallback if playerId not set yet
    }
    
    if (newlyEnabled) {
      // Auto-on microphone when granted permission (e.g. start of day phase)
      this.setMutedInternal(false);
      
      // Update UI button state if it exists
      const muteBtn = document.getElementById('mute-btn');
      if (muteBtn) {
        muteBtn.classList.remove('muted');
        const icon = muteBtn.querySelector('i');
        if (icon) {
          icon.classList.remove('fa-microphone-slash');
          icon.classList.add('fa-microphone');
        }
      }
    }

    this.updateLocalTrackEnabled();

    // Apply audio routing: only play audio from allowed speakers
    this.updateAudioRouting();
  }

  /**
   * Update which remote audio streams are played based on allowed speakers.
   */
  updateAudioRouting() {
    for (const [playerId, audio] of this.audioElements) {
      const shouldPlay = this.allowedSpeakers.includes(playerId);
      if (shouldPlay) {
        audio.volume = this.volumes.get(playerId) || 1.0;
      } else {
        audio.volume = 0;
      }
    }
  }

  /**
   * Internal method to update track enabled state based on game rules, user mute, and PTT.
   */
  updateLocalTrackEnabled() {
    if (this.localStream) {
      const pttMuted = this.isPTTEnabled && !this.pttActive;
      const effectivelyMuted = this.muted || !this.voiceEnabled || pttMuted;
      this.localStream.getAudioTracks().forEach((track) => {
        track.enabled = !effectivelyMuted;
      });
    }
  }

  /**
   * Activate or deactivate Push-to-Talk.
   * @param {boolean} active 
   */
  setPTTActive(active) {
    if (!this.isPTTEnabled) return;
    if (this.pttActive !== active) {
      this.pttActive = active;
      this.updateLocalTrackEnabled();
    }
  }

  /**
   * Toggle Push-To-Talk mode.
   * @param {boolean} enabled 
   */
  setPTTMode(enabled) {
    this.isPTTEnabled = enabled;
    if (!enabled) this.pttActive = false;
    this.updateLocalTrackEnabled();
  }

  /**
   * Internal user mute control (used by toggleMute).
   * @param {boolean} muted
   */
  setMutedInternal(muted) {
    this.muted = muted;
    this.updateLocalTrackEnabled();
  }

  /**
   * Toggle mute/unmute for the local microphone.
   * @param {boolean|null} muted - If null, toggles current state
   */
  toggleMute(muted) {
    const newMuted = muted !== null ? muted : !this.muted;
    this.setMutedInternal(newMuted);

    // Notify server
    this.socket.emit('voice:mute', { muted: newMuted });

    // Update UI
    if (this.onRemoteMuteChange) {
      // Signal to UI that we changed our mute state
      this.onRemoteMuteChange('__local__', newMuted);
    }
  }

  /**
   * Set volume for a remote player.
   * @param {string} playerId
   * @param {number} volume - 0 to 1
   */
  setVolume(playerId, volume) {
    const clamped = Math.max(0, Math.min(1, volume));
    this.volumes.set(playerId, clamped);

    const audio = this.audioElements.get(playerId);
    if (audio) {
      // Check if this player is allowed to be heard
      if (this.allowedSpeakers.includes(playerId)) {
        audio.volume = clamped;
      }
    }
  }

  /**
   * Change the microphone input device.
   * @param {string} deviceId
   * @returns {Promise<boolean>}
   */
  async changeMic(deviceId) {
    try {
      // Store current mute state
      const wasMuted = this.muted;

      // Stop old stream tracks
      if (this.localStream) {
        this.localStream.getTracks().forEach((track) => track.stop());
      }

      // Get new stream with selected device
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: deviceId },
          echoCancellation: { ideal: true },
          noiseSuppression: { ideal: true },
          autoGainControl: { ideal: true },
        },
      });

      this.currentMicId = deviceId;

      // Restore mute state
      if (wasMuted) {
        this.localStream.getAudioTracks().forEach((track) => {
          track.enabled = false;
        });
      }

      // Replace track in all peer connections
      const newTrack = this.localStream.getAudioTracks()[0];
      for (const [peerId, pc] of this.peerConnections) {
        const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'audio');
        if (sender) {
          try {
            await sender.replaceTrack(newTrack);
          } catch (err) {
            console.error(`[Voice] Failed to replace track for ${peerId}:`, err.message);
          }
        }
      }

      // Re-setup VAD with new stream
      this.setupVAD();

      console.log('[Voice] Mic changed to device:', deviceId);
      return true;
    } catch (err) {
      console.error('[Voice] Failed to change mic:', err.message);
      return false;
    }
  }

  /**
   * Change the audio output device (speaker).
   * Uses setSinkId API if available.
   * @param {string} deviceId
   */
  async changeSpeaker(deviceId) {
    this.currentSpeakerId = deviceId;

    let successCount = 0;
    for (const [playerId, audio] of this.audioElements) {
      if (audio.setSinkId) {
        try {
          await audio.setSinkId(deviceId);
          successCount++;
        } catch (err) {
          console.error(`[Voice] Failed to set speaker for ${playerId}:`, err.message);
        }
      }
    }

    if (successCount > 0) {
      console.log('[Voice] Speaker changed to device:', deviceId);
    } else {
      console.warn('[Voice] setSinkId not supported or failed for all audio elements');
    }
  }

  /**
   * Enumerate available audio input/output devices.
   * @returns {Promise<{inputs: MediaDeviceInfo[], outputs: MediaDeviceInfo[]}>}
   */
  async enumerateDevices() {
    try {
      // Request permission to enumerate
      if (this.localStream) {
        // Already have permission
      }

      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter((d) => d.kind === 'audioinput');
      const audioOutputs = devices.filter((d) => d.kind === 'audiooutput');

      return {
        inputs: audioInputs,
        outputs: audioOutputs,
      };
    } catch (err) {
      console.error('[Voice] Failed to enumerate devices:', err.message);
      return { inputs: [], outputs: [] };
    }
  }

  /**
   * Add a remote speaking event from the server.
   * @param {string} playerId
   * @param {boolean} speaking
   */
  onRemoteSpeaking(playerId, speaking) {
    if (this.onRemoteSpeakingChange) {
      this.onRemoteSpeakingChange(playerId, speaking);
    }
  }

  /**
   * Add a remote mute event from the server.
   * @param {string} playerId
   * @param {boolean} muted
   */
  onRemoteMuted(playerId, muted) {
    if (this.onRemoteMuteChange) {
      this.onRemoteMuteChange(playerId, muted);
    }
  }

  /**
   * Start polling RTCPeerConnection stats for voice quality.
   */
  startQualityMonitoring() {
    if (this.qualityInterval) clearInterval(this.qualityInterval);
    this.qualityInterval = setInterval(() => this.checkVoiceQuality(), 3000);
  }

  /**
   * Extract WebRTC stats to determine connection quality.
   */
  async checkVoiceQuality() {
    if (this.peerConnections.size === 0) {
      if (this.onVoiceQualityChange) this.onVoiceQualityChange('idle');
      return;
    }

    let maxRtt = 0;
    let totalPacketsLost = 0;
    let checkedPeers = 0;

    for (const pc of this.peerConnections.values()) {
      try {
        const stats = await pc.getStats();
        stats.forEach(report => {
          if (report.type === 'candidate-pair' && report.state === 'succeeded') {
            if (report.currentRoundTripTime !== undefined) {
              maxRtt = Math.max(maxRtt, report.currentRoundTripTime * 1000); // ms
            }
          }
          if (report.type === 'inbound-rtp' && report.kind === 'audio') {
            totalPacketsLost += report.packetsLost || 0;
          }
        });
        checkedPeers++;
      } catch (err) {
        // Ignore
      }
    }

    if (checkedPeers > 0 && this.onVoiceQualityChange) {
      let quality = 'good';
      if (maxRtt > 300 || totalPacketsLost > 50) quality = 'poor';
      else if (maxRtt > 150 || totalPacketsLost > 10) quality = 'fair';
      
      this.onVoiceQualityChange(quality);
    }
  }

  /**
   * Clean up all resources.
   */
  destroy() {
    this.leaveVoiceRoom();

    if (this.vadInterval) {
      clearInterval(this.vadInterval);
      this.vadInterval = null;
    }

    if (this.qualityInterval) {
      clearInterval(this.qualityInterval);
      this.qualityInterval = null;
    }

    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }

    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }

    this.initialized = false;
    console.log('[Voice] Destroyed');
  }
}

// Make VoiceManager available globally
window.VoiceManager = VoiceManager;
