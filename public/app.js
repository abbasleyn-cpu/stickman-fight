const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

const createBtn = document.getElementById("createBtn");
const joinBtn = document.getElementById("joinBtn");
const roomInput = document.getElementById("roomInput");
const roomCodeText = document.getElementById("roomCode");
const statusText = document.getElementById("status");
const restartBtn = document.getElementById("restartBtn");

let socket = null;
let myPlayerId = null;
let gameState = null;

const keys = {};

function setStatus(text) {
  statusText.textContent = text;
}

function connect() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(`${protocol}//${location.host}`);

  socket.addEventListener("open", () => {
    setStatus("Mit Server verbunden.");
  });

  socket.addEventListener("message", (event) => {
    let message;

    try {
      message = JSON.parse(event.data);
    } catch (error) {
      console.error("Ungültige Server-Nachricht:", error);
      return;
    }

    if (message.type === "roomCreated") {
      myPlayerId = message.playerId;
      roomCodeText.textContent = message.roomCode;

      setStatus("Raum erstellt. Warte auf Spieler 2...");
    }

    if (message.type === "roomJoined") {
      myPlayerId = message.playerId;
      roomCodeText.textContent = message.roomCode;

      setStatus("Raum beigetreten. Starte...");
    }

    if (message.type === "state") {
      gameState = message.state;

      if (message.yourId) {
        myPlayerId = message.yourId;
      }

      updateStatusFromGame();
    }

    if (message.type === "error") {
      setStatus("Fehler: " + message.message);
    }
  });

  socket.addEventListener("close", () => {
    setStatus("Verbindung zum Server verloren.");
  });

  socket.addEventListener("error", () => {
    setStatus("WebSocket-Verbindungsfehler.");
  });
}

function updateStatusFromGame() {
  if (!gameState) {
    return;
  }

  if (gameState.status === "waiting") {
    setStatus("Warte auf Spieler 2...");
    restartBtn.style.display = "none";
  }

  if (gameState.status === "countdown") {
    setStatus(
      gameState.countdown > 0
        ? `Start in ${gameState.countdown}...`
        : "Los!"
    );

    restartBtn.style.display = "none";
  }

  if (gameState.status === "playing") {
    setStatus("KÄMPF!");
    restartBtn.style.display = "none";
  }

  if (gameState.status === "finished") {
    const winner = gameState.players.find(
      player => player.id === gameState.winner
    );

    if (winner) {
      if (winner.id === myPlayerId) {
        setStatus("🏆 DU HAST GEWONNEN!");
      } else {
        setStatus("💀 DU HAST VERLOREN!");
      }
    }

    restartBtn.style.display = "inline-block";
  }
}

function sendInput(code, pressed) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }

  socket.send(JSON.stringify({
    type: "input",
    key: code,
    pressed: pressed
  }));
}

window.addEventListener("keydown", (event) => {
  if (
    event.code === "ArrowLeft" ||
    event.code === "ArrowRight" ||
    event.code === "ArrowUp" ||
    event.code === "Space"
  ) {
    event.preventDefault();
  }

  if (keys[event.code]) {
    return;
  }

  keys[event.code] = true;

  sendInput(event.code, true);
});

window.addEventListener("keyup", (event) => {
  keys[event.code] = false;

  sendInput(event.code, false);
});

createBtn.addEventListener("click", () => {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    setStatus("Noch nicht mit dem Server verbunden.");
    return;
  }

  socket.send(JSON.stringify({
    type: "createRoom"
  }));
});

joinBtn.addEventListener("click", () => {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    setStatus("Noch nicht mit dem Server verbunden.");
    return;
  }

  const code = roomInput.value.trim().toUpperCase();

  if (code.length !== 6) {
    setStatus("Der Raumcode muss 6 Zeichen haben.");
    return;
  }

  socket.send(JSON.stringify({
    type: "joinRoom",
    roomCode: code
  }));
});

restartBtn.addEventListener("click", () => {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }

  socket.send(JSON.stringify({
    type: "reset"
  }));
});

function drawBackground() {
  const gradient = ctx.createLinearGradient(
    0,
    0,
    0,
    canvas.height
  );

  gradient.addColorStop(0, "#202a44");
  gradient.addColorStop(1, "#111");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Mond
  ctx.beginPath();
  ctx.arc(850, 80, 40, 0, Math.PI * 2);
  ctx.fillStyle = "#fff";
  ctx.fill();

  // Berge
  ctx.fillStyle = "#151515";

  ctx.beginPath();
  ctx.moveTo(0, 360);
  ctx.lineTo(180, 190);
  ctx.lineTo(330, 360);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(250, 360);
  ctx.lineTo(480, 150);
  ctx.lineTo(700, 360);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(580, 360);
  ctx.lineTo(800, 200);
  ctx.lineTo(1000, 360);
  ctx.closePath();
  ctx.fill();
}

function drawArena() {
  const groundY = 455;

  ctx.fillStyle = "#333";
  ctx.fillRect(0, groundY, canvas.width, canvas.height - groundY);

  ctx.fillStyle = "#666";
  ctx.fillRect(0, groundY, canvas.width, 8);

  // Kleine Linien auf dem Boden
  ctx.strokeStyle = "#555";
  ctx.lineWidth = 2;

  for (let x = 0; x < canvas.width; x += 50) {
    ctx.beginPath();
    ctx.moveTo(x, groundY + 20);
    ctx.lineTo(x + 25, groundY + 20);
    ctx.stroke();
  }
}

function drawHealthBar(x, y, width, hp, label, flip = false) {
  hp = Math.max(0, Math.min(100, hp));

  ctx.fillStyle = "#000";
  ctx.fillRect(x, y, width, 30);

  ctx.fillStyle = hp > 50 ? "#2ecc71" : hp > 20 ? "#f1c40f" : "#e74c3c";

  const hpWidth = width * (hp / 100);

  if (flip) {
    ctx.fillRect(x + width - hpWidth, y, hpWidth, 30);
  } else {
    ctx.fillRect(x, y, hpWidth, 30);
  }

  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, width, 30);

  ctx.fillStyle = "#fff";
  ctx.font = "bold 18px Arial";
  ctx.textAlign = flip ? "right" : "left";
  ctx.fillText(
    `${label} ${hp} HP`,
    flip ? x + width : x,
    y + 21
  );

  ctx.textAlign = "center";
}

function drawStickman(player) {
  if (!player) {
    return;
  }

  const x = player.x;
  const y = player.y;
  const dir = player.direction || 1;

  const isAttacking = player.attack !== null;

  ctx.save();

  ctx.translate(x, y);

  // Schatten
  ctx.beginPath();
  ctx.ellipse(0, 4, 30, 8, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.fill();

  // Kopf
  ctx.beginPath();
  ctx.arc(0, -68, 18, 0, Math.PI * 2);
  ctx.fillStyle = player.id === myPlayerId
    ? "#4dd0ff"
    : "#ff5d73";
  ctx.fill();

  // Augen
  ctx.fillStyle = "#111";

  ctx.beginPath();
  ctx.arc(
    -6 + dir * 3,
    -72,
    3,
    0,
    Math.PI * 2
  );
  ctx.fill();

  ctx.beginPath();
  ctx.arc(
    5 + dir * 3,
    -72,
    3,
    0,
    Math.PI * 2
  );
  ctx.fill();

  // Körper
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 7;
  ctx.lineCap = "round";

  ctx.beginPath();
  ctx.moveTo(0, -50);
  ctx.lineTo(0, -10);
  ctx.stroke();

  // Beine
  ctx.beginPath();
  ctx.moveTo(0, -10);
  ctx.lineTo(-18, 20);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(0, -10);
  ctx.lineTo(18, 20);
  ctx.stroke();

  // Arme
  if (isAttacking) {
    if (player.attack === "punch") {
      ctx.beginPath();
      ctx.moveTo(0, -42);
      ctx.lineTo(dir * 38, -45);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, -42);
      ctx.lineTo(-dir * 15, -18);
      ctx.stroke();

      // Faust
      ctx.beginPath();
      ctx.arc(dir * 45, -45, 7, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
    } else {
      // kick
      ctx.beginPath();
      ctx.moveTo(0, -15);
      ctx.lineTo(dir * 42, -3);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, -42);
      ctx.lineTo(-dir * 15, -18);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, -10);
      ctx.lineTo(-dir * 16, 18);
      ctx.stroke();
    }
  } else {
    ctx.beginPath();
    ctx.moveTo(0, -42);
    ctx.lineTo(-dir * 20, -18);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, -42);
    ctx.lineTo(dir * 20, -18);
    ctx.stroke();
  }

  // Spielername
  ctx.fillStyle = "#fff";
  ctx.font = "bold 14px Arial";
  ctx.textAlign = "center";

  ctx.fillText(
    player.id === myPlayerId ? "DU" : "SPIELER",
    0,
    -100
  );

  ctx.restore();
}

function drawCenterMessage() {
  if (!gameState) {
    return;
  }

  ctx.textAlign = "center";

  if (gameState.status === "waiting") {
    ctx.fillStyle = "#fff";
    ctx.font = "bold 34px Arial";
    ctx.fillText(
      "Warte auf Spieler 2...",
      canvas.width / 2,
      120
    );
  }

  if (gameState.status === "countdown") {
    ctx.fillStyle = "#fff";
    ctx.font = "bold 90px Arial";

    const number =
      gameState.countdown > 0
        ? gameState.countdown
        : "GO!";

    ctx.fillText(
      number,
      canvas.width / 2,
      200
    );
  }

  if (gameState.status === "finished") {
    const winner = gameState.players.find(
      player => player.id === gameState.winner
    );

    ctx.fillStyle = "#fff";
    ctx.font = "bold 56px Arial";

    if (winner && winner.id === myPlayerId) {
      ctx.fillText(
        "GEWONNEN!",
        canvas.width / 2,
        220
      );
    } else {
      ctx.fillText(
        "VERLOREN!",
        canvas.width / 2,
        220
      );
    }
  }
}

function draw() {
  drawBackground();
  drawArena();

  if (gameState && gameState.players) {
    const player1 = gameState.players[0];
    const player2 = gameState.players[1];

    if (player1) {
      drawStickman(player1);
    }

    if (player2) {
      drawStickman(player2);
    }

    if (player1) {
      drawHealthBar(
        30,
        25,
        300,
        player1.hp,
        "SPIELER 1"
      );
    }

    if (player2) {
      drawHealthBar(
        670,
        25,
        300,
        player2.hp,
        "SPIELER 2",
        true
      );
    }
  }

  drawCenterMessage();

  requestAnimationFrame(draw);
}

connect();
draw();
