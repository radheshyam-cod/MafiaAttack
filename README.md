# MafiaAttack 🕵️‍♂️🩸

An immersive, AAA-quality, real-time web version of the classic social deduction game **Mafia**. Built from the ground up for maximum player immersion, MafiaAttack trades traditional forms and dashboards for borderless, cinematic game scenes powered by Node.js, Socket.IO, and WebRTC.

## 🌟 Key Features

### 🎬 Fully Cinematic UI
- **Zero Dashboards**: The entire UI is built as a single-page application with no scrolling. You are placed directly into the scene.
- **Dynamic Lighting & Ambience**: Pure CSS particles, smoke effects, creeping shadows, and heartbeats transition based on the active phase.
- **HUD Widgetizing**: A sleek, transparent HUD floats on top of the environment to display time, phase, and round information without breaking immersion.

### 🎙️ Advanced WebRTC Voice Architecture
- **Phase-Aware Audio**: 
  - **Day/Lobby**: Everyone is in a global voice chat.
  - **Night Phase**: Players are hard-muted.
  - **Mafia Secure Channel**: Mafia members are placed into a private, encrypted voice channel during the night.
- **Peer-to-Peer Mesh**: Voice data is streamed directly between peers using WebRTC (`getUserMedia`, `RTCPeerConnection`), keeping server overhead near zero.
- **Push-To-Talk (PTT)**: Spacebar-activated PTT with smart-muting while typing in chat.
- **Connection Diagnostics**: Live latency and packet loss indicators (📶) dynamically update per-client.

### 🌙 Role-Specific Night Phases
- **Mafia Secure Channel**: A dark, blood-red command center where Mafia members can chat via voice and secret typewriter-style text chat to coordinate their hit.
- **Doctor's Healing Aura**: A calm, magical cyan atmosphere where the Doctor selects a target to save, triggering floating healing particles.
- **Detective's Investigation**: A gritty, dark office environment with a flashlight overlay. The Detective instantly slams a "MAFIA" or "NOT MAFIA" stamp on their suspect's file.

### 🌅 Emotional Phase Transitions
- **Morning Arrivals**: The sun rises, warm colors return, and birds sing. If a player was murdered, the screen zooms in, turns grayscale, a bell tolls, and a blood-red death animation plays.
- **Campfire Discussions**: Surviving players form a circle around a crackling campfire. When a player speaks via WebRTC, a green voice ring pulses from their avatar. Players can raise their hands (✋) or float emoji reactions (👍😮😂😡) physically into the scene.
- **High-Tension Voting**: During the last 10 seconds of voting, a heartbeat plays, the screen shakes, and a dark red vignette closes in.

### 🏆 Game Over Cinematics
- **Village Win**: Golden sunlight rays, confetti, and cheers.
- **Mafia Win**: A crimson nightmare with rolling fog, lightning, and ominous smoke.
- **True Identities Reveal**: A beautiful glass-morphism grid reveals the true role and team alignment of every player, alongside match statistics.

## 🛠️ Technology Stack

- **Frontend**: HTML5, Vanilla JavaScript (ES6), pure CSS3 (Animations, Keyframes, Flexbox/Grid). 
- **Backend Server**: Node.js, Express.
- **Real-Time Signaling**: Socket.IO (Used *strictly* for game state logic and WebRTC offer/answer signaling).
- **Voice Networking**: WebRTC Mesh Architecture (No media servers involved).

## 🚀 Installation & Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/radheshyam-cod/MafiaAttack.git
   cd MafiaAttack
   ```

2. **Install Dependencies**
   ```bash
   npm install
   ```

3. **Run the Server**
   ```bash
   # Development mode
   npm run dev
   
   # Production mode
   npm start
   ```

4. **Play the Game**
   - Open your browser and navigate to `http://localhost:3000`
   - Share the room code with your friends to start a match!

## 📁 Project Structure

```text
MafiaAttack/
├── client/                     # Frontend Application
│   ├── assets/                 # Audio (mp3) and Images (png)
│   ├── css/                    # Pure CSS styling (styles.css, cinematic.css)
│   ├── js/
│   │   ├── main.js             # Client initialization
│   │   ├── socket.js           # Socket.IO event listeners
│   │   ├── ui/                 # UI Controllers (GameUI, LobbyUI, VoiceUI, AudioManager)
│   │   ├── voice/              # WebRTC VoiceManager
│   │   └── scene/              # SceneManager for cinematic transitions
│   └── index.html              # Single Page Entry
├── server/                     # Backend Node.js Server
│   ├── index.js                # Express & Socket.IO initialization
│   ├── game/
│   │   ├── GameEngine.js       # Core loop, timers, win conditions
│   │   ├── PhaseManager.js     # State machine for Night/Day/Voting
│   │   ├── GameStore.js        # In-memory storage for active rooms
│   │   └── roles/              # OOP Role logic (Mafia, Doctor, Detective, Villager)
│   └── socket/
│       └── handlers.js         # Socket event routing
├── package.json
└── README.md
```

## 📜 License
Developed for the ultimate social deduction experience. Do not trust your friends.
