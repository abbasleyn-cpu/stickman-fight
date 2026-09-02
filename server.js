const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;

const rooms = new Map();

const MAX_PLAYERS = 2;

const WORLD_WIDTH = 1000;
const GROUND_Y = 420;

const PLAYER_WIDTH = 45;
const PLAYER_HEIGHT = 90;

const MOVE_SPEED = 6;
const JUMP_SPEED = -14;
const GRAVITY = 0.7;

const START_HP = 100;

const ATTACK_COOLDOWN = 450;
const PUNCH_DAMAGE = 10;
const KICK_DAMAGE = 15;

const ATTACK_TIME = 180;
const GAME_TICK = 50;


// =========================================================
// HTTP SERVER
// =========================================================

const server = http.createServer((req, res) => {
    let filePath;

    if (req.url === "/") {
        filePath = path.join(
            __dirname,
            "public",
            "index.html"
        );
    } else {
        const cleanUrl = decodeURIComponent(
            req.url.split("?")[0]
        );

        filePath = path.join(
            __dirname,
            "public",
            cleanUrl
        );
    }

    // Sicherheit gegen ../
    const publicDir = path.join(__dirname, "public");
    const resolvedPath = path.resolve(filePath);

    if (!resolvedPath.startsWith(publicDir)) {
        res.writeHead(403, {
            "Content-Type": "text/plain; charset=utf-8"
        });

        res.end("403 - Zugriff verweigert");
        return;
    }

    fs.readFile(filePath, (error, data) => {
        if (error) {
            res.writeHead(404, {
                "Content-Type": "text/plain; charset=utf-8"
            });

            res.end("404 - Datei nicht gefunden");
            return;
        }

        let contentType =
            "text/plain; charset=utf-8";

        if (filePath.endsWith(".html")) {
            contentType =
                "text/html; charset=utf-8";
        } else if (filePath.endsWith(".js")) {
            contentType =
                "application/javascript; charset=utf-8";
        } else if (filePath.endsWith(".css")) {
            contentType =
                "text/css; charset=utf-8";
        } else if (filePath.endsWith(".json")) {
            contentType =
                "application/json; charset=utf-8";
        }

        res.writeHead(200, {
            "Content-Type": contentType
        });

        res.end(data);
    });
});


// =========================================================
// WEBSOCKET
// =========================================================

const wss = new WebSocket.Server({
    server
});


// =========================================================
// HILFSFUNKTIONEN
// =========================================================

function send(ws, type, data = {}) {
    if (
        ws &&
        ws.readyState === WebSocket.OPEN
    ) {
        ws.send(
            JSON.stringify({
                type,
                ...data
            })
        );
    }
}


function randomRoomCode() {
    const chars =
        "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    let code;

    do {
        code = "";

        for (let i = 0; i < 6; i++) {
            code += chars[
                Math.floor(
                    Math.random() *
                    chars.length
                )
            ];
        }
    } while (rooms.has(code));

    return code;
}


function randomId() {
    return crypto.randomUUID();
}


function getPlayers(room) {
    return [...room.players.values()];
}


function getPlayerNumber(room, player) {
    const players = getPlayers(room);

    const index = players.findIndex(
        p => p.id === player.id
    );

    return index === 1 ? 2 : 1;
}


function getOpponent(room, player) {
    for (const other of room.players.values()) {
        if (
            other.id !== player.id &&
            other.active
        ) {
            return other;
        }
    }

    return null;
}


// =========================================================
// ÖFFENTLICHER SPIELSTAND
// =========================================================

function publicState(room) {
    return {
        roomCode: room.code,

        status: room.status,

        countdown: room.countdown,

        winner: room.winner,

        players: getPlayers(room).map(player => ({
            id: player.id,

            x: player.x,

            y: player.y,

            hp: player.hp,

            direction: player.direction,

            attack: player.attacking
                ? player.attackType
                : null,

            active: player.active,

            connected: Boolean(player.ws)
        }))
    };
}


function broadcastState(room) {
    const state = publicState(room);

    for (const player of room.players.values()) {
        send(
            player.ws,
            "state",
            {
                state: state,
                yourId: player.id
            }
        );
    }
}


// =========================================================
// SPIELER ERSTELLEN
// =========================================================

function createPlayer(
    id,
    ws,
    playerNumber
) {
    const isPlayer1 =
        playerNumber === 1;

    return {
        id,

        ws,

        x: isPlayer1 ? 200 : 750,

        y:
            GROUND_Y -
            PLAYER_HEIGHT,

        vx: 0,

        vy: 0,

        hp: START_HP,

        direction:
            isPlayer1 ? 1 : -1,

        attacking: false,

        attackType: null,

        lastAttack: 0,

        hitThisAttack: false,

        active: true
    };
}


// =========================================================
// RAUM ERSTELLEN
// =========================================================

function createRoom(ws) {
    const code = randomRoomCode();

    const id = randomId();

    const player = createPlayer(
        id,
        ws,
        1
    );

    const room = {
        code,

        status: "waiting",

        countdown: 0,

        winner: null,

        players: new Map([
            [id, player]
        ]),

        loop: null,

        countdownTimer: null
    };

    rooms.set(code, room);

    ws.roomCode = code;

    ws.playerId = id;

    send(
        ws,
        "roomCreated",
        {
            roomCode: code,

            playerId: id
        }
    );

    broadcastState(room);

    return room;
}


// =========================================================
// RAUM BEITRETEN
// =========================================================

function joinRoom(code, ws) {
    const room = rooms.get(code);

    if (!room) {
        send(
            ws,
            "error",
            {
                message: "Raum nicht gefunden."
            }
        );

        return;
    }

    if (room.players.size >= MAX_PLAYERS) {
        send(
            ws,
            "error",
            {
                message: "Der Raum ist voll."
            }
        );

        return;
    }

    if (room.status !== "waiting") {
        send(
            ws,
            "error",
            {
                message:
                    "Das Spiel läuft bereits."
            }
        );

        return;
    }

    const id = randomId();

    const player = createPlayer(
        id,
        ws,
        2
    );

    room.players.set(
        id,
        player
    );

    ws.roomCode = code;

    ws.playerId = id;

    send(
        ws,
        "roomJoined",
        {
            roomCode: code,

            playerId: id
        }
    );

    room.status = "countdown";

    room.countdown = 3;

    broadcastState(room);

    startCountdown(room);
}


// =========================================================
// COUNTDOWN
// =========================================================

function startCountdown(room) {
    let value = 3;

    if (room.countdownTimer) {
        clearInterval(
            room.countdownTimer
        );
    }

    room.countdownTimer =
        setInterval(() => {
            if (!rooms.has(room.code)) {
                clearInterval(
                    room.countdownTimer
                );

                room.countdownTimer = null;

                return;
            }

            value--;

            room.countdown = value;

            broadcastState(room);

            if (value <= 0) {
                clearInterval(
                    room.countdownTimer
                );

                room.countdownTimer = null;

                room.status = "playing";

                room.countdown = 0;

                broadcastState(room);

                startGameLoop(room);
            }
        }, 1000);
}


// =========================================================
// SPIELLOOP
// =========================================================

function startGameLoop(room) {
    if (room.loop) {
        return;
    }

    room.loop = setInterval(() => {
        if (room.status !== "playing") {
            clearInterval(room.loop);

            room.loop = null;

            return;
        }

        updatePhysics(room);

        updateAttacks(room);

        broadcastState(room);

    }, GAME_TICK);
}


// =========================================================
// PHYSIK
// =========================================================

function updatePhysics(room) {
    for (const player of room.players.values()) {
        if (!player.active) {
            continue;
        }

        player.x += player.vx;

        player.y += player.vy;

        player.vy += GRAVITY;

        const floor =
            GROUND_Y -
            PLAYER_HEIGHT;

        if (player.y >= floor) {
            player.y = floor;

            player.vy = 0;
        }

        player.x = Math.max(
            20,
            Math.min(
                WORLD_WIDTH -
                PLAYER_WIDTH -
                20,
                player.x
            )
        );

        player.vx *= 0.75;

        if (Math.abs(player.vx) > 0.1) {
            player.direction =
                player.vx >= 0
                    ? 1
                    : -1;
        }

        if (
            player.attacking &&
            Date.now() -
                player.lastAttack >
                ATTACK_TIME
        ) {
            player.attacking = false;

            player.attackType = null;

            player.hitThisAttack = false;
        }
    }
}


// =========================================================
// STEUERUNG
// =========================================================

function handleInput(
    room,
    ws,
    key,
    pressed
) {
    const player =
        room.players.get(
            ws.playerId
        );

    if (
        !player ||
        !player.active ||
        room.status !== "playing"
    ) {
        return;
    }

    const normalized =
        String(key).toLowerCase();


    // PLAYER 1 + PLAYER 2 LINKS
    if (
        normalized === "a" ||
        normalized === "arrowleft" ||
        normalized === "left"
    ) {
        if (pressed) {
            player.vx = -MOVE_SPEED;

            player.direction = -1;
        }

        return;
    }


    // PLAYER 1 + PLAYER 2 RECHTS
    if (
        normalized === "d" ||
        normalized === "arrowright" ||
        normalized === "right"
    ) {
        if (pressed) {
            player.vx = MOVE_SPEED;

            player.direction = 1;
        }

        return;
    }


    // SPRINGEN
    if (
        pressed &&
        (
            normalized === "w" ||
            normalized === "arrowup" ||
            normalized === "up"
        )
    ) {
        const floor =
            GROUND_Y -
            PLAYER_HEIGHT;

        const onGround =
            player.y >= floor - 2;

        if (onGround) {
            player.vy = JUMP_SPEED;
        }

        return;
    }


    // SCHLAG
    if (
        pressed &&
        (
            normalized === "f" ||
            normalized === "numpad1"
        )
    ) {
        attack(
            room,
            player,
            "punch"
        );

        return;
    }


    // TRITT
    if (
        pressed &&
        (
            normalized === "g" ||
            normalized === "numpad2"
        )
    ) {
        attack(
            room,
            player,
            "kick"
        );

        return;
    }
}


// =========================================================
// ANGRIFF
// =========================================================

function attack(
    room,
    player,
    type
) {
    if (!player.active) {
        return;
    }

    const now = Date.now();

    if (
        now -
            player.lastAttack <
        ATTACK_COOLDOWN
    ) {
        return;
    }

    player.lastAttack = now;

    player.attacking = true;

    player.attackType = type;

    player.hitThisAttack = false;
}


// =========================================================
// ANGRIFFE AUSWERTEN
// =========================================================

function updateAttacks(room) {
    if (room.status !== "playing") {
        return;
    }

    for (const player of room.players.values()) {
        if (
            !player.active ||
            !player.attacking
        ) {
            continue;
        }

        const opponent =
            getOpponent(
                room,
                player
            );

        if (!opponent) {
            continue;
        }

        const playerCenter =
            player.x +
            PLAYER_WIDTH / 2;

        const opponentCenter =
            opponent.x +
            PLAYER_WIDTH / 2;

        const distance =
            Math.abs(
                playerCenter -
                opponentCenter
            );

        const attackRange =
            player.attackType === "kick"
                ? 95
                : 75;

        const opponentIsInFront =
            player.direction === 1
                ? opponentCenter >=
                  playerCenter - 10
                : opponentCenter <=
                  playerCenter + 10;

        if (
            distance <= attackRange &&
            opponentIsInFront &&
            !player.hitThisAttack
        ) {
            const damage =
                player.attackType === "kick"
                    ? KICK_DAMAGE
                    : PUNCH_DAMAGE;

            opponent.hp -= damage;

            player.hitThisAttack = true;

            if (opponent.hp <= 0) {
                opponent.hp = 0;

                opponent.active = false;

                player.attacking = false;

                player.attackType = null;

                room.winner = player.id;

                room.status = "finished";

                broadcastState(room);

                return;
            }
        }

        if (
            Date.now() -
                player.lastAttack >
            ATTACK_TIME
        ) {
            player.attacking = false;

            player.attackType = null;

            player.hitThisAttack = false;
        }
    }
}


// =========================================================
// RESET
// =========================================================

function resetRoom(
    room,
    ws
) {
    const players =
        getPlayers(room);

    if (players.length === 0) {
        return;
    }

    // Nur PLAYER 1 darf neue Runde starten
    if (
        ws.playerId !==
        players[0].id
    ) {
        return;
    }

    if (room.loop) {
        clearInterval(
            room.loop
        );

        room.loop = null;
    }

    if (room.countdownTimer) {
        clearInterval(
            room.countdownTimer
        );

        room.countdownTimer = null;
    }

    players.forEach((player, index) => {
        player.hp = START_HP;

        player.active = true;

        player.attacking = false;

        player.attackType = null;

        player.lastAttack = 0;

        player.hitThisAttack = false;

        player.vx = 0;

        player.vy = 0;

        player.x =
            index === 0
                ? 200
                : 750;

        player.y =
            GROUND_Y -
            PLAYER_HEIGHT;

        player.direction =
            index === 0
                ? 1
                : -1;
    });

    room.winner = null;

    room.status = "countdown";

    room.countdown = 3;

    broadcastState(room);

    startCountdown(room);
}


// =========================================================
// DISCONNECT
// =========================================================

function handleDisconnect(ws) {
    const room =
        rooms.get(
            ws.roomCode
        );

    if (!room) {
        return;
    }

    const player =
        room.players.get(
            ws.playerId
        );

    if (!player) {
        return;
    }

    player.ws = null;

    player.active = false;

    // Wenn während des Spiels getrennt wird,
    // gewinnt der andere Spieler.
    if (
        room.status === "playing"
    ) {
        const opponent =
            getOpponent(
                room,
                player
            );

        room.status = "finished";

        if (opponent) {
            room.winner =
                opponent.id;
        }

        broadcastState(room);

        return;
    }

    // Beim Warten einfach Raum entfernen,
    // wenn PLAYER 1 verschwindet.
    if (
        room.status === "waiting"
    ) {
        rooms.delete(room.code);

        return;
    }

    broadcastState(room);
}


// =========================================================
// WEBSOCKET EVENTS
// =========================================================

wss.on(
    "connection",
    ws => {
        send(
            ws,
            "connected"
        );


        ws.on(
            "message",
            raw => {
                let message;

                try {
                    message =
                        JSON.parse(
                            raw.toString()
                        );
                } catch (error) {
                    send(
                        ws,
                        "error",
                        {
                            message:
                                "Ungültige Nachricht."
                        }
                    );

                    return;
                }


                // =========================================
                // RAUM ERSTELLEN
                // =========================================

                if (
                    message.type ===
                    "createRoom"
                ) {
                    createRoom(ws);

                    return;
                }


                // =========================================
                // RAUM BEITRETEN
                // =========================================

                if (
                    message.type ===
                    "joinRoom"
                ) {
                    const code =
                        String(
                            message.roomCode ||
                            message.code ||
                            ""
                        )
                        .trim()
                        .toUpperCase();

                    if (code.length !== 6) {
                        send(
                            ws,
                            "error",
                            {
                                message:
                                    "Ungültiger Raumcode."
                            }
                        );

                        return;
                    }

                    joinRoom(
                        code,
                        ws
                    );

                    return;
                }


                // =========================================
                // SPIELER MUSS BEREITS IN EINEM RAUM SEIN
                // =========================================

                const room =
                    rooms.get(
                        ws.roomCode
                    );

                if (!room) {
                    send(
                        ws,
                        "error",
                        {
                            message:
                                "Kein Raum."
                        }
                    );

                    return;
                }


                // =========================================
                // INPUT
                // =========================================

                if (
                    message.type ===
                    "input"
                ) {
                    handleInput(
                        room,
                        ws,
                        message.key,
                        Boolean(
                            message.pressed
                        )
                    );

                    return;
                }


                // =========================================
                // RESET
                // =========================================

                if (
                    message.type ===
                    "reset"
                ) {
                    resetRoom(
                        room,
                        ws
                    );

                    return;
                }
            }
        );


        ws.on(
            "close",
            () => {
                handleDisconnect(ws);
            }
        );


        ws.on(
            "error",
            () => {
                handleDisconnect(ws);
            }
        );
    }
);


// =========================================================
// SERVER START
// =========================================================

server.listen(
    PORT,
    "0.0.0.0",
    () => {
        console.log(
            `Stickman Fight läuft auf Port ${PORT}`
        );
    }
);
