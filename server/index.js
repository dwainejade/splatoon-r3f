import { WebSocketServer } from "ws";

// A relay, not an authority: every client simulates its own movement and its
// own splats, and this just forwards what it sees to everyone else in the
// room. Good enough for a co-op session among people who trust each other;
// nothing here stops a modified client from painting anywhere it likes.

const PORT = Number(process.env.PORT) || 8787;

// Splatoon-style ink colours. Handed out round-robin as players join, so two
// people never end up unable to tell their territory apart.
const PALETTE = [
  "#3c6dff", // blue
  "#ff5c3c", // orange
  "#c93cff", // purple
  "#3cffb0", // teal
  "#ffe23c", // yellow
  "#ff3c8f", // pink
  "#3cffe2", // cyan
  "#8fff3c", // lime
];

const players = new Map(); // id -> { socket, color, position, rotation }
let nextId = 1;
let nextColor = 0;

const wss = new WebSocketServer({ port: PORT });

function send(socket, message) {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}

function broadcast(message, exceptId) {
  const payload = JSON.stringify(message);
  for (const [id, player] of players) {
    if (id === exceptId) continue;
    if (player.socket.readyState === player.socket.OPEN)
      player.socket.send(payload);
  }
}

wss.on("connection", (socket) => {
  const id = nextId++;
  const color = PALETTE[nextColor % PALETTE.length];
  nextColor += 1;

  const player = { socket, color, position: [0, 1.7, 15], rotation: [0, 0, 0, 1] };
  players.set(id, player);

  send(socket, {
    type: "welcome",
    id,
    color,
    players: Array.from(players, ([playerId, p]) => ({
      id: playerId,
      color: p.color,
      position: p.position,
      rotation: p.rotation,
    })),
  });

  broadcast({ type: "join", id, color, position: player.position, rotation: player.rotation }, id);
  console.log(`player ${id} joined (${players.size} in room)`);

  socket.on("message", (raw) => {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }

    if (message.type === "state") {
      player.position = message.position;
      player.rotation = message.rotation;
      broadcast({ type: "state", id, position: message.position, rotation: message.rotation }, id);
      return;
    }

    if (message.type === "splat") {
      // Colour comes from the room roster, not the client, so a splat always
      // reads as the colour everyone else already associates with this player.
      broadcast({ ...message, id, color: player.color }, id);
      return;
    }

    if (message.type === "fire") {
      // Same idea as splat: every other client simulates its own copy of the
      // shot from these starting conditions, coloured as this room already
      // knows the sender rather than trusting whatever the client sends.
      broadcast({ ...message, id, color: player.color }, id);
      return;
    }
  });

  socket.on("close", () => {
    players.delete(id);
    broadcast({ type: "leave", id });
    console.log(`player ${id} left (${players.size} in room)`);
  });
});

console.log(`Ink Rush relay listening on ws://localhost:${PORT}`);
