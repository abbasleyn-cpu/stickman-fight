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

const symbols = ["🔵", "🔴"];


/* =========================================================
   HTTP SERVER
========================================================= */

const server = http.createServer((req, res) => {

    let filePath;

    if (req.url === "/") {

        filePath =
            path.join(
                __dirname,
                "public",
                "index.html"
            );

    } else {

        const cleanUrl =
            decodeURIComponent(
                req.url.split("?")[0]
            );

        filePath =
            path.join(
                __dirname,
                "public",
                cleanUrl
            );
    }


    fs.readFile(
        filePath,
        (error, data) => {

            if (error) {

                res.writeHead(
                    404,
                    {
                        "Content-Type":
                            "text/plain; charset=utf-8"
                    }
                );

                res.end(
                    "404 - Datei nicht gefunden"
                );

                return;
            }


            let contentType =
                "text/plain; charset=utf-8";


            if (
                filePath.endsWith(".html")
            ) {

                contentType =
                    "text/html; charset=utf-8";

            } else if (
                filePath.endsWith(".js")
            ) {

                contentType =
                    "application/javascript; charset=utf-8";

            } else if (
                filePath.endsWith(".css")
            ) {

                contentType =
                    "text/css; charset=utf-8";

            }


            res.writeHead(
                200,
                {
                    "Content-Type":
                        contentType
                }
            );


            res.end(data);
        }
    );
});


/* =========================================================
   WEBSOCKET
========================================================= */

const wss =
    new WebSocket.Server({
        server
    });


/* =========================================================
   HILFSFUNKTIONEN
========================================================= */

function send(ws, type, data = {}) {

    if (
        ws &&
        ws.readyState ===
            WebSocket.OPEN
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

    let code = "";

    do {

        code = "";

        for (
            let i = 0;
            i < 6;
            i++
        ) {

            code +=
                chars[
                    Math.floor(
                        Math.random() *
                        chars.length
                    )
                ];
        }

    } while (
        rooms.has(code)
    );


    return code;
}


function randomId() {

    return crypto.randomUUID();
}


function addLog(
    room,
    message
) {

    room.log.push(message);

    if (
        room.log.length > 50
    ) {

        room.log =
            room.log.slice(-50);
    }
}


function currentOpponent(
    room,
    player
) {

    for (
        const other
        of room.players.values()
    ) {

        if (
            other.id !== player.id &&
            other.active
        ) {

            return other;
        }
    }

    return null;
}


/* =========================================================
   SPIELSTAND
========================================================= */

function publicState(room) {

    return {

        roomCode:
            room.code,

        status:
            room.status,

        players:
            [...room.players.values()]
                .map(
                    player => ({

                        id:
                            player.id,

                        name:
                            player.name,

                        symbol:
                            player.symbol,

                        x:
                            player.x,

                        y:
                            player.y,

                        hp:
                            player.hp,

                        facing:
                            player.facing,

                        attacking:
                            player.attacking,

                        attackType:
                            player.attackType,

                        active:
                            player.active,

                        connected:
                            Boolean(
                                player.ws
                            )
                    })
                ),

        countdown:
            room.countdown,

        winner:
            room.winner,

        log:
            room.log.slice(-50)
    };
}


function broadcastState(room) {

    const state =
        publicState(room);


    for (
        const player
        of room.players.values()
    ) {

        send(
            player.ws,
            "state",
            {
                game:
                    state,

                yourId:
                    player.id
            }
        );
    }
}


/* =========================================================
   RAUM ERSTELLEN
========================================================= */

function createRoom(
    name,
    ws
) {

    const code =
        randomRoomCode();

    const id =
        randomId();


    const player = {

        id,

        name,

        symbol:
            symbols[0],

        x:
            200,

        y:
            GROUND_Y -

            PLAYER_HEIGHT,

        vx:
            0,

        vy:
            0,

        hp:
            START_HP,

        facing:
            1,

        attacking:
            false,

        attackType:
            null,

        lastAttack:
            0,

        active:
            true,

        ws
    };


    const room = {

        code,

        status:
            "waiting",

        countdown:
            0,

        winner:
            null,

        players:
            new Map([
                [id, player]
            ]),

        log:
            []
    };


    rooms.set(
        code,
        room
    );


    ws.roomCode =
        code;

    ws.playerId =
        id;


    addLog(
        room,
        `🏠 Raum ${code} wurde erstellt.`
    );


    addLog(
        room,
        `👤 ${name} wartet auf Spieler 2.`
    );


    return room;
}


/* =========================================================
   RAUM BEITRETEN
========================================================= */

function joinRoom(
    code,
    name,
    ws
) {

    const room =
        rooms.get(code);


    if (!room) {

        send(
            ws,
            "error",
            {
                message:
                    "Raum nicht gefunden."
            }
        );

        return;
    }


    if (
        room.players.size >=
        MAX_PLAYERS
    ) {

        send(
            ws,
            "error",
            {
                message:
                    "Der Raum ist voll."
            }
        );

        return;
    }


    if (
        room.status !==
        "waiting"
    ) {

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


    const names =
        [...room.players.values()]
            .map(
                player =>
                    player.name.toLowerCase()
            );


    if (
        names.includes(
            name.toLowerCase()
        )
    ) {

        send(
            ws,
            "error",
            {
                message:
                    "Dieser Name wird bereits benutzt."
            }
        );

        return;
    }


    const id =
        randomId();


    const player = {

        id,

        name,

        symbol:
            symbols[1],

        x:
            750,

        y:
            GROUND_Y -
            PLAYER_HEIGHT,

        vx:
            0,

        vy:
            0,

        hp:
            START_HP,

        facing:
            -1,

        attacking:
            false,

        attackType:
            null,

        lastAttack:
            0,

        active:
            true,

        ws
    };


    room.players.set(
        id,
        player
    );


    ws.roomCode =
        code;

    ws.playerId =
        id;


    addLog(
        room,
        `👤 ${name} ist beigetreten.`
    );


    /*
     * WICHTIG:
     * Eigene Spieler-ID sofort senden.
     */

    send(
        ws,
        "roomJoined",
        {
            roomCode:
                code,

            playerId:
                id
        }
    );


    /*
     * Spiel kann jetzt starten.
     */

    room.status =
        "countdown";

    room.countdown =
        3;


    broadcastState(room);


    startCountdown(room);
}


/* =========================================================
   COUNTDOWN
========================================================= */

function startCountdown(room) {

    let value =
        3;


    const timer =
        setInterval(
            () => {

                if (
                    !rooms.has(room.code)
                ) {

                    clearInterval(timer);

                    return;
                }


                value--;


                room.countdown =
                    value;


                broadcastState(room);


                if (
                    value <= 0
                ) {

                    clearInterval(timer);


                    room.status =
                        "playing";


                    addLog(
                        room,
                        "🥊 KÄMPFT!"
                    );


                    broadcastState(room);

                    startGameLoop(room);
                }

            },
            1000
        );
}


/* =========================================================
   SPIELLOOP
========================================================= */

function startGameLoop(room) {

    if (
        room.loop
    ) {
        return;
    }


    room.loop =
        setInterval(
            () => {

                if (
                    room.status !==
                    "playing"
                ) {

                    clearInterval(
                        room.loop
                    );

                    room.loop =
                        null;

                    return;
                }


                updatePhysics(room);

                updateAttacks(room);

                broadcastState(room);

            },
            50
        );
}


/* =========================================================
   PHYSIK
========================================================= */

function updatePhysics(room) {

    for (
        const player
        of room.players.values()
    ) {

        if (
            !player.active
        ) {
            continue;
        }


        player.x +=
            player.vx;


        player.y +=
            player.vy;


        player.vy +=
            GRAVITY;


        /*
         * Boden
         */

        const floor =
            GROUND_Y -
            PLAYER_HEIGHT;


        if (
            player.y >=
            floor
        ) {

            player.y =
                floor;

            player.vy =
                0;
        }


        /*
         * Spielfeldgrenzen
         */

        player.x =
            Math.max(
                20,
                Math.min(
                    WORLD_WIDTH -
                    PLAYER_WIDTH -
                    20,
                    player.x
                )
            );


        /*
         * Reibung
         */

        player.vx *=
            0.75;


        /*
         * Richtung
         */

        if (
            Math.abs(player.vx) > 0.1
        ) {

            player.facing =
                player.vx >= 0
                    ? 1
                    : -1;
        }


        /*
         * Angriff nach kurzer Zeit
         * automatisch beenden
         */

        if (
            player.attacking
            &&
            Date.now() -
                player.lastAttack
            >
                180
        ) {

            player.attacking =
                false;

            player.attackType =
                null;
        }
    }
}


/* =========================================================
   STEUERUNG
========================================================= */

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
        room.status !==
            "playing"
    ) {

        return;
    }


    const normalized =
        String(key).toLowerCase();


    if (
        normalized === "left"
        ||
        normalized === "arrowleft"
        ||
        normalized === "a"
    ) {

        player.vx =
            pressed
                ? -MOVE_SPEED
                : player.vx;


        if (pressed) {

            player.facing =
                -1;
        }


        return;
    }


    if (
        normalized === "right"
        ||
        normalized === "arrowright"
        ||
        normalized === "d"
    ) {

        player.vx =
            pressed
                ? MOVE_SPEED
                : player.vx;


        if (pressed) {

            player.facing =
                1;
        }


        return;
    }


    if (
        pressed &&
        (
            normalized === "up"
            ||
            normalized === "arrowup"
            ||
            normalized === "w"
        )
    ) {

        const floor =
            GROUND_Y -
            PLAYER_HEIGHT;


        const onGround =
            player.y >=
            floor - 2;


        if (
            onGround
        ) {

            player.vy =
                JUMP_SPEED;
        }


        return;
    }


    if (
        pressed
        &&
        (
            normalized === "f"
            ||
            normalized === "numpad1"
            ||
            normalized === " "
        )
    ) {

        attack(
            room,
            player,
            "punch"
        );

        return;
    }


    if (
        pressed
        &&
        (
            normalized === "g"
            ||
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


/* =========================================================
   ANGRIFF
========================================================= */

function attack(
    room,
    player,
    type
) {

    const now =
        Date.now();


    if (
        now -
            player.lastAttack
        <
        ATTACK_COOLDOWN
    ) {

        return;
    }


    player.lastAttack =
        now;


    player.attacking =
        true;


    player.attackType =
        type;
}


/* =========================================================
   ANGRIFFE AUSWERTEN
========================================================= */

function updateAttacks(room) {

    for (
        const player
        of room.players.values()
    ) {

        if (
            !player.active ||
            !player.attacking
        ) {

            continue;
        }


        const opponent =
            currentOpponent(
                room,
                player
            );


        if (!opponent) {
            continue;
        }


        const distance =
            Math.abs(
                (
                    player.x +
                    PLAYER_WIDTH / 2
                )
                -
                (
                    opponent.x +
                    PLAYER_WIDTH / 2
                )
            );


        const attackRange =
            player.attackType ===
                "kick"
                ? 95
                : 75;


        if (
            distance <=
            attackRange
        ) {

            /*
             * Nur einmal pro Angriff treffen.
             */

            if (
                !player.hitThisAttack
            ) {

                const damage =
                    player.attackType ===
                        "kick"
                        ? KICK_DAMAGE
                        : PUNCH_DAMAGE;


                opponent.hp -=
                    damage;


                player.hitThisAttack =
                    true;


                addLog(
                    room,
                    `${player.symbol} ${player.name} trifft ${opponent.symbol} ${opponent.name} mit ${player.attackType === "kick" ? "einem Tritt" : "einem Schlag"} (-${damage} HP).`
                );


                if (
                    opponent.hp <= 0
                ) {

                    opponent.hp =
                        0;

                    opponent.active =
                        false;

                    room.status =
                        "finished";

                    room.winner =
                        player.id;


                    addLog(
                        room,
                        `🏆 ${player.symbol} ${player.name} gewinnt!`
                    );

                }
            }
        }


        /*
         * Angriff vorbei
         */

        if (
            Date.now() -
                player.lastAttack
            >
            180
        ) {

            player.attacking =
                false;

            player.attackType =
                null;

            player.hitThisAttack =
                false;
        }
    }


    /*
     * Wenn das Spiel noch läuft,
     * aber jemand HP 0 hat.
     */

    for (
        const player
        of room.players.values()
    ) {

        if (
            player.hp <= 0
        ) {

            player.active =
                false;
        }
    }
}


/* =========================================================
   RESET
========================================================= */

function resetRoom(
    room,
    ws
) {

    if (
        room.players.size === 0
    ) {
        return;
    }


    const players =
        [
            ...room.players.values()
        ];


    if (
        ws.playerId !==
        players[0].id
    ) {

        return;
    }


    for (
        let i = 0;
        i < players.length;
        i++
    ) {

        const player =
            players[i];


        player.hp =
            START_HP;


        player.active =
            true;


        player.attacking =
            false;


        player.attackType =
            null;


        player.vx =
            0;


        player.vy =
            0;


        player.x =
            i === 0
                ? 200
                : 750;


        player.y =
            GROUND_Y -
            PLAYER_HEIGHT;


        player.facing =
            i === 0
                ? 1
                : -1;
    }


    room.status =
        "countdown";


    room.winner =
        null;


    room.countdown =
        3;


    room.log =
        [];


    addLog(
        room,
        "🔄 Neue Runde!"
    );


    broadcastState(room);


    startCountdown(room);
}


/* =========================================================
   DISCONNECT
========================================================= */

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


    player.ws =
        null;


    addLog(
        room,
        `🔌 ${player.symbol} ${player.name} ist offline.`
    );


    if (
        room.status ===
        "playing"
    ) {

        room.status =
            "finished";


        const opponent =
            currentOpponent(
                room,
                player
            );


        if (opponent) {

            room.winner =
                opponent.id;

            addLog(
                room,
                `🏆 ${opponent.symbol} ${opponent.name} gewinnt, weil ${player.name} getrennt wurde.`
            );
        }
    }


    broadcastState(room);
}


/* =========================================================
   WEBSOCKET EVENTS
========================================================= */

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

                } catch {

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


                /*
                 * Raum erstellen
                 */

                if (
                    message.type ===
                    "createRoom"
                ) {

                    const name =
                        String(
                            message.name ||
                            ""
                        )
                            .trim()
                            .slice(0, 20);


                    if (!name) {

                        send(
                            ws,
                            "error",
                            {
                                message:
                                    "Bitte Namen eingeben."
                            }
                        );

                        return;
                    }


                    const room =
                        createRoom(
                            name,
                            ws
                        );


                    send(
                        ws,
                        "roomCreated",
                        {
                            roomCode:
                                room.code,

                            playerId:
                                ws.playerId
                        }
                    );


                    broadcastState(room);

                    return;
                }


                /*
                 * Raum beitreten
                 */

                if (
                    message.type ===
                    "joinRoom"
                ) {

                    const name =
                        String(
                            message.name ||
                            ""
                        )
                            .trim()
                            .slice(0, 20);


                    const code =
                        String(
                            message.code ||
                            ""
                        )
                            .trim()
                            .toUpperCase();


                    joinRoom(
                        code,
                        name,
                        ws
                    );


                    return;
                }


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


                /*
                 * Eingabe
                 */

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


                /*
                 * Reset
                 */

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


/* =========================================================
   SERVER START
========================================================= */

server.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            `Stickman Fight läuft auf Port ${PORT}`
        );

    }
);
