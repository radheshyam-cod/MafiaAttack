/**
 * Shadow Mafia — Voice UI
 *
 * Handles DOM updates and callbacks for the VoiceManager.
 */

document.addEventListener('DOMContentLoaded', () => {
  // We need to wait for voiceManager to be initialized by socket.js
  // Let's poll for it.
  const checkInterval = setInterval(() => {
    if (window.voiceManager) {
      clearInterval(checkInterval);
      initVoiceUI(window.voiceManager);
    }
  }, 100);
});

function initVoiceUI(voiceManager) {
  const voiceBar = document.getElementById('voice-bar');
  const micStatusText = document.getElementById('mic-status-text');
  const micIcon = document.getElementById('mic-icon');
  const voiceStatusDot = document.getElementById('voice-status-dot');
  const voiceStatusText = document.getElementById('voice-status-text');
  const micSelect = document.getElementById('voice-mic-select');
  const speakerSelect = document.getElementById('voice-speaker-select');

  // Callback when microphone is successfully initialized or failed
  voiceManager.onMicAvailable = async (available) => {
    if (available) {
      if (voiceBar) voiceBar.classList.remove('hidden');
      updateLocalMuteUI(voiceManager.muted);
      await populateDeviceSelectors();
    } else {
      if (voiceBar) voiceBar.classList.add('hidden');
    }
  };

  // Callback when local user speaking state changes
  voiceManager.onLocalSpeakingChange = (speaking) => {
    if (voiceStatusDot) {
      voiceStatusDot.className = 'voice-status-dot ' + (speaking ? 'speaking' : 'idle');
    }
    if (voiceStatusText) {
      voiceStatusText.textContent = speaking ? 'Speaking' : 'Idle';
    }
    
    // Also update our own chip if visible
    if (typeof playerId !== 'undefined' && playerId) {
      updatePlayerSpeakingUI(playerId, speaking);
    }
  };

  // Callback when remote user speaking state changes
  voiceManager.onRemoteSpeakingChange = (id, speaking) => {
    updatePlayerSpeakingUI(id, speaking);
  };

  // Callback when remote user mutes/unmutes (or we get updated local mute state via loopback)
  voiceManager.onRemoteMuteChange = (id, muted) => {
    if (id === '__local__' || id === (typeof playerId !== 'undefined' ? playerId : null)) {
      updateLocalMuteUI(muted);
      if (typeof playerId !== 'undefined' && playerId) {
        updatePlayerMuteUI(playerId, muted);
      }
    } else {
      updatePlayerMuteUI(id, muted);
    }
  };

  async function populateDeviceSelectors() {
    const devices = await voiceManager.enumerateDevices();
    
    if (micSelect) {
      micSelect.innerHTML = devices.inputs.map(d => 
        `<option value="${d.deviceId}" ${d.deviceId === voiceManager.currentMicId ? 'selected' : ''}>🎤 ${d.label || 'Microphone'}</option>`
      ).join('');
    }

    if (speakerSelect) {
      if (devices.outputs.length > 0) {
        speakerSelect.innerHTML = devices.outputs.map(d => 
          `<option value="${d.deviceId}" ${d.deviceId === voiceManager.currentSpeakerId ? 'selected' : ''}>🔊 ${d.label || 'Speaker'}</option>`
        ).join('');
      } else {
        speakerSelect.style.display = 'none'; // Hide if speaker selection not supported
      }
    }
  }

  function updateLocalMuteUI(muted) {
    if (micIcon) {
      micIcon.textContent = muted ? '🔇' : '🎤';
      micIcon.parentElement.classList.toggle('muted', muted);
    }
    if (micStatusText) {
      micStatusText.textContent = muted ? 'Mic Muted' : 'Mic On';
    }
  }
}

// ── Global Handlers for HTML elements ──

window.toggleMute = function() {
  if (window.voiceManager) {
    window.voiceManager.toggleMute();
  }
};

window.handleMicChange = function(deviceId) {
  if (window.voiceManager) {
    window.voiceManager.changeMic(deviceId);
  }
};

window.handleSpeakerChange = function(deviceId) {
  if (window.voiceManager) {
    window.voiceManager.changeSpeaker(deviceId);
  }
};

window.handleVolumeChange = function(id, volume) {
  if (window.voiceManager) {
    window.voiceManager.setVolume(id, parseFloat(volume));
  }
};

// Update UI of a specific player chip
window.updatePlayerSpeakingUI = function(id, speaking) {
  const chip = document.querySelector(`.player-chip[data-player-id="${id}"]`);
  if (chip) {
    const avatar = chip.querySelector('.chip-avatar');
    if (avatar) {
      if (speaking) {
        avatar.classList.add('voice-active');
      } else {
        avatar.classList.remove('voice-active');
      }
    }
  }
};

window.updatePlayerMuteUI = function(id, muted) {
  const chip = document.querySelector(`.player-chip[data-player-id="${id}"]`);
  if (chip) {
    const micIcon = chip.querySelector('.chip-mic-icon');
    if (micIcon) {
      micIcon.textContent = muted ? '🔇' : '🎤';
      if (muted) {
        micIcon.classList.add('muted');
      } else {
        micIcon.classList.remove('muted');
      }
    }
  }
};
